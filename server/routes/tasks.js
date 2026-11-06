import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { scope, requirePerm, assertFacility } from '../auth.js';
import { today } from '../util.js';
import { inList, httpError } from './helpers.js';
import { logActivity } from '../core.js';

const r = Router();

r.get('/tasks', (req, res) => {
  const ids = scope(req);
  res.json(all(`SELECT t.*, a.name assignee, c.name creator, f.code facility_code, tn.first_name tenant_first, tn.last_name tenant_last FROM tasks t LEFT JOIN users a ON a.id=t.assigned_to LEFT JOIN users c ON c.id=t.created_by
    JOIN facilities f ON f.id=t.facility_id LEFT JOIN tenants tn ON tn.id=t.tenant_id WHERE t.facility_id IN ${inList(ids)} ORDER BY t.status='done', t.priority='urgent' DESC, t.due_date IS NULL, t.due_date, t.id DESC LIMIT 500`, ...ids));
});

const F = ['title', 'description', 'due_date', 'priority', 'category', 'assigned_to', 'tenant_id', 'unit_id'];
r.post('/tasks', requirePerm('tasks.manage', 'audits.perform'), (req, res) => {
  const b = req.body;
  assertFacility(req, b.facility_id);
  if (!b.title?.trim()) throw httpError(400, 'Title is required');
  const id = insert('tasks', { ...Object.fromEntries(F.filter((k) => b[k] !== undefined && b[k] !== '').map((k) => [k, b[k]])), facility_id: b.facility_id, created_by: req.user.id, source: b.audit_id ? 'audit' : 'manual', audit_id: b.audit_id, status: 'open' });
  logActivity({ facility_id: b.facility_id, user_id: req.user.id, entity_type: 'task', entity_id: id, action: 'create', details: `Reminder: ${b.title}` });
  res.json({ id });
});

r.put('/tasks/:id', (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id=?', Number(req.params.id));
  if (!t) throw httpError(404, 'Not found');
  assertFacility(req, t.facility_id);
  const ch = Object.fromEntries(F.filter((k) => req.body[k] !== undefined).map((k) => [k, req.body[k] === '' ? null : req.body[k]]));
  if (t.source === 'lien_payment') { delete ch.title; delete ch.description; delete ch.priority; delete ch.tenant_id; }
  if (req.body.status) {
    if (t.source === 'lien_payment' && req.body.status === 'done') {
      const note = String(req.body.resolution || '').trim();
      if (!note) throw httpError(400, 'Describe the steps taken before resolving a lien payment alert');
      ch.resolution = note;
    }
    if (t.source === 'lien_payment' && req.body.status === 'open' && t.status === 'done') throw httpError(400, 'Resolved lien payment alerts cannot be reopened');
    ch.status = req.body.status;
    ch.completed_at = req.body.status === 'done' ? new Date().toISOString() : null;
    ch.completed_by = req.body.status === 'done' ? req.user.id : null;
  }
  update('tasks', t.id, ch);
  if (req.body.status) logActivity({ facility_id: t.facility_id, user_id: req.user.id, entity_type: t.tenant_id && t.source === 'lien_payment' ? 'tenant' : 'task', entity_id: t.tenant_id && t.source === 'lien_payment' ? t.tenant_id : t.id, action: req.body.status === 'done' ? (t.source === 'lien_payment' ? 'lien_payment_resolved' : 'complete') : 'reopen', details: `${req.body.status === 'done' ? 'Completed' : 'Reopened'}: ${t.title}${ch.resolution ? ` – ${ch.resolution}` : ''}` });
  res.json({ ok: true });
});

r.delete('/tasks/:id', requirePerm('tasks.manage'), (req, res) => {
  const t = get('SELECT * FROM tasks WHERE id=?', Number(req.params.id));
  if (!t) throw httpError(404, 'Not found');
  if (t.source === 'lien_payment') throw httpError(400, 'Lien payment alerts cannot be deleted – resolve them instead');
  assertFacility(req, t.facility_id);
  run('DELETE FROM tasks WHERE id=?', t.id);
  res.json({ ok: true });
});

r.get('/users/lookup', (req, res) => {
  const ids = scope(req);
  const users = all('SELECT u.id, u.name, u.facility_ids, r.name role FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.active=1 ORDER BY r.rank DESC, u.name');
  res.json(users.filter((u) => u.facility_ids === '*' || JSON.parse(u.facility_ids || '[]').some((f) => ids.includes(f))).map(({ facility_ids, ...u }) => u));
});

export default r;
