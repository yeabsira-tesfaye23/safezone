import { query } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

// Verifies the bearer token, then reloads the user so a deactivated or suspended account loses access at once.
export async function authenticate(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch {
      throw unauthorized('Session expired', 'token_expired');
    }
    const { rows } = await query(
      'SELECT id, role, email, full_name, status, guardian_verified, date_of_birth FROM users WHERE id = $1',
      [claims.sub],
    );
    const user = rows[0];
    if (!user) throw unauthorized();
    if (user.status !== 'active') throw forbidden('This account is not active', 'account_inactive');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Role-based permission check. Usage: router.get('/x', authenticate, requireRole('admin'), handler)
export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden('Your role cannot do this', 'wrong_role'));

// Wrap async route handlers so thrown errors reach the error middleware.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
