import crypto from 'node:crypto';
import { get, run, all } from './db.js';
import { jparse, ALL_PERMS } from './util.js';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', token, userId, expires);
  run('UPDATE users SET last_login=? WHERE id=?', new Date().toISOString(), userId);
  return token;
}

export function loadUser(userId) {
  const u = get('SELECT u.id,u.name,u.email,u.phone,u.role_id,u.facility_ids,u.active,u.last_login, r.name role_name, r.slug role_slug, r.permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=?', userId);
  if (!u) return null;
  const perms = jparse(u.permissions, []);
  const allFac = all('SELECT id FROM facilities ORDER BY id').map((f) => f.id);
  const fids = u.facility_ids === '*' ? allFac : jparse(u.facility_ids, []).filter((id) => allFac.includes(id));
  return { ...u, permissions: perms.filter((p) => ALL_PERMS.includes(p)), facility_ids: fids, all_facilities: u.facility_ids === '*' };
}

/** Express middleware: requires a valid bearer token. */
export function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token;
  const s = token && get('SELECT * FROM sessions WHERE token=?', token);
  if (!s || s.expires_at < new Date().toISOString()) return res.status(401).json({ error: 'Not signed in' });
  const user = loadUser(s.user_id);
  if (!user || !user.active) return res.status(401).json({ error: 'Account disabled' });
  req.user = user;
  req.token = token;
  next();
}

export const can = (user, perm) => user.permissions.includes(perm);

export function requirePerm(...perms) {
  return (req, res, next) => {
    if (perms.some((p) => can(req.user, p))) return next();
    res.status(403).json({ error: `You do not have permission (${perms.join(' / ')})` });
  };
}

/**
 * Resolve which facilities a request targets. `?facility=all` (portfolio) or `?facility=<id>`.
 * Always limited to facilities the user can access.
 */
export function scope(req) {
  const raw = req.query.facility ?? req.body?.facility_id;
  if (raw === undefined || raw === 'all' || raw === '' || raw === null) return req.user.facility_ids;
  const id = Number(raw);
  if (!req.user.facility_ids.includes(id)) { const e = new Error('No access to this facility'); e.status = 403; throw e; }
  return [id];
}
export function assertFacility(req, facilityId) {
  if (!req.user.facility_ids.includes(Number(facilityId))) { const e = new Error('No access to this facility'); e.status = 403; throw e; }
}
