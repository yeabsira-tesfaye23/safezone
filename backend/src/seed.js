import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';
import { hashPassword } from './lib/password.js';
import { migrate } from './migrate.js';

// Creates TEST accounts only. All locations are simulated. Never use real children's data.
export const DEMO = {
  adminEmail: 'admin@safezone.test',
  guardianEmail: 'guardian@safezone.test',
  childEmail: 'child@safezone.test',
  password: 'SafeZone#Demo2026',
};

async function upsertUser({ role, email, fullName, dob = null, verified = false }) {
  const hash = await hashPassword(DEMO.password);
  const { rows } = await query(
    `INSERT INTO users (role, email, full_name, password_hash, date_of_birth, guardian_verified)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (lower(email)) DO UPDATE SET password_hash = $4, status = 'active', failed_attempts = 0, locked_until = NULL
     RETURNING id`,
    [role, email, fullName, hash, dob, verified],
  );
  return rows[0].id;
}

export async function seed() {
  await migrate();
  const adminId = await upsertUser({ role: 'admin', email: DEMO.adminEmail, fullName: 'Demo Administrator' });
  const guardianId = await upsertUser({ role: 'guardian', email: DEMO.guardianEmail, fullName: 'Demo Guardian', verified: true });
  const childId = await upsertUser({ role: 'child', email: DEMO.childEmail, fullName: 'Demo Child', dob: '2012-06-15' });
  await query('INSERT INTO sharing_settings (child_id) VALUES ($1) ON CONFLICT DO NOTHING', [childId]);
  const link = await query(`SELECT id FROM guardian_links WHERE child_id = $1 AND guardian_id = $2 AND status IN ('pending', 'active', 'paused')`, [childId, guardianId]);
  if (!link.rowCount) {
    await query(`INSERT INTO guardian_links (child_id, guardian_id, initiated_by, status, child_consented_at) VALUES ($1, $2, 'guardian', 'active', now())`, [childId, guardianId]);
  }
  const zones = await query('SELECT 1 FROM safe_zones WHERE child_id = $1', [childId]);
  if (!zones.rowCount) {
    // Simulated demo places (not a real child's home or school).
    await query(
      `INSERT INTO safe_zones (child_id, created_by, name, center_lat, center_lng, radius_m) VALUES
       ($1, $2, 'Home (demo)', 9.4010, 42.0230, 150), ($1, $2, 'School (demo)', 9.4167, 42.0333, 250)`,
      [childId, guardianId],
    );
  }
  const contact = await query('SELECT 1 FROM emergency_contacts WHERE child_id = $1', [childId]);
  if (!contact.rowCount) {
    await query(`INSERT INTO emergency_contacts (child_id, contact_user_id, display_name) VALUES ($1, $2, 'Demo Guardian')`, [childId, guardianId]);
  }
  return { adminId, guardianId, childId };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => {
      console.log('Demo accounts ready (password for all: %s)', DEMO.password);
      console.log('  admin    ', DEMO.adminEmail);
      console.log('  guardian ', DEMO.guardianEmail);
      console.log('  child    ', DEMO.childEmail);
    })
    .catch((e) => { console.error('Seed failed:', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
