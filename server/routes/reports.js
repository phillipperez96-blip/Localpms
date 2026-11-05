import { Router } from 'express';
import { all, get } from '../db.js';
import { scope, requirePerm, can } from '../auth.js';
import { today, round2, monthStart, diffDays, addDays } from '../util.js';
import { inList, httpError, activeRentals, facilityConfig, facilityNames } from './helpers.js';
import { facilityAccounts, gateState, EMPTY_ACCT } from '../core.js';

const r = Router();

const C = (key, label, type = 'text') => ({ key, label, type });
const pct = (a, b) => (b ? round2((a / b) * 100) : 0);

/** FIFO aging of unpaid charges into buckets. */
function aging(rows, asOf) {
  let credits = 0; const charges = [];
  const paidSales = new Set(rows.filter((r) => r.sale_id && r.type === 'payment').map((r) => r.sale_id));
  for (const x of rows) {
    if (x.sale_id && paidSales.has(x.sale_id)) continue; if (x.type === 'charge' || x.type === 'refund') charges.push(x); else credits += x.amount; }
  charges.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const b = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  for (const c of charges) {
    const unpaid = Math.max(0, c.amount - Math.max(0, credits)); credits -= c.amount;
    if (unpaid <= 0.004) continue;
    const age = diffDays(asOf, c.date);
    if (age <= 0) b.current += unpaid; else if (age <= 30) b.d30 += unpaid; else if (age <= 60) b.d60 += unpaid; else if (age <= 90) b.d90 += unpaid; else b.d90p += unpaid;
  }
  return b;
}

const REPORTS = {
  rent_roll: { name: 'Rent Roll', group: 'Management', range: false, desc: 'Every occupied unit with rent, street rate and balance.',
    run: (ids) => {
      const rows = activeRentals(ids).sort((a, b) => a.facility_id - b.facility_id || a.number.localeCompare(b.number)).map((x) => ({
        facility: x.facility_code, unit: x.number, size: `${x.width}x${x.length}`, type: x.unit_type, tenant: `${x.first_name} ${x.last_name}`, move_in: x.move_in_date,
        rent: x.rent, street: x.street_rate, variance: round2(x.rent - x.street_rate), insurance: x.insurance_premium, next_due: x.next_due_date, balance: x.account.balance, days_late: x.account.daysLate }));
      return { columns: [C('facility', 'Fac'), C('unit', 'Unit'), C('size', 'Size'), C('type', 'Type'), C('tenant', 'Tenant'), C('move_in', 'Move-In', 'date'), C('rent', 'Rent', 'money'), C('street', 'Street', 'money'), C('variance', 'Variance', 'money'), C('insurance', 'Protection', 'money'), C('next_due', 'Next Due', 'date'), C('balance', 'Balance', 'money'), C('days_late', 'Days Late', 'number')],
        rows, totals: { unit: `${rows.length} units`, rent: sum(rows, 'rent'), street: sum(rows, 'street'), variance: sum(rows, 'variance'), insurance: sum(rows, 'insurance'), balance: sum(rows, 'balance') } };
    } },
  occupancy: { name: 'Occupancy Summary', group: 'Management', range: false, desc: 'Unit, square-foot and economic occupancy by unit type & size.',
    run: (ids) => {
      const fn = facilityNames();
      const units = all(`SELECT * FROM units WHERE facility_id IN ${inList(ids)}`, ...ids);
      const rents = new Map(activeRentals(ids).map((x) => [x.unit_id, x.rent]));
      const g = {};
      for (const u of units) {
        const k = `${u.facility_id}|${u.unit_type}|${u.width}x${u.length}`;
        const o = (g[k] ||= { facility: fn[u.facility_id], type: u.unit_type, size: `${u.width}x${u.length}`, units: 0, occupied: 0, vacant: 0, unrentable: 0, sqft: 0, occ_sqft: 0, gpr: 0, actual: 0 });
        o.units++; if (u.status === 'occupied') { o.occupied++; o.occ_sqft += u.sqft; } else if (u.status === 'unrentable') o.unrentable++; else o.vacant++;
        if (u.status !== 'unrentable') { o.sqft += u.sqft; o.gpr += u.street_rate; }
        o.actual += rents.get(u.id) || 0;
      }
      const rows = Object.values(g).map((o) => ({ ...o, unit_occ: pct(o.occupied, o.units - o.unrentable), sqft_occ: pct(o.occ_sqft, o.sqft), econ_occ: pct(o.actual, o.gpr) }));
      const t = rows.reduce((a, o) => { for (const k of ['units', 'occupied', 'vacant', 'unrentable', 'sqft', 'occ_sqft', 'gpr', 'actual']) a[k] = (a[k] || 0) + o[k]; return a; }, {});
      return { columns: [C('facility', 'Facility'), C('type', 'Type'), C('size', 'Size'), C('units', 'Units', 'number'), C('occupied', 'Occ', 'number'), C('vacant', 'Vac', 'number'), C('unrentable', 'Unrent.', 'number'), C('unit_occ', 'Unit Occ %', 'pct'), C('sqft_occ', 'SqFt Occ %', 'pct'), C('gpr', 'Gross Potential', 'money'), C('actual', 'Actual Rent', 'money'), C('econ_occ', 'Econ Occ %', 'pct')],
        rows, totals: { ...t, facility: 'Total', unit_occ: pct(t.occupied, t.units - t.unrentable), sqft_occ: pct(t.occ_sqft, t.sqft), econ_occ: pct(t.actual, t.gpr) } };
    } },
  aging: { name: 'Accounts Receivable Aging', group: 'Collections', range: false, desc: 'Unpaid balances aged by charge date.',
    run: (ids) => {
      const T = today();
      const tenants = all(`SELECT t.id, t.first_name, t.last_name, t.phone, f.code, (SELECT group_concat(u.number, ', ') FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.tenant_id=t.id AND r.status='active') units FROM tenants t JOIN facilities f ON f.id=t.facility_id WHERE t.facility_id IN ${inList(ids)}`, ...ids);
      const led = all(`SELECT id, tenant_id, date, type, amount, sale_id FROM ledger WHERE voided=0 AND tenant_id IS NOT NULL AND facility_id IN ${inList(ids)}`, ...ids);
      const by = new Map(); for (const l of led) { if (!by.has(l.tenant_id)) by.set(l.tenant_id, []); by.get(l.tenant_id).push(l); }
      const rows = [];
      for (const t of tenants) {
        const b = aging(by.get(t.id) || [], T);
        const total = round2(b.d30 + b.d60 + b.d90 + b.d90p);
        if (total > 0) rows.push({ facility: t.code, tenant: `${t.first_name} ${t.last_name}`, units: t.units || '(former)', phone: t.phone, d30: round2(b.d30), d60: round2(b.d60), d90: round2(b.d90), d90p: round2(b.d90p), total });
      }
      rows.sort((a, b) => b.total - a.total);
      return { columns: [C('facility', 'Fac'), C('tenant', 'Tenant'), C('units', 'Units'), C('phone', 'Phone'), C('d30', '1–30', 'money'), C('d60', '31–60', 'money'), C('d90', '61–90', 'money'), C('d90p', '90+', 'money'), C('total', 'Total Past Due', 'money')],
        rows, totals: { tenant: `${rows.length} accounts`, d30: sum(rows, 'd30'), d60: sum(rows, 'd60'), d90: sum(rows, 'd90'), d90p: sum(rows, 'd90p'), total: sum(rows, 'total') } };
    } },
  payments: { name: 'Payments / Receipts', group: 'Accounting', range: true, desc: 'All payments received in the date range.',
    run: (ids, from, to) => {
      const rows = all(`SELECT l.date, f.code facility, COALESCE(t.first_name || ' ' || t.last_name, 'Walk-in') tenant, l.description, l.method, l.reference, l.amount, u.name user, CASE WHEN l.voided THEN 'VOID' ELSE '' END status
        FROM ledger l JOIN facilities f ON f.id=l.facility_id LEFT JOIN tenants t ON t.id=l.tenant_id LEFT JOIN users u ON u.id=l.user_id WHERE l.type='payment' AND l.facility_id IN ${inList(ids)} AND l.date BETWEEN ? AND ? ORDER BY l.date DESC, l.id DESC`, ...ids, from, to);
      const byMethod = {}; for (const x of rows) if (!x.status) byMethod[x.method] = round2((byMethod[x.method] || 0) + x.amount);
      return { columns: [C('date', 'Date', 'date'), C('facility', 'Fac'), C('tenant', 'Tenant'), C('description', 'Description'), C('method', 'Method'), C('reference', 'Reference'), C('amount', 'Amount', 'money'), C('user', 'Taken By'), C('status', 'Status')],
        rows, totals: { tenant: `${rows.length} payments`, amount: round2(rows.filter((x) => !x.status).reduce((s, x) => s + x.amount, 0)) }, summary: Object.entries(byMethod).map(([k, v]) => ({ label: k, value: v, type: 'money' })) };
    } },
  revenue: { name: 'Revenue by Category', group: 'Accounting', range: true, desc: 'Charges posted by category (rent, fees, protection, merchandise).',
    run: (ids, from, to) => {
      const rows = all(`SELECT f.code facility, l.category, COUNT(*) count, ROUND(SUM(l.amount),2) amount FROM ledger l JOIN facilities f ON f.id=l.facility_id WHERE l.type='charge' AND l.voided=0 AND l.facility_id IN ${inList(ids)} AND l.date BETWEEN ? AND ? GROUP BY l.facility_id, l.category ORDER BY l.facility_id, amount DESC`, ...ids, from, to)
        .map((x) => ({ ...x, category: label(x.category) }));
      const credits = all(`SELECT f.code facility, 'Credits / Write-offs' category, COUNT(*) count, -ROUND(SUM(l.amount),2) amount FROM ledger l JOIN facilities f ON f.id=l.facility_id WHERE l.type='credit' AND l.voided=0 AND l.facility_id IN ${inList(ids)} AND l.date BETWEEN ? AND ? GROUP BY l.facility_id`, ...ids, from, to);
      const all2 = [...rows, ...credits];
      return { columns: [C('facility', 'Facility'), C('category', 'Category'), C('count', 'Count', 'number'), C('amount', 'Amount', 'money')], rows: all2, totals: { facility: 'Net', amount: sum(all2, 'amount') } };
    } },
  move_activity: { name: 'Move-In / Move-Out Activity', group: 'Management', range: true, desc: 'Move-ins and move-outs with length of stay.',
    run: (ids, from, to) => {
      const rows = [
        ...all(`SELECT 'Move-In' kind, r.move_in_date date, f.code facility, u.number unit, u.width || 'x' || u.length size, t.first_name || ' ' || t.last_name tenant, r.rent, NULL reason, NULL stay FROM rentals r JOIN units u ON u.id=r.unit_id JOIN tenants t ON t.id=r.tenant_id JOIN facilities f ON f.id=r.facility_id WHERE r.facility_id IN ${inList(ids)} AND r.move_in_date BETWEEN ? AND ?`, ...ids, from, to),
        ...all(`SELECT 'Move-Out' kind, r.move_out_date date, f.code facility, u.number unit, u.width || 'x' || u.length size, t.first_name || ' ' || t.last_name tenant, r.rent, r.move_out_reason reason, CAST(julianday(r.move_out_date)-julianday(r.move_in_date) AS INT) stay FROM rentals r JOIN units u ON u.id=r.unit_id JOIN tenants t ON t.id=r.tenant_id JOIN facilities f ON f.id=r.facility_id WHERE r.facility_id IN ${inList(ids)} AND r.move_out_date BETWEEN ? AND ?`, ...ids, from, to),
      ].sort((a, b) => (a.date < b.date ? 1 : -1));
      const ins = rows.filter((x) => x.kind === 'Move-In').length;
      return { columns: [C('kind', 'Type'), C('date', 'Date', 'date'), C('facility', 'Fac'), C('unit', 'Unit'), C('size', 'Size'), C('tenant', 'Tenant'), C('rent', 'Rent', 'money'), C('reason', 'Reason'), C('stay', 'Days Stayed', 'number')],
        rows, summary: [{ label: 'Move-ins', value: ins }, { label: 'Move-outs', value: rows.length - ins }, { label: 'Net', value: ins - (rows.length - ins) }] };
    } },
  vacant_units: { name: 'Vacant Units', group: 'Management', range: false, desc: 'Vacant & unrentable units with days vacant.',
    run: (ids) => {
      const rows = all(`SELECT f.code facility, u.number unit, u.width || 'x' || u.length size, u.unit_type type, u.status, u.street_rate, u.unrentable_reason note, (SELECT MAX(move_out_date) FROM rentals r WHERE r.unit_id=u.id) last_out
        FROM units u JOIN facilities f ON f.id=u.facility_id WHERE u.facility_id IN ${inList(ids)} AND u.status IN ('vacant','unrentable','reserved') ORDER BY u.facility_id, u.number`, ...ids)
        .map((x) => ({ ...x, days_vacant: x.last_out ? diffDays(today(), x.last_out) : null }));
      return { columns: [C('facility', 'Fac'), C('unit', 'Unit'), C('size', 'Size'), C('type', 'Type'), C('status', 'Status'), C('street_rate', 'Street Rate', 'money'), C('last_out', 'Last Move-Out', 'date'), C('days_vacant', 'Days Vacant', 'number'), C('note', 'Note')],
        rows, totals: { unit: `${rows.length} units`, street_rate: sum(rows, 'street_rate') } };
    } },
  insurance: { name: 'Tenant Protection Enrollment', group: 'Management', range: false, desc: 'Protection / insurance plan enrollment.',
    run: (ids) => {
      const rows = activeRentals(ids).map((x) => ({ facility: x.facility_code, unit: x.number, tenant: `${x.first_name} ${x.last_name}`, plan: get('SELECT name FROM insurance_plans WHERE id=?', x.insurance_plan_id)?.name || '— None —', premium: x.insurance_premium }))
        .sort((a, b) => a.facility.localeCompare(b.facility) || a.unit.localeCompare(b.unit));
      const enrolled = rows.filter((x) => x.premium > 0).length;
      return { columns: [C('facility', 'Fac'), C('unit', 'Unit'), C('tenant', 'Tenant'), C('plan', 'Plan'), C('premium', 'Monthly Premium', 'money')], rows,
        totals: { premium: sum(rows, 'premium') }, summary: [{ label: 'Enrolled', value: enrolled }, { label: 'Not enrolled', value: rows.length - enrolled }, { label: 'Enrollment rate', value: pct(enrolled, rows.length), type: 'pct' }] };
    } },
  lien: { name: 'Lien & Collections History', group: 'Collections', range: true, desc: 'Every lien step completed (letters, overlocks, fees).',
    run: (ids, from, to) => {
      const rows = all(`SELECT e.date, f.code facility, un.number unit, t.first_name || ' ' || t.last_name tenant, e.step_name step, e.fee, CASE WHEN e.auto THEN 'Automatic' ELSE COALESCE(u.name,'') END by_user, e.notes
        FROM lien_events e JOIN facilities f ON f.id=e.facility_id JOIN tenants t ON t.id=e.tenant_id LEFT JOIN rentals r ON r.id=e.rental_id LEFT JOIN units un ON un.id=r.unit_id LEFT JOIN users u ON u.id=e.user_id
        WHERE e.facility_id IN ${inList(ids)} AND e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`, ...ids, from, to);
      return { columns: [C('date', 'Date', 'date'), C('facility', 'Fac'), C('unit', 'Unit'), C('tenant', 'Tenant'), C('step', 'Step'), C('fee', 'Fee', 'money'), C('by_user', 'By'), C('notes', 'Notes')], rows, totals: { fee: sum(rows, 'fee') } };
    } },
  auctions: { name: 'Auction History', group: 'Collections', range: true, desc: 'Scheduled and completed auctions with proceeds.',
    run: (ids, from, to) => {
      const rows = all(`SELECT a.scheduled_date date, f.code facility, u.number unit, t.first_name || ' ' || t.last_name tenant, a.platform, a.status, a.winning_bidder, a.sale_amount, a.applied_to_balance, a.surplus
        FROM auctions a JOIN facilities f ON f.id=a.facility_id JOIN units u ON u.id=a.unit_id JOIN tenants t ON t.id=a.tenant_id WHERE a.facility_id IN ${inList(ids)} AND (a.scheduled_date BETWEEN ? AND ? OR a.status='scheduled') ORDER BY a.scheduled_date DESC`, ...ids, from, to);
      return { columns: [C('date', 'Date', 'date'), C('facility', 'Fac'), C('unit', 'Unit'), C('tenant', 'Tenant'), C('platform', 'Platform'), C('status', 'Status'), C('winning_bidder', 'Buyer'), C('sale_amount', 'Sale', 'money'), C('applied_to_balance', 'Applied', 'money'), C('surplus', 'Surplus', 'money')],
        rows, totals: { sale_amount: sum(rows, 'sale_amount'), applied_to_balance: sum(rows, 'applied_to_balance'), surplus: sum(rows, 'surplus') } };
    } },
  writeoffs: { name: 'Credits, Waivers & Write-offs', group: 'Accounting', range: true, desc: 'Credits and voided entries — useful for loss prevention.',
    run: (ids, from, to) => {
      const rows = all(`SELECT l.date, f.code facility, COALESCE(t.first_name || ' ' || t.last_name,'') tenant, CASE WHEN l.voided THEN 'VOID ' || l.type ELSE l.type END kind, l.category, l.description, l.amount, u.name user
        FROM ledger l JOIN facilities f ON f.id=l.facility_id LEFT JOIN tenants t ON t.id=l.tenant_id LEFT JOIN users u ON u.id=l.user_id WHERE l.facility_id IN ${inList(ids)} AND l.date BETWEEN ? AND ? AND (l.type='credit' OR l.voided=1) ORDER BY l.date DESC`, ...ids, from, to)
        .map((x) => ({ ...x, category: label(x.category) }));
      return { columns: [C('date', 'Date', 'date'), C('facility', 'Fac'), C('tenant', 'Tenant'), C('kind', 'Type'), C('category', 'Category'), C('description', 'Description'), C('amount', 'Amount', 'money'), C('user', 'User')], rows, totals: { amount: sum(rows, 'amount') } };
    } },
  merchandise: { name: 'Merchandise Sales', group: 'Retail', range: true, desc: 'Units sold, revenue, cost and margin by product.',
    run: (ids, from, to) => {
      const rows = all(`SELECT f.code facility, si.name product, p.category, SUM(si.qty) qty, ROUND(SUM(si.qty*si.price),2) revenue, ROUND(SUM(si.qty*COALESCE(p.cost,0)),2) cost FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN facilities f ON f.id=s.facility_id LEFT JOIN products p ON p.id=si.product_id
        WHERE s.facility_id IN ${inList(ids)} AND s.date BETWEEN ? AND ? GROUP BY s.facility_id, si.product_id ORDER BY revenue DESC`, ...ids, from, to).map((x) => ({ ...x, margin: round2(x.revenue - x.cost), margin_pct: pct(x.revenue - x.cost, x.revenue) }));
      const t = { qty: sum(rows, 'qty'), revenue: sum(rows, 'revenue'), cost: sum(rows, 'cost'), margin: sum(rows, 'margin') };
      return { columns: [C('facility', 'Fac'), C('product', 'Product'), C('category', 'Category'), C('qty', 'Qty', 'number'), C('revenue', 'Revenue', 'money'), C('cost', 'Cost', 'money'), C('margin', 'Margin', 'money'), C('margin_pct', 'Margin %', 'pct')], rows, totals: { ...t, margin_pct: pct(t.margin, t.revenue) } };
    } },
  inventory: { name: 'Inventory Valuation', group: 'Retail', range: false, desc: 'On-hand quantities, value and reorder needs.',
    run: (ids) => {
      const rows = all(`SELECT f.code facility, p.sku, p.name, p.category, p.qty_on_hand qty, p.reorder_point, p.cost, p.price, ROUND(p.qty_on_hand*p.cost,2) value, CASE WHEN p.qty_on_hand<=p.reorder_point THEN 'REORDER' ELSE '' END flag FROM products p JOIN facilities f ON f.id=p.facility_id WHERE p.facility_id IN ${inList(ids)} AND p.active=1 ORDER BY p.facility_id, p.category, p.name`, ...ids);
      return { columns: [C('facility', 'Fac'), C('sku', 'SKU'), C('name', 'Product'), C('category', 'Category'), C('qty', 'On Hand', 'number'), C('reorder_point', 'Reorder At', 'number'), C('cost', 'Cost', 'money'), C('price', 'Price', 'money'), C('value', 'Value', 'money'), C('flag', '')], rows, totals: { qty: sum(rows, 'qty'), value: sum(rows, 'value') } };
    } },
  rent_increases: { name: 'Rent Increases (ECRI)', group: 'Management', range: true, desc: 'Scheduled and applied existing-customer rate increases.',
    run: (ids, from, to) => {
      const rows = all(`SELECT ri.effective_date, f.code facility, u.number unit, t.first_name || ' ' || t.last_name tenant, ri.old_rent, ri.new_rent, ROUND(ri.new_rent-ri.old_rent,2) change, ri.status, ri.notice_date FROM rent_increases ri JOIN facilities f ON f.id=ri.facility_id JOIN units u ON u.id=ri.unit_id JOIN tenants t ON t.id=ri.tenant_id
        WHERE ri.facility_id IN ${inList(ids)} AND (ri.effective_date BETWEEN ? AND ? OR ri.status='scheduled') ORDER BY ri.effective_date DESC`, ...ids, from, to);
      return { columns: [C('effective_date', 'Effective', 'date'), C('facility', 'Fac'), C('unit', 'Unit'), C('tenant', 'Tenant'), C('old_rent', 'Old Rent', 'money'), C('new_rent', 'New Rent', 'money'), C('change', 'Monthly Change', 'money'), C('status', 'Status'), C('notice_date', 'Notice Sent', 'date')], rows,
        totals: { change: round2(rows.filter((x) => x.status !== 'cancelled').reduce((s, x) => s + x.change, 0)) } };
    } },
  leads: { name: 'Lead Source & Conversion', group: 'Sales', range: true, desc: 'Leads by source with reservation and conversion rates.',
    run: (ids, from, to) => {
      const rows = all(`SELECT source, COUNT(*) leads, SUM(status='reserved') reserved, SUM(status='converted') converted, SUM(status='lost') lost FROM leads WHERE facility_id IN ${inList(ids)} AND date(created_at) BETWEEN ? AND ? GROUP BY source ORDER BY leads DESC`, ...ids, from, to)
        .map((x) => ({ ...x, conversion: pct(x.converted, x.leads) }));
      const t = { leads: sum(rows, 'leads'), reserved: sum(rows, 'reserved'), converted: sum(rows, 'converted'), lost: sum(rows, 'lost') };
      return { columns: [C('source', 'Source'), C('leads', 'Leads', 'number'), C('reserved', 'Reserved', 'number'), C('converted', 'Converted', 'number'), C('lost', 'Lost', 'number'), C('conversion', 'Conversion %', 'pct')], rows, totals: { source: 'Total', ...t, conversion: pct(t.converted, t.leads) } };
    } },
  daily_close: { name: 'Daily Close History', group: 'Accounting', range: true, desc: 'Closed days with deposits and cash variances.',
    run: (ids, from, to) => {
      const rows = all(`SELECT d.date, f.code facility, d.expected_cash, d.counted_cash, d.expected_check, d.counted_check, d.card_total, d.ach_total, d.total, d.variance, d.deposit_ref, u.name user FROM daily_closes d JOIN facilities f ON f.id=d.facility_id LEFT JOIN users u ON u.id=d.user_id WHERE d.facility_id IN ${inList(ids)} AND d.date BETWEEN ? AND ? ORDER BY d.date DESC`, ...ids, from, to);
      return { columns: [C('date', 'Date', 'date'), C('facility', 'Fac'), C('expected_cash', 'Exp. Cash', 'money'), C('counted_cash', 'Counted Cash', 'money'), C('expected_check', 'Exp. Check', 'money'), C('counted_check', 'Counted Check', 'money'), C('card_total', 'Card', 'money'), C('ach_total', 'ACH', 'money'), C('total', 'Total', 'money'), C('variance', 'Variance', 'money'), C('deposit_ref', 'Deposit'), C('user', 'Closed By')],
        rows, totals: { total: sum(rows, 'total'), variance: sum(rows, 'variance'), card_total: sum(rows, 'card_total'), ach_total: sum(rows, 'ach_total') } };
    } },
  gate_denied: { name: 'Gate Access Denied', group: 'Collections', range: false, desc: 'Tenants whose gate code is currently suspended.',
    run: (ids) => {
      const accts = facilityAccounts(ids);
      const rows = [];
      for (const id of ids) {
        const f = facilityConfig(id);
        for (const t of all(`SELECT t.*, (SELECT group_concat(u.number, ', ') FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.tenant_id=t.id AND r.status='active') units FROM tenants t WHERE t.facility_id=? AND t.status='active'`, id)) {
          const a = accts.get(t.id) || EMPTY_ACCT; const g = gateState(t, a, f, !!t.units);
          if (!g.allowed) rows.push({ facility: f.code, tenant: `${t.first_name} ${t.last_name}`, units: t.units, code: t.gate_code, reason: g.reason, balance: a.balance });
        }
      }
      return { columns: [C('facility', 'Fac'), C('tenant', 'Tenant'), C('units', 'Units'), C('code', 'Gate Code'), C('reason', 'Reason'), C('balance', 'Balance', 'money')], rows, totals: { balance: sum(rows, 'balance') } };
    } },
  audits: { name: 'Property Audit Scores', group: 'Management', range: true, desc: 'Monthly visit scores and status by facility.',
    run: (ids, from, to) => {
      const rows = all(`SELECT a.period, a.visit_date, f.name facility, u.name auditor, a.status, a.score, a.max_score, ROUND(a.score*100.0/NULLIF(a.max_score,0),1) pct, a.acknowledged_at FROM audits a JOIN facilities f ON f.id=a.facility_id LEFT JOIN users u ON u.id=a.auditor_id WHERE a.facility_id IN ${inList(ids)} AND a.visit_date BETWEEN ? AND ? ORDER BY a.period DESC, f.name`, ...ids, from, to);
      return { columns: [C('period', 'Month'), C('visit_date', 'Visit', 'date'), C('facility', 'Facility'), C('auditor', 'Auditor'), C('status', 'Status'), C('score', 'Score', 'number'), C('max_score', 'Max', 'number'), C('pct', 'Score %', 'pct'), C('acknowledged_at', 'Acknowledged', 'date')], rows };
    } },
  tenant_list: { name: 'Tenant Contact List', group: 'Management', range: false, desc: 'Mailing / contact list for active tenants.',
    run: (ids) => {
      const rows = all(`SELECT f.code facility, t.last_name, t.first_name, t.company, t.phone, t.email, t.address, t.city, t.state, t.zip, (SELECT group_concat(u.number, ', ') FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.tenant_id=t.id AND r.status='active') units, CASE WHEN t.military THEN 'Yes' ELSE '' END military
        FROM tenants t JOIN facilities f ON f.id=t.facility_id WHERE t.facility_id IN ${inList(ids)} AND t.status='active' ORDER BY t.last_name`, ...ids);
      return { columns: [C('facility', 'Fac'), C('last_name', 'Last'), C('first_name', 'First'), C('company', 'Company'), C('units', 'Units'), C('phone', 'Phone'), C('email', 'Email'), C('address', 'Address'), C('city', 'City'), C('state', 'ST'), C('zip', 'Zip'), C('military', 'Military')], rows };
    } },
  activity_log: { name: 'Activity Log', group: 'Admin', range: true, perm: 'activity.view', desc: 'Audit trail of every action taken in the system.',
    run: (ids, from, to) => {
      const rows = all(`SELECT a.created_at, f.code facility, u.name user, a.entity_type, a.action, a.details FROM activity_log a LEFT JOIN facilities f ON f.id=a.facility_id LEFT JOIN users u ON u.id=a.user_id WHERE (a.facility_id IN ${inList(ids)} OR a.facility_id IS NULL) AND date(a.created_at) BETWEEN ? AND ? ORDER BY a.id DESC LIMIT 5000`, ...ids, from, to);
      return { columns: [C('created_at', 'When', 'datetime'), C('facility', 'Fac'), C('user', 'User'), C('entity_type', 'Area'), C('action', 'Action'), C('details', 'Details')], rows };
    } },
};

const LABELS = { rent: 'Rent', late_fee: 'Late Fees', insurance: 'Protection Plan', admin_fee: 'Admin Fees', lien_fee: 'Lien Fees', merchandise: 'Merchandise', deposit: 'Deposits', auction_fee: 'Auction Fees', cleaning_fee: 'Cleaning Fees', misc: 'Misc. Charges', credit: 'Credit', write_off: 'Write-off', lock_cut: 'Lock Cut Fee' };
const label = (c) => LABELS[c] || c;
function sum(rows, k) { return round2(rows.reduce((s, x) => s + (Number(x[k]) || 0), 0)); }

r.get('/reports', requirePerm('reports.view'), (req, res) => {
  res.json(Object.entries(REPORTS).filter(([, v]) => !v.perm || can(req.user, v.perm)).map(([key, v]) => ({ key, name: v.name, group: v.group, range: v.range, desc: v.desc })));
});

r.get('/reports/:key', requirePerm('reports.view'), (req, res) => {
  const rep = REPORTS[req.params.key];
  if (!rep) throw httpError(404, 'Unknown report');
  if (rep.perm && !can(req.user, rep.perm)) throw httpError(403, 'No permission');
  const ids = scope(req);
  const from = req.query.from || monthStart(), to = req.query.to || today();
  const out = rep.run(ids, from, to);
  res.json({ key: req.params.key, name: rep.name, range: rep.range, from, to, generated: new Date().toISOString(), facilities: ids.map((id) => facilityNames()[id]), ...out });
});

r.get('/activity', requirePerm('activity.view'), (req, res) => {
  const ids = scope(req);
  const q = req.query;
  const params = [...ids];
  let where = `(a.facility_id IN ${inList(ids)} OR a.facility_id IS NULL)`;
  if (q.user) { where += ' AND a.user_id=?'; params.push(Number(q.user)); }
  if (q.entity) { where += ' AND a.entity_type=?'; params.push(q.entity); }
  if (q.q) { where += ' AND a.details LIKE ?'; params.push(`%${q.q}%`); }
  if (q.from) { where += ' AND date(a.created_at)>=?'; params.push(q.from); }
  if (q.to) { where += ' AND date(a.created_at)<=?'; params.push(q.to); }
  res.json(all(`SELECT a.*, u.name user_name, f.code facility_code FROM activity_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN facilities f ON f.id=a.facility_id WHERE ${where} ORDER BY a.id DESC LIMIT 1000`, ...params));
});

export default r;
