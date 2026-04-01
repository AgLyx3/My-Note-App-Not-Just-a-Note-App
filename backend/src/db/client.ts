import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export type DbClient = NodePgDatabase;

let pool: pg.Pool | null = null;
let db: DbClient | null = null;

export function getDatabaseUrl(): string | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getPool(): pg.Pool | null {
  const url = getDatabaseUrl();
  if (!url) return null;
  if (!pool) {
    pool = new pg.Pool({ connectionString: url });
  }
  return pool;
}

export function getDb(): DbClient | null {
  const p = getPool();
  if (!p) return null;
  if (!db) {
    db = drizzle(p);
  }
  return db;
}

