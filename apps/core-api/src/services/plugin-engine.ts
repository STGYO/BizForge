import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
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

      const parsed = pluginManifestSchema.safeParse(JSON.parse(rawManifest));
      if (!parsed.success) {
        continue;
      }

      const manifest = parsed.data as PluginManifest;
      this.plugins.set(manifest.name, {
        manifest,
        rootPath,
        status: "enabled",
        registration: {
          manifest,
          routes: [],
          triggers: [],
          actions: []
        }
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
}
