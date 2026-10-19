import pg from 'pg';
import { mkdirSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Two interchangeable database back ends, both real PostgreSQL:
//   - DATABASE_URL set   -> an external PostgreSQL server (production, Docker, tests).
//   - DATABASE_URL unset -> an EMBEDDED PostgreSQL (PGlite) stored in backend/data/. Nothing to install:
//                           this is what makes `start.bat` / `npm start` work on a fresh computer.

// Bigint counts come back as numbers.
pg.types.setTypeParser(20, (v) => Number(v));

// pg-compatible result: for SELECT, rowCount is the number of rows; for writes it is the affected count.
const shape = (r) => ({ rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0, fields: r.fields });

function createEmbeddedPool() {
  let dbPromise;
  const open = () => dbPromise ??= (async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.EMBEDDED_DB_DIR || fileURLToPath(new URL('../data/safezone-db', import.meta.url));
    let db;
    if (dir === 'memory') db = new PGlite({ parsers: { 20: Number } });
    else { mkdirSync(dir, { recursive: true }); db = new PGlite(dir, { parsers: { 20: Number } }); }
    await db.waitReady;
    return db;
  })();

  const run = async (text, params) => {
    const db = await open();
    // No parameters: use the simple protocol, which allows several statements (the schema file needs this).
    if (params === undefined || params.length === 0) {
      const results = await db.exec(text);
      return shape(results[results.length - 1] ?? { rows: [] });
    }
    return shape(await db.query(text, params));
  };

  // One connection only, so work is serialised: a transaction holds the lock until it releases.
  // Code running INSIDE a transaction that calls the pool directly joins that transaction instead of deadlocking.
  let tail = Promise.resolve();
  const lock = () => {
    let release;
    const next = new Promise((r) => { release = r; });
    const ready = tail.then(() => release);
    tail = tail.then(() => next);
    return ready;
  };

  return {
    embedded: true,
    on() {},
    inTx: new AsyncLocalStorage(),
    async query(text, params) { if (this.inTx.getStore()) return run(text, params); const release = await lock(); try { return await run(text, params); } finally { release(); } },
    async connect() {
      const release = await lock();
      let done = false;
      return { query: run, release: () => { if (!done) { done = true; release(); } } };
    },
    async end() { if (dbPromise) { const db = await dbPromise; await db.close(); dbPromise = undefined; } },
  };
}

export const pool = config.databaseUrl
  ? new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 10000, connectionTimeoutMillis: 20000 })
  : createEmbeddedPool();

pool.on('error', (err) => {
  // Log the message only: connection strings and query text can contain sensitive values.
  console.error('[db] idle client error:', err.message);
});

export const query = (text, params) => pool.query(text, params);

// Run several statements atomically.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = pool.embedded ? await pool.inTx.run(true, () => fn(client)) : await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
