import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

export async function migrate() {
  const sql = await readFile(fileURLToPath(new URL('./sql/schema.sql', import.meta.url)), 'utf8');
  await pool.query(sql);
}

// `npm run migrate` runs this file directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => console.log('Database schema is up to date.'))
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
