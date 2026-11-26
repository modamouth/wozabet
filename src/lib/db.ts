import { SCHEMA } from './schema';

export type Q = <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
export interface Db {
  q: Q;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Embedded Postgres (PGlite) for dev/tests. Same SQL dialect as production Postgres. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir && !dataDir.includes('://')) (await import('node:fs')).mkdirSync(dataDir, { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.exec(SCHEMA);
  const mk = (c: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }): Q => async (sql, params) =>
    (await c.query(sql, params as any[])).rows as any[];
  return {
    q: mk(pg),
    tx: (fn) => pg.transaction((t) => fn(mk(t as any))),
    close: () => pg.close(),
  };
}

/** Real Postgres via node-postgres (production). */
export async function createPgDb(url: string): Promise<Db> {
  const { Pool } = await import('pg');
  // serverless (Vercel) runs many small instances: keep each pool small and use the provider's POOLED connection string
  const pool = new Pool({ connectionString: url, max: process.env.VERCEL ? 3 : 10 });
  // several instances can cold-start at once: an advisory lock makes them create/migrate the schema one at a time
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727274001)');
    await c.query(SCHEMA);
  } finally {
    await c.query('SELECT pg_advisory_unlock(727274001)').catch(() => {});
    c.release();
  }
  const q: Q = async (sql, params) => (await pool.query(sql, params as any[])).rows;
  return {
    q,
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(async (sql, params) => (await c.query(sql, params as any[])).rows);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

const g = globalThis as unknown as { __wozaDb?: Promise<Db> };

/** Singleton used by the app (survives Next.js dev hot reloads). */
export function getDb(): Promise<Db> {
  if (!g.__wozaDb) {
    g.__wozaDb = process.env.DATABASE_URL
      ? createPgDb(process.env.DATABASE_URL)
      : createPgliteDb(process.env.PGLITE_DIR || './.data/pglite');
  }
  return g.__wozaDb;
}
