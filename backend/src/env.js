import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Loads backend/.env if it exists (without overriding real environment variables). Works on every Node version.
const file = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
