import { query } from '../db.js';

// Write one audit row. `meta` must never contain coordinates or message text.
export async function audit(req, action, { targetType = null, targetId = null, meta = {}, client = null, dedupeMinutes = 0 } = {}) {
  const run = client ? client.query.bind(client) : query;
  const actor = req?.user ?? null;
  try {
    // Frequent reads (for example a dashboard refreshing) are logged once per time window, not once per request.
    if (dedupeMinutes > 0 && actor?.id) {
      const { rowCount } = await run(
        `SELECT 1 FROM audit_logs WHERE actor_id = $1 AND action = $2 AND coalesce(target_id, '') = $3
         AND created_at > now() - ($4 || ' minutes')::interval LIMIT 1`,
        [actor.id, action, targetId ? String(targetId) : '', String(dedupeMinutes)],
      );
      if (rowCount > 0) return;
    }
    await run(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, ip, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actor?.id ?? null, actor?.role ?? null, action, targetType, targetId ? String(targetId) : null, req?.ip ?? null, meta],
    );
  } catch (err) {
    // An audit failure must be loud in the logs, but it must not leak details to the client.
    console.error('[audit] failed to write', action, err.message);
    if (client) throw err;
  }
}
