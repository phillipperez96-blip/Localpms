import { Router } from 'express';
import { all, get } from '../db.js';
import { scope, requirePerm } from '../auth.js';
import { today, monthStart, addMonths, monthEnd, round2, addDays } from '../util.js';
import { inList, activeRentals, facilityConfig } from './helpers.js';
import { gateState } from '../core.js';

const r = Router();

function snapshot(ids, T = today()) {
  const MS = monthStart(T);
  const units = all(`SELECT status, sqft, street_rate, overlocked FROM units WHERE facility_id IN ${inList(ids)}`, ...ids);
  const rentals = activeRentals(ids, T);
  const total = units.length;
  const rentable = units.filter((u) => u.status !== 'unrentable');
  const occupied = units.filter((u) => u.status === 'occupied').length;
  const reserved = units.filter((u) => u.status === 'reserved').length;
  const unrentable = total - rentable.length;
  const vacant = units.filter((u) => u.status === 'vacant').length;
  const sqftTotal = rentable.reduce((s, u) => s + u.sqft, 0);
  const sqftOcc = rentals.reduce((s, x) => s + x.sqft, 0);
  const gpr = rentable.reduce((s, u) => s + u.street_rate, 0);
  const inPlace = rentals.reduce((s, x) => s + x.rent, 0);

  const pastDue = rentals.filter((x) => x.account.daysLate > 0 && x.account.balance > 0);
  const seen = new Set(), pdTenants = [];
  for (const x of pastDue) if (!seen.has(x.tenant_id)) { seen.add(x.tenant_id); pdTenants.push(x); }
  const aging = { '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const agingCount = { '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const x of pdTenants) {
    const d = x.account.daysLate, k = d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+';
    aging[k] += x.account.pastDue; agingCount[k]++;
  }
  const pdAmount = round2(pdTenants.reduce((s, x) => s + x.account.pastDue, 0));
  const count = (sql, ...p) => get(sql, ...ids, ...p).c;
  const moveInsMTD = count(`SELECT COUNT(*) c FROM rentals WHERE facility_id IN ${inList(ids)} AND move_in_date>=? AND move_in_date<=?`, MS, T);
  const moveOutsMTD = count(`SELECT COUNT(*) c FROM rentals WHERE facility_id IN ${inList(ids)} AND move_out_date>=? AND move_out_date<=? AND move_out_reason!='Auctioned'`, MS, T);
  const moveInsToday = count(`SELECT COUNT(*) c FROM rentals WHERE facility_id IN ${inList(ids)} AND move_in_date=?`, T);
  const moveOutsToday = count(`SELECT COUNT(*) c FROM rentals WHERE facility_id IN ${inList(ids)} AND move_out_date=?`, T);
  const leadsOpen = count(`SELECT COUNT(*) c FROM leads WHERE facility_id IN ${inList(ids)} AND status IN ('new','contacted')`);
  const leadsNew = count(`SELECT COUNT(*) c FROM leads WHERE facility_id IN ${inList(ids)} AND status='new'`);
  const reservations = count(`SELECT COUNT(*) c FROM leads WHERE facility_id IN ${inList(ids)} AND status='reserved'`);
  const followUps = count(`SELECT COUNT(*) c FROM leads WHERE facility_id IN ${inList(ids)} AND status IN ('new','contacted') AND follow_up_date<=?`, T);
  const collectedMTD = round2(get(`SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE facility_id IN ${inList(ids)} AND type='payment' AND voided=0 AND date>=? AND date<=?`, ...ids, MS, T).s);
  const collectedToday = round2(get(`SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE facility_id IN ${inList(ids)} AND type='payment' AND voided=0 AND date=?`, ...ids, T).s);
  const merchMTD = round2(get(`SELECT COALESCE(SUM(subtotal),0) s FROM sales WHERE facility_id IN ${inList(ids)} AND date>=?`, ...ids, MS).s);
  const insured = rentals.filter((x) => x.insurance_premium > 0).length;
  const overlocked = units.filter((u) => u.overlocked).length;
  const auctionsScheduled = count(`SELECT COUNT(*) c FROM auctions WHERE facility_id IN ${inList(ids)} AND status='scheduled'`);
  const lowStock = count(`SELECT COUNT(*) c FROM products WHERE facility_id IN ${inList(ids)} AND active=1 AND qty_on_hand<=reorder_point`);
  const audit = ids.length === 1 ? get("SELECT a.*, u.name auditor FROM audits a LEFT JOIN users u ON u.id=a.auditor_id WHERE facility_id=? AND period=? ORDER BY id DESC LIMIT 1", ids[0], T.slice(0, 7)) : null;
  const unclosed = ids.length === 1 && !get('SELECT 1 x FROM daily_closes WHERE facility_id=? AND date=?', ids[0], addDays(T, -1));

  return {
    units: { total, rentable: rentable.length, occupied, vacant, reserved, unrentable, overlocked },
    occupancy: {
      unit: rentable.length ? round2((occupied / rentable.length) * 100) : 0,
      sqft: sqftTotal ? round2((sqftOcc / sqftTotal) * 100) : 0,
      economic: gpr ? round2((inPlace / gpr) * 100) : 0,
      sqftTotal, sqftOcc, gpr: round2(gpr), inPlace: round2(inPlace),
    },
    pastDue: { count: pdTenants.length, amount: pdAmount, aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, round2(v)])), agingCount, pct: rentals.length ? round2((pdTenants.length / rentals.length) * 100) : 0 },
    moves: { inToday: moveInsToday, outToday: moveOutsToday, inMTD: moveInsMTD, outMTD: moveOutsMTD, net: moveInsMTD - moveOutsMTD },
    leads: { open: leadsOpen, new: leadsNew, reservations, followUps },
    revenue: { collectedMTD, collectedToday, merchMTD, insurancePct: rentals.length ? round2((insured / rentals.length) * 100) : 0 },
    auctionsScheduled, lowStock, audit, unclosed, _pd: pdTenants,
  };
}

r.get('/dashboard', requirePerm('dashboard.view'), (req, res) => {
  const ids = scope(req);
  const T = today();
  const s = snapshot(ids, T);
  // 12-month trend
  const unitCount = s.units.rentable;
  const trend = [];
  for (let i = 11; i >= 0; i--) {
    const ms = addMonths(monthStart(T), -i, 1), me = i === 0 ? T : monthEnd(ms);
    const occ = get(`SELECT COUNT(*) c FROM rentals WHERE facility_id IN ${inList(ids)} AND move_in_date<=? AND (move_out_date IS NULL OR move_out_date>?)`, ...ids, me, me).c;
    const ins = get(`SELECT COUNT(*) c FROM rentals WHERE facility_id IN ${inList(ids)} AND move_in_date>=? AND move_in_date<=?`, ...ids, ms, me).c;
    const outs = get(`SELECT COUNT(*) c FROM rentals WHERE facility_id IN ${inList(ids)} AND move_out_date>=? AND move_out_date<=?`, ...ids, ms, me).c;
    const rev = get(`SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE facility_id IN ${inList(ids)} AND type='payment' AND voided=0 AND date>=? AND date<=?`, ...ids, ms, me).s;
    trend.push({ month: ms.slice(0, 7), occupancy: unitCount ? round2(Math.min(100, (occ / unitCount) * 100)) : 0, moveIns: ins, moveOuts: outs, revenue: round2(rev) });
  }
  const topPastDue = s._pd.sort((a, b) => b.account.pastDue - a.account.pastDue).slice(0, 8).map((x) => ({
    tenant_id: x.tenant_id, name: `${x.first_name} ${x.last_name}`, unit: x.number, balance: x.account.balance, pastDue: x.account.pastDue, daysLate: x.account.daysLate, lien_status: x.lien_status, facility_code: x.facility_code,
  }));
  const upcomingAuctions = all(`SELECT a.*, u.number, t.first_name, t.last_name FROM auctions a JOIN units u ON u.id=a.unit_id JOIN tenants t ON t.id=a.tenant_id WHERE a.facility_id IN ${inList(ids)} AND a.status='scheduled' ORDER BY scheduled_date LIMIT 5`, ...ids);
  const tasks = all(`SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.facility_id IN ${inList(ids)} AND t.status='open' AND t.source!='lien_payment' AND (t.due_date<=? OR t.priority IN ('high','urgent')) ORDER BY t.due_date LIMIT 8`, ...ids, addDays(T, 3));
  const followUps = all(`SELECT id, first_name, last_name, phone, follow_up_date, status, size_wanted, source FROM leads WHERE facility_id IN ${inList(ids)} AND status IN ('new','contacted') AND follow_up_date<=? ORDER BY follow_up_date LIMIT 6`, ...ids, addDays(T, 1));
  const recentMoves = all(`SELECT r.id, r.tenant_id, r.move_in_date, r.move_out_date, r.status, u.number, t.first_name, t.last_name, CASE WHEN r.move_out_date>=? THEN 'out' ELSE 'in' END kind
    FROM rentals r JOIN units u ON u.id=r.unit_id JOIN tenants t ON t.id=r.tenant_id WHERE r.facility_id IN ${inList(ids)} AND (r.move_in_date>=? OR r.move_out_date>=?) ORDER BY COALESCE(r.move_out_date, r.move_in_date) DESC LIMIT 8`, addDays(T, -14), ...ids, addDays(T, -14), addDays(T, -14));
  const { _pd, ...rest } = s;
  res.json({ ...rest, trend, topPastDue, upcomingAuctions, tasks, followUps, recentMoves, asOf: T });
});

r.get('/portfolio', requirePerm('portfolio.view'), (req, res) => {
  const T = today();
  const rows = req.user.facility_ids.map((id) => {
    const f = get('SELECT id, name, code, city, state FROM facilities WHERE id=?', id);
    const s = snapshot([id], T);
    const audit = get("SELECT a.id, a.status, a.visit_date, a.score, a.max_score, u.name auditor FROM audits a LEFT JOIN users u ON u.id=a.auditor_id WHERE facility_id=? AND period=? ORDER BY a.id DESC LIMIT 1", id, T.slice(0, 7));
    const lastClose = get('SELECT MAX(date) d FROM daily_closes WHERE facility_id=?', id).d;
    const openTasks = get("SELECT COUNT(*) c FROM tasks WHERE facility_id=? AND status='open'", id).c;
    return { ...f, occupancy: s.occupancy, units: s.units, pastDue: { count: s.pastDue.count, amount: s.pastDue.amount, pct: s.pastDue.pct }, moves: s.moves, leads: s.leads, revenue: s.revenue, audit, lastClose, openTasks, auctionsScheduled: s.auctionsScheduled };
  });
  res.json({ facilities: rows, asOf: T });
});

r.get('/reminders/auto', (req, res) => {
  // System-generated reminders (not stored as tasks)
  const ids = scope(req);
  const T = today();
  const items = [];
  for (const l of all(`SELECT * FROM leads WHERE facility_id IN ${inList(ids)} AND status IN ('new','contacted') AND follow_up_date<=?`, ...ids, addDays(T, 1)))
    items.push({ kind: 'lead', title: `Follow up with ${l.first_name} ${l.last_name}`, detail: `${l.size_wanted || ''} ${l.unit_type || ''} · ${l.phone || ''}`, due: l.follow_up_date, link: `/leads?open=${l.id}`, facility_id: l.facility_id });
  for (const l of all(`SELECT l.*, u.number FROM leads l LEFT JOIN units u ON u.id=l.unit_id WHERE l.facility_id IN ${inList(ids)} AND l.status='reserved' AND l.reservation_expires<=?`, ...ids, addDays(T, 2)))
    items.push({ kind: 'reservation', title: `Reservation expiring: ${l.first_name} ${l.last_name}`, detail: `Unit ${l.number || '—'}`, due: l.reservation_expires, link: `/leads?open=${l.id}`, facility_id: l.facility_id });
  for (const a of all(`SELECT a.*, u.number FROM auctions a JOIN units u ON u.id=a.unit_id WHERE a.facility_id IN ${inList(ids)} AND a.status='scheduled' AND a.scheduled_date<=?`, ...ids, addDays(T, 7)))
    items.push({ kind: 'auction', title: `Auction for unit ${a.number}`, detail: a.platform, due: a.scheduled_date, link: '/past-dues?tab=auctions', facility_id: a.facility_id });
  for (const ri of all(`SELECT ri.*, u.number FROM rent_increases ri JOIN units u ON u.id=ri.unit_id WHERE ri.facility_id IN ${inList(ids)} AND ri.status='scheduled' AND ri.effective_date<=?`, ...ids, addDays(T, 7)))
    items.push({ kind: 'rate', title: `Rent increase takes effect – unit ${ri.number}`, detail: `$${ri.old_rent} → $${ri.new_rent}`, due: ri.effective_date, link: '/rates?tab=increases', facility_id: ri.facility_id });
  for (const p of all(`SELECT * FROM products WHERE facility_id IN ${inList(ids)} AND active=1 AND qty_on_hand<=reorder_point`, ...ids))
    items.push({ kind: 'inventory', title: `Reorder ${p.name}`, detail: `${p.qty_on_hand} on hand (reorder at ${p.reorder_point})`, due: T, link: '/merchandise?tab=inventory', facility_id: p.facility_id });
  for (const id of ids) {
    if (!get('SELECT 1 x FROM daily_closes WHERE facility_id=? AND date=?', id, addDays(T, -1)))
      items.push({ kind: 'close', title: 'Daily close not completed for yesterday', detail: '', due: addDays(T, -1), link: '/daily-close', facility_id: id });
    const f = facilityConfig(id);
    const ol = activeRentals([id], T).filter((x) => x.account.daysLate >= (f.lien_steps.find((s) => s.overlock)?.day ?? 999) && !x.overlocked && x.account.balance > 0);
    if (ol.length) items.push({ kind: 'overlock', title: `${ol.length} unit(s) need to be overlocked`, detail: ol.map((x) => x.number).slice(0, 8).join(', '), due: T, link: '/walkthrough', facility_id: id });
    const rm = activeRentals([id], T).filter((x) => x.overlocked && x.account.balance <= 0);
    if (rm.length) items.push({ kind: 'overlock', title: `${rm.length} overlock(s) to remove (paid)`, detail: rm.map((x) => x.number).join(', '), due: T, link: '/walkthrough', facility_id: id });
  }
  items.sort((a, b) => (a.due < b.due ? -1 : 1));
  res.json(items);
});

export default r;
export { snapshot };
