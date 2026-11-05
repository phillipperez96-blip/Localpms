import { Router } from 'express';
import { all, get, insert, update, tx } from '../db.js';
import { scope, requirePerm, assertFacility } from '../auth.js';
import { today, round2, money, addDays } from '../util.js';
import { inList, httpError, activeRentals, facilityConfig, nextLienStep } from './helpers.js';
import { completeLienStep, tenantAccount, postLedger, logActivity, delinquencyCycle } from '../core.js';

const r = Router();

r.get('/pastdues', requirePerm('pastdue.manage'), (req, res) => {
  const ids = scope(req);
  const facs = Object.fromEntries(ids.map((id) => [id, facilityConfig(id)]));
  const rows = activeRentals(ids).filter((x) => x.account.daysLate > 0 && x.account.balance > 0).map((x) => {
    const steps = facs[x.facility_id].lien_steps;
    const next = nextLienStep(x, x.account, steps);
    const last = next ? get('SELECT step_name, date FROM lien_events WHERE rental_id=? AND cycle=? ORDER BY id DESC LIMIT 1', x.id, next.cycle) : null;
    const lastContact = get('SELECT channel, created_at FROM communications WHERE tenant_id=? ORDER BY id DESC LIMIT 1', x.tenant_id);
    return {
      rental_id: x.id, tenant_id: x.tenant_id, facility_id: x.facility_id, facility_code: x.facility_code, name: `${x.first_name} ${x.last_name}`, phone: x.phone, email: x.email,
      unit: x.number, unit_id: x.unit_id, size: `${x.width}x${x.length}`, rent: x.rent, balance: x.account.balance, pastDue: x.account.pastDue, daysLate: x.account.daysLate,
      oldestUnpaid: x.account.oldestUnpaid, lien_status: x.lien_status, lien_hold: x.lien_hold, overlocked: !!x.overlocked, autopay: x.autopay,
      lastStep: last, next, lastContact, stepIndex: steps.findIndex((s) => s.key === x.lien_status),
    };
  }).sort((a, b) => b.daysLate - a.daysLate);
  const steps = ids.length === 1 ? facs[ids[0]].lien_steps : facs[ids[0]]?.lien_steps || [];
  res.json({ rows, steps, automation: ids.length === 1 ? facs[ids[0]].lien_automation : null });
});

r.post('/pastdues/:rentalId/step', requirePerm('pastdue.manage'), async (req, res) => {
  const x = get('SELECT * FROM rentals WHERE id=?', Number(req.params.rentalId));
  if (!x) throw httpError(404, 'Rental not found');
  assertFacility(req, x.facility_id);
  const acct = tenantAccount(x.tenant_id);
  const cycle = delinquencyCycle(x.tenant_id, acct, { persist: true });
  if (!cycle) throw httpError(400, 'This account is not past due');
  const f = facilityConfig(x.facility_id);
  const step = f.lien_steps.find((s) => s.key === req.body.step_key) || nextLienStep(x, acct, f.lien_steps);
  if (!step) throw httpError(400, 'All lien steps are complete');
  if (get('SELECT 1 x FROM lien_events WHERE rental_id=? AND step_key=? AND cycle=?', x.id, step.key, cycle)) throw httpError(400, 'Step already completed');
  await completeLienStep({ rental: x, step, cycle, user_id: req.user.id, notes: req.body.notes, deliver: req.body.send !== false });
  res.json({ ok: true });
});

// ---------- auctions ----------
r.get('/auctions', requirePerm('auctions.manage', 'pastdue.manage'), (req, res) => {
  const ids = scope(req);
  const rows = all(`SELECT a.*, u.number, u.width, u.length, t.first_name, t.last_name, t.phone, f.code facility_code FROM auctions a JOIN units u ON u.id=a.unit_id JOIN tenants t ON t.id=a.tenant_id JOIN facilities f ON f.id=a.facility_id
    WHERE a.facility_id IN ${inList(ids)} ORDER BY CASE a.status WHEN 'scheduled' THEN 0 ELSE 1 END, a.scheduled_date DESC`, ...ids);
  res.json(rows.map((a) => ({ ...a, balance: a.status === 'scheduled' ? tenantAccount(a.tenant_id).balance : null })));
});

r.post('/auctions', requirePerm('auctions.manage'), (req, res) => {
  const x = get('SELECT * FROM rentals WHERE id=?', Number(req.body.rental_id));
  if (!x) throw httpError(404, 'Rental not found');
  assertFacility(req, x.facility_id);
  if (get("SELECT 1 x FROM auctions WHERE rental_id=? AND status='scheduled'", x.id)) throw httpError(400, 'An auction is already scheduled');
  const id = insert('auctions', { facility_id: x.facility_id, rental_id: x.id, tenant_id: x.tenant_id, unit_id: x.unit_id, scheduled_date: req.body.scheduled_date || addDays(today(), 14), platform: req.body.platform || 'Online Auction', listing_url: req.body.listing_url, status: 'scheduled', notes: req.body.notes });
  update('rentals', x.id, { lien_status: 'auction' });
  logActivity({ facility_id: x.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: x.tenant_id, action: 'auction', details: `Auction scheduled for ${req.body.scheduled_date}` });
  res.json({ id });
});

r.put('/auctions/:id', requirePerm('auctions.manage'), (req, res) => {
  const a = get('SELECT * FROM auctions WHERE id=?', Number(req.params.id));
  if (!a) throw httpError(404, 'Auction not found');
  assertFacility(req, a.facility_id);
  const b = req.body;
  const ch = Object.fromEntries(['scheduled_date', 'platform', 'listing_url', 'notes', 'winning_bidder', 'bidder_phone', 'cleanout_deadline'].filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  if (b.status === 'cancelled') ch.status = 'cancelled';
  update('auctions', a.id, ch);
  logActivity({ facility_id: a.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: a.tenant_id, action: 'auction', details: b.status === 'cancelled' ? 'Auction cancelled' : 'Auction details updated' });
  res.json({ ok: true });
});

/** Record a completed sale: apply proceeds, write off remainder, end rental, vacate unit. */
r.post('/auctions/:id/sold', requirePerm('auctions.manage'), (req, res) => {
  const a = get('SELECT * FROM auctions WHERE id=?', Number(req.params.id));
  if (!a || a.status !== 'scheduled') throw httpError(400, 'Auction is not open');
  assertFacility(req, a.facility_id);
  const sale = round2(req.body.sale_amount);
  if (!(sale >= 0)) throw httpError(400, 'Enter the sale amount');
  const T = req.body.date || today();
  tx(() => {
    const fee = round2(req.body.auction_fee || 0);
    if (fee > 0) postLedger({ facility_id: a.facility_id, tenant_id: a.tenant_id, rental_id: a.rental_id, date: T, type: 'charge', category: 'auction_fee', description: 'Auction / sale fee', amount: fee, user_id: req.user.id });
    const bal = tenantAccount(a.tenant_id).balance;
    const applied = Math.min(sale, Math.max(0, bal));
    if (applied > 0) postLedger({ facility_id: a.facility_id, tenant_id: a.tenant_id, rental_id: a.rental_id, date: T, type: 'payment', category: 'auction', description: 'Auction proceeds applied', amount: applied, method: req.body.method || 'auction', user_id: req.user.id });
    const remaining = round2(bal - applied);
    if (remaining > 0 && req.body.writeOff !== false) postLedger({ facility_id: a.facility_id, tenant_id: a.tenant_id, rental_id: a.rental_id, date: T, type: 'credit', category: 'write_off', description: 'Bad debt write-off after auction', amount: remaining, user_id: req.user.id });
    const surplus = round2(Math.max(0, sale - Math.max(0, bal)));
    update('auctions', a.id, { status: 'sold', sale_amount: sale, applied_to_balance: applied, surplus, winning_bidder: req.body.winning_bidder, bidder_phone: req.body.bidder_phone, cleanout_deadline: req.body.cleanout_deadline || addDays(T, 3), notes: req.body.notes || a.notes, scheduled_date: T });
    update('rentals', a.rental_id, { status: 'ended', move_out_date: T, move_out_reason: 'Auctioned', lien_status: 'sold' });
    update('units', a.unit_id, { status: 'vacant', overlocked: 0 });
    if (!get("SELECT 1 x FROM rentals WHERE tenant_id=? AND status='active'", a.tenant_id)) update('tenants', a.tenant_id, { status: 'former', gate_last_state: 'denied' });
    logActivity({ facility_id: a.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: a.tenant_id, action: 'auction_sold', details: `Unit sold for ${money(sale)} to ${req.body.winning_bidder || 'bidder'}. Applied ${money(applied)}, surplus ${money(surplus)}.` });
  });
  res.json({ ok: true });
});

export default r;
