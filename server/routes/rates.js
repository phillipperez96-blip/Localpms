import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { scope, requirePerm, assertFacility } from '../auth.js';
import { today, round2, money, addDays, diffDays } from '../util.js';
import { inList, httpError, activeRentals } from './helpers.js';
import { logActivity, sendTemplate } from '../core.js';

const r = Router();

r.get('/rates', requirePerm('rates.manage'), (req, res) => {
  const ids = scope(req);
  const units = all(`SELECT * FROM units WHERE facility_id IN ${inList(ids)}`, ...ids);
  const rentals = new Map(activeRentals(ids).map((x) => [x.unit_id, x]));
  const groups = {};
  for (const u of units) {
    const k = `${u.facility_id}|${u.unit_type}|${u.width}x${u.length}`;
    const g = (groups[k] ||= { facility_id: u.facility_id, unit_type: u.unit_type, size: `${u.width}x${u.length}`, sqft: u.sqft, total: 0, occupied: 0, vacant: 0, reserved: 0, unrentable: 0, rates: new Set(), inPlace: [], below: 0 });
    g.total++; g[u.status]++; g.rates.add(u.street_rate);
    const x = rentals.get(u.id);
    if (x) { g.inPlace.push(x.rent); if (x.rent < u.street_rate) g.below++; }
  }
  const rows = Object.values(groups).map((g) => {
    const rates = [...g.rates];
    const avg = g.inPlace.length ? round2(g.inPlace.reduce((a, b) => a + b, 0) / g.inPlace.length) : null;
    const street = Math.max(...rates);
    const occ = g.total - g.unrentable ? round2((g.occupied / (g.total - g.unrentable)) * 100) : 0;
    let suggestion = null;
    if (occ >= 92 && g.vacant <= 1) suggestion = { dir: 'up', text: `High occupancy – consider raising to ${money(Math.round(street * 1.06))}` };
    else if (occ < 75 && g.vacant >= 4) suggestion = { dir: 'down', text: 'Low occupancy – consider a promotion or a small decrease' };
    return { facility_id: g.facility_id, unit_type: g.unit_type, size: g.size, sqft: g.sqft, total: g.total, occupied: g.occupied, vacant: g.vacant, reserved: g.reserved, unrentable: g.unrentable,
      occupancy: occ, street_rate: street, mixed: rates.length > 1, avg_in_place: avg, per_sqft: round2(street / g.sqft), below_street: g.below, variance: avg ? round2(avg - street) : null, suggestion };
  }).sort((a, b) => a.facility_id - b.facility_id || a.unit_type.localeCompare(b.unit_type) || a.sqft - b.sqft);
  const history = all(`SELECT h.*, u.name user_name FROM rate_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.facility_id IN ${inList(ids)} ORDER BY h.id DESC LIMIT 50`, ...ids);
  res.json({ rows, history });
});

r.put('/rates', requirePerm('rates.manage'), (req, res) => {
  const { facility_id, unit_type, size, street_rate } = req.body;
  assertFacility(req, facility_id);
  const [w, l] = size.split('x').map(Number);
  const rate = round2(street_rate);
  if (!(rate > 0)) throw httpError(400, 'Enter a valid rate');
  const old = get('SELECT MAX(street_rate) r, COUNT(*) c FROM units WHERE facility_id=? AND unit_type=? AND width=? AND length=?', facility_id, unit_type, w, l);
  run('UPDATE units SET street_rate=? WHERE facility_id=? AND unit_type=? AND width=? AND length=?', rate, facility_id, unit_type, w, l);
  insert('rate_history', { facility_id, unit_type, size, old_rate: old.r, new_rate: rate, unit_count: old.c, user_id: req.user.id });
  logActivity({ facility_id, user_id: req.user.id, entity_type: 'rates', action: 'street_rate', details: `${size} ${unit_type}: ${money(old.r)} → ${money(rate)} (${old.c} units)` });
  res.json({ ok: true });
});

r.get('/rates/ecri-candidates', requirePerm('rates.manage'), (req, res) => {
  const ids = scope(req);
  const minMonths = Number(req.query.minMonths ?? 12), minGap = Number(req.query.minGap ?? 10), pct = Number(req.query.pct ?? 9);
  const T = today();
  const scheduled = new Set(all(`SELECT rental_id FROM rent_increases WHERE status='scheduled' AND facility_id IN ${inList(ids)}`, ...ids).map((x) => x.rental_id));
  const lastInc = new Map(all(`SELECT rental_id, MAX(effective_date) d FROM rent_increases WHERE status='applied' GROUP BY rental_id`).map((x) => [x.rental_id, x.d]));
  const rows = activeRentals(ids).filter((x) => {
    const months = diffDays(T, x.move_in_date) / 30.4;
    const gap = ((x.street_rate - x.rent) / x.street_rate) * 100;
    const recent = lastInc.get(x.id) && diffDays(T, lastInc.get(x.id)) < 365;
    return months >= minMonths && gap >= minGap && !scheduled.has(x.id) && !recent && x.account.daysLate === 0;
  }).map((x) => ({
    rental_id: x.id, tenant_id: x.tenant_id, facility_id: x.facility_id, name: `${x.first_name} ${x.last_name}`, unit: x.number, size: `${x.width}x${x.length}`, unit_type: x.unit_type,
    move_in_date: x.move_in_date, months: Math.floor(diffDays(T, x.move_in_date) / 30.4), rent: x.rent, street_rate: x.street_rate, gap_pct: round2(((x.street_rate - x.rent) / x.street_rate) * 100),
    new_rent: Math.min(x.street_rate, Math.round(x.rent * (1 + pct / 100))),
  })).sort((a, b) => b.gap_pct - a.gap_pct);
  res.json(rows);
});

r.get('/rates/increases', requirePerm('rates.manage'), (req, res) => {
  const ids = scope(req);
  res.json(all(`SELECT ri.*, u.number, t.first_name, t.last_name, us.name user_name FROM rent_increases ri JOIN units u ON u.id=ri.unit_id JOIN tenants t ON t.id=ri.tenant_id LEFT JOIN users us ON us.id=ri.user_id WHERE ri.facility_id IN ${inList(ids)} ORDER BY CASE ri.status WHEN 'scheduled' THEN 0 ELSE 1 END, ri.effective_date DESC LIMIT 300`, ...ids));
});

r.post('/rates/increases', requirePerm('rates.manage'), async (req, res) => {
  const { items, notice_date, effective_date, sendNotice } = req.body;
  if (!items?.length) throw httpError(400, 'Select at least one tenant');
  const nd = notice_date || today(), ed = effective_date || addDays(today(), 30);
  let n = 0;
  for (const it of items) {
    const x = get("SELECT * FROM rentals WHERE id=? AND status='active'", it.rental_id);
    if (!x) continue;
    assertFacility(req, x.facility_id);
    insert('rent_increases', { facility_id: x.facility_id, rental_id: x.id, tenant_id: x.tenant_id, unit_id: x.unit_id, old_rent: x.rent, new_rent: round2(it.new_rent), notice_date: nd, effective_date: ed, status: 'scheduled', user_id: req.user.id });
    logActivity({ facility_id: x.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: x.tenant_id, action: 'rent_increase', details: `Rent increase scheduled ${money(x.rent)} → ${money(it.new_rent)} effective ${ed}` });
    if (sendNotice) await sendTemplate('rent_increase', { tenant_id: x.tenant_id, facility_id: x.facility_id, user_id: req.user.id, extra: { old_rent: money(x.rent), new_rent: money(it.new_rent), effective_date: ed, unit: get('SELECT number FROM units WHERE id=?', x.unit_id).number } });
    n++;
  }
  res.json({ scheduled: n });
});

r.put('/rates/increases/:id', requirePerm('rates.manage'), (req, res) => {
  const ri = get('SELECT * FROM rent_increases WHERE id=?', Number(req.params.id));
  if (!ri) throw httpError(404, 'Not found');
  assertFacility(req, ri.facility_id);
  if (ri.status !== 'scheduled') throw httpError(400, 'Only scheduled increases can be changed');
  const ch = {};
  if (req.body.status === 'cancelled') ch.status = 'cancelled';
  if (req.body.new_rent) ch.new_rent = round2(req.body.new_rent);
  if (req.body.effective_date) ch.effective_date = req.body.effective_date;
  update('rent_increases', ri.id, ch);
  logActivity({ facility_id: ri.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: ri.tenant_id, action: 'rent_increase', details: ch.status ? 'Rent increase cancelled' : 'Rent increase updated' });
  res.json({ ok: true });
});

const PROMO = ['name', 'description', 'discount_type', 'value', 'months', 'active'];
r.post('/promotions', requirePerm('rates.manage'), (req, res) => {
  assertFacility(req, req.body.facility_id);
  const id = insert('promotions', { ...Object.fromEntries(PROMO.filter((k) => req.body[k] !== undefined).map((k) => [k, req.body[k]])), facility_id: req.body.facility_id });
  logActivity({ facility_id: req.body.facility_id, user_id: req.user.id, entity_type: 'promotion', entity_id: id, action: 'create', details: `Created promotion ${req.body.name}` });
  res.json({ id });
});
r.put('/promotions/:id', requirePerm('rates.manage'), (req, res) => {
  const p = get('SELECT * FROM promotions WHERE id=?', Number(req.params.id));
  if (!p) throw httpError(404, 'Not found');
  assertFacility(req, p.facility_id);
  update('promotions', p.id, Object.fromEntries(PROMO.filter((k) => req.body[k] !== undefined).map((k) => [k, req.body[k]])));
  res.json({ ok: true });
});

export default r;
