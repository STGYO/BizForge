import { Pool } from "pg";

let pool: Pool | null = null;

export function getPgPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000
    });
  }

  return pool;
}

export async function checkPostgresHealth(): Promise<boolean> {
  const pgPool = getPgPool();
  if (!pgPool) {
    return false;
  }

  try {
    await pgPool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
