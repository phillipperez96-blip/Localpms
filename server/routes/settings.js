import { Router } from 'express';
import { all, get, insert, update, run, setState } from '../db.js';
import { requirePerm, assertFacility, hashPassword } from '../auth.js';
import { today, jparse, PERMISSIONS, ALL_PERMS, DEFAULT_LATE_FEES, DEFAULT_LIEN_STEPS, DEFAULT_AUDIT_TEMPLATE } from '../util.js';
import { httpError, facilityConfig } from './helpers.js';
import { logActivity, processFacility } from '../core.js';
import { integrationStatus, sendEmail, sendSms, gateSetAccess, chargeCard } from '../services/integrations.js';

const r = Router();

// ---------- facility ----------
r.get('/settings/facility/:id', requirePerm('settings.facility'), (req, res) => {
  assertFacility(req, req.params.id);
  const f = facilityConfig(Number(req.params.id));
  res.json({ ...f, audit_template: f.audit_template || DEFAULT_AUDIT_TEMPLATE });
});

const FF = ['name', 'code', 'address', 'city', 'state', 'zip', 'phone', 'email', 'office_hours', 'gate_hours', 'billing_type', 'prorate', 'tax_rate', 'admin_fee', 'deposit', 'gate_deny_days', 'lien_automation', 'reservation_days', 'late_fees', 'lien_steps', 'audit_template'];
r.put('/settings/facility/:id', requirePerm('settings.facility'), (req, res) => {
  const id = Number(req.params.id);
  assertFacility(req, id);
  const b = req.body;
  if (b.lien_steps) {
    const keys = new Set();
    for (const s of b.lien_steps) {
      if (!s.key || !s.name || !(s.day >= 0)) throw httpError(400, 'Each lien step needs a key, name and day');
      if (keys.has(s.key)) throw httpError(400, `Duplicate step key ${s.key}`);
      keys.add(s.key);
    }
    b.lien_steps = [...b.lien_steps].sort((a, c) => a.day - c.day);
  }
  if (b.late_fees) b.late_fees = [...b.late_fees].sort((a, c) => a.day - c.day);
  const ch = Object.fromEntries(FF.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  update('facilities', id, ch);
  if (b.note_reminder !== undefined) setNoteReminder(req, [id], b.note_reminder);
  logActivity({ facility_id: id, user_id: req.user.id, entity_type: 'settings', entity_id: id, action: 'update', details: `Facility settings updated (${Object.keys(ch).join(', ')})` });
  res.json({ ok: true });
});

function setNoteReminder(req, ids, on) {
  if (!req.user.permissions.includes('settings.note_reminder')) throw httpError(403, 'You do not have permission to change the note reminder');
  for (const id of ids) {
    assertFacility(req, id);
    update('facilities', id, { note_reminder: on ? 1 : 0 });
    logActivity({ facility_id: id, user_id: req.user.id, entity_type: 'settings', entity_id: id, action: 'note_reminder', details: `"Leave account without a note" reminder turned ${on ? 'ON' : 'OFF'}` });
  }
}

/** Toggle the note reminder for one facility or all of the user's facilities. */
r.put('/settings/note-reminder', requirePerm('settings.note_reminder'), (req, res) => {
  const ids = req.body.facility_id === 'all' ? req.user.facility_ids : [Number(req.body.facility_id)];
  setNoteReminder(req, ids, !!req.body.enabled);
  res.json({ ok: true });
});

r.post('/settings/facilities', requirePerm('settings.integrations'), (req, res) => {
  if (!req.user.all_facilities) throw httpError(403, 'Only company-wide admins can add facilities');
  const b = req.body;
  if (!b.name) throw httpError(400, 'Name is required');
  const id = insert('facilities', { ...Object.fromEntries(FF.filter((k) => b[k] !== undefined).map((k) => [k, b[k]])), late_fees: DEFAULT_LATE_FEES, lien_steps: DEFAULT_LIEN_STEPS, audit_template: DEFAULT_AUDIT_TEMPLATE });
  for (const p of all('SELECT * FROM promotions WHERE facility_id=(SELECT MIN(id) FROM facilities)')) insert('promotions', { ...p, id: undefined, facility_id: id });
  logActivity({ facility_id: id, user_id: req.user.id, entity_type: 'facility', entity_id: id, action: 'create', details: `Facility ${b.name} created` });
  res.json({ id });
});

r.get('/settings/insurance', requirePerm('settings.facility'), (req, res) => res.json(all('SELECT * FROM insurance_plans ORDER BY premium')));
r.post('/settings/insurance', requirePerm('settings.facility'), (req, res) => res.json({ id: insert('insurance_plans', { name: req.body.name, coverage: req.body.coverage, premium: req.body.premium, active: 1 }) }));
r.put('/settings/insurance/:id', requirePerm('settings.facility'), (req, res) => { update('insurance_plans', Number(req.params.id), { name: req.body.name, coverage: req.body.coverage, premium: req.body.premium, active: req.body.active }); res.json({ ok: true }); });

// ---------- users ----------
const myRank = (req) => get('SELECT rank FROM roles WHERE id=?', req.user.role_id)?.rank ?? 0;

r.get('/settings/users', requirePerm('settings.users'), (req, res) => {
  res.json(all('SELECT u.id, u.name, u.email, u.phone, u.role_id, u.facility_ids, u.active, u.last_login, r.name role_name, r.rank FROM users u LEFT JOIN roles r ON r.id=u.role_id ORDER BY r.rank DESC, u.name')
    .map((u) => ({ ...u, all_facilities: u.facility_ids === '*', facility_ids: u.facility_ids === '*' ? [] : jparse(u.facility_ids, []) })));
});

function checkRole(req, role_id) {
  const role = get('SELECT * FROM roles WHERE id=?', Number(role_id));
  if (!role) throw httpError(400, 'Choose a role');
  if (role.rank > myRank(req)) throw httpError(403, 'You cannot assign a role higher than your own');
  return role;
}

r.post('/settings/users', requirePerm('settings.users'), (req, res) => {
  const b = req.body;
  if (!b.name || !b.email || !b.password) throw httpError(400, 'Name, email and password are required');
  if (get('SELECT 1 x FROM users WHERE lower(email)=lower(?)', b.email)) throw httpError(400, 'Email already in use');
  checkRole(req, b.role_id);
  if (b.all_facilities && !req.user.all_facilities) throw httpError(403, 'You cannot grant company-wide access');
  const id = insert('users', { name: b.name, email: b.email, phone: b.phone, role_id: b.role_id, password_hash: hashPassword(b.password), facility_ids: b.all_facilities ? '*' : JSON.stringify((b.facility_ids || []).filter((f) => req.user.facility_ids.includes(f))), active: 1 });
  logActivity({ user_id: req.user.id, entity_type: 'user', entity_id: id, action: 'create', details: `Created user ${b.email}` });
  res.json({ id });
});

r.put('/settings/users/:id', requirePerm('settings.users'), (req, res) => {
  const u = get('SELECT u.*, r.rank FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=?', Number(req.params.id));
  if (!u) throw httpError(404, 'User not found');
  if ((u.rank ?? 0) > myRank(req)) throw httpError(403, 'You cannot edit a user with a higher role');
  const b = req.body, ch = {};
  for (const k of ['name', 'email', 'phone', 'active']) if (b[k] !== undefined) ch[k] = b[k];
  if (b.role_id) { checkRole(req, b.role_id); ch.role_id = b.role_id; }
  if (b.password) ch.password_hash = hashPassword(b.password);
  if (b.all_facilities !== undefined || b.facility_ids) {
    if (b.all_facilities && !req.user.all_facilities) throw httpError(403, 'You cannot grant company-wide access');
    ch.facility_ids = b.all_facilities ? '*' : JSON.stringify(b.facility_ids || []);
  }
  if (u.id === req.user.id && b.active === false) throw httpError(400, 'You cannot deactivate yourself');
  update('users', u.id, ch);
  if (b.active === false) run('DELETE FROM sessions WHERE user_id=?', u.id);
  logActivity({ user_id: req.user.id, entity_type: 'user', entity_id: u.id, action: 'update', details: `Updated user ${u.email} (${Object.keys(ch).filter((k) => k !== 'password_hash').join(', ')}${ch.password_hash ? ', password' : ''})` });
  res.json({ ok: true });
});

// ---------- roles ----------
r.get('/settings/roles', requirePerm('settings.roles', 'settings.users'), (req, res) => {
  res.json({ roles: all('SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id=r.id) users FROM roles r ORDER BY rank DESC').map((x) => ({ ...x, permissions: jparse(x.permissions, []) })), permissions: PERMISSIONS.map(([key, group, label]) => ({ key, group, label })) });
});
r.put('/settings/roles/:id', requirePerm('settings.roles'), (req, res) => {
  const role = get('SELECT * FROM roles WHERE id=?', Number(req.params.id));
  if (!role) throw httpError(404, 'Role not found');
  const perms = (req.body.permissions || jparse(role.permissions, [])).filter((p) => ALL_PERMS.includes(p));
  if (role.slug === 'admin' && !perms.includes('settings.roles')) throw httpError(400, 'Admin must keep the "Manage roles" permission');
  update('roles', role.id, { permissions: perms, name: req.body.name || role.name, description: req.body.description ?? role.description });
  logActivity({ user_id: req.user.id, entity_type: 'role', entity_id: role.id, action: 'update', details: `Permissions updated for ${role.name} (${perms.length} granted)` });
  res.json({ ok: true });
});
r.post('/settings/roles', requirePerm('settings.roles'), (req, res) => {
  const { name, description, rank, permissions } = req.body;
  if (!name) throw httpError(400, 'Name required');
  const id = insert('roles', { name, description, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36), rank: Number(rank) || 10, permissions: (permissions || []).filter((p) => ALL_PERMS.includes(p)) });
  res.json({ id });
});

// ---------- integrations / system ----------
r.get('/settings/integrations', requirePerm('settings.integrations'), (req, res) => {
  res.json({ integrations: integrationStatus(), lastProcessed: get("SELECT value FROM system_state WHERE key='last_processed'")?.value, node: process.version });
});

r.post('/settings/integrations/test', requirePerm('settings.integrations'), async (req, res) => {
  const { type, to } = req.body;
  let result;
  if (type === 'email') result = await sendEmail({ to, subject: 'Test email from LocalPMS', body: 'If you received this, email delivery is configured correctly.' });
  else if (type === 'sms') result = await sendSms({ to, body: 'LocalPMS test message – SMS is configured correctly.' });
  else if (type === 'gate') result = await gateSetAccess({ facilityId: 0, code: '000000', allowed: false, action: 'test' });
  else if (type === 'payments') result = await chargeCard({ amount: 1, last4: '4242', paymentMethodId: 'pm_card_visa', description: 'LocalPMS test charge' }).then((x) => ({ status: x.simulated ? 'simulated' : 'sent', ...x })).catch((e) => ({ status: 'failed', error: e.message }));
  else throw httpError(400, 'Unknown integration');
  res.json(result);
});

r.post('/settings/run-daily', requirePerm('settings.integrations'), async (req, res) => {
  const T = today();
  const results = {};
  for (const id of req.user.facility_ids) results[get('SELECT name FROM facilities WHERE id=?', id).name] = await processFacility(id, T);
  setState('last_processed', T);
  logActivity({ user_id: req.user.id, entity_type: 'system', action: 'daily_processing', details: 'Ran daily processing manually' });
  res.json(results);
});

r.post('/settings/reset-demo', requirePerm('settings.integrations'), async (req, res) => {
  if (!req.user.all_facilities) throw httpError(403, 'Only company-wide admins can reset demo data');
  const { seedDatabase } = await import('../seed.js');
  await seedDatabase();
  res.json({ ok: true });
});

export default r;
