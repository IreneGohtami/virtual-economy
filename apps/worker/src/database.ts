import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

/**
 * Get or create the shared PostgreSQL connection pool for the worker process.
 * Uses environment variables for configuration (same as the API app).
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env['DB_HOST'] || 'localhost',
      port: parseInt(process.env['DB_PORT'] || '5432', 10),
      database: process.env['DB_NAME'] || 'sea_commodity_tycoon',
      user: process.env['DB_USER'] || 'postgres',
      password: process.env['DB_PASSWORD'] || 'postgres',
      max: parseInt(process.env['DB_POOL_SIZE'] || '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      console.error('[Database] Unexpected pool error:', err);
    });
  }

  return pool;
}

/**
 * Execute a query using the shared pool.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

/**
 * Get a client from the pool for transactional work.
 * Caller must release the client when done.
 */
export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

/**
 * Close the database pool. Called during graceful shutdown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[Database] Pool closed');
  }
}
