import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const CORE_MIGRATION_SCOPE = "__core__";

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

interface MigrationRunnerLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

interface MigrationRunnerOptions {
  client: SqlClient;
  pluginsDir: string;
  coreSchemaPath: string;
  logger?: MigrationRunnerLogger;
}

interface MigrationScope {
  pluginName: string;
  migrationName: string;
}

interface MigrationFailure extends MigrationScope {
  reason: string;
}

export interface MigrationRunReport {
  applied: MigrationScope[];
  skipped: MigrationScope[];
  failed: MigrationFailure[];
}

export class MigrationRunner {
  constructor(private readonly options: MigrationRunnerOptions) {}

  async run(): Promise<MigrationRunReport> {
    const report: MigrationRunReport = {
      applied: [],
      skipped: [],
      failed: []
    };

    await this.ensureTrackingTable();

    try {
      const corePath = path.resolve(process.cwd(), this.options.coreSchemaPath);
      const coreSql = await readFile(corePath, "utf-8");
      await this.applyMigration(CORE_MIGRATION_SCOPE, path.basename(corePath), coreSql, report);

      const pluginsRoot = path.resolve(process.cwd(), this.options.pluginsDir);
      const pluginEntries = await readdir(pluginsRoot, { withFileTypes: true }).catch(() => []);

      for (const entry of pluginEntries.filter((value) => value.isDirectory())) {
        const pluginName = entry.name;
        const migrationsDir = path.join(pluginsRoot, pluginName, "migrations");
        const migrationFiles = await readdir(migrationsDir, { withFileTypes: true }).catch(() => []);
        const orderedSqlFiles = migrationFiles
          .filter((value) => value.isFile() && value.name.endsWith(".sql"))
          .map((value) => value.name)
          .sort((a, b) => a.localeCompare(b));

        for (const migrationName of orderedSqlFiles) {
          const migrationPath = path.join(migrationsDir, migrationName);
          const migrationSql = await readFile(migrationPath, "utf-8");
          await this.applyMigration(pluginName, migrationName, migrationSql, report);
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown migration failure";
      this.options.logger?.warn("Migration run aborted", { reason, report });
      throw error;
    }

    this.options.logger?.info("Migration run completed", {
      applied: report.applied.length,
      skipped: report.skipped.length,
      failed: report.failed.length
    });

    return report;
  }

  private async applyMigration(
    pluginName: string,
    migrationName: string,
    sql: string,
    report: MigrationRunReport
  ): Promise<void> {
    const alreadyApplied = await this.isApplied(pluginName, migrationName);
    if (alreadyApplied) {
      report.skipped.push({ pluginName, migrationName });
      return;
    }

    await this.options.client.query("BEGIN");
    try {
      await this.options.client.query(sql);
      await this.options.client.query(
        `INSERT INTO schema_migrations (id, plugin_name, migration_name)
         VALUES ($1, $2, $3)`,
        [randomUUID(), pluginName, migrationName]
      );
      await this.options.client.query("COMMIT");
      report.applied.push({ pluginName, migrationName });
    } catch (error) {
      await this.options.client.query("ROLLBACK").catch(() => undefined);
      const reason = error instanceof Error ? error.message : "Failed to apply migration";
      report.failed.push({ pluginName, migrationName, reason });
      throw new Error(`Migration failed for ${pluginName}/${migrationName}: ${reason}`);
    }
  }

  private async isApplied(pluginName: string, migrationName: string): Promise<boolean> {
    const result = (await this.options.client.query(
      `SELECT 1
       FROM schema_migrations
       WHERE plugin_name = $1 AND migration_name = $2
       LIMIT 1`,
      [pluginName, migrationName]
    )) as { rowCount?: number; rows?: unknown[] };

    return (result.rowCount ?? 0) > 0 || (result.rows?.length ?? 0) > 0;
  }

  private async ensureTrackingTable(): Promise<void> {
    await this.options.client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id UUID PRIMARY KEY,
        plugin_name TEXT NOT NULL,
        migration_name TEXT NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (plugin_name, migration_name)
      )
    `);
  }
}