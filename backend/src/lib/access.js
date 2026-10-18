import { query } from '../db.js';
import { forbidden } from './errors.js';

// All access to a child's data by someone else goes through these helpers.

export async function getLink(guardianId, childId) {
  const { rows } = await query(
    `SELECT * FROM guardian_links
     WHERE guardian_id = $1 AND child_id = $2 AND status IN ('active', 'paused')
     LIMIT 1`,
    [guardianId, childId],
  );
  return rows[0] ?? null;
}

export async function getSharing(childId) {
  const { rows } = await query('SELECT * FROM sharing_settings WHERE child_id = $1', [childId]);
  return rows[0] ?? { child_id: childId, share_zone_events: true, share_sos_location: true };
}

// Resolve whose data a request is about and check the caller may see it.
//  - a child may always see her own data
//  - a guardian needs an ACTIVE (not paused, not revoked) link
//  - `needs` names the sharing switch that must also be on: 'zones' | 'sos'
// Administrators never get location data through this path.
export async function authorizeChildData(user, childId, needs = null) {
  if (user.role === 'child') {
    if (user.id !== childId) throw forbidden();
    return { link: null, sharing: await getSharing(childId) };
  }
  if (user.role !== 'guardian') throw forbidden();
  const link = await getLink(user.id, childId);
  if (!link || link.status !== 'active') throw forbidden('No active, consented link with this child');
  const sharing = await getSharing(childId);
  if (needs === 'zones' && !sharing.share_zone_events) throw forbidden('The child has turned off zone sharing');
  return { link, sharing };
}

// Guardians with an active link to a child.
export async function activeGuardianIds(childId) {
  const { rows } = await query(
    `SELECT l.guardian_id FROM guardian_links l JOIN users u ON u.id = l.guardian_id
     WHERE l.child_id = $1 AND l.status = 'active' AND u.status = 'active'`,
    [childId],
  );
  return rows.map((r) => r.guardian_id);
}
