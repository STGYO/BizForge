import type { AutomationEngine } from "./automation-engine";
import type { PluginEngine } from "./plugin-engine";

type LifecycleErrorCode = "plugin_not_found" | "plugin_in_use";

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
}

export class PluginLifecycleService {
  constructor(private readonly options: PluginLifecycleServiceOptions) {}

  async installPlugin(name: string): Promise<LifecycleOutcome> {
    if (!this.pluginExists(name)) {
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
    return {
      ok: true,
      status: "installed",
      plugin: name
    };
  }

  async uninstallPlugin(name: string, organizationId: string): Promise<LifecycleOutcome> {
    if (!this.pluginExists(name)) {
      return {
        ok: false,
        error: {
          httpStatus: 404,
          code: "plugin_not_found",
          message: "Plugin not found"
        }
      };
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

    this.options.pluginEngine.disable(name);
    return {
      ok: true,
      status: "uninstalled",
      plugin: name
    };
  }

  private pluginExists(name: string): boolean {
    return this.options.pluginEngine
      .list()
      .some((entry) => entry.manifest.name === name);
  }
}