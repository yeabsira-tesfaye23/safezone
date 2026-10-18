// Minimal request log. It records method, path WITHOUT the query string, status and timing.
// It never logs bodies, headers, cookies or coordinates.
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (process.env.NODE_ENV === 'test') return;
    const path = req.originalUrl.split('?')[0];
    console.log(`${new Date().toISOString()} ${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)}ms user=${req.user?.id ?? '-'}`);
  });
  next();
}
