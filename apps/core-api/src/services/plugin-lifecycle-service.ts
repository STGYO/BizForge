import type { AutomationEngine } from "./automation-engine";
import type { PluginEngine } from "./plugin-engine";
import type { PluginInstallRepository } from "../repositories/plugin-install-repository";

type LifecycleErrorCode =
  | "plugin_not_found"
  | "plugin_in_use"
  | "plugin_not_installed"
  | "plugin_dependency_missing"
  | "plugin_dependency_conflict"
  | "plugin_core_protected";

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

interface LifecycleMutationOptions {
  force?: boolean;
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

    const missingDependencies = this.findMissingDependencies(plugin.manifest.dependsOn);
    if (missingDependencies.length > 0) {
      return {
        ok: false,
        error: {
          httpStatus: 409,
          code: "plugin_dependency_missing",
          message: `Missing required dependencies: ${missingDependencies.join(", ")}`
        }
      };
    }

    if (organizationId && this.options.pluginInstallRepository) {
      const unresolvedInstalls: string[] = [];
      for (const dependencyName of plugin.manifest.dependsOn ?? []) {
        const installed = await this.options.pluginInstallRepository.isInstalled(
          organizationId,
          dependencyName
        );
        if (!installed) {
          unresolvedInstalls.push(dependencyName);
        }
      }

      if (unresolvedInstalls.length > 0) {
        return {
          ok: false,
          error: {
            httpStatus: 409,
            code: "plugin_dependency_missing",
            message: `Install dependencies first: ${unresolvedInstalls.join(", ")}`
          }
        };
      }
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

  async disablePlugin(
    name: string,
    options: LifecycleMutationOptions = {}
  ): Promise<LifecycleOutcome> {
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

    const dependents = this.findEnabledDependents(name);
    if (dependents.length > 0 && !options.force) {
      return {
        ok: false,
        error: {
          httpStatus: 409,
          code: "plugin_dependency_conflict",
          message: `Plugin is required by enabled plugins: ${dependents.join(", ")}`
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

  async uninstallPlugin(
    name: string,
    organizationId: string,
    options: LifecycleMutationOptions = {}
  ): Promise<LifecycleOutcome> {
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

    if (plugin.manifest.core && !options.force) {
      return {
        ok: false,
        error: {
          httpStatus: 409,
          code: "plugin_core_protected",
          message: "Core plugins require force override to uninstall"
        }
      };
    }

    const dependents = this.findEnabledDependents(name);
    if (dependents.length > 0 && !options.force) {
      return {
        ok: false,
        error: {
          httpStatus: 409,
          code: "plugin_dependency_conflict",
          message: `Plugin is required by enabled plugins: ${dependents.join(", ")}`
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

  private findEnabledDependents(name: string): string[] {
    return this.options.pluginEngine
      .list()
      .filter((entry) => entry.status === "enabled")
      .filter((entry) => (entry.manifest.dependsOn ?? []).includes(name))
      .map((entry) => entry.manifest.name);
  }

  private findMissingDependencies(dependencyNames: string[] | undefined): string[] {
    if (!dependencyNames || dependencyNames.length === 0) {
      return [];
    }

    const available = new Set(this.options.pluginEngine.list().map((entry) => entry.manifest.name));
    return dependencyNames.filter((dependencyName) => !available.has(dependencyName));
  }
}