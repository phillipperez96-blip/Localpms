import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { scope, requirePerm, assertFacility } from '../auth.js';
import { today, addDays, money } from '../util.js';
import { inList, httpError, facilityConfig } from './helpers.js';
import { logActivity, sendTemplate } from '../core.js';

const r = Router();
const FIELDS = ['first_name', 'last_name', 'phone', 'email', 'source', 'unit_type', 'size_wanted', 'desired_date', 'status', 'quoted_rate', 'follow_up_date', 'lost_reason', 'notes', 'assigned_to'];

r.get('/leads', requirePerm('leads.manage'), (req, res) => {
  const ids = scope(req);
  res.json(all(`SELECT l.*, u.number unit_number, u.width, u.length, us.name assignee, f.code facility_code FROM leads l LEFT JOIN units u ON u.id=l.unit_id LEFT JOIN users us ON us.id=l.assigned_to JOIN facilities f ON f.id=l.facility_id
    WHERE l.facility_id IN ${inList(ids)} ORDER BY CASE l.status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'reserved' THEN 2 ELSE 3 END, l.created_at DESC`, ...ids));
});

r.get('/leads/:id', requirePerm('leads.manage'), (req, res) => {
  const l = get('SELECT l.*, u.number unit_number, u.width, u.length, u.street_rate FROM leads l LEFT JOIN units u ON u.id=l.unit_id WHERE l.id=?', Number(req.params.id));
  if (!l) throw httpError(404, 'Lead not found');
  assertFacility(req, l.facility_id);
  res.json({ ...l, communications: all('SELECT * FROM communications WHERE lead_id=? ORDER BY id DESC', l.id), activity: all("SELECT a.*, u.name user_name FROM activity_log a LEFT JOIN users u ON u.id=a.user_id WHERE entity_type='lead' AND entity_id=? ORDER BY id DESC", l.id) });
});

r.post('/leads', requirePerm('leads.manage'), (req, res) => {
  const b = req.body;
  assertFacility(req, b.facility_id);
  const id = insert('leads', { ...Object.fromEntries(FIELDS.filter((k) => b[k] !== undefined && b[k] !== '').map((k) => [k, b[k]])), facility_id: b.facility_id, status: 'new', assigned_to: b.assigned_to || req.user.id, follow_up_date: b.follow_up_date || today() });
  logActivity({ facility_id: b.facility_id, user_id: req.user.id, entity_type: 'lead', entity_id: id, action: 'create', details: `New lead from ${b.source || 'unknown source'}` });
  res.json({ id });
});

r.put('/leads/:id', requirePerm('leads.manage'), (req, res) => {
  const l = get('SELECT * FROM leads WHERE id=?', Number(req.params.id));
  if (!l) throw httpError(404, 'Lead not found');
  assertFacility(req, l.facility_id);
  const ch = Object.fromEntries(FIELDS.filter((k) => req.body[k] !== undefined).map((k) => [k, req.body[k] === '' ? null : req.body[k]]));
  if (ch.status && ch.status !== 'reserved' && l.status === 'reserved' && l.unit_id) {
    run("UPDATE units SET status='vacant' WHERE id=? AND status='reserved'", l.unit_id);
    ch.unit_id = null; ch.reservation_expires = null;
  }
  update('leads', l.id, ch);
  logActivity({ facility_id: l.facility_id, user_id: req.user.id, entity_type: 'lead', entity_id: l.id, action: 'update', details: ch.status && ch.status !== l.status ? `Status ${l.status} → ${ch.status}` : 'Lead updated' });
  res.json({ ok: true });
});

r.post('/leads/:id/reserve', requirePerm('leads.manage'), async (req, res) => {
  const l = get('SELECT * FROM leads WHERE id=?', Number(req.params.id));
  if (!l) throw httpError(404, 'Lead not found');
  assertFacility(req, l.facility_id);
  const u = get('SELECT * FROM units WHERE id=?', Number(req.body.unit_id));
  if (!u || u.facility_id !== l.facility_id) throw httpError(400, 'Choose a unit at this facility');
  if (u.status !== 'vacant' && u.id !== l.unit_id) throw httpError(400, `Unit ${u.number} is ${u.status}`);
  if (l.unit_id && l.unit_id !== u.id) run("UPDATE units SET status='vacant' WHERE id=? AND status='reserved'", l.unit_id);
  const f = facilityConfig(l.facility_id);
  const expires = req.body.expires || addDays(today(), f.reservation_days || 7);
  update('leads', l.id, { status: 'reserved', unit_id: u.id, reservation_expires: expires, quoted_rate: req.body.quoted_rate || u.street_rate });
  update('units', u.id, { status: 'reserved' });
  logActivity({ facility_id: l.facility_id, user_id: req.user.id, entity_type: 'lead', entity_id: l.id, action: 'reserve', details: `Reserved unit ${u.number} until ${expires}` });
  if (req.body.sendConfirmation) await sendTemplate('reservation', { lead_id: l.id, facility_id: l.facility_id, user_id: req.user.id, extra: { unit_size: `${u.width}x${u.length}`, reservation_expires: expires, quoted_rate: money(req.body.quoted_rate || u.street_rate) } });
  res.json({ ok: true });
});

r.delete('/leads/:id', requirePerm('leads.manage'), (req, res) => {
  const l = get('SELECT * FROM leads WHERE id=?', Number(req.params.id));
  if (!l) throw httpError(404, 'Lead not found');
  assertFacility(req, l.facility_id);
  if (l.unit_id && l.status === 'reserved') run("UPDATE units SET status='vacant' WHERE id=? AND status='reserved'", l.unit_id);
  run('DELETE FROM leads WHERE id=?', l.id);
  logActivity({ facility_id: l.facility_id, user_id: req.user.id, entity_type: 'lead', entity_id: l.id, action: 'delete', details: `Deleted lead ${l.first_name} ${l.last_name}` });
  res.json({ ok: true });
});

export default r;
