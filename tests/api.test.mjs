// End-to-end API tests against a real server on a throwaway database. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}/api`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-api-'));
let server;
const tokens = {};

async function call(method, url, body, who = 'admin') {
  const res = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(tokens[who] ? { authorization: `Bearer ${tokens[who]}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const get = (u, who) => call('GET', u, null, who);
const post = (u, b, who) => call('POST', u, b, who);
const put = (u, b, who) => call('PUT', u, b, who);
const ok = (r, msg) => { assert.ok(r.status >= 200 && r.status < 300, `${msg || ''} expected 2xx, got ${r.status}: ${JSON.stringify(r.data)}`); return r.data; };

const USERS = { admin: 'admin@demo.com', dm: 'dm@demo.com', am: 'am@demo.com', pm: 'pm@demo.com', pm2: 'pm2@demo.com', pm3: 'pm3@demo.com', asst: 'asst@demo.com' };

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR, NOTE_UNDO_SECONDS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) {
    if (log.includes('running on')) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(log.includes('running on'), 'server failed to start:\n' + log);
  for (const [k, email] of Object.entries(USERS)) {
    const r = await post('/auth/login', { email, password: 'demo123' }, null);
    tokens[k] = ok(r, 'login ' + k).token;
  }
});
after(() => server?.kill());

test('auth: bad password and missing token are rejected', async () => {
  assert.equal((await post('/auth/login', { email: 'admin@demo.com', password: 'nope' }, null)).status, 401);
  assert.equal((await get('/me', null)).status, 401);
  assert.equal((await get('/nope')).status, 404);
});

const GET_ENDPOINTS = ['/me', '/dashboard', '/portfolio', '/reminders/auto', '/tenants', '/tenants?status=all', '/units', '/walkthrough', '/gate', '/pastdues', '/auctions', '/leads',
  '/communications', '/templates', '/products', '/sales', '/inventory/adjustments', '/rates', '/rates/ecri-candidates', '/rates/increases', '/promotions', '/tasks', '/users/lookup',
  '/audits', '/reports', '/activity', '/settings/users', '/settings/roles', '/settings/integrations', '/settings/insurance', '/insurance-plans', '/search?q=sm'];

test('no endpoint crashes for any role or facility scope (only 200/400/403 allowed)', async () => {
  const problems = [];
  for (const who of Object.keys(USERS)) {
    for (const scope of ['all', '1', '2', '3']) {
      for (const ep of GET_ENDPOINTS) {
        const url = ep + (ep.includes('?') ? '&' : '?') + 'facility=' + scope;
        const r = await get(url, who);
        if (![200, 400, 403].includes(r.status)) problems.push(`${who} ${url} → ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('facility isolation: a property manager cannot reach another facility', async () => {
  assert.equal((await get('/dashboard?facility=2', 'pm')).status, 403);
  const other = ok(await get('/tenants?facility=2')).find((t) => t.status === 'active');
  assert.equal((await get(`/tenants/${other.id}`, 'pm')).status, 403);
  assert.equal((await post(`/tenants/${other.id}/payments`, { amount: 5, method: 'cash' }, 'pm')).status, 403);
  // "all" scope only returns the PM's own facility
  const mine = ok(await get('/tenants?facility=all', 'pm'));
  assert.ok(mine.every((t) => t.facility_id === 1));
  const search = ok(await get('/search?facility=all&q=a', 'pm'));
  assert.ok(search.every((r) => r.facility_id === 1));
});

test('permissions are enforced on the server, not just hidden in the UI', async () => {
  assert.equal((await get('/reports?facility=1', 'asst')).status, 403);
  assert.equal((await get('/settings/users', 'asst')).status, 403);
  assert.equal((await post('/audits', { facility_id: 1 }, 'pm')).status, 403, 'PM cannot perform audits');
  assert.equal((await get('/portfolio', 'pm')).status, 403);
  const pay = ok(await get('/tenants/1')).ledger.find((l) => l.type === 'payment' && !l.voided);
  assert.equal((await post(`/ledger/${pay.id}/void`, {}, 'pm')).status, 403, 'PM cannot void payments by default');
  // DM cannot create an admin
  const roles = ok(await get('/settings/roles')).roles;
  const admin = roles.find((r) => r.slug === 'admin');
  assert.equal((await post('/settings/users', { name: 'X', email: 'x@x.com', password: 'pw123456', role_id: admin.id }, 'dm')).status, 403);
});

test('editing role permissions takes effect immediately', async () => {
  const roles = ok(await get('/settings/roles')).roles;
  const pm = roles.find((r) => r.slug === 'pm');
  ok(await put(`/settings/roles/${pm.id}`, { permissions: pm.permissions.filter((p) => p !== 'reports.view') }));
  assert.equal((await get('/reports?facility=1', 'pm')).status, 403);
  ok(await put(`/settings/roles/${pm.id}`, { permissions: pm.permissions }));
  ok(await get('/reports?facility=1', 'pm'));
  // admin cannot lock themselves out of role management
  const adminRole = roles.find((r) => r.slug === 'admin');
  assert.equal((await put(`/settings/roles/${adminRole.id}`, { permissions: [] })).status, 400);
});

test('every report runs for every scope and returns consistent columns', async () => {
  const list = ok(await get('/reports'));
  assert.ok(list.length >= 20);
  for (const r of list) for (const scope of ['all', '1']) {
    const d = ok(await get(`/reports/${r.key}?facility=${scope}&from=2025-01-01&to=2030-01-01`), r.key);
    assert.ok(Array.isArray(d.rows) && Array.isArray(d.columns), r.key);
    for (const row of d.rows.slice(0, 5)) for (const c of d.columns) assert.ok(c.key in row, `${r.key} row missing ${c.key}`);
  }
});

let movedIn;
test('move-in: quote matches posted charges; unit, gate code and lead are updated', async () => {
  const unit = ok(await get('/units?facility=1')).find((u) => u.status === 'vacant');
  const q = ok(await post('/movein/quote', { unit_id: unit.id, insurance_plan_id: 2, promotion_id: null }, 'pm'));
  const lead = ok(await post('/leads', { facility_id: 1, first_name: 'Quinn', last_name: 'Lead', phone: '5125550001' }, 'pm'));
  const r = ok(await post('/movein', { unit_id: unit.id, insurance_plan_id: 2, lead_id: lead.id, tenant: { first_name: 'Quinn', last_name: 'Lead', email: 'q@example.com' }, payment: { method: 'card', last4: '4242' } }, 'pm'));
  assert.match(r.gate_code, /^\d{6}$/);
  const acct = ok(await get(`/tenants/${r.tenantId}`, 'pm'));
  const charges = acct.ledger.filter((l) => l.type === 'charge').reduce((s, l) => s + l.amount, 0);
  assert.equal(Math.round(charges * 100), Math.round(q.total * 100));
  assert.equal(acct.account.balance, 0);
  assert.equal(acct.rentals[0].status, 'active');
  assert.ok(acct.communications.some((c) => c.template_key === 'welcome'), 'welcome email logged');
  assert.equal(ok(await get(`/units/${unit.id}`)).status, 'occupied');
  assert.equal(ok(await get(`/leads/${lead.id}`)).status, 'converted');
  // cannot move into an occupied unit
  assert.equal((await post('/movein', { unit_id: unit.id, tenant: { first_name: 'A', last_name: 'B' } }, 'pm')).status, 400);
  // tenant name required
  const v2 = ok(await get('/units?facility=1')).find((u) => u.status === 'vacant');
  assert.equal((await post('/movein', { unit_id: v2.id, tenant: { first_name: '' } }, 'pm')).status, 400);
  // an existing tenant from another facility cannot be moved into this facility's unit
  const foreign = ok(await get('/tenants?facility=2')).find((t) => t.status === 'active');
  assert.equal((await post('/movein', { unit_id: v2.id, tenant_id: foreign.id })).status, 400);
  movedIn = { ...r, unit };
});

test('payments: validation, credit balance, refund limits and voids', async () => {
  const id = movedIn.tenantId;
  assert.equal((await post(`/tenants/${id}/payments`, { amount: -5, method: 'cash' }, 'pm')).status, 400);
  assert.equal((await post(`/tenants/${id}/payments`, { amount: 'abc', method: 'cash' }, 'pm')).status, 400);
  const p = ok(await post(`/tenants/${id}/payments`, { amount: 50, method: 'cash' }, 'pm'));
  assert.equal(p.account.balance, -50);
  assert.equal((await post(`/tenants/${id}/refund`, { amount: 60 })).status, 400, 'cannot refund more than credit');
  ok(await post(`/tenants/${id}/refund`, { amount: 20, method: 'check' }));
  let acct = ok(await get(`/tenants/${id}`)).account;
  assert.equal(acct.balance, -30);
  const pay = ok(await get(`/tenants/${id}`)).ledger.find((l) => l.type === 'payment' && l.amount === 50);
  ok(await post(`/ledger/${pay.id}/void`, { reason: 'test' }));
  assert.equal((await post(`/ledger/${pay.id}/void`, {})).status, 400, 'double void rejected');
  acct = ok(await get(`/tenants/${id}`)).account;
  assert.equal(acct.balance, 20);
  ok(await post(`/tenants/${id}/adjustments`, { type: 'credit', amount: 20, description: 'courtesy' }, 'pm'));
  assert.equal(ok(await get(`/tenants/${id}`)).account.balance, 0);
  assert.equal((await post(`/tenants/${id}/adjustments`, { type: 'bogus', amount: 5 }, 'pm')).status, 400);
});

test('gate codes: validation, uniqueness and overrides', async () => {
  const id = movedIn.tenantId;
  assert.equal((await post(`/tenants/${id}/gate`, { code: '12' }, 'pm')).status, 400);
  const other = ok(await get('/tenants?facility=1')).find((t) => t.id !== id && t.gate_code);
  assert.equal((await post(`/tenants/${id}/gate`, { code: other.gate_code }, 'pm')).status, 400, 'duplicate code rejected');
  let g = ok(await post(`/tenants/${id}/gate`, { access: 'denied' }, 'pm'));
  assert.equal(g.gate.allowed, false);
  g = ok(await post(`/tenants/${id}/gate`, { access: 'auto' }, 'pm'));
  assert.equal(g.gate.allowed, true);
  const sim = ok(await post('/gate/simulate?facility=1', { code: g.code }, 'pm'));
  assert.equal(sim.event, 'entry');
  assert.equal(ok(await post('/gate/simulate?facility=1', { code: '000001' }, 'pm')).event, 'entry_denied');
});

test('merchandise: account charge requires tenant, inventory decrements, paid sale does not change balance', async () => {
  const prods = ok(await get('/products?facility=1', 'pm'));
  const p = prods.find((x) => x.qty_on_hand > 3);
  assert.equal((await post('/sales', { facility_id: 1, items: [{ product_id: p.id, qty: 1 }], method: 'account' }, 'pm')).status, 400);
  assert.equal((await post('/sales', { facility_id: 1, items: [], method: 'cash' }, 'pm')).status, 400);
  const before = ok(await get(`/tenants/${movedIn.tenantId}`)).account.balance;
  ok(await post('/sales', { facility_id: 1, tenant_id: movedIn.tenantId, items: [{ product_id: p.id, qty: 2 }], method: 'cash' }, 'pm'));
  assert.equal(ok(await get(`/tenants/${movedIn.tenantId}`)).account.balance, before, 'paid sale leaves balance unchanged');
  const s = ok(await post('/sales', { facility_id: 1, tenant_id: movedIn.tenantId, items: [{ product_id: p.id, qty: 1 }], method: 'account' }, 'pm'));
  assert.equal(ok(await get(`/tenants/${movedIn.tenantId}`)).account.balance, Math.round((before + s.total) * 100) / 100);
  const after = ok(await get('/products?facility=1', 'pm')).find((x) => x.id === p.id);
  assert.equal(after.qty_on_hand, p.qty_on_hand - 3);
  // a product from another facility cannot be sold here
  const foreign = ok(await get('/products?facility=2')).at(0);
  assert.equal((await post('/sales', { facility_id: 1, items: [{ product_id: foreign.id, qty: 1 }], method: 'cash' }, 'pm')).status, 400);
  // inventory count adjustment
  ok(await post(`/products/${p.id}/adjust`, { reason: 'count', counted: 50 }, 'pm'));
  assert.equal(ok(await get('/products?facility=1', 'pm')).find((x) => x.id === p.id).qty_on_hand, 50);
});

test('move-out: unit vacated, tenant former, gate code removed, balance waived', async () => {
  const id = movedIn.tenantId;
  const acct = ok(await get(`/tenants/${id}`));
  ok(await post('/moveout', { rental_id: acct.rentals[0].id, reason: 'Test', waiveBalance: true }, 'pm'));
  const after = ok(await get(`/tenants/${id}`));
  assert.equal(after.tenant.status, 'former');
  assert.equal(after.account.balance, 0);
  assert.equal(after.gate.allowed, false);
  assert.equal(ok(await get(`/units/${movedIn.unit.id}`)).status, 'vacant');
  assert.equal((await post('/moveout', { rental_id: acct.rentals[0].id }, 'pm')).status, 400, 'cannot move out twice');
});

test('past dues: lien step completion and auction sale', async () => {
  const pd = ok(await get('/pastdues?facility=1', 'pm'));
  assert.ok(pd.rows.length > 0);
  const withNext = pd.rows.find((r) => r.next);
  ok(await post(`/pastdues/${withNext.rental_id}/step`, { notes: 'test' }, 'pm'));
  const again = ok(await get('/pastdues?facility=1', 'pm')).rows.find((r) => r.rental_id === withNext.rental_id);
  assert.notEqual(again.next?.key, withNext.next.key, 'step advanced');
  const auction = ok(await get('/auctions?facility=1', 'pm')).find((a) => a.status === 'scheduled');
  assert.ok(auction, 'a scheduled auction exists');
  ok(await post(`/auctions/${auction.id}/sold`, { sale_amount: auction.balance + 100, winning_bidder: 'Bidder' }, 'pm'));
  const sold = ok(await get('/auctions?facility=1', 'pm')).find((a) => a.id === auction.id);
  assert.equal(sold.status, 'sold');
  assert.equal(sold.surplus, 100);
  assert.equal(ok(await get(`/units/${auction.unit_id}`)).status, 'vacant');
  assert.equal(ok(await get(`/tenants/${auction.tenant_id}`)).account.balance, 0);
  assert.equal((await post(`/auctions/${auction.id}/sold`, { sale_amount: 5 }, 'pm')).status, 400);
});

test('paying a past-due account in full restores gate access and cancels the auction', async () => {
  const pd = ok(await get('/pastdues?facility=all')).rows;
  const target = pd.find((r) => r.lien_status === 'auction') || pd.find((r) => r.daysLate >= 6);
  const before = ok(await get(`/tenants/${target.tenant_id}`));
  assert.equal(before.gate.allowed, false);
  ok(await post(`/tenants/${target.tenant_id}/payments`, { amount: before.account.balance, method: 'cash' }));
  const after = ok(await get(`/tenants/${target.tenant_id}`));
  assert.equal(after.account.balance, 0);
  assert.equal(after.gate.allowed, true);
  assert.ok(after.rentals.filter((r) => r.status === 'active').every((r) => r.lien_status === 'current'));
  assert.ok(after.auctions.every((a) => a.status !== 'scheduled'));
});

test('leads & reservations', async () => {
  const lead = ok(await post('/leads', { facility_id: 1, first_name: 'Res', last_name: 'Ervation' }, 'pm'));
  const units = ok(await get('/units?facility=1'));
  const occupied = units.find((u) => u.status === 'occupied');
  assert.equal((await post(`/leads/${lead.id}/reserve`, { unit_id: occupied.id }, 'pm')).status, 400);
  const v = units.find((u) => u.status === 'vacant');
  ok(await post(`/leads/${lead.id}/reserve`, { unit_id: v.id, sendConfirmation: true }, 'pm'));
  assert.equal(ok(await get(`/units/${v.id}`)).status, 'reserved');
  ok(await put(`/leads/${lead.id}`, { status: 'lost', lost_reason: 'Price' }, 'pm'));
  assert.equal(ok(await get(`/units/${v.id}`)).status, 'vacant', 'losing a lead releases the unit');
  const unit3 = units.find((u) => u.facility_id === 1 && u.status === 'vacant' && u.id !== v.id);
  const l2 = ok(await post('/leads', { facility_id: 1, first_name: 'Del', last_name: 'Ete' }, 'pm'));
  ok(await post(`/leads/${l2.id}/reserve`, { unit_id: unit3.id }, 'pm'));
  ok(await call('DELETE', `/leads/${l2.id}`, null, 'pm'));
  assert.equal(ok(await get(`/units/${unit3.id}`)).status, 'vacant', 'deleting a lead releases the unit');
  assert.equal((await post('/leads', { facility_id: 2, first_name: 'X' }, 'pm')).status, 403);
});

test('communications: preview, mass send and opt-outs', async () => {
  const prev = ok(await post('/communications/preview', { audience: 'pastdue', facility_id: 1, subject: 'Hi {{first_name}}', body: 'You owe {{balance}}' }, 'pm'));
  assert.ok(prev.count > 0);
  assert.ok(!prev.body.includes('{{'));
  const r = ok(await post('/communications/send', { audience: 'pastdue', facility_id: 1, channel: 'sms', body: 'Pay {{balance}}' }, 'pm'));
  assert.equal(r.failed || 0, 0);
  assert.equal((await post('/communications/send', { audience: 'all', facility_id: 1, channel: 'email', body: '  ' }, 'pm')).status, 400);
  assert.equal((await post('/communications/send', { audience: 'all', facility_id: 2, channel: 'email', body: 'x' }, 'pm')).status, 403);
  const letter = ok(await post('/communications/send', { audience: 'selected', tenant_ids: [1], channel: 'letter', subject: 'L', body: 'Letter body' }));
  assert.equal(letter.ready_to_print, 1);
  ok(await get(`/communications/${letter.ids[0]}`));
});

test('daily close: cannot close the same day twice', async () => {
  const d = ok(await get('/daily-close?facility=1', 'pm'));
  assert.equal((await get('/daily-close?facility=all', 'admin')).status, 400, 'multi-facility scope must pick one facility');
  if (!d.close) ok(await post('/daily-close', { facility_id: 1 }, 'pm'));
  assert.equal((await post('/daily-close', { facility_id: 1 }, 'pm')).status, 400);
});

test('rates: street rate change, rent increases and promotions', async () => {
  const rows = ok(await get('/rates?facility=1', 'pm')).rows;
  const g = rows[0];
  ok(await put('/rates', { facility_id: 1, unit_type: g.unit_type, size: g.size, street_rate: g.street_rate + 7 }, 'pm'));
  assert.equal(ok(await get('/rates?facility=1', 'pm')).rows[0].street_rate, g.street_rate + 7);
  assert.equal((await put('/rates', { facility_id: 1, unit_type: g.unit_type, size: g.size, street_rate: 0 }, 'pm')).status, 400);
  const cands = ok(await get('/rates/ecri-candidates?facility=1&minMonths=6&minGap=1', 'pm'));
  assert.ok(cands.length > 0);
  const r = ok(await post('/rates/increases', { items: [{ rental_id: cands[0].rental_id, new_rent: cands[0].new_rent }], sendNotice: true }, 'pm'));
  assert.equal(r.scheduled, 1);
  const again = ok(await get('/rates/ecri-candidates?facility=1&minMonths=6&minGap=1', 'pm'));
  assert.ok(!again.some((c) => c.rental_id === cands[0].rental_id), 'already-scheduled tenants drop off the candidate list');
  const p = ok(await post('/promotions', { facility_id: 1, name: 'Test promo', discount_type: 'percent', value: 25, months: 2 }, 'pm'));
  const q = ok(await post('/movein/quote', { unit_id: ok(await get('/units?facility=1')).find((u) => u.status === 'vacant').id, promotion_id: p.id }, 'pm'));
  assert.ok(q.items[0].description.includes('Test promo'));
});

test('audits: full visit flow and validation', async () => {
  const a = ok(await post('/audits', { facility_id: 3 }, 'dm'));
  assert.equal((await post(`/audits/${a.id}/submit`, {}, 'dm')).status, 400, 'unscored items block submission');
  const detail = ok(await get(`/audits/${a.id}`, 'dm'));
  ok(await put(`/audits/${a.id}`, { items: detail.items.map((i) => ({ id: i.id, points: 4 })), summary: 'Good' }, 'dm'));
  ok(await post(`/audits/${a.id}/submit`, {}, 'dm'));
  assert.equal((await post(`/audits/${a.id}/acknowledge`, {}, 'pm')).status, 403, 'PM of another facility cannot acknowledge');
  ok(await post(`/audits/${a.id}/acknowledge`, { manager_response: 'Thanks' }, 'pm3'));
  const done = ok(await get(`/audits/${a.id}`, 'pm3'));
  assert.equal(done.status, 'acknowledged');
  assert.equal(done.score, done.max_score * 0.8);
  assert.equal((await put(`/audits/${a.id}`, { summary: 'edit' }, 'dm')).status, 400, 'acknowledged audits are locked');
  // photo upload
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const a2 = ok(await post('/audits', { facility_id: 3 }, 'dm'));
  ok(await post(`/audits/${a2.id}/photos`, { dataUrl: png, caption: 'x' }, 'dm'));
  assert.equal((await post(`/audits/${a2.id}/photos`, { dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }, 'dm')).status, 400, 'non-images rejected');
});

test('settings: validation and user management', async () => {
  assert.equal((await put('/settings/facility/1', { lien_steps: [{ key: 'a', name: 'A', day: 1 }, { key: 'a', name: 'B', day: 2 }] })).status, 400);
  ok(await put('/settings/facility/1', { gate_deny_days: 10 }));
  assert.equal(ok(await get('/settings/facility/1')).gate_deny_days, 10);
  ok(await put('/settings/facility/1', { gate_deny_days: 6 }));
  const roles = ok(await get('/settings/roles')).roles;
  const u = ok(await post('/settings/users', { name: 'New Hire', email: 'new@demo.com', password: 'secret12', role_id: roles.find((r) => r.slug === 'asst').id, facility_ids: [2] }));
  const login = ok(await post('/auth/login', { email: 'new@demo.com', password: 'secret12' }, null));
  tokens.new = login.token;
  assert.deepEqual(ok(await get('/me', 'new')).user.facility_ids, [2]);
  assert.equal((await post('/settings/users', { name: 'Dup', email: 'NEW@demo.com', password: 'x', role_id: 1 })).status, 400, 'duplicate email (case-insensitive)');
  ok(await put(`/settings/users/${u.id}`, { active: false }));
  assert.equal((await get('/me', 'new')).status, 401, 'deactivated user is signed out');
  const me = ok(await get('/me')).user;
  assert.equal((await put(`/settings/users/${me.id}`, { active: false })).status, 400, 'cannot deactivate yourself');
});

test('units: add, duplicate number, unrentable rules', async () => {
  const u = ok(await post('/units', { facility_id: 1, number: 'Z001', building: 'Z', unit_type: 'Drive-Up', width: 10, length: 10, street_rate: 120 }));
  assert.equal((await post('/units', { facility_id: 1, number: 'Z001', width: 10, length: 10 })).status, 400);
  ok(await put(`/units/${u.id}`, { status: 'unrentable', unrentable_reason: 'test' }));
  assert.equal(ok(await get(`/units/${u.id}`)).status, 'unrentable');
  const occ = ok(await get('/units?facility=1')).find((x) => x.status === 'occupied');
  assert.equal((await put(`/units/${occ.id}`, { status: 'vacant' })).status, 400, 'cannot vacate an occupied unit by editing');
});

test('nightly processing endpoint is idempotent', async () => {
  ok(await post('/settings/run-daily', {}));
  const r = ok(await post('/settings/run-daily', {}));
  for (const s of Object.values(r)) { assert.equal(s.rentPosted, 0); assert.equal(s.lateFees, 0); assert.equal(s.lienSteps, 0); }
});

test('account notes: author can undo within the window, then the note is permanent', async () => {
  const t = ok(await get('/tenants?facility=1', 'pm')).find((x) => x.status === 'active');
  assert.equal((await post(`/tenants/${t.id}/notes`, { note: '   ' }, 'pm')).status, 400, 'empty note rejected');
  // undo right away: the note is removed and its text is returned for editing
  const a = ok(await post(`/tenants/${t.id}/notes`, { note: 'Called about balance' }, 'pm'));
  assert.equal(a.undo_seconds, 1);
  assert.ok(a.note.undo_seconds_left >= 1);
  const u = ok(await call('DELETE', `/tenants/${t.id}/notes/${a.note.id}`, null, 'pm'));
  assert.equal(u.body, 'Called about balance');
  let acct = ok(await get(`/tenants/${t.id}`, 'pm'));
  assert.ok(!acct.notes.some((n) => n.id === a.note.id), 'undone note is gone');
  assert.ok(!acct.history.some((h) => h.action === 'note' || h.action === 'note_undo'), 'notes are not duplicated in the history list');
  const log = ok(await get('/activity?facility=1&entity=tenant'));
  assert.ok(log.some((x) => x.action === 'note_undo'), 'undo is recorded in the activity log');
  // someone else cannot undo your note
  const b = ok(await post(`/tenants/${t.id}/notes`, { note: 'Promised to pay Friday' }, 'pm'));
  assert.equal((await call('DELETE', `/tenants/${t.id}/notes/${b.note.id}`, null, 'admin')).status, 403);
  // other users never see an undo timer on it
  assert.equal(ok(await get(`/tenants/${t.id}`, 'admin')).notes.find((n) => n.id === b.note.id).undo_seconds_left, 0);
  // after the window (1s here + 5s network grace) the note is permanent
  await new Promise((r) => setTimeout(r, 6500));
  assert.equal((await call('DELETE', `/tenants/${t.id}/notes/${b.note.id}`, null, 'pm')).status, 400);
  acct = ok(await get(`/tenants/${t.id}`, 'pm'));
  const kept = acct.notes.find((n) => n.id === b.note.id);
  assert.equal(kept.body, 'Promised to pay Friday');
  assert.equal(kept.undo_seconds_left, 0);
  // a PM cannot add notes to another facility's tenant
  const other = ok(await get('/tenants?facility=2')).find((x) => x.status === 'active');
  assert.equal((await post(`/tenants/${other.id}/notes`, { note: 'x' }, 'pm')).status, 403);
});

test('note reminder setting: only higher-ups can toggle it', async () => {
  assert.equal(ok(await get('/tenants/1', 'pm')).facility.note_reminder, true, 'demo facilities start with the reminder on');
  assert.equal((await put('/settings/note-reminder', { facility_id: 1, enabled: false }, 'pm')).status, 403, 'property manager cannot turn it off');
  assert.equal((await put('/settings/facility/1', { note_reminder: 0 }, 'pm')).status, 403, 'not even through the facility settings form');
  assert.equal((await put('/settings/note-reminder', { facility_id: 3, enabled: false }, 'am')).status, 403, 'area manager limited to their facilities');
  ok(await put('/settings/note-reminder', { facility_id: 1, enabled: false }, 'am'));
  assert.equal(ok(await get('/tenants/1', 'pm')).facility.note_reminder, false);
  ok(await put('/settings/note-reminder', { facility_id: 'all', enabled: true }, 'dm'));
  const me = ok(await get('/me', 'dm'));
  assert.ok(me.facilities.every((f) => f.note_reminder === 1));
  // PM can still save other facility settings without touching the reminder
  ok(await put('/settings/facility/1', { gate_deny_days: 6 }, 'pm'));
});
