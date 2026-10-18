import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { runRetention } from './jobs/retention.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

try {
  await migrate();
} catch (err) {
  console.error('\nSafeZone could not start the database: ' + (err.message || err.code));
  console.error('If you set DATABASE_URL in backend/.env, check that PostgreSQL is running and the URL is right.');
  console.error('To use the built-in database instead, delete the DATABASE_URL line from backend/.env.\n');
  process.exit(1);
}
// First run on the built-in database: create the demo accounts so there is something to sign in with.
if (pool.embedded && !config.isProd && process.env.AUTO_SEED !== 'false') {
  const { rowCount } = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (!rowCount) { await seed(); console.log('Created demo accounts (password: SafeZone#Demo2026).'); }
}
const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`SafeZone is running: open http://localhost:${config.port}  (${config.env}, database: ${pool.embedded ? 'built-in' : 'PostgreSQL'})`);
});

// Daily data retention. Failures are logged, never fatal.
const runJob = () => runRetention().then((r) => console.log('[retention]', JSON.stringify(r))).catch((e) => console.error('[retention] failed:', e.message));
if (config.runRetentionOnStart) runJob();
const timer = setInterval(runJob, 24 * 60 * 60 * 1000);
timer.unref();

const shutdown = () => { server.close(() => pool.end().then(() => process.exit(0))); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
