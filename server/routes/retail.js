import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { scope, requirePerm, assertFacility } from '../auth.js';
import { today, round2, money } from '../util.js';
import { inList, httpError, facilityConfig } from './helpers.js';
import { postLedger, logActivity } from '../core.js';
import { chargeCard } from '../services/integrations.js';

const r = Router();

r.get('/products', requirePerm('merch.sell', 'inventory.manage'), (req, res) => {
  const ids = scope(req);
  res.json(all(`SELECT p.*, f.code facility_code, (SELECT COALESCE(SUM(si.qty),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.product_id=p.id AND s.date>=date('now','-30 days')) sold_30
    FROM products p JOIN facilities f ON f.id=p.facility_id WHERE p.facility_id IN ${inList(ids)} ORDER BY p.category, p.name`, ...ids));
});

const PF = ['sku', 'name', 'category', 'price', 'cost', 'reorder_point', 'taxable', 'active'];
r.post('/products', requirePerm('inventory.manage'), (req, res) => {
  const b = req.body;
  assertFacility(req, b.facility_id);
  const id = insert('products', { ...Object.fromEntries(PF.filter((k) => b[k] !== undefined).map((k) => [k, b[k]])), facility_id: b.facility_id, qty_on_hand: Number(b.qty_on_hand) || 0 });
  if (Number(b.qty_on_hand) > 0) insert('inventory_adjustments', { facility_id: b.facility_id, product_id: id, qty_change: Number(b.qty_on_hand), reason: 'initial', user_id: req.user.id });
  logActivity({ facility_id: b.facility_id, user_id: req.user.id, entity_type: 'product', entity_id: id, action: 'create', details: `Added product ${b.name}` });
  res.json({ id });
});
r.put('/products/:id', requirePerm('inventory.manage'), (req, res) => {
  const p = get('SELECT * FROM products WHERE id=?', Number(req.params.id));
  if (!p) throw httpError(404, 'Product not found');
  assertFacility(req, p.facility_id);
  update('products', p.id, Object.fromEntries(PF.filter((k) => req.body[k] !== undefined).map((k) => [k, req.body[k]])));
  res.json({ ok: true });
});

r.post('/products/:id/adjust', requirePerm('inventory.manage'), (req, res) => {
  const p = get('SELECT * FROM products WHERE id=?', Number(req.params.id));
  if (!p) throw httpError(404, 'Product not found');
  assertFacility(req, p.facility_id);
  const { reason, notes } = req.body;
  let change = Number(req.body.qty_change);
  if (reason === 'count') change = Number(req.body.counted) - p.qty_on_hand;
  if (!Number.isFinite(change) || change === 0) throw httpError(400, 'No quantity change');
  update('products', p.id, { qty_on_hand: p.qty_on_hand + change });
  insert('inventory_adjustments', { facility_id: p.facility_id, product_id: p.id, qty_change: change, reason, notes, user_id: req.user.id });
  logActivity({ facility_id: p.facility_id, user_id: req.user.id, entity_type: 'product', entity_id: p.id, action: 'inventory', details: `${p.name}: ${change > 0 ? '+' : ''}${change} (${reason})` });
  res.json({ qty_on_hand: p.qty_on_hand + change });
});

r.get('/inventory/adjustments', requirePerm('inventory.manage'), (req, res) => {
  const ids = scope(req);
  res.json(all(`SELECT a.*, p.name, p.sku, u.name user_name FROM inventory_adjustments a JOIN products p ON p.id=a.product_id LEFT JOIN users u ON u.id=a.user_id WHERE a.facility_id IN ${inList(ids)} ORDER BY a.id DESC LIMIT 300`, ...ids));
});

r.get('/sales', requirePerm('merch.sell', 'reports.view'), (req, res) => {
  const ids = scope(req);
  const sales = all(`SELECT s.*, u.name user_name, f.code facility_code FROM sales s LEFT JOIN users u ON u.id=s.user_id JOIN facilities f ON f.id=s.facility_id WHERE s.facility_id IN ${inList(ids)} ORDER BY s.id DESC LIMIT 300`, ...ids);
  const items = all(`SELECT * FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE facility_id IN ${inList(ids)} ORDER BY id DESC LIMIT 300)`, ...ids);
  res.json(sales.map((s) => ({ ...s, items: items.filter((i) => i.sale_id === s.id) })));
});

r.get('/sales/:id', requirePerm('merch.sell', 'tenants.view'), (req, res) => {
  const s = get('SELECT s.*, u.name user_name FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.id=?', Number(req.params.id));
  if (!s) throw httpError(404, 'Sale not found');
  assertFacility(req, s.facility_id);
  res.json({ ...s, items: all('SELECT * FROM sale_items WHERE sale_id=?', s.id), facility: get('SELECT name, address, city, state, zip, phone FROM facilities WHERE id=?', s.facility_id) });
});

r.post('/sales', requirePerm('merch.sell'), async (req, res) => {
  const b = req.body;
  assertFacility(req, b.facility_id);
  const f = facilityConfig(b.facility_id);
  if (!b.items?.length) throw httpError(400, 'Cart is empty');
  const lines = b.items.map((it) => {
    const p = get('SELECT * FROM products WHERE id=? AND facility_id=?', it.product_id, f.id);
    if (!p) throw httpError(400, 'Product not found');
    const qty = Math.max(1, Number(it.qty) || 1);
    return { p, qty, total: round2(p.price * qty) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
  const tax = round2(lines.filter((l) => l.p.taxable).reduce((s, l) => s + l.total, 0) * f.tax_rate);
  const total = round2(subtotal + tax);
  const tenant = b.tenant_id ? get('SELECT * FROM tenants WHERE id=?', b.tenant_id) : null;
  if (b.method === 'account' && !tenant) throw httpError(400, 'Choose a tenant to charge to account');
  let ref = b.reference;
  if (b.method === 'card') { const ch = await chargeCard({ amount: total, paymentMethodId: b.paymentMethodId, last4: b.last4, description: 'Merchandise' }); ref = ch.reference; }
  const T = today();
  const id = tx(() => {
    const sid = insert('sales', { facility_id: f.id, tenant_id: tenant?.id, customer_name: tenant ? `${tenant.first_name} ${tenant.last_name}` : b.customer_name || 'Walk-in Customer', subtotal, tax, total, method: b.method, reference: ref, user_id: req.user.id, date: T });
    for (const l of lines) {
      insert('sale_items', { sale_id: sid, product_id: l.p.id, name: l.p.name, qty: l.qty, price: l.p.price });
      run('UPDATE products SET qty_on_hand=qty_on_hand-? WHERE id=?', l.qty, l.p.id);
      insert('inventory_adjustments', { facility_id: f.id, product_id: l.p.id, qty_change: -l.qty, reason: 'sale', notes: `Sale #${sid}`, user_id: req.user.id });
    }
    postLedger({ facility_id: f.id, tenant_id: tenant?.id, date: T, type: 'charge', category: 'merchandise', description: `Merchandise sale #${sid}`, amount: total, sale_id: sid, user_id: req.user.id });
    if (b.method !== 'account') postLedger({ facility_id: f.id, tenant_id: tenant?.id, date: T, type: 'payment', category: 'payment', description: `Payment – sale #${sid}`, amount: total, method: b.method, reference: ref, sale_id: sid, user_id: req.user.id });
    logActivity({ facility_id: f.id, user_id: req.user.id, entity_type: tenant ? 'tenant' : 'sale', entity_id: tenant?.id || sid, action: 'sale', details: `Merchandise sale #${sid} ${money(total)} (${b.method === 'account' ? 'charged to account' : b.method})` });
    return sid;
  });
  res.json({ id, total });
});

// ---------- daily close ----------
r.get('/daily-close', requirePerm('dailyclose.perform', 'reports.view'), (req, res) => {
  const ids = scope(req);
  if (ids.length !== 1) throw httpError(400, 'Select a single facility');
  const fid = ids[0];
  const date = req.query.date || today();
  const tx = all(`SELECT l.*, t.first_name, t.last_name, u.name user_name FROM ledger l LEFT JOIN tenants t ON t.id=l.tenant_id LEFT JOIN users u ON u.id=l.user_id WHERE l.facility_id=? AND l.date=? AND l.type IN ('payment','refund') ORDER BY l.id`, fid, date);
  const by = {};
  for (const l of tx) if (!l.voided) by[l.method || 'other'] = round2((by[l.method || 'other'] || 0) + (l.type === 'refund' ? -l.amount : l.amount));
  const charges = all("SELECT category, SUM(amount) total, COUNT(*) n FROM ledger WHERE facility_id=? AND date=? AND type='charge' AND voided=0 GROUP BY category", fid, date);
  const moves = { in: get('SELECT COUNT(*) c FROM rentals WHERE facility_id=? AND move_in_date=?', fid, date).c, out: get('SELECT COUNT(*) c FROM rentals WHERE facility_id=? AND move_out_date=?', fid, date).c };
  const close = get('SELECT d.*, u.name user_name FROM daily_closes d LEFT JOIN users u ON u.id=d.user_id WHERE facility_id=? AND date=?', fid, date);
  const history = all('SELECT d.*, u.name user_name FROM daily_closes d LEFT JOIN users u ON u.id=d.user_id WHERE facility_id=? ORDER BY date DESC LIMIT 45', fid);
  res.json({ date, byMethod: by, transactions: tx, charges, moves, close, history });
});

r.post('/daily-close', requirePerm('dailyclose.perform'), (req, res) => {
  const b = req.body;
  assertFacility(req, b.facility_id);
  const date = b.date || today();
  if (get('SELECT 1 x FROM daily_closes WHERE facility_id=? AND date=?', b.facility_id, date)) throw httpError(400, 'This day is already closed');
  const by = {};
  for (const l of all("SELECT * FROM ledger WHERE facility_id=? AND date=? AND type IN ('payment','refund') AND voided=0", b.facility_id, date)) by[l.method || 'other'] = round2((by[l.method || 'other'] || 0) + (l.type === 'refund' ? -l.amount : l.amount));
  const cash = by.cash || 0, check = (by.check || 0) + (by.money_order || 0);
  const counted_cash = round2(b.counted_cash ?? cash), counted_check = round2(b.counted_check ?? check);
  const total = round2(Object.values(by).reduce((a, c) => a + c, 0));
  const id = insert('daily_closes', { facility_id: b.facility_id, date, expected_cash: cash, counted_cash, expected_check: check, counted_check, card_total: by.card || 0, ach_total: by.ach || 0,
    other_total: round2(total - cash - check - (by.card || 0) - (by.ach || 0)), total, variance: round2(counted_cash - cash + counted_check - check), deposit_ref: b.deposit_ref, notes: b.notes, user_id: req.user.id });
  logActivity({ facility_id: b.facility_id, user_id: req.user.id, entity_type: 'daily_close', entity_id: id, action: 'close', details: `Closed ${date}: total ${money(total)}, variance ${money(counted_cash - cash + counted_check - check)}` });
  res.json({ id });
});

export default r;
