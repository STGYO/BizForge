import type { Pool } from "pg";
import type { PluginDatabaseClient, PluginQueryResult } from "@bizforge/plugin-sdk";

class InMemoryPluginDatabaseClient implements PluginDatabaseClient {
  readonly mode = "in-memory" as const;
  readonly isAvailable = false;

  async query<TRow = Record<string, unknown>>(): Promise<PluginQueryResult<TRow>> {
    throw new Error("Plugin database is not available in in-memory mode");
  }
}

class PostgresPluginDatabaseClient implements PluginDatabaseClient {
  readonly mode = "postgres" as const;
  readonly isAvailable = true;

  constructor(private readonly pool: Pool) {}

  async query<TRow = Record<string, unknown>>(
    text: string,
    params: unknown[] = []
  ): Promise<PluginQueryResult<TRow>> {
    const result = await this.pool.query(text, params);
    return {
      rows: result.rows as TRow[],
      rowCount: result.rowCount ?? 0
    };
  }
}

export function createPluginDatabaseClient(pool: Pool | null): PluginDatabaseClient {
  if (!pool) {
    return new InMemoryPluginDatabaseClient();
  }

  return new PostgresPluginDatabaseClient(pool);
}
