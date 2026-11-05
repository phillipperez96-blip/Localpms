// Billing / lien engine tests. Run with: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-engine-'));
const db = await import('../server/db.js');
const core = await import('../server/core.js');
const util = await import('../server/util.js');
const { seedDatabase } = await import('../server/seed.js');

const T = util.today();
let F; // facility id

before(async () => { console.log = () => {}; await seedDatabase(); F = 1; });

function newRental({ moveIn, rent = 100, billing } = {}) {
  if (billing) db.run('UPDATE facilities SET billing_type=? WHERE id=?', billing, F);
  // a vacant unit that was empty on the move-in date (keeps rental history non-overlapping)
  const u = db.get("SELECT * FROM units u WHERE facility_id=? AND status='vacant' AND COALESCE((SELECT MAX(move_out_date) FROM rentals r WHERE r.unit_id=u.id),'0000') < ? LIMIT 1", F, moveIn);
  const tid = db.insert('tenants', { facility_id: F, first_name: 'Test', last_name: 'T' + Math.random(), status: 'active', gate_code: core.generateGateCode(), gate_access: 'auto' });
  const f = core.facilityConfig(F);
  const fp = core.firstPeriod(f, moveIn, rent);
  const rid = db.insert('rentals', { facility_id: F, tenant_id: tid, unit_id: u.id, move_in_date: moveIn, rent, next_due_date: fp.nextDue, status: 'active', lien_status: 'current' });
  db.run("UPDATE units SET status='occupied' WHERE id=?", u.id);
  core.postLedger({ facility_id: F, tenant_id: tid, rental_id: rid, date: moveIn, type: 'charge', category: 'rent', description: 'first', amount: fp.amount, reference: `RENT:${rid}:${moveIn}` });
  core.postLedger({ facility_id: F, tenant_id: tid, rental_id: rid, date: moveIn, type: 'payment', category: 'payment', description: 'pay', amount: fp.amount, method: 'cash' });
  return { tid, rid, unit: u };
}

test('seeded data integrity', () => {
  // no unit with two active rentals; occupied units have exactly one
  assert.equal(db.get("SELECT COUNT(*) c FROM (SELECT unit_id FROM rentals WHERE status='active' GROUP BY unit_id HAVING COUNT(*)>1)").c, 0);
  assert.equal(db.get("SELECT COUNT(*) c FROM units u WHERE status='occupied' AND NOT EXISTS (SELECT 1 FROM rentals r WHERE r.unit_id=u.id AND r.status='active')").c, 0);
  assert.equal(db.get("SELECT COUNT(*) c FROM units u WHERE status IN ('vacant','reserved') AND EXISTS (SELECT 1 FROM rentals r WHERE r.unit_id=u.id AND r.status='active')").c, 0);
  // no duplicate rent charges
  assert.equal(db.get("SELECT COUNT(*) c FROM (SELECT reference FROM ledger WHERE reference LIKE 'RENT:%' GROUP BY reference HAVING COUNT(*)>1)").c, 0);
  // no overlapping rentals on the same unit
  const overlap = db.get(`SELECT COUNT(*) c FROM rentals a JOIN rentals b ON a.unit_id=b.unit_id AND a.id<b.id
    WHERE a.move_in_date < COALESCE(b.move_out_date,'9999') AND b.move_in_date < COALESCE(a.move_out_date,'9999')`).c;
  assert.equal(overlap, 0, 'rentals on the same unit must not overlap');
  // reserved units belong to a reserved lead
  assert.equal(db.get("SELECT COUNT(*) c FROM units u WHERE status='reserved' AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.unit_id=u.id AND l.status='reserved')").c, 0);
});

test('computeAccount: FIFO, past due and days late', () => {
  const a = core.computeAccount([
    { id: 1, date: '2026-01-01', type: 'charge', amount: 100 },
    { id: 2, date: '2026-02-01', type: 'charge', amount: 100 },
    { id: 3, date: '2026-02-05', type: 'payment', amount: 150 },
  ], '2026-02-11');
  assert.equal(a.balance, 50);
  assert.equal(a.pastDue, 50);
  assert.equal(a.oldestUnpaid, '2026-02-01');
  assert.equal(a.daysLate, 10);
});

test('computeAccount: charge due today is not late; credit balance is negative', () => {
  assert.equal(core.computeAccount([{ id: 1, date: '2026-03-01', type: 'charge', amount: 80 }], '2026-03-01').daysLate, 0);
  const c = core.computeAccount([{ id: 1, date: '2026-03-01', type: 'charge', amount: 80 }, { id: 2, date: '2026-03-01', type: 'payment', amount: 100 }], '2026-03-10');
  assert.equal(c.balance, -20); assert.equal(c.daysLate, 0);
});

test('computeAccount: voids ignored, refunds add to balance', () => {
  const a = core.computeAccount([
    { id: 1, date: '2026-01-01', type: 'charge', amount: 100 },
    { id: 2, date: '2026-01-01', type: 'payment', amount: 100, voided: 1 },
    { id: 3, date: '2026-01-02', type: 'payment', amount: 130 },
    { id: 4, date: '2026-01-03', type: 'refund', amount: 30 },
  ], '2026-01-20');
  assert.equal(a.balance, 0); assert.equal(a.daysLate, 0);
});

test('computeAccount: merchandise paid at counter never covers rent', () => {
  const a = core.computeAccount([
    { id: 1, date: '2026-01-01', type: 'charge', amount: 100 },
    { id: 2, date: '2026-01-05', type: 'charge', amount: 40, sale_id: 9 },
    { id: 3, date: '2026-01-05', type: 'payment', amount: 40, sale_id: 9 },
  ], '2026-01-20');
  assert.equal(a.oldestUnpaid, '2026-01-01'); assert.equal(a.daysLate, 19);
  // charged to account (no payment) does count
  const b = core.computeAccount([{ id: 1, date: '2026-01-05', type: 'charge', amount: 40, sale_id: 9 }], '2026-01-20');
  assert.equal(b.balance, 40);
});

test('addMonths keeps anniversary day and clamps month-end', () => {
  assert.equal(util.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(util.addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(util.addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(util.addMonths('2028-01-30', 1, 30), '2028-02-29');
});

test('firstPeriod proration (1st-of-month billing)', () => {
  const f = { billing_type: 'first', prorate: 1 };
  const p = core.firstPeriod(f, '2026-04-16', 90);
  assert.equal(p.amount, 45); assert.equal(p.nextDue, '2026-05-01');
  assert.equal(core.firstPeriod(f, '2026-04-01', 90).amount, 90);
  assert.equal(core.firstPeriod({ billing_type: 'anniversary' }, '2026-01-31', 90).nextDue, '2026-02-28');
});

test('applyPromo variants', () => {
  assert.equal(core.applyPromo(100, { discount_type: 'percent', value: 50 }), 50);
  assert.equal(core.applyPromo(100, { discount_type: 'fixed_price', value: 1 }), 1);
  assert.equal(core.applyPromo(15, { discount_type: 'amount_off', value: 20 }), 0);
});

test('nightly processing over 120 days: rent posted once per month, fees once per cycle, steps in order', async () => {
  db.run("UPDATE facilities SET billing_type='anniversary' WHERE id=?", F);
  const start = util.addDays(T, -3);
  const { tid, rid } = newRental({ moveIn: start, rent: 100 });
  for (let d = 0; d <= 120; d += 1) await core.processFacility(F, util.addDays(T, d), { deliver: false });
  const rents = db.all("SELECT date FROM ledger WHERE rental_id=? AND category='rent' AND voided=0 ORDER BY date", rid);
  const dates = rents.map((r) => r.date);
  assert.equal(new Set(dates).size, dates.length, 'no duplicate rent charges');
  assert.equal(dates.length, 5, 'move-in + 4 monthly charges');
  const fees = db.all("SELECT reference FROM ledger WHERE tenant_id=? AND category='late_fee'", tid);
  assert.equal(fees.length, 2, 'each late-fee rule applied once in a single delinquency');
  const steps = db.all('SELECT step_key FROM lien_events WHERE rental_id=? ORDER BY id', rid).map((e) => e.step_key);
  assert.deepEqual(steps, util.DEFAULT_LIEN_STEPS.map((s) => s.key), 'every lien step exactly once, in order');
  assert.equal(db.get('SELECT overlocked FROM units u JOIN rentals r ON r.unit_id=u.id WHERE r.id=?', rid).overlocked, 1);
  assert.ok(db.get("SELECT 1 x FROM auctions WHERE rental_id=? AND status='scheduled'", rid), 'auction scheduled');
  const t = db.get('SELECT * FROM tenants WHERE id=?', tid);
  assert.equal(t.gate_last_state, 'denied');
});

test('partial payment does not restart lien steps or late fees', async () => {
  const { tid, rid } = newRental({ moveIn: util.addDays(T, -70), rent: 100 });
  // unpaid since day 30 → process to now
  await core.processFacility(F, T, { deliver: false });
  const before = db.get('SELECT COUNT(*) c FROM lien_events WHERE rental_id=?', rid).c;
  const feesBefore = db.get("SELECT COUNT(*) c FROM ledger WHERE tenant_id=? AND category='late_fee'", tid).c;
  assert.ok(before >= 4);
  core.postLedger({ facility_id: F, tenant_id: tid, date: T, type: 'payment', category: 'payment', amount: 100, method: 'cash' }); // pays oldest month only
  await core.processFacility(F, T, { deliver: false });
  await core.processFacility(F, util.addDays(T, 1), { deliver: false });
  assert.equal(db.get('SELECT COUNT(*) c FROM lien_events WHERE rental_id=?', rid).c, before, 'no repeated lien steps');
  assert.equal(db.get("SELECT COUNT(*) c FROM ledger WHERE tenant_id=? AND category='late_fee'", tid).c, feesBefore, 'no repeated late fees');
});

test('paying in full resets the cycle so a later delinquency starts fresh', async () => {
  const { tid, rid } = newRental({ moveIn: util.addDays(T, -40), rent: 100 });
  await core.processFacility(F, T, { deliver: false });
  const bal = core.tenantAccount(tid).balance;
  core.postLedger({ facility_id: F, tenant_id: tid, date: T, type: 'payment', category: 'payment', amount: bal, method: 'cash' });
  await core.processFacility(F, T, { deliver: false });
  assert.equal(db.get('SELECT delinquent_since FROM tenants WHERE id=?', tid).delinquent_since, null);
  assert.equal(db.get('SELECT lien_status FROM rentals WHERE id=?', rid).lien_status, 'current');
  assert.equal(db.get('SELECT gate_last_state FROM tenants WHERE id=?', tid).gate_last_state, 'allowed');
});

test('scheduled rent increase applies on effective date and next rent uses it', async () => {
  const { tid, rid, unit } = newRental({ moveIn: util.addDays(T, -10), rent: 100 });
  const eff = util.addDays(T, 5);
  db.insert('rent_increases', { facility_id: F, rental_id: rid, tenant_id: tid, unit_id: unit.id, old_rent: 100, new_rent: 110, notice_date: T, effective_date: eff, status: 'scheduled' });
  for (let d = 0; d <= 25; d++) await core.processFacility(F, util.addDays(T, d), { deliver: false });
  assert.equal(db.get('SELECT rent FROM rentals WHERE id=?', rid).rent, 110);
  const last = db.get("SELECT amount FROM ledger WHERE rental_id=? AND category='rent' ORDER BY date DESC LIMIT 1", rid);
  assert.equal(last.amount, 110);
});

test('expired reservations release the unit', async () => {
  const u = db.get("SELECT * FROM units WHERE facility_id=? AND status='vacant' LIMIT 1", F);
  db.run("UPDATE units SET status='reserved' WHERE id=?", u.id);
  const lid = db.insert('leads', { facility_id: F, first_name: 'R', last_name: 'X', status: 'reserved', unit_id: u.id, reservation_expires: util.addDays(T, -1) });
  await core.processFacility(F, T, { deliver: false });
  assert.equal(db.get('SELECT status FROM units WHERE id=?', u.id).status, 'vacant');
  assert.equal(db.get('SELECT status FROM leads WHERE id=?', lid).status, 'contacted');
});
