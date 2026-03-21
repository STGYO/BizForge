import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type PluginManifest, type PluginRegistration } from "@bizforge/plugin-sdk";

interface PluginEngineLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  author: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(z.string()),
  activationEvents: z.array(z.string()),
  backendEntry: z.string().min(1),
  frontendEntry: z.string().min(1)
});

export interface PluginRuntimeRecord {
  manifest: PluginManifest;
  status: "enabled" | "disabled";
  rootPath: string;
  registration: PluginRegistration;
}

interface PluginEngineOptions {
  pluginsDir: string;
  logger?: PluginEngineLogger;
}

interface PluginLoadReport {
  scannedDirectories: number;
  loadedPlugins: number;
  skippedPlugins: number;
  failedPlugins: Array<{ pluginDir: string; reason: string }>;
}

export class PluginEngine {
  private readonly plugins = new Map<string, PluginRuntimeRecord>();
  private lastLoadReport: PluginLoadReport = {
    scannedDirectories: 0,
    loadedPlugins: 0,
    skippedPlugins: 0,
    failedPlugins: []
  };

  constructor(private readonly options: PluginEngineOptions) {}

  async loadInstalledPlugins(): Promise<void> {
    const report: PluginLoadReport = {
      scannedDirectories: 0,
      loadedPlugins: 0,
      skippedPlugins: 0,
      failedPlugins: []
    };
    const claimedRoutes = new Map<string, string>();

    const dir = path.resolve(process.cwd(), this.options.pluginsDir);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
      this.options.logger?.warn("Unable to read plugins directory", { dir });
      return [];
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      report.scannedDirectories += 1;

      const rootPath = path.join(dir, entry.name);
      const manifestPath = path.join(rootPath, "plugin.json");
      const rawManifest = await readFile(manifestPath, "utf-8").catch(() => "");
      if (!rawManifest) {
        report.skippedPlugins += 1;
        report.failedPlugins.push({
          pluginDir: entry.name,
          reason: "Missing plugin.json"
        });
        continue;
      }

      const parsedJson = z.string().transform((text, context) => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid plugin manifest JSON"
          });
          return z.NEVER;
        }
      });
      const parsedManifestJson = parsedJson.safeParse(rawManifest);
      if (!parsedManifestJson.success) {
        report.skippedPlugins += 1;
        report.failedPlugins.push({
          pluginDir: entry.name,
          reason: "Invalid plugin.json JSON"
        });
        continue;
      }

      const parsed = pluginManifestSchema.safeParse(parsedManifestJson.data);
      if (!parsed.success) {
        report.skippedPlugins += 1;
        report.failedPlugins.push({
          pluginDir: entry.name,
          reason: "Invalid plugin manifest schema"
        });
        continue;
      }

      const manifest = parsed.data as PluginManifest;
      const registration = await this.loadRegistration(manifest, rootPath);

      const conflicts = this.findRouteConflicts(claimedRoutes, manifest.name, registration);
      if (conflicts.length > 0) {
        report.skippedPlugins += 1;
        report.failedPlugins.push({
          pluginDir: entry.name,
          reason: `Route conflicts detected: ${conflicts.join(", ")}`
        });

        this.options.logger?.warn("Plugin skipped due to route conflicts", {
          plugin: manifest.name,
          conflicts
        });
        continue;
      }

      if ((registration.handlers ?? {}) && Object.keys(registration.handlers ?? {}).length === 0) {
        this.options.logger?.warn("Plugin loaded without handlers", {
          plugin: manifest.name,
          rootPath
        });
      }

      this.plugins.set(manifest.name, {
        manifest,
        rootPath,
        status: "enabled",
        registration
      });

      report.loadedPlugins += 1;

      for (const route of registration.routes ?? []) {
        claimedRoutes.set(this.routeSignature(route.method, route.path), manifest.name);
      }
    }

    this.lastLoadReport = report;

    this.options.logger?.info("Plugin load completed", {
      scannedDirectories: report.scannedDirectories,
      loadedPlugins: report.loadedPlugins,
      skippedPlugins: report.skippedPlugins,
      failedPlugins: report.failedPlugins
    });
  }

  list(): PluginRuntimeRecord[] {
    return Array.from(this.plugins.values());
  }

  getLoadReport(): PluginLoadReport {
    return this.lastLoadReport;
  }

  disable(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return false;
    }
    plugin.status = "disabled";
    return true;
  }

  enable(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return false;
    }
    plugin.status = "enabled";
    return true;
  }

  private async loadRegistration(
    manifest: PluginManifest,
    rootPath: string
  ): Promise<PluginRegistration> {
    const candidates = this.backendEntryCandidates(manifest.backendEntry);

    for (const candidate of candidates) {
      const entryPath = path.join(rootPath, candidate);

      try {
        const loadedModule = await import(pathToFileURL(entryPath).href);
        const exportedRegistration = this.findRegistrationExport(loadedModule);
        if (!exportedRegistration) {
          this.options.logger?.warn("Plugin backend entry has no registration export", {
            plugin: manifest.name,
            entryPath
          });
          continue;
        }

        return {
          ...exportedRegistration,
          manifest,
          routes: exportedRegistration.routes ?? [],
          triggers: exportedRegistration.triggers ?? [],
          actions: exportedRegistration.actions ?? []
        };
      } catch {
        continue;
      }
    }

    this.options.logger?.warn("Plugin backend registration could not be loaded", {
      plugin: manifest.name,
      candidates
    });

    return {
      manifest,
      routes: [],
      triggers: [],
      actions: []
    };
  }

  private backendEntryCandidates(backendEntry: string): string[] {
    const candidates = new Set<string>();
    candidates.add(backendEntry);

    if (backendEntry.endsWith(".ts")) {
      candidates.add(backendEntry.replace(/\.ts$/, ".js"));
    }

    if (backendEntry.startsWith("src/")) {
      const distEntry = `dist/${backendEntry.slice(4)}`;
      candidates.add(distEntry);
      if (distEntry.endsWith(".ts")) {
        candidates.add(distEntry.replace(/\.ts$/, ".js"));
      }
    }

    return Array.from(candidates);
  }

  private findRegistrationExport(moduleExports: Record<string, unknown>): PluginRegistration | null {
    const values = Object.values(moduleExports);
    for (const value of values) {
      if (this.isPluginRegistration(value)) {
        return value;
      }
    }

    return null;
  }

  private isPluginRegistration(value: unknown): value is PluginRegistration {
    if (!value || typeof value !== "object") {
      return false;
    }

    return "manifest" in value;
  }

  private findRouteConflicts(
    claimedRoutes: Map<string, string>,
    pluginName: string,
    registration: PluginRegistration
  ): string[] {
    const conflicts: string[] = [];

    for (const route of registration.routes ?? []) {
      const signature = this.routeSignature(route.method, route.path);
      const owner = claimedRoutes.get(signature);
      if (owner && owner !== pluginName) {
        conflicts.push(`${signature} already claimed by ${owner}`);
      }
    }

    return conflicts;
  }

  private routeSignature(method: string, pathValue: string): string {
    return `${method.toUpperCase()} ${pathValue}`;
  }
}
