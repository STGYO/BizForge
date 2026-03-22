import { randomUUID } from "node:crypto";
import type { SqlClient } from "../services/migration-runner";

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

export class PostgresPluginInstallRepository implements PluginInstallRepository {
  constructor(private readonly client: SqlClient) {}

  async markInstalled(input: {
    organizationId: string;
    pluginName: string;
    installedVersion: string;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO plugins (id, name, latest_version, author)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name)
       DO UPDATE SET latest_version = EXCLUDED.latest_version`,
      [randomUUID(), input.pluginName, input.installedVersion, "BizForge"]
    );

    await this.client.query(
      `INSERT INTO plugin_installs (id, organization_id, plugin_id, installed_version, status)
       VALUES (
         $1,
         $2,
         (SELECT id FROM plugins WHERE name = $3),
         $4,
         'installed'
       )
       ON CONFLICT (organization_id, plugin_id)
       DO UPDATE SET installed_version = EXCLUDED.installed_version, status = 'installed', installed_at = NOW()`,
      [randomUUID(), input.organizationId, input.pluginName, input.installedVersion]
    );
  }

  async markUninstalled(input: { organizationId: string; pluginName: string }): Promise<void> {
    await this.client.query(
      `DELETE FROM plugin_installs
       WHERE organization_id = $1
         AND plugin_id = (SELECT id FROM plugins WHERE name = $2)`,
      [input.organizationId, input.pluginName]
    );
  }

  async isInstalled(organizationId: string, pluginName: string): Promise<boolean> {
    const result = (await this.client.query(
      `SELECT 1
       FROM plugin_installs installs
       JOIN plugins plugins ON plugins.id = installs.plugin_id
       WHERE installs.organization_id = $1
         AND plugins.name = $2
       LIMIT 1`,
      [organizationId, pluginName]
    )) as { rowCount?: number; rows?: unknown[] };

    return (result.rowCount ?? 0) > 0 || (result.rows?.length ?? 0) > 0;
  }

  async countOrganizationsForPlugin(pluginName: string): Promise<number> {
    const result = (await this.client.query(
      `SELECT COUNT(*)::INT AS total
       FROM plugin_installs installs
       JOIN plugins plugins ON plugins.id = installs.plugin_id
       WHERE plugins.name = $1`,
      [pluginName]
    )) as { rows?: Array<{ total?: number }> };

    const total = result.rows?.[0]?.total;
    return typeof total === "number" ? total : 0;
  }
}
