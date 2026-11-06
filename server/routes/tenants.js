import { Router } from 'express';
import { all, get, run, insert, update, tx } from '../db.js';
import { scope, requirePerm, assertFacility, can } from '../auth.js';
import { today, round2, money, addDays, NOTE_UNDO_SECONDS, noteReminderRoles } from '../util.js';
import { inList, httpError, facilityConfig, nextLienStep, fullName } from './helpers.js';
import { facilityAccounts, tenantAccount, gateState, postLedger, logActivity, firstPeriod, applyPromo, generateGateCode, sendTemplate, EMPTY_ACCT, lienPaymentAlert } from '../core.js';
import { chargeCard, refundCard, gateSetAccess } from '../services/integrations.js';

const r = Router();

function loadTenant(req, id) {
  const t = get('SELECT * FROM tenants WHERE id=?', Number(id));
  if (!t) throw httpError(404, 'Tenant not found');
  assertFacility(req, t.facility_id);
  return t;
}

r.get('/tenants', requirePerm('tenants.view'), (req, res) => {
  const ids = scope(req);
  const status = req.query.status || 'active';
  const rows = all(`SELECT t.*, f.code facility_code,
      (SELECT group_concat(u.number, ', ') FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.tenant_id=t.id AND r.status='active') units,
      (SELECT COUNT(*) FROM rentals r WHERE r.tenant_id=t.id AND r.status='active') active_rentals,
      (SELECT SUM(rent) FROM rentals r WHERE r.tenant_id=t.id AND r.status='active') rent,
      (SELECT MIN(move_in_date) FROM rentals r WHERE r.tenant_id=t.id) since,
      (SELECT SUM(insurance_premium>0) FROM rentals r WHERE r.tenant_id=t.id AND r.status='active') insured,
      (SELECT lien_status FROM rentals r WHERE r.tenant_id=t.id AND r.status='active' ORDER BY id LIMIT 1) lien_status
    FROM tenants t JOIN facilities f ON f.id=t.facility_id WHERE t.facility_id IN ${inList(ids)} ${status === 'all' ? '' : 'AND t.status=?'} ORDER BY t.last_name, t.first_name`, ...ids, ...(status === 'all' ? [] : [status]));
  const accts = facilityAccounts(ids);
  const facs = Object.fromEntries(ids.map((id) => [id, facilityConfig(id)]));
  res.json(rows.map((t) => {
    const a = accts.get(t.id) || EMPTY_ACCT;
    const g = gateState(t, a, facs[t.facility_id], t.active_rentals > 0);
    return { id: t.id, facility_id: t.facility_id, facility_code: t.facility_code, first_name: t.first_name, last_name: t.last_name, company: t.company, email: t.email, phone: t.phone,
      units: t.units, rent: t.rent || 0, since: t.since, status: t.status, autopay: t.autopay, insured: !!t.insured, gate_code: t.gate_code, gate_allowed: g.allowed, gate_reason: g.reason,
      balance: a.balance, pastDue: a.pastDue, daysLate: a.daysLate, lien_status: t.lien_status, military: t.military };
  }));
});

r.post('/tenants', requirePerm('tenants.edit'), (req, res) => {
  const b = req.body;
  assertFacility(req, b.facility_id);
  const id = insert('tenants', { ...pickTenant(b), facility_id: b.facility_id, gate_code: b.gate_code || generateGateCode(), status: 'active' });
  logActivity({ facility_id: b.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: id, action: 'create', details: `Created tenant ${fullName(b)}` });
  res.json({ id });
});

const TENANT_FIELDS = ['first_name', 'last_name', 'company', 'email', 'phone', 'alt_phone', 'address', 'city', 'state', 'zip', 'dl_number', 'dl_state', 'dob', 'emergency_name', 'emergency_phone', 'military', 'autopay', 'autopay_method', 'sms_opt_in', 'email_opt_in', 'notes'];
function pickTenant(b) { return Object.fromEntries(TENANT_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]])); }

r.get('/tenants/:id', requirePerm('tenants.view'), (req, res) => {
  const t = loadTenant(req, req.params.id);
  const f = facilityConfig(t.facility_id);
  const acct = tenantAccount(t.id);
  const rentals = all(`SELECT r.*, u.number, u.unit_type, u.width, u.length, u.street_rate, u.overlocked, u.building, ip.name insurance_name, ip.coverage, p.name promotion_name
    FROM rentals r JOIN units u ON u.id=r.unit_id LEFT JOIN insurance_plans ip ON ip.id=r.insurance_plan_id LEFT JOIN promotions p ON p.id=r.promotion_id WHERE r.tenant_id=? ORDER BY r.status='active' DESC, r.move_in_date DESC`, t.id)
    .map((x) => ({ ...x, signature: x.signature ? true : false, nextStep: x.status === 'active' ? nextLienStep(x, acct, f.lien_steps) : null }));
  const ledgerRows = all('SELECT l.*, u.name user_name, un.number unit FROM ledger l LEFT JOIN users u ON u.id=l.user_id LEFT JOIN rentals r ON r.id=l.rental_id LEFT JOIN units un ON un.id=r.unit_id WHERE l.tenant_id=? ORDER BY l.date, l.id', t.id);
  let bal = 0;
  const ledger = ledgerRows.map((l) => { if (!l.voided) bal += l.type === 'charge' || l.type === 'refund' ? l.amount : -l.amount; return { ...l, running: round2(bal) }; }).reverse();
  const active = rentals.filter((x) => x.status === 'active');
  res.json({
    tenant: t, facility: { id: f.id, name: f.name, note_reminder: noteReminderRoles(f).includes(req.user.role_id), gate_deny_days: f.gate_deny_days, lien_steps: f.lien_steps, tax_rate: f.tax_rate, billing_type: f.billing_type },
    account: acct, gate: gateState(t, acct, f, active.length > 0), rentals, ledger,
    communications: all('SELECT c.*, u.name user_name FROM communications c LEFT JOIN users u ON u.id=c.user_id WHERE tenant_id=? ORDER BY c.id DESC', t.id),
    lienEvents: all('SELECT e.*, u.name user_name, un.number unit FROM lien_events e LEFT JOIN users u ON u.id=e.user_id LEFT JOIN rentals r ON r.id=e.rental_id LEFT JOIN units un ON un.id=r.unit_id WHERE e.tenant_id=? ORDER BY e.id DESC', t.id),
    notes: all('SELECT n.*, u.name user_name FROM tenant_notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.tenant_id=? ORDER BY n.created_ms DESC', t.id).map(noteView(req)),
    history: all("SELECT a.*, u.name user_name FROM activity_log a LEFT JOIN users u ON u.id=a.user_id WHERE entity_type='tenant' AND entity_id=? AND action NOT IN ('note','note_undo') ORDER BY a.id DESC LIMIT 200", t.id),
    gateEvents: all('SELECT * FROM gate_events WHERE tenant_id=? ORDER BY id DESC LIMIT 30', t.id),
    sales: all('SELECT * FROM sales WHERE tenant_id=? ORDER BY id DESC', t.id),
    auctions: all('SELECT a.*, u.number FROM auctions a JOIN units u ON u.id=a.unit_id WHERE a.tenant_id=? ORDER BY a.id DESC', t.id),
    increases: all('SELECT ri.*, u.number FROM rent_increases ri JOIN units u ON u.id=ri.unit_id WHERE ri.tenant_id=? ORDER BY ri.id DESC', t.id),
    tasks: all('SELECT * FROM tasks WHERE tenant_id=? ORDER BY id DESC', t.id),
  });
});

r.put('/tenants/:id', requirePerm('tenants.edit'), (req, res) => {
  const t = loadTenant(req, req.params.id);
  const changes = pickTenant(req.body);
  update('tenants', t.id, changes);
  const changed = Object.keys(changes).filter((k) => String(changes[k] ?? '') !== String(t[k] ?? ''));
  if (changed.length) logActivity({ facility_id: t.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: t.id, action: 'update', details: `Updated ${changed.join(', ')}` });
  res.json({ ok: true });
});

// ---------- account notes ----------
// The author can undo a note for NOTE_UNDO_SECONDS (clean removal, no trace). After that the note is
// permanent: there is deliberately no edit or delete route for anyone.
const UNDO_GRACE_MS = 5000; // allowance for network delay; the screen shows the exact window
const noteView = (req) => (n) => {
  const remaining = n.user_id === req.user.id ? Math.max(0, Math.ceil((n.created_ms + NOTE_UNDO_SECONDS * 1000 - Date.now()) / 1000)) : 0;
  return { ...n, undo_seconds_left: remaining };
};

r.post('/tenants/:id/notes', requirePerm('tenants.view'), (req, res) => {
  const t = loadTenant(req, req.params.id);
  const body = String(req.body.note || '').trim();
  if (!body) throw httpError(400, 'Note is empty');
  if (body.length > 5000) throw httpError(400, 'Note is too long (5,000 characters max)');
  const id = insert('tenant_notes', { facility_id: t.facility_id, tenant_id: t.id, user_id: req.user.id, body, created_ms: Date.now() });
  const n = get('SELECT n.*, u.name user_name FROM tenant_notes n LEFT JOIN users u ON u.id=n.user_id WHERE n.id=?', id);
  res.json({ note: noteView(req)(n), undo_seconds: NOTE_UNDO_SECONDS });
});

r.delete('/tenants/:id/notes/:noteId', requirePerm('tenants.view'), (req, res) => {
  const t = loadTenant(req, req.params.id);
  const n = get('SELECT * FROM tenant_notes WHERE id=? AND tenant_id=?', Number(req.params.noteId), t.id);
  if (!n) throw httpError(404, 'Note not found');
  if (n.user_id !== req.user.id) throw httpError(403, 'Only the person who wrote a note can undo it');
  if (Date.now() - n.created_ms > NOTE_UNDO_SECONDS * 1000 + UNDO_GRACE_MS) throw httpError(400, `The ${NOTE_UNDO_SECONDS}-second undo window has passed – this note is now permanent`);
  run('DELETE FROM tenant_notes WHERE id=?', n.id); // a clean take-back: nothing is kept once undone
  res.json({ ok: true, body: n.body });
});

r.post('/tenants/:id/gate', requirePerm('gate.manage'), async (req, res) => {
  const t = loadTenant(req, req.params.id);
  const { access, regenerate, code } = req.body;
  const changes = {};
  if (access) changes.gate_access = access;
  if (regenerate) changes.gate_code = generateGateCode();
  if (code) {
    if (!/^\d{4,8}$/.test(code)) throw httpError(400, 'Gate code must be 4–8 digits');
    if (get('SELECT 1 x FROM tenants WHERE gate_code=? AND id!=?', code, t.id)) throw httpError(400, 'That code is already in use');
    changes.gate_code = code;
  }
  update('tenants', t.id, changes);
  const nt = get('SELECT * FROM tenants WHERE id=?', t.id);
  const f = facilityConfig(t.facility_id);
  const hasActive = !!get("SELECT 1 x FROM rentals WHERE tenant_id=? AND status='active'", t.id);
  const g = gateState(nt, tenantAccount(t.id), f, hasActive);
  if (changes.gate_code && t.gate_code) await gateSetAccess({ facilityId: f.id, code: t.gate_code, allowed: false, action: 'delete_code' });
  const sync = await gateSetAccess({ facilityId: f.id, code: nt.gate_code, allowed: g.allowed, tenantName: fullName(nt) });
  update('tenants', t.id, { gate_last_state: g.allowed ? 'allowed' : 'denied' });
  insert('gate_events', { facility_id: f.id, tenant_id: t.id, code: nt.gate_code, event: changes.gate_code ? 'code_changed' : g.allowed ? 'access_restored' : 'access_suspended', detail: `${g.reason} (by ${req.user.name})` });
  logActivity({ facility_id: f.id, user_id: req.user.id, entity_type: 'tenant', entity_id: t.id, action: 'gate', details: changes.gate_code ? 'Gate code changed' : `Gate access set to ${access}` });
  res.json({ gate: g, code: nt.gate_code, sync: sync.status });
});

// ---------- money ----------
r.post('/tenants/:id/payments', requirePerm('payments.take'), async (req, res) => {
  const t = loadTenant(req, req.params.id);
  const { method, reference, paymentMethodId, last4, notes } = req.body;
  const amount = round2(req.body.amount);
  if (!(amount > 0)) throw httpError(400, 'Enter a payment amount');
  let ref = reference;
  if (method === 'card') {
    const ch = await chargeCard({ amount, paymentMethodId, last4, description: `Payment – ${fullName(t)}` });
    ref = ch.reference + (last4 ? ` (•••• ${last4})` : '');
  }
  const before = tenantAccount(t.id);
  const rentalsBefore = all("SELECT r.*, u.number FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.tenant_id=? AND r.status='active'", t.id);
  const id = postLedger({ facility_id: t.facility_id, tenant_id: t.id, rental_id: get("SELECT id FROM rentals WHERE tenant_id=? AND status='active' ORDER BY id LIMIT 1", t.id)?.id, type: 'payment', category: 'payment', description: notes ? `Payment – ${notes}` : 'Payment', amount, method, reference: ref, user_id: req.user.id });
  const after = tenantAccount(t.id);
  const lienAlert = lienPaymentAlert({ tenant: t, before: rentalsBefore, amount, method, balanceBefore: before.balance, balanceAfter: after.balance, user_id: req.user.id });
  logActivity({ facility_id: t.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: t.id, action: 'payment', details: `Payment ${money(amount)} (${method}) – balance ${money(before.balance)} → ${money(after.balance)}` });
  // paid in full: clear lien status, restore gate
  if (after.balance <= 0 || after.daysLate === 0) {
    update('tenants', t.id, { delinquent_since: null });
    run("UPDATE rentals SET lien_status='current' WHERE tenant_id=? AND status='active'", t.id);
    const f = facilityConfig(t.facility_id);
    const g = gateState(t, after, f, true);
    if (g.allowed && t.gate_last_state === 'denied') {
      await gateSetAccess({ facilityId: f.id, code: t.gate_code, allowed: true, tenantName: fullName(t) });
      update('tenants', t.id, { gate_last_state: 'allowed' });
      insert('gate_events', { facility_id: f.id, tenant_id: t.id, code: t.gate_code, event: 'access_restored', detail: 'Paid – access restored automatically' });
    }
    // cancel scheduled auctions when redeemed
    for (const a of all("SELECT id FROM auctions WHERE tenant_id=? AND status='scheduled'", t.id)) update('auctions', a.id, { status: 'redeemed', notes: `Tenant paid in full ${today()}` });
  }
  if (req.body.sendReceipt) await sendTemplate('payment_receipt', { tenant_id: t.id, facility_id: t.facility_id, user_id: req.user.id });
  res.json({ id, reference: ref, account: after, lienAlert });
});

r.post('/tenants/:id/adjustments', requirePerm('ledger.adjust'), (req, res) => {
  const t = loadTenant(req, req.params.id);
  const { type, category, description, rental_id } = req.body;
  const amount = round2(req.body.amount);
  if (!['charge', 'credit'].includes(type) || !(amount > 0)) throw httpError(400, 'Invalid adjustment');
  postLedger({ facility_id: t.facility_id, tenant_id: t.id, rental_id: rental_id || null, type, category: category || (type === 'credit' ? 'credit' : 'misc'), description: description || (type === 'credit' ? 'Credit' : 'Charge'), amount, user_id: req.user.id });
  logActivity({ facility_id: t.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: t.id, action: type, details: `${type === 'credit' ? 'Credit' : 'Charge'} ${money(amount)} – ${description || category}` });
  res.json({ account: tenantAccount(t.id) });
});

r.post('/ledger/:id/void', async (req, res) => {
  const l = get('SELECT * FROM ledger WHERE id=?', Number(req.params.id));
  if (!l) throw httpError(404, 'Entry not found');
  assertFacility(req, l.facility_id);
  if (!can(req.user, l.type === 'payment' ? 'payments.refund' : 'ledger.adjust')) throw httpError(403, 'You do not have permission to void this entry');
  if (l.voided) throw httpError(400, 'Already voided');
  if (l.type === 'payment' && l.method === 'card') await refundCard({ reference: (l.reference || '').split(' ')[0], amount: l.amount });
  update('ledger', l.id, { voided: 1 });
  logActivity({ facility_id: l.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: l.tenant_id, action: 'void', details: `Voided ${l.type} ${money(l.amount)} – ${l.description}${req.body.reason ? ` (Reason: ${req.body.reason})` : ''}` });
  res.json({ ok: true });
});

r.post('/tenants/:id/refund', requirePerm('payments.refund'), async (req, res) => {
  const t = loadTenant(req, req.params.id);
  const amount = round2(req.body.amount);
  const acct = tenantAccount(t.id);
  if (!(amount > 0) || amount > -acct.balance + 0.001) throw httpError(400, `Refund cannot exceed the credit balance (${money(Math.max(0, -acct.balance))})`);
  postLedger({ facility_id: t.facility_id, tenant_id: t.id, type: 'refund', category: 'refund', description: req.body.description || 'Refund of credit balance', amount, method: req.body.method || 'check', user_id: req.user.id });
  logActivity({ facility_id: t.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: t.id, action: 'refund', details: `Refunded ${money(amount)}` });
  res.json({ account: tenantAccount(t.id) });
});

r.put('/rentals/:id', requirePerm('pastdue.manage', 'tenants.edit'), (req, res) => {
  const x = get('SELECT * FROM rentals WHERE id=?', Number(req.params.id));
  if (!x) throw httpError(404, 'Rental not found');
  assertFacility(req, x.facility_id);
  const ch = {};
  if (req.body.lien_hold !== undefined) ch.lien_hold = req.body.lien_hold ? 1 : 0;
  if (req.body.insurance_plan_id !== undefined) {
    const p = req.body.insurance_plan_id ? get('SELECT * FROM insurance_plans WHERE id=?', req.body.insurance_plan_id) : null;
    ch.insurance_plan_id = p?.id || null; ch.insurance_premium = p?.premium || 0;
  }
  update('rentals', x.id, ch);
  logActivity({ facility_id: x.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: x.tenant_id, action: 'rental_update', details: ch.lien_hold !== undefined ? (ch.lien_hold ? 'Lien process placed on hold' : 'Lien hold removed') : 'Protection plan changed' });
  res.json({ ok: true });
});

// ---------- move-in ----------
function quote(f, unit, { move_in_date, rent, promotion_id, insurance_plan_id }) {
  const promo = promotion_id ? get('SELECT * FROM promotions WHERE id=?', promotion_id) : null;
  const plan = insurance_plan_id ? get('SELECT * FROM insurance_plans WHERE id=?', insurance_plan_id) : null;
  const baseRent = round2(rent || unit.street_rate);
  const firstRent = promo ? applyPromo(baseRent, promo) : baseRent;
  const fp = firstPeriod(f, move_in_date, firstRent);
  const items = [{ category: 'rent', description: fp.label + (promo ? ` – ${promo.name}` : ''), amount: fp.amount }];
  if (f.admin_fee > 0) items.push({ category: 'admin_fee', description: 'Admin fee', amount: f.admin_fee });
  if (f.deposit > 0) items.push({ category: 'deposit', description: 'Security deposit', amount: f.deposit });
  if (plan) items.push({ category: 'insurance', description: `${plan.name} ($${plan.coverage.toLocaleString()} coverage)`, amount: plan.premium });
  return { items, total: round2(items.reduce((s, i) => s + i.amount, 0)), nextDue: fp.nextDue, rent: baseRent, promo, plan };
}

r.post('/movein/quote', requirePerm('movein.perform'), (req, res) => {
  const unit = get('SELECT * FROM units WHERE id=?', Number(req.body.unit_id));
  if (!unit) throw httpError(404, 'Unit not found');
  assertFacility(req, unit.facility_id);
  const q = quote(facilityConfig(unit.facility_id), unit, { ...req.body, move_in_date: req.body.move_in_date || today() });
  res.json({ items: q.items, total: q.total, nextDue: q.nextDue, rent: q.rent });
});

r.post('/movein', requirePerm('movein.perform'), async (req, res) => {
  const b = req.body;
  const unit = get('SELECT * FROM units WHERE id=?', Number(b.unit_id));
  if (!unit) throw httpError(404, 'Unit not found');
  assertFacility(req, unit.facility_id);
  if (!['vacant', 'reserved'].includes(unit.status)) throw httpError(400, `Unit ${unit.number} is ${unit.status}`);
  const f = facilityConfig(unit.facility_id);
  const moveIn = b.move_in_date || today();
  const q = quote(f, unit, { ...b, move_in_date: moveIn });
  const pay = b.payment || {};
  const payAmt = round2(pay.amount ?? q.total);
  let payRef = pay.reference;
  if (payAmt > 0 && pay.method === 'card') {
    const ch = await chargeCard({ amount: payAmt, paymentMethodId: pay.paymentMethodId, last4: pay.last4, description: `Move-in ${unit.number}` });
    payRef = ch.reference + (pay.last4 ? ` (•••• ${pay.last4})` : '');
  }
  const result = tx(() => {
    let tenantId = b.tenant_id;
    if (tenantId) { const t = get('SELECT * FROM tenants WHERE id=?', tenantId); if (!t) throw httpError(404, 'Tenant not found'); if (t.facility_id !== f.id) throw httpError(400, 'That tenant belongs to another facility – create a new tenant record here instead'); update('tenants', tenantId, { status: 'active', ...pickTenant(b.tenant || {}) }); }
    else {
      if (!b.tenant?.first_name || !b.tenant?.last_name) throw httpError(400, 'Tenant first and last name are required');
      tenantId = insert('tenants', { ...pickTenant(b.tenant), facility_id: f.id, gate_code: b.gate_code || generateGateCode(), status: 'active', lead_id: b.lead_id || null });
    }
    if (b.gate_code) update('tenants', tenantId, { gate_code: b.gate_code });
    const rid = insert('rentals', { facility_id: f.id, tenant_id: tenantId, unit_id: unit.id, move_in_date: moveIn, rent: q.rent, insurance_plan_id: q.plan?.id, insurance_premium: q.plan?.premium || 0,
      promotion_id: q.promo?.id, promo_months_left: q.promo ? Math.max(0, q.promo.months - 1) : 0, next_due_date: q.nextDue, status: 'active', lien_status: 'current', signature: b.signature || null });
    for (const it of q.items) postLedger({ facility_id: f.id, tenant_id: tenantId, rental_id: rid, date: moveIn, type: 'charge', category: it.category, description: `${it.description} – ${unit.number}`, amount: it.amount, reference: it.category === 'rent' ? `RENT:${rid}:${moveIn}` : null, user_id: req.user.id });
    if (payAmt > 0) postLedger({ facility_id: f.id, tenant_id: tenantId, rental_id: rid, date: moveIn, type: 'payment', category: 'payment', description: 'Move-in payment', amount: payAmt, method: pay.method || 'cash', reference: payRef, user_id: req.user.id });
    update('units', unit.id, { status: 'occupied', overlocked: 0 });
    if (b.lead_id) update('leads', b.lead_id, { status: 'converted', tenant_id: tenantId, unit_id: unit.id });
    else run("UPDATE leads SET status='contacted', unit_id=NULL WHERE unit_id=? AND status='reserved'", unit.id);
    logActivity({ facility_id: f.id, user_id: req.user.id, entity_type: 'tenant', entity_id: tenantId, action: 'move_in', details: `Moved into unit ${unit.number} at ${money(q.rent)}/mo. Collected ${money(payAmt)}.` });
    return { tenantId, rentalId: rid };
  });
  const t = get('SELECT * FROM tenants WHERE id=?', result.tenantId);
  await gateSetAccess({ facilityId: f.id, code: t.gate_code, allowed: true, units: [unit.number], tenantName: fullName(t), action: 'create_code' });
  update('tenants', t.id, { gate_last_state: 'allowed' });
  insert('gate_events', { facility_id: f.id, tenant_id: t.id, unit_id: unit.id, code: t.gate_code, event: 'code_created', detail: `Move-in unit ${unit.number}` });
  if (b.sendWelcome !== false) await sendTemplate('welcome', { tenant_id: t.id, facility_id: f.id, user_id: req.user.id });
  res.json({ ...result, gate_code: t.gate_code, paymentReference: payRef });
});

// ---------- move-out ----------
r.post('/moveout', requirePerm('moveout.perform'), async (req, res) => {
  const b = req.body;
  const x = get('SELECT r.*, u.number FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.id=?', Number(b.rental_id));
  if (!x || x.status !== 'active') throw httpError(400, 'Rental is not active');
  assertFacility(req, x.facility_id);
  const date = b.date || today();
  const inspection = b.inspection || {};
  tx(() => {
    if (b.waiveBalance) {
      const a = tenantAccount(x.tenant_id);
      if (a.balance > 0) postLedger({ facility_id: x.facility_id, tenant_id: x.tenant_id, rental_id: x.id, date, type: 'credit', category: 'write_off', description: 'Balance waived at move-out', amount: a.balance, user_id: req.user.id });
    }
    if (b.cleaningFee > 0) postLedger({ facility_id: x.facility_id, tenant_id: x.tenant_id, rental_id: x.id, date, type: 'charge', category: 'cleaning_fee', description: 'Cleaning / trash removal fee', amount: b.cleaningFee, user_id: req.user.id });
    update('rentals', x.id, { status: 'ended', move_out_date: date, move_out_reason: b.reason, vacate_notes: [b.notes, Object.entries(inspection).filter(([, v]) => v).map(([k]) => k).join(', ')].filter(Boolean).join(' | ') });
    update('units', x.unit_id, { status: b.markUnrentable ? 'unrentable' : 'vacant', overlocked: 0, unrentable_reason: b.markUnrentable ? (b.unrentableReason || 'Needs cleaning / repair') : null });
    run("UPDATE rent_increases SET status='cancelled' WHERE rental_id=? AND status='scheduled'", x.id);
    run("UPDATE auctions SET status='cancelled' WHERE rental_id=? AND status='scheduled'", x.id);
    const still = get("SELECT COUNT(*) c FROM rentals WHERE tenant_id=? AND status='active'", x.tenant_id).c;
    if (!still) update('tenants', x.tenant_id, { status: 'former', autopay: 0 });
    logActivity({ facility_id: x.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: x.tenant_id, action: 'move_out', details: `Moved out of unit ${x.number}. Reason: ${b.reason || '—'}` });
  });
  const t = get('SELECT * FROM tenants WHERE id=?', x.tenant_id);
  if (t.status === 'former') {
    await gateSetAccess({ facilityId: x.facility_id, code: t.gate_code, allowed: false, action: 'delete_code', tenantName: fullName(t) });
    update('tenants', t.id, { gate_last_state: 'denied' });
    insert('gate_events', { facility_id: x.facility_id, tenant_id: t.id, unit_id: x.unit_id, code: t.gate_code, event: 'code_removed', detail: `Move-out unit ${x.number}` });
  }
  if (b.sendConfirmation !== false) await sendTemplate('move_out', { tenant_id: t.id, facility_id: x.facility_id, user_id: req.user.id, extra: { unit: x.number } });
  res.json({ ok: true, account: tenantAccount(t.id) });
});

r.get('/insurance-plans', (req, res) => res.json(all('SELECT * FROM insurance_plans WHERE active=1 ORDER BY premium')));
r.get('/promotions', (req, res) => { const ids = scope(req); res.json(all(`SELECT * FROM promotions WHERE facility_id IN ${inList(ids)} ORDER BY active DESC, name`, ...ids)); });

export default r;
