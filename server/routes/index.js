import { Router } from 'express';
import { get, all } from '../db.js';
import { verifyPassword, createSession, loadUser, requireAuth } from '../auth.js';
import { run } from '../db.js';
import { integrationStatus } from '../services/integrations.js';
import { PERMISSIONS, NOTE_UNDO_SECONDS } from '../util.js';
import { logActivity } from '../core.js';
import dashboard from './dashboard.js';
import tenants from './tenants.js';
import units from './units.js';
import collections from './collections.js';
import leads from './leads.js';
import comms from './comms.js';
import retail from './retail.js';
import rates from './rates.js';
import tasks from './tasks.js';
import audits from './audits.js';
import reports from './reports.js';
import settings from './settings.js';
import { inList } from './helpers.js';
import { scope } from '../auth.js';

const r = Router();

r.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = get('SELECT * FROM users WHERE lower(email)=lower(?)', email || '');
  if (!u || !u.active || !verifyPassword(password || '', u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  const token = createSession(u.id);
  logActivity({ user_id: u.id, entity_type: 'user', entity_id: u.id, action: 'login', details: 'Signed in' });
  res.json({ token, user: loadUser(u.id) });
});

// Public list of demo accounts for the login screen quick-switcher.
r.get('/auth/demo-accounts', (req, res) => {
  if (process.env.HIDE_DEMO_ACCOUNTS) return res.json([]);
  res.json(all('SELECT u.name, u.email, r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active=1 ORDER BY r.rank DESC, u.id'));
});

r.use(requireAuth);

r.post('/auth/logout', (req, res) => { run('DELETE FROM sessions WHERE token=?', req.token); res.json({ ok: true }); });

r.get('/me', (req, res) => {
  const facilities = all(`SELECT id, name, code, city, state, billing_type, tax_rate, admin_fee, gate_deny_days, reservation_days, note_reminder FROM facilities WHERE id IN ${inList(req.user.facility_ids)} ORDER BY id`, ...req.user.facility_ids);
  const integ = integrationStatus();
  res.json({ user: req.user, facilities, permissions: PERMISSIONS, noteUndoSeconds: NOTE_UNDO_SECONDS, integrations: { stripePublishableKey: integ.payments.publishableKey, payments: integ.payments.connected, email: integ.email.connected, sms: integ.sms.connected, gate: integ.gate.connected } });
});

r.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const ids = scope(req);
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, '');
  const tenants = all(`SELECT t.id, t.first_name, t.last_name, t.phone, t.email, t.status, t.facility_id, f.code,
      (SELECT group_concat(u.number, ', ') FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.tenant_id=t.id AND r.status='active') units
    FROM tenants t JOIN facilities f ON f.id=t.facility_id WHERE t.facility_id IN ${inList(ids)} AND (
      (t.first_name || ' ' || t.last_name) LIKE ? OR t.email LIKE ? OR t.company LIKE ? OR t.gate_code = ?
      ${digits.length >= 3 ? "OR replace(replace(replace(replace(t.phone,'(',''),')',''),'-',''),' ','') LIKE ?" : ''}
      OR t.id IN (SELECT r.tenant_id FROM rentals r JOIN units u ON u.id=r.unit_id WHERE u.number LIKE ? AND r.status='active'))
    ORDER BY t.status='active' DESC, t.last_name LIMIT 12`, ...ids, like, like, like, q, ...(digits.length >= 3 ? [`%${digits}%`] : []), like);
  const units = all(`SELECT u.id, u.number, u.unit_type, u.width, u.length, u.status, u.facility_id, f.code FROM units u JOIN facilities f ON f.id=u.facility_id WHERE u.facility_id IN ${inList(ids)} AND u.number LIKE ? LIMIT 6`, ...ids, like);
  const leads = all(`SELECT id, first_name, last_name, phone, status, facility_id FROM leads WHERE facility_id IN ${inList(ids)} AND status NOT IN ('converted','lost') AND ((first_name || ' ' || last_name) LIKE ? OR phone LIKE ? OR email LIKE ?) LIMIT 5`, ...ids, like, like, like);
  res.json([
    ...tenants.map((t) => ({ type: 'tenant', id: t.id, title: `${t.first_name} ${t.last_name}`, subtitle: [t.units ? `Unit ${t.units}` : t.status, t.phone, t.code].filter(Boolean).join(' · '), facility_id: t.facility_id })),
    ...units.map((u) => ({ type: 'unit', id: u.id, title: `Unit ${u.number}`, subtitle: `${u.width}x${u.length} ${u.unit_type} · ${u.status} · ${u.code}`, facility_id: u.facility_id })),
    ...leads.map((l) => ({ type: 'lead', id: l.id, title: `${l.first_name} ${l.last_name}`, subtitle: `Lead · ${l.status} · ${l.phone || ''}`, facility_id: l.facility_id })),
  ]);
});

for (const m of [dashboard, tenants, units, collections, leads, comms, retail, rates, tasks, audits, reports, settings]) r.use(m);

export default r;
