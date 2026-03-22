import type { PluginRuntimeRecord } from "./plugin-engine";
import type { PluginInstallRepository } from "../repositories/plugin-install-repository";

export interface MarketplacePluginRecord {
  name: string;
  version: string;
  author: string;
  description?: string;
  status: "enabled" | "disabled";
  permissions: string[];
  installed: boolean;
}

interface MarketplaceServiceOptions {
  pluginEngine: {
    list(): PluginRuntimeRecord[];
  };
  pluginInstallRepository: PluginInstallRepository;
}

export class MarketplaceService {
  constructor(private readonly options: MarketplaceServiceOptions) {}

  async listCatalog(organizationId: string): Promise<MarketplacePluginRecord[]> {
    const plugins = this.options.pluginEngine.list();
    const catalog = await Promise.all(
      plugins.map(async (plugin) => {
        const installed = await this.options.pluginInstallRepository.isInstalled(
          organizationId,
          plugin.manifest.name
        );

        const record: MarketplacePluginRecord = {
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          author: plugin.manifest.author,
          status: plugin.status,
          permissions: [...plugin.manifest.permissions],
          installed
        };

        if (plugin.manifest.description !== undefined) {
          record.description = plugin.manifest.description;
        }

        return record;
      })
    );

    return catalog.sort((a, b) => a.name.localeCompare(b.name));
  }
}
