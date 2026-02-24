import { Pool, PoolClient } from 'pg';
import { schema } from './schema';
import { runMigrations } from './migrations';

// Singleton pool pattern for Next.js — prevents connection exhaustion during HMR in dev
declare global {
  var _pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!global._pgPool) {
    global._pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: process.env.NODE_ENV === 'production' ? 10 : 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    global._pgPool.on('error', (err) => {
      console.error('Postgres pool error:', err);
    });
  }
  return global._pgPool;
}

const pool = getPool();

// Track whether schema initialization has been done this process lifecycle
let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true;
  // Create base schema tables (IF NOT EXISTS — safe to run multiple times)
  await pool.query(schema);
  // Run any pending migrations
  await runMigrations(pool);
  console.log('[DB] Postgres initialized');
}

// Type-safe async query helpers
export async function queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureInitialized();
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  await ensureInitialized();
  const result = await pool.query(sql, params);
  return result.rows[0] as T | undefined;
}

export async function run(sql: string, params: unknown[] = []): Promise<void> {
  await ensureInitialized();
  await pool.query(sql, params);
}

// Transaction helper — passes a query function bound to a single client
// so all queries in the transaction share the same connection (required for ROLLBACK)
export async function transaction<T>(
  fn: (query: (sql: string, params?: unknown[]) => Promise<any>) => Promise<T>
): Promise<T> {
  await ensureInitialized();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn((sql, params) => client.query(sql, params ?? []));
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Export for direct pool access (rare cases)
export function getPool_(): Pool {
  return pool;
}

// Export migration utilities for CLI use
export { runMigrations } from './migrations';
