import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { pool, withTransaction } from '../db.js';

// Deletes data that has outlived its purpose. Run daily (the server schedules it) or with `npm run retention`.
// Every rule is a number you can change in .env. Returns how many rows each rule removed.
export async function runRetention() {
  const r = config.retention;
  return withTransaction(async (c) => {
    // Lets the audit-log trigger allow deletes inside this transaction only.
    await c.query(`SELECT set_config('safezone.retention', 'on', true)`);
    const del = async (name, sql, params = []) => [name, (await c.query(sql, params)).rowCount];
    const out = [];
    out.push(await del('locationEvents', `DELETE FROM location_events WHERE occurred_at < now() - ($1 || ' days')::interval`, [String(r.locationEventsDays)]));
    out.push(await del('sosAlerts', `DELETE FROM sos_alerts WHERE triggered_at < now() - ($1 || ' days')::interval`, [String(r.sosDays)]));
    out.push(await del('notifications', `DELETE FROM notifications WHERE created_at < now() - ($1 || ' days')::interval`, [String(r.notificationsDays)]));
    out.push(await del('checkins', `DELETE FROM checkins WHERE created_at < now() - ($1 || ' days')::interval`, [String(r.checkinsDays)]));
    out.push(await del('closedReports', `DELETE FROM incident_reports WHERE status = 'closed' AND closed_at < now() - ($1 || ' days')::interval`, [String(r.closedReportsDays)]));
    out.push(await del('endedLinks', `DELETE FROM guardian_links WHERE status IN ('revoked', 'declined') AND ended_at < now() - ($1 || ' days')::interval`, [String(r.endedLinksDays)]));
    out.push(await del('expiredTokens', `DELETE FROM refresh_tokens WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '7 days'`));
    out.push(await del('usedResets', `DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`));
    out.push(await del('auditLogs', `DELETE FROM audit_logs WHERE created_at < now() - ($1 || ' months')::interval`, [String(r.auditMonths)]));
    // Deactivated accounts: remove personal details after the grace period, keep the row so references stay valid.
    out.push(await del(
      'anonymizedUsers',
      `UPDATE users SET email = 'deleted-' || id || '@invalid.local', full_name = 'Deleted user', password_hash = '!', date_of_birth = NULL, updated_at = now()
       WHERE status = 'deactivated' AND deactivated_at < now() - ($1 || ' days')::interval AND email NOT LIKE 'deleted-%@invalid.local'`,
      [String(r.deactivatedAnonymizeDays)],
    ));
    return Object.fromEntries(out);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRetention()
    .then((res) => console.log('Retention complete:', res))
    .catch((err) => { console.error('Retention failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
