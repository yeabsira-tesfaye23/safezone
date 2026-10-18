import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { requestLogger } from './middleware/logger.js';
import admin from './routes/admin.js';
import auth from './routes/auth.js';
import checkins from './routes/checkins.js';
import contacts from './routes/contacts.js';
import links from './routes/links.js';
import me from './routes/me.js';
import notifications from './routes/notifications.js';
import reports from './routes/reports.js';
import sos from './routes/sos.js';
import zones from './routes/zones.js';

// The built index.html carries one tiny inline script (a help message for people who open it as a file).
// Allow exactly that script by its hash instead of weakening the policy with 'unsafe-inline'.
function inlineScriptHashes() {
  try {
    const html = readFileSync(fileURLToPath(new URL('../../frontend/dist/index.html', import.meta.url)), 'utf8');
    return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  } catch { return []; }
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.isProd ? 1 : false); // behind one reverse proxy in production so req.ip is the client
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'], // OpenStreetMap map tiles
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        scriptSrc: ["'self'", ...inlineScriptHashes()],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null, // only force https when actually deployed
      },
    },
  }));
  app.use(requestLogger);
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: config.apiRateLimit, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));

  // Responses can contain private data, so browsers and proxies must not store them.
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth);
  app.use('/api/me', me);
  app.use('/api/links', links);
  app.use('/api/contacts', contacts);
  app.use('/api/zones', zones);
  app.use('/api/checkins', checkins);
  app.use('/api/sos', sos);
  app.use('/api/reports', reports);
  app.use('/api/notifications', notifications);
  app.use('/api/admin', admin);
  app.use('/api', notFoundHandler);

  // In production the built React app is served from the same origin as the API (so cookies stay first-party).
  const dist = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: dist }));
  }

  app.use(errorHandler);
  return app;
}
