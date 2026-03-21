import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type PluginManifest, type PluginRegistration } from "@bizforge/plugin-sdk";

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
}

export class PluginEngine {
  private readonly plugins = new Map<string, PluginRuntimeRecord>();

  constructor(private readonly options: PluginEngineOptions) {}

  async loadInstalledPlugins(): Promise<void> {
    const dir = path.resolve(process.cwd(), this.options.pluginsDir);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const rootPath = path.join(dir, entry.name);
      const manifestPath = path.join(rootPath, "plugin.json");
      const rawManifest = await readFile(manifestPath, "utf-8").catch(() => "");
      if (!rawManifest) {
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
        continue;
      }

      const parsed = pluginManifestSchema.safeParse(parsedManifestJson.data);
      if (!parsed.success) {
        continue;
      }

      const manifest = parsed.data as PluginManifest;
      const registration = await this.loadRegistration(manifest, rootPath);

      this.plugins.set(manifest.name, {
        manifest,
        rootPath,
        status: "enabled",
        registration
      });
    }
  }

  list(): PluginRuntimeRecord[] {
    return Array.from(this.plugins.values());
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
}
