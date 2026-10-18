import { query } from '../db.js';

// Create an in-app notification. The unique (recipient_id, dedupe_key) index makes duplicates fail
// silently, so the same event can never notify the same person twice. Returns true if a row was created.
// Notification text may name the child and the time but never contains coordinates.
export async function notify({ recipientId, kind, urgent = false, title, body, sourceType = null, sourceId = null, dedupeKey = null }, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rowCount } = await run(
    `INSERT INTO notifications (recipient_id, kind, urgent, title, body, source_type, source_id, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [recipientId, kind, urgent, title, body, sourceType, sourceId, dedupeKey],
  );
  return rowCount > 0;
}
