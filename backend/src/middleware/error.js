import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

// Never send stack traces or database messages to clients, and never log request bodies.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  if (err?.code === '23505') return res.status(409).json({ error: 'Already exists', code: 'duplicate' });
  if (err?.code === '22P02') return res.status(400).json({ error: 'Invalid identifier' });
  console.error(`[error] ${req.method} ${req.path.split('?')[0]}:`, config.isProd ? err.message : err.stack);
  return res.status(500).json({ error: 'Something went wrong' });
}
