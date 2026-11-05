import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { scope, requirePerm, assertFacility } from '../auth.js';
import { inList, httpError, activeRentals } from './helpers.js';
import { renderTemplate, tenantContext, sendCommunication, logActivity, facilityCtx } from '../core.js';

const r = Router();

r.get('/communications', requirePerm('communications.send', 'tenants.view'), (req, res) => {
  const ids = scope(req);
  res.json(all(`SELECT c.*, t.first_name, t.last_name, l.first_name lead_first, l.last_name lead_last, u.name user_name, f.code facility_code FROM communications c
    LEFT JOIN tenants t ON t.id=c.tenant_id LEFT JOIN leads l ON l.id=c.lead_id LEFT JOIN users u ON u.id=c.user_id LEFT JOIN facilities f ON f.id=c.facility_id
    WHERE c.facility_id IN ${inList(ids)} ORDER BY c.id DESC LIMIT 600`, ...ids));
});

r.get('/communications/:id', requirePerm('communications.send', 'tenants.view'), (req, res) => {
  const c = get('SELECT c.*, t.first_name, t.last_name, t.address, t.city, t.state, t.zip FROM communications c LEFT JOIN tenants t ON t.id=c.tenant_id WHERE c.id=?', Number(req.params.id));
  if (!c) throw httpError(404, 'Not found');
  assertFacility(req, c.facility_id);
  res.json({ ...c, facility: get('SELECT * FROM facilities WHERE id=?', c.facility_id) });
});

r.get('/templates', (req, res) => res.json(all('SELECT * FROM templates ORDER BY category, name')));
r.post('/templates', requirePerm('templates.manage'), (req, res) => {
  const { name, channel, category, subject, body } = req.body;
  const key = req.body.key || name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const id = insert('templates', { key, name, channel, category, subject, body });
  logActivity({ user_id: req.user.id, entity_type: 'template', entity_id: id, action: 'create', details: `Created template ${name}` });
  res.json({ id });
});
r.put('/templates/:id', requirePerm('templates.manage'), (req, res) => {
  const { name, channel, category, subject, body } = req.body;
  update('templates', Number(req.params.id), { name, channel, category, subject, body });
  logActivity({ user_id: req.user.id, entity_type: 'template', entity_id: Number(req.params.id), action: 'update', details: `Updated template ${name}` });
  res.json({ ok: true });
});
r.delete('/templates/:id', requirePerm('templates.manage'), (req, res) => { run('DELETE FROM templates WHERE id=?', Number(req.params.id)); res.json({ ok: true }); });

function recipients(req, b) {
  const ids = b.facility_id ? [Number(b.facility_id)] : scope(req);
  ids.forEach((id) => assertFacility(req, id));
  if (b.audience === 'selected') return (b.tenant_ids || []).map(Number);
  const rentals = activeRentals(ids);
  const set = new Set();
  for (const x of rentals) {
    if (b.audience === 'pastdue' && !(x.account.daysLate > 0 && x.account.balance > 0)) continue;
    if (b.audience === 'pastdue_min' && !(x.account.daysLate >= (b.minDays || 1) && x.account.balance > 0)) continue;
    if (b.audience === 'autopay_off' && x.autopay) continue;
    set.add(x.tenant_id);
  }
  return [...set];
}

r.post('/communications/preview', requirePerm('communications.send'), (req, res) => {
  const b = req.body;
  const list = b.lead_id ? [] : recipients(req, b);
  const sampleId = list[0];
  let ctx;
  if (b.lead_id) { const l = get('SELECT * FROM leads WHERE id=?', b.lead_id); ctx = { ...l, ...facilityCtx(get('SELECT * FROM facilities WHERE id=?', l.facility_id)) }; }
  else ctx = sampleId ? tenantContext(sampleId) : {};
  res.json({ count: b.lead_id ? 1 : list.length, subject: renderTemplate(b.subject, ctx), body: renderTemplate(b.body, ctx) });
});

r.post('/communications/send', requirePerm('communications.send'), async (req, res) => {
  const b = req.body;
  if (!b.body?.trim()) throw httpError(400, 'Message body is empty');
  const results = { sent: 0, simulated: 0, failed: 0, ready_to_print: 0, logged: 0, ids: [] };
  if (b.lead_id) {
    const l = get('SELECT * FROM leads WHERE id=?', Number(b.lead_id));
    assertFacility(req, l.facility_id);
    const ctx = { ...l, ...facilityCtx(get('SELECT * FROM facilities WHERE id=?', l.facility_id)) };
    const id = await sendCommunication({ facility_id: l.facility_id, lead_id: l.id, channel: b.channel, subject: renderTemplate(b.subject, ctx), body: renderTemplate(b.body, ctx), template_key: b.template_key, user_id: req.user.id });
    const c = get('SELECT status FROM communications WHERE id=?', id);
    results[c.status] = (results[c.status] || 0) + 1; results.ids.push(id);
    if (l.status === 'new') update('leads', l.id, { status: 'contacted' });
    logActivity({ facility_id: l.facility_id, user_id: req.user.id, entity_type: 'lead', entity_id: l.id, action: 'message', details: `${b.channel} sent: ${renderTemplate(b.subject, ctx) || b.body.slice(0, 40)}` });
    return res.json(results);
  }
  const list = recipients(req, b);
  if (!list.length) throw httpError(400, 'No recipients match');
  if (list.length > 2000) throw httpError(400, 'Too many recipients');
  for (const tid of list) {
    const t = get('SELECT * FROM tenants WHERE id=?', tid);
    if (!t) continue;
    assertFacility(req, t.facility_id);
    if (b.channel === 'sms' && !t.sms_opt_in) { results.skipped = (results.skipped || 0) + 1; continue; }
    if (b.channel === 'email' && !t.email_opt_in) { results.skipped = (results.skipped || 0) + 1; continue; }
    const ctx = tenantContext(tid);
    const id = await sendCommunication({ facility_id: t.facility_id, tenant_id: tid, channel: b.channel, subject: renderTemplate(b.subject, ctx), body: renderTemplate(b.body, ctx), template_key: b.template_key, user_id: req.user.id });
    const c = get('SELECT status FROM communications WHERE id=?', id);
    results[c.status] = (results[c.status] || 0) + 1; results.ids.push(id);
  }
  logActivity({ facility_id: b.facility_id || null, user_id: req.user.id, entity_type: 'communication', action: 'send', details: `Sent ${b.channel} "${b.subject || b.template_key || 'message'}" to ${list.length} recipient(s)` });
  res.json(results);
});

r.post('/communications/log', requirePerm('tenants.view', 'leads.manage'), (req, res) => {
  const b = req.body;
  const facility_id = b.tenant_id ? get('SELECT facility_id FROM tenants WHERE id=?', b.tenant_id)?.facility_id : get('SELECT facility_id FROM leads WHERE id=?', b.lead_id)?.facility_id;
  if (!facility_id) throw httpError(404, 'Not found');
  assertFacility(req, facility_id);
  const id = insert('communications', { facility_id, tenant_id: b.tenant_id, lead_id: b.lead_id, channel: b.channel || 'call', direction: b.direction || 'outbound', subject: b.subject || (b.channel === 'call' ? 'Phone call' : 'Note'), body: b.body, status: 'logged', user_id: req.user.id });
  if (b.lead_id) { const l = get('SELECT status FROM leads WHERE id=?', b.lead_id); if (l.status === 'new') update('leads', b.lead_id, { status: 'contacted' }); }
  res.json({ id });
});

export default r;
