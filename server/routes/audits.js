import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, insert, update, run, UPLOAD_DIR } from '../db.js';
import { scope, requirePerm, assertFacility, can } from '../auth.js';
import { today, round2, DEFAULT_AUDIT_TEMPLATE } from '../util.js';
import { inList, httpError, facilityConfig } from './helpers.js';
import { logActivity } from '../core.js';

const r = Router();

function loadAudit(req, id) {
  const a = get('SELECT a.*, u.name auditor, f.name facility_name, ak.name acknowledged_by_name FROM audits a LEFT JOIN users u ON u.id=a.auditor_id LEFT JOIN users ak ON ak.id=a.acknowledged_by JOIN facilities f ON f.id=a.facility_id WHERE a.id=?', Number(id));
  if (!a) throw httpError(404, 'Audit not found');
  assertFacility(req, a.facility_id);
  return a;
}

r.get('/audits', requirePerm('audits.view', 'audits.perform'), (req, res) => {
  const ids = scope(req);
  const period = today().slice(0, 7);
  const list = all(`SELECT a.*, u.name auditor, f.name facility_name, f.code facility_code, (SELECT COUNT(*) FROM tasks t WHERE t.audit_id=a.id AND t.status='open') open_tasks
    FROM audits a LEFT JOIN users u ON u.id=a.auditor_id JOIN facilities f ON f.id=a.facility_id WHERE a.facility_id IN ${inList(ids)} ORDER BY a.period DESC, a.id DESC`, ...ids);
  const checklist = ids.map((id) => {
    const f = get('SELECT id, name, code FROM facilities WHERE id=?', id);
    const a = list.find((x) => x.facility_id === id && x.period === period);
    return { facility_id: id, name: f.name, code: f.code, audit: a || null };
  });
  // score trend per facility (last 12 periods)
  const trend = {};
  for (const a of list.filter((x) => x.status !== 'draft' && x.max_score)) {
    (trend[a.period] ||= { period: a.period });
    trend[a.period][a.facility_code] = round2((a.score / a.max_score) * 100);
  }
  res.json({ list, checklist, period, trend: Object.values(trend).sort((a, b) => a.period.localeCompare(b.period)).slice(-12) });
});

r.get('/audits/:id', requirePerm('audits.view', 'audits.perform'), (req, res) => {
  const a = loadAudit(req, req.params.id);
  res.json({ ...a, items: all('SELECT * FROM audit_items WHERE audit_id=? ORDER BY sort', a.id), photos: all('SELECT * FROM audit_photos WHERE audit_id=? ORDER BY id', a.id),
    tasks: all('SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE audit_id=? ORDER BY id', a.id),
    previous: get("SELECT id, period, score, max_score FROM audits WHERE facility_id=? AND id<? AND status!='draft' ORDER BY id DESC LIMIT 1", a.facility_id, a.id) });
});

r.post('/audits', requirePerm('audits.perform'), (req, res) => {
  const fid = Number(req.body.facility_id);
  assertFacility(req, fid);
  const visit = req.body.visit_date || today();
  const f = facilityConfig(fid);
  const tpl = f.audit_template || DEFAULT_AUDIT_TEMPLATE;
  const id = insert('audits', { facility_id: fid, auditor_id: req.user.id, visit_date: visit, period: visit.slice(0, 7), status: 'draft', score: 0, max_score: 0 });
  let sort = 0, max = 0;
  for (const c of tpl) for (const label of c.items) { insert('audit_items', { audit_id: id, category: c.category, label, max_points: 5, points: null, sort: sort++ }); max += 5; }
  update('audits', id, { max_score: max });
  logActivity({ facility_id: fid, user_id: req.user.id, entity_type: 'audit', entity_id: id, action: 'create', details: `Started property audit (visit ${visit})` });
  res.json({ id });
});

r.put('/audits/:id', requirePerm('audits.perform'), (req, res) => {
  const a = loadAudit(req, req.params.id);
  if (a.status === 'acknowledged') throw httpError(400, 'Audit already acknowledged by the manager');
  const b = req.body;
  if (b.items) for (const it of b.items) run('UPDATE audit_items SET points=?, notes=? WHERE id=? AND audit_id=?', it.points === '' || it.points === undefined ? null : it.points, it.notes || null, it.id, a.id);
  const items = all('SELECT * FROM audit_items WHERE audit_id=?', a.id);
  update('audits', a.id, { visit_date: b.visit_date, period: b.visit_date?.slice(0, 7), summary: b.summary, score: items.reduce((s, i) => s + (i.points || 0), 0), max_score: items.reduce((s, i) => s + i.max_points, 0) });
  res.json({ ok: true });
});

r.post('/audits/:id/submit', requirePerm('audits.perform'), (req, res) => {
  const a = loadAudit(req, req.params.id);
  const missing = get('SELECT COUNT(*) c FROM audit_items WHERE audit_id=? AND points IS NULL', a.id).c;
  if (missing && !req.body.force) throw httpError(400, `${missing} checklist item(s) are not scored yet`);
  update('audits', a.id, { status: 'submitted' });
  logActivity({ facility_id: a.facility_id, user_id: req.user.id, entity_type: 'audit', entity_id: a.id, action: 'submit', details: `Monthly visit completed – score ${a.score}/${a.max_score}` });
  // notify managers via a reminder
  insert('tasks', { facility_id: a.facility_id, title: `Review & acknowledge ${a.period} property audit`, description: a.summary, due_date: today(), priority: 'high', status: 'open', category: 'Audit', created_by: req.user.id, source: 'audit', audit_id: a.id,
    assigned_to: all('SELECT u.id, u.facility_ids, r.slug FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug=\'pm\' AND u.active=1').find((u) => JSON.parse(u.facility_ids || '[]').includes(a.facility_id))?.id });
  res.json({ ok: true });
});

r.post('/audits/:id/acknowledge', requirePerm('audits.respond'), (req, res) => {
  const a = loadAudit(req, req.params.id);
  if (a.status !== 'submitted') throw httpError(400, 'Only submitted audits can be acknowledged');
  update('audits', a.id, { status: 'acknowledged', manager_response: req.body.manager_response, acknowledged_by: req.user.id, acknowledged_at: new Date().toISOString() });
  run("UPDATE tasks SET status='done', completed_at=?, completed_by=? WHERE audit_id=? AND title LIKE 'Review & acknowledge%'", new Date().toISOString(), req.user.id, a.id);
  logActivity({ facility_id: a.facility_id, user_id: req.user.id, entity_type: 'audit', entity_id: a.id, action: 'acknowledge', details: `Manager acknowledged audit${req.body.manager_response ? ': ' + req.body.manager_response.slice(0, 80) : ''}` });
  res.json({ ok: true });
});

r.post('/audits/:id/reopen', requirePerm('audits.perform'), (req, res) => {
  const a = loadAudit(req, req.params.id);
  update('audits', a.id, { status: 'draft' });
  res.json({ ok: true });
});

r.delete('/audits/:id', requirePerm('audits.perform'), (req, res) => {
  const a = loadAudit(req, req.params.id);
  if (a.status !== 'draft') throw httpError(400, 'Only drafts can be deleted');
  run('DELETE FROM audit_items WHERE audit_id=?', a.id); run('DELETE FROM audits WHERE id=?', a.id);
  res.json({ ok: true });
});

r.post('/audits/:id/photos', requirePerm('audits.perform'), (req, res) => {
  const a = loadAudit(req, req.params.id);
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/.exec(req.body.dataUrl || '');
  if (!m) throw httpError(400, 'Upload a PNG, JPG, GIF or WEBP image');
  const name = `audit-${a.id}-${crypto.randomBytes(6).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
  const id = insert('audit_photos', { audit_id: a.id, filename: name, caption: req.body.caption });
  res.json({ id, filename: name });
});

r.delete('/audits/:id/photos/:pid', requirePerm('audits.perform'), (req, res) => {
  loadAudit(req, req.params.id);
  run('DELETE FROM audit_photos WHERE id=? AND audit_id=?', Number(req.params.pid), Number(req.params.id));
  res.json({ ok: true });
});

export default r;
