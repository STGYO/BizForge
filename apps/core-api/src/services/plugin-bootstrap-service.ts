import type { PluginLifecycleService } from "./plugin-lifecycle-service";
import { CORE_PLUGIN_IDS } from "./core-plugin-catalog";

interface PluginBootstrapServiceOptions {
  pluginEngine: {
    list: () => Array<{
      manifest: {
        name: string;
        preinstalled?: boolean;
        core?: boolean;
      };
    }>;
  };
  pluginLifecycleService: PluginLifecycleService;
}

export interface PluginBootstrapReport {
  installed: string[];
  skipped: string[];
  failed: Array<{ name: string; reason: string }>;
  missingCore: string[];
}

export class PluginBootstrapService {
  constructor(private readonly options: PluginBootstrapServiceOptions) {}

  async ensurePreinstalledPlugins(organizationId: string): Promise<PluginBootstrapReport> {
    const report: PluginBootstrapReport = {
      installed: [],
      skipped: [],
      failed: [],
      missingCore: []
    };

    const availablePlugins = this.options.pluginEngine.list();
    const availableNames = new Set(availablePlugins.map((plugin) => plugin.manifest.name));

    report.missingCore = CORE_PLUGIN_IDS.filter((name) => !availableNames.has(name));

    const preinstalled = availablePlugins.filter(
      (plugin) => plugin.manifest.preinstalled === true || plugin.manifest.core === true
    );

    for (const plugin of preinstalled) {
      const outcome = await this.options.pluginLifecycleService.installPlugin(
        plugin.manifest.name,
        organizationId
      );

      if (outcome.ok) {
        report.installed.push(plugin.manifest.name);
      } else if (outcome.error.code === "plugin_not_found") {
        report.failed.push({
          name: plugin.manifest.name,
          reason: outcome.error.message
        });
      } else {
        report.skipped.push(plugin.manifest.name);
      }
    }

    return report;
  }
}
