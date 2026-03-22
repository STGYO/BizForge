interface InstallRecord {
  organizationId: string;
  pluginName: string;
  installedVersion: string;
  status: "installed" | "uninstalled";
  installedAt: string;
}

export interface PluginInstallRepository {
  markInstalled(input: {
    organizationId: string;
    pluginName: string;
    installedVersion: string;
  }): Promise<void>;
  markUninstalled(input: { organizationId: string; pluginName: string }): Promise<void>;
  isInstalled(organizationId: string, pluginName: string): Promise<boolean>;
  countOrganizationsForPlugin(pluginName: string): Promise<number>;
}

function recordKey(organizationId: string, pluginName: string): string {
  return `${organizationId}:${pluginName}`;
}

export class InMemoryPluginInstallRepository implements PluginInstallRepository {
  private readonly installs = new Map<string, InstallRecord>();

  async markInstalled(input: {
    organizationId: string;
    pluginName: string;
    installedVersion: string;
  }): Promise<void> {
    this.installs.set(recordKey(input.organizationId, input.pluginName), {
      organizationId: input.organizationId,
      pluginName: input.pluginName,
      installedVersion: input.installedVersion,
      status: "installed",
      installedAt: new Date().toISOString()
    });
  }

  async markUninstalled(input: { organizationId: string; pluginName: string }): Promise<void> {
    this.installs.delete(recordKey(input.organizationId, input.pluginName));
  }

  async isInstalled(organizationId: string, pluginName: string): Promise<boolean> {
    return this.installs.has(recordKey(organizationId, pluginName));
  }

  async countOrganizationsForPlugin(pluginName: string): Promise<number> {
    let count = 0;
    for (const install of this.installs.values()) {
      if (install.pluginName === pluginName) {
        count += 1;
      }
    }
    return count;
  }
}
