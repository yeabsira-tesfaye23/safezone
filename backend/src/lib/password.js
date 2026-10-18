import bcrypt from 'bcryptjs';
import { badRequest } from './errors.js';

const COMMON = new Set(['password123', 'password1234', '1234567890', 'qwertyuiop', 'iloveyou123', 'letmein1234', 'safezone1234']);

// Policy: at least 10 characters, not a well-known password, and not mostly one repeated character.
export function checkPasswordPolicy(password, { email = '', name = '' } = {}) {
  if (typeof password !== 'string' || password.length < 10) throw badRequest('password: must be at least 10 characters', 'weak_password');
  if (password.length > 128) throw badRequest('password: must be at most 128 characters', 'weak_password');
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) throw badRequest('password: too common, choose something less guessable', 'weak_password');
  if (new Set(lower).size < 5) throw badRequest('password: too repetitive', 'weak_password');
  const emailName = email.split('@')[0]?.toLowerCase();
  if (emailName && emailName.length >= 4 && lower.includes(emailName)) throw badRequest('password: must not contain your email name', 'weak_password');
  if (name && name.length >= 4 && lower.includes(name.toLowerCase().replace(/\s+/g, ''))) throw badRequest('password: must not contain your name', 'weak_password');
}

export const hashPassword = (password) => bcrypt.hash(password, 12);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);
// Used to keep login timing similar when an email does not exist.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
