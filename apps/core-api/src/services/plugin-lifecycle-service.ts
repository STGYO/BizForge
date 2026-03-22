import type { AutomationEngine } from "./automation-engine";
import type { PluginEngine } from "./plugin-engine";
import type { PluginInstallRepository } from "../repositories/plugin-install-repository";

type LifecycleErrorCode = "plugin_not_found" | "plugin_in_use" | "plugin_not_installed";

interface LifecycleError {
  httpStatus: 404 | 409;
  code: LifecycleErrorCode;
  message: string;
}

type LifecycleOutcome =
  | {
      ok: true;
      status: "installed" | "uninstalled";
      plugin: string;
    }
  | {
      ok: false;
      error: LifecycleError;
    };

interface PluginLifecycleServiceOptions {
  pluginEngine: Pick<PluginEngine, "list" | "enable" | "disable">;
  automationEngine: Pick<AutomationEngine, "listRules">;
  pluginInstallRepository?: PluginInstallRepository;
}

export class PluginLifecycleService {
  constructor(private readonly options: PluginLifecycleServiceOptions) {}

  async installPlugin(name: string, organizationId?: string): Promise<LifecycleOutcome> {
    const plugin = this.findPlugin(name);
    if (!plugin) {
      return {
        ok: false,
        error: {
          httpStatus: 404,
          code: "plugin_not_found",
          message: "Plugin not found"
        }
      };
    }

    this.options.pluginEngine.enable(name);

    if (organizationId && this.options.pluginInstallRepository) {
      await this.options.pluginInstallRepository.markInstalled({
        organizationId,
        pluginName: name,
        installedVersion: plugin.manifest.version
      });
    }

    return {
      ok: true,
      status: "installed",
      plugin: name
    };
  }

  async uninstallPlugin(name: string, organizationId: string): Promise<LifecycleOutcome> {
    if (!this.findPlugin(name)) {
      return {
        ok: false,
        error: {
          httpStatus: 404,
          code: "plugin_not_found",
          message: "Plugin not found"
        }
      };
    }

    if (this.options.pluginInstallRepository) {
      const isInstalledForOrg = await this.options.pluginInstallRepository.isInstalled(
        organizationId,
        name
      );

      if (!isInstalledForOrg) {
        return {
          ok: false,
          error: {
            httpStatus: 409,
            code: "plugin_not_installed",
            message: "Plugin is not installed for organization"
          }
        };
      }
    }

    const rules = await this.options.automationEngine.listRules(organizationId);
    const activeReferences = rules.some((rule) =>
      rule.actions.some((action) => action.plugin === name)
    );

    if (activeReferences) {
      return {
        ok: false,
        error: {
          httpStatus: 409,
          code: "plugin_in_use",
          message: "Plugin is referenced by active automation rules"
        }
      };
    }

    if (this.options.pluginInstallRepository) {
      await this.options.pluginInstallRepository.markUninstalled({
        organizationId,
        pluginName: name
      });

      const totalInstalls = await this.options.pluginInstallRepository.countOrganizationsForPlugin(
        name
      );

      if (totalInstalls === 0) {
        this.options.pluginEngine.disable(name);
      }
    } else {
      this.options.pluginEngine.disable(name);
    }

    return {
      ok: true,
      status: "uninstalled",
      plugin: name
    };
  }

  private findPlugin(name: string) {
    return this.options.pluginEngine.list().find((entry) => entry.manifest.name === name);
  }
}