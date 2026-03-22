import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MigrationRunner, type SqlClient } from "./migration-runner";

class FakeSqlClient implements SqlClient {
  readonly executedStatements: string[] = [];
  private readonly applied = new Set<string>();

  constructor(initialApplied: Array<{ pluginName: string; migrationName: string }> = []) {
    for (const migration of initialApplied) {
      this.applied.add(this.key(migration.pluginName, migration.migrationName));
    }
  }

  async query(text: string, values?: unknown[]): Promise<unknown> {
    this.executedStatements.push(text.trim());

    if (text.includes("SELECT 1") && values) {
      const pluginName = String(values[0]);
      const migrationName = String(values[1]);
      const exists = this.applied.has(this.key(pluginName, migrationName));
      return { rowCount: exists ? 1 : 0, rows: exists ? [{ exists: true }] : [] };
    }

    if (text.includes("INSERT INTO schema_migrations") && values) {
      const pluginName = String(values[1]);
      const migrationName = String(values[2]);
      this.applied.add(this.key(pluginName, migrationName));
      return { rowCount: 1, rows: [] };
    }

    if (text.includes("SELECT FAIL_MIGRATION")) {
      throw new Error("Intentional migration failure");
    }

    return { rowCount: 0, rows: [] };
  }

  hasApplied(pluginName: string, migrationName: string): boolean {
    return this.applied.has(this.key(pluginName, migrationName));
  }

  private key(pluginName: string, migrationName: string): string {
    return `${pluginName}::${migrationName}`;
  }
}

async function setupTempMigrations(options?: { failingPluginMigration?: boolean }): Promise<{
  rootDir: string;
  pluginsDir: string;
  coreSchemaPath: string;
}> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "bizforge-migrations-"));
  const pluginsDir = path.join(rootDir, "plugins");
  const coreSchemaPath = path.join(rootDir, "infra", "db", "001_core_schema.sql");
  const pluginMigrationsDir = path.join(pluginsDir, "appointment-manager", "migrations");

  await mkdir(path.dirname(coreSchemaPath), { recursive: true });
  await mkdir(pluginMigrationsDir, { recursive: true });

  await writeFile(coreSchemaPath, "SELECT 1;");
  await writeFile(
    path.join(pluginMigrationsDir, "001_init.sql"),
    options?.failingPluginMigration ? "SELECT FAIL_MIGRATION;" : "SELECT 2;"
  );

  return {
    rootDir,
    pluginsDir,
    coreSchemaPath
  };
}

test("applies core and plugin migrations when not previously tracked", async () => {
  const fixture = await setupTempMigrations();
  const client = new FakeSqlClient();

  const runner = new MigrationRunner({
    client,
    pluginsDir: fixture.pluginsDir,
    coreSchemaPath: fixture.coreSchemaPath
  });

  const report = await runner.run();

  assert.equal(report.failed.length, 0);
  assert.equal(report.applied.length, 2);
  assert.equal(report.skipped.length, 0);
  assert.equal(client.hasApplied("__core__", "001_core_schema.sql"), true);
  assert.equal(client.hasApplied("appointment-manager", "001_init.sql"), true);
});

test("skips migrations already tracked in schema_migrations", async () => {
  const fixture = await setupTempMigrations();
  const client = new FakeSqlClient([
    { pluginName: "__core__", migrationName: "001_core_schema.sql" },
    { pluginName: "appointment-manager", migrationName: "001_init.sql" }
  ]);

  const runner = new MigrationRunner({
    client,
    pluginsDir: fixture.pluginsDir,
    coreSchemaPath: fixture.coreSchemaPath
  });

  const report = await runner.run();

  assert.equal(report.applied.length, 0);
  assert.equal(report.skipped.length, 2);
  assert.equal(report.failed.length, 0);
});

test("rolls back and throws when a migration fails", async () => {
  const fixture = await setupTempMigrations({ failingPluginMigration: true });
  const client = new FakeSqlClient();

  const runner = new MigrationRunner({
    client,
    pluginsDir: fixture.pluginsDir,
    coreSchemaPath: fixture.coreSchemaPath
  });

  await assert.rejects(async () => {
    await runner.run();
  }, /Migration failed for appointment-manager\/001_init.sql/);

  assert.equal(
    client.executedStatements.some((statement) => statement === "ROLLBACK"),
    true
  );
});