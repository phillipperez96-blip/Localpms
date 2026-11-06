// Core business logic: account balances, posting, lien process, daily processing.
import { all, get, run, insert, update, tx } from './db.js';
import { today, addDays, addMonths, diffDays, round2, money, parse, jparse, daysInMonth, DEFAULT_LATE_FEES, DEFAULT_LIEN_STEPS } from './util.js';
import * as integ from './services/integrations.js';

// ---------- facilities ----------
export function facilityConfig(f) {
  if (typeof f === 'number' || typeof f === 'string') f = get('SELECT * FROM facilities WHERE id=?', Number(f));
  if (!f) return null;
  return { ...f, late_fees: jparse(f.late_fees, DEFAULT_LATE_FEES), lien_steps: jparse(f.lien_steps, DEFAULT_LIEN_STEPS), audit_template: jparse(f.audit_template, null) };
}

// ---------- activity log ----------
export function logActivity({ facility_id, user_id, entity_type, entity_id, action, details }) {
  insert('activity_log', { facility_id, user_id, entity_type, entity_id, action, details });
}

// ---------- account math ----------
/** FIFO: apply payments/credits to the oldest charges first. */
export function computeAccount(rows, asOf = today()) {
  let credits = 0, balance = 0;
  const charges = [];
  // Merchandise paid at the counter (charge + payment on the same sale) never touches rent.
  const paidSales = new Set(rows.filter((r) => r.sale_id && r.type === 'payment' && !r.voided).map((r) => r.sale_id));
  for (const r of rows) {
    if (r.voided) continue;
    if (r.sale_id && paidSales.has(r.sale_id)) continue;
    if (r.type === 'charge' || r.type === 'refund') { charges.push(r); balance += r.amount; }
    else { credits += r.amount; balance -= r.amount; }
  }
  charges.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  let oldestUnpaid = null, pastDue = 0, remaining = credits;
  for (const c of charges) {
    const unpaid = Math.max(0, c.amount - Math.max(0, remaining));
    remaining -= c.amount;
    if (unpaid > 0.004) {
      if (!oldestUnpaid) oldestUnpaid = c.date;
      if (c.date < asOf) pastDue += unpaid;
    }
  }
  const daysLate = oldestUnpaid && oldestUnpaid < asOf ? diffDays(asOf, oldestUnpaid) : 0;
  return { balance: round2(balance), pastDue: round2(pastDue), daysLate, oldestUnpaid: daysLate > 0 ? oldestUnpaid : null };
}

export function tenantAccount(tenantId, asOf) {
  return computeAccount(all('SELECT id,date,type,amount,voided,sale_id FROM ledger WHERE tenant_id=? AND voided=0', tenantId), asOf);
}

/** Map of tenant_id -> account for the given facilities. */
export function facilityAccounts(facilityIds, asOf = today()) {
  if (!facilityIds.length) return new Map();
  const rows = all(`SELECT id,tenant_id,date,type,amount,voided,sale_id FROM ledger WHERE voided=0 AND tenant_id IS NOT NULL AND facility_id IN (${facilityIds.map(() => '?').join(',')})`, ...facilityIds);
  const by = new Map();
  for (const r of rows) { if (!by.has(r.tenant_id)) by.set(r.tenant_id, []); by.get(r.tenant_id).push(r); }
  const out = new Map();
  for (const [tid, rs] of by) out.set(tid, computeAccount(rs, asOf));
  return out;
}

/**
 * The delinquency "cycle" key: the date the account first went past due. It stays fixed through
 * partial payments so lien steps and late fees are never repeated; it resets once the account is current.
 */
export function delinquencyCycle(tenantId, acct, { persist = false } = {}) {
  const t = get('SELECT delinquent_since FROM tenants WHERE id=?', tenantId);
  const delinquent = acct.daysLate > 0 && acct.balance > 0;
  if (!delinquent) { if (persist && t?.delinquent_since) run('UPDATE tenants SET delinquent_since=NULL WHERE id=?', tenantId); return null; }
  if (t?.delinquent_since && t.delinquent_since <= acct.oldestUnpaid) return t.delinquent_since;
  if (persist) run('UPDATE tenants SET delinquent_since=? WHERE id=?', acct.oldestUnpaid, tenantId);
  return acct.oldestUnpaid;
}

export const EMPTY_ACCT = { balance: 0, pastDue: 0, daysLate: 0, oldestUnpaid: null };

export function gateState(tenant, acct, facility, hasActiveRental = true) {
  if (!hasActiveRental) return { allowed: false, reason: 'No active rental' };
  if (tenant.gate_access === 'denied') return { allowed: false, reason: 'Manually denied' };
  if (tenant.gate_access === 'allowed') return { allowed: true, reason: 'Manual override' };
  if (acct && acct.daysLate >= (facility.gate_deny_days ?? 6) && acct.balance > 0) return { allowed: false, reason: `${acct.daysLate} days past due` };
  return { allowed: true, reason: 'Current' };
}

// ---------- posting ----------
export function postLedger(e) {
  return insert('ledger', { date: today(), ...e, amount: round2(e.amount) });
}

export function monthlyRent(rental) {
  return round2((rental.rent || 0));
}

// ---------- templates / comms ----------
export function renderTemplate(text, ctx) {
  return (text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (ctx[k] !== undefined && ctx[k] !== null ? String(ctx[k]) : ''));
}

export function tenantContext(tenantId, extra = {}) {
  const t = get('SELECT * FROM tenants WHERE id=?', tenantId);
  if (!t) return extra;
  const f = get('SELECT * FROM facilities WHERE id=?', t.facility_id);
  const rentals = all('SELECT r.*, u.number FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.tenant_id=? ORDER BY r.status=\'active\' DESC, r.id DESC', t.id);
  const active = rentals.filter((r) => r.status === 'active');
  const acct = tenantAccount(t.id);
  const r0 = active[0] || rentals[0];
  return {
    first_name: t.first_name, last_name: t.last_name, email: t.email, phone: t.phone,
    tenant_address: [t.address, [t.city, t.state, t.zip].filter(Boolean).join(', ')].filter(Boolean).join('\n'),
    unit: (active.length ? active : rentals.slice(0, 1)).map((r) => r.number).join(', '),
    balance: money(acct.balance), days_late: acct.daysLate, gate_code: t.gate_code,
    rent: money(active.reduce((s, r) => s + r.rent, 0)),
    due_day: r0 ? ordinal(parse(r0.next_due_date || r0.move_in_date).getDate()) : '',
    ...facilityCtx(f), today: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    ...extra,
  };
}
export function facilityCtx(f) {
  return f ? { facility_name: f.name, facility_phone: f.phone, facility_address: `${f.address}, ${f.city}, ${f.state} ${f.zip}`, gate_hours: f.gate_hours, gate_deny_days: f.gate_deny_days } : {};
}
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

/** Create a communication record and deliver it through the configured provider. */
export async function sendCommunication({ facility_id, tenant_id, lead_id, channel, subject, body, template_key, user_id, deliver = true, created_at }) {
  let to = null;
  if (tenant_id) { const t = get('SELECT email, phone FROM tenants WHERE id=?', tenant_id); to = channel === 'sms' ? t?.phone : channel === 'email' ? t?.email : null; }
  if (lead_id) { const l = get('SELECT email, phone FROM leads WHERE id=?', lead_id); to = channel === 'sms' ? l?.phone : channel === 'email' ? l?.email : null; }
  let result = { status: 'logged' };
  if (deliver) {
    if (channel === 'email') result = await integ.sendEmail({ to, subject, body });
    else if (channel === 'sms') result = await integ.sendSms({ to, body });
    else if (channel === 'letter') result = await integ.sendLetter({ to, subject, body });
  } else if (channel === 'letter') result = { status: 'ready_to_print' };
  else result = { status: 'simulated' };
  return insert('communications', { facility_id, tenant_id, lead_id, channel, to_address: to, subject, body, status: result.status, provider_ref: result.provider_ref, error: result.error, template_key, user_id, created_at });
}

export async function sendTemplate(key, { tenant_id, lead_id, facility_id, user_id, extra = {}, channel, deliver = true, created_at }) {
  const tpl = get('SELECT * FROM templates WHERE key=?', key);
  if (!tpl) return null;
  let ctx;
  if (tenant_id) ctx = tenantContext(tenant_id, extra);
  else { const l = get('SELECT * FROM leads WHERE id=?', lead_id); ctx = { ...l, ...facilityCtx(get('SELECT * FROM facilities WHERE id=?', facility_id)), ...extra }; }
  return sendCommunication({ facility_id, tenant_id, lead_id, channel: channel || tpl.channel, subject: renderTemplate(tpl.subject, ctx), body: renderTemplate(tpl.body, ctx), template_key: key, user_id, deliver, created_at });
}

// ---------- lien payment alerts ----------
export const LIEN_ALERT_STEPS = [
  'Confirm whether a partial payment can be accepted under your state lien law (it may waive the right to sell)',
  'Stop or postpone the sale / cancel the auction listing if the balance is paid',
  'Remove the overlock once paid in full and verify gate access is restored',
  'Withdraw any newspaper / online sale advertisement',
  'Call the tenant to confirm the remaining balance and next due date',
  'Notify the district manager',
];

/**
 * When a payment is received from a tenant at or past the facility's alert stage of the lien
 * process, create an urgent reminder so the office can act immediately. `before` is the
 * tenant's active rentals (with lien_status) captured BEFORE the payment was posted.
 */
export function lienPaymentAlert({ tenant, before, amount, method, balanceBefore, balanceAfter, user_id, source = 'Payment' }) {
  const f = facilityConfig(tenant.facility_id);
  const keys = f.lien_steps.map((s) => s.key);
  const threshold = f.lien_alert_step === 'any' ? 0 : Math.max(0, keys.indexOf(f.lien_alert_step || 'pre_lien'));
  const hit = before.filter((r) => keys.indexOf(r.lien_status) >= threshold && r.lien_status !== 'current');
  if (!hit.length) return null;
  const stage = hit.map((r) => `${r.number}: ${f.lien_steps.find((s) => s.key === r.lien_status)?.name || r.lien_status}`).join(', ');
  const name = `${tenant.first_name} ${tenant.last_name}`;
  const id = insert('tasks', {
    facility_id: tenant.facility_id, title: `Lien payment received: ${name} paid ${money(amount)}`,
    description: `${source} of ${money(amount)} (${method || '—'}) taken from a tenant in lien status (${stage}). Balance ${money(balanceBefore)} → ${money(balanceAfter)}${balanceAfter > 0 ? ' – still owes a balance.' : ' – paid in full.'}`,
    due_date: today(), priority: 'urgent', category: 'Lien Payment', source: 'lien_payment', status: 'open', tenant_id: tenant.id, unit_id: hit[0].unit_id, created_by: user_id,
  });
  logActivity({ facility_id: tenant.facility_id, user_id, entity_type: 'tenant', entity_id: tenant.id, action: 'lien_payment_alert', details: `Lien payment alert raised: ${money(amount)} while ${stage}` });
  return { id, stage, steps: LIEN_ALERT_STEPS, paidInFull: balanceAfter <= 0 };
}

// ---------- lien process ----------
export async function completeLienStep({ rental, step, cycle, date = today(), auto = false, user_id = null, notes = null, deliver = true }) {
  const f = get('SELECT * FROM facilities WHERE id=?', rental.facility_id);
  insert('lien_events', { facility_id: rental.facility_id, rental_id: rental.id, tenant_id: rental.tenant_id, step_key: step.key, step_name: step.name, cycle, date, fee: step.fee || 0, notes, auto: auto ? 1 : 0, user_id });
  if (step.fee > 0) {
    postLedger({ facility_id: rental.facility_id, tenant_id: rental.tenant_id, rental_id: rental.id, date, type: 'charge', category: 'lien_fee', description: `${step.name} fee`, amount: step.fee, reference: `LIEN:${step.key}:${cycle}:${rental.id}`, user_id });
  }
  if (step.overlock) run('UPDATE units SET overlocked=1 WHERE id=?', rental.unit_id);
  if (step.auction) {
    const existing = get("SELECT id FROM auctions WHERE rental_id=? AND status='scheduled'", rental.id);
    if (!existing) insert('auctions', { facility_id: rental.facility_id, rental_id: rental.id, tenant_id: rental.tenant_id, unit_id: rental.unit_id, scheduled_date: addDays(date, 14) > addDays(today(), 3) ? addDays(date, 14) : addDays(today(), 3), platform: 'Online Auction', status: 'scheduled' });
  }
  update('rentals', rental.id, { lien_status: step.key });
  if (step.template) await sendTemplate(step.template, { tenant_id: rental.tenant_id, facility_id: rental.facility_id, user_id, channel: step.channel, deliver, created_at: date < today() ? `${date} 09:00:00` : undefined });
  logActivity({ facility_id: rental.facility_id, user_id, entity_type: 'tenant', entity_id: rental.tenant_id, action: 'lien_step', details: `${auto ? 'Auto' : 'Manual'}: ${step.name} on unit ${get('SELECT number FROM units WHERE id=?', rental.unit_id)?.number}${f ? '' : ''}` });
}

// ---------- daily processing ----------
/**
 * Runs the nightly process for one facility: rent increases, recurring charges, late fees,
 * lien steps, reservation expiry and gate access sync. Safe to run repeatedly (idempotent).
 */
export async function processFacility(facilityId, asOf = today(), { deliver = true } = {}) {
  const f = facilityConfig(facilityId);
  const stats = { rentPosted: 0, lateFees: 0, lienSteps: 0, increases: 0, gateChanges: 0, reservationsExpired: 0 };

  // 1. scheduled rent increases
  for (const ri of all("SELECT * FROM rent_increases WHERE facility_id=? AND status='scheduled' AND effective_date<=?", f.id, asOf)) {
    run('UPDATE rentals SET rent=? WHERE id=? AND status=\'active\'', ri.new_rent, ri.rental_id);
    update('rent_increases', ri.id, { status: 'applied' });
    logActivity({ facility_id: f.id, entity_type: 'rental', entity_id: ri.rental_id, action: 'rent_increase_applied', details: `Rent ${money(ri.old_rent)} → ${money(ri.new_rent)}` });
    stats.increases++;
  }

  // 2. recurring charges
  tx(() => {
    for (const r of all("SELECT r.*, u.number FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.facility_id=? AND r.status='active' AND r.next_due_date<=?", f.id, asOf)) {
      let due = r.next_due_date, promoLeft = r.promo_months_left || 0;
      const anchor = f.billing_type === 'first' ? 1 : parse(r.move_in_date).getDate();
      let guard = 0;
      while (due <= asOf && guard++ < 24) {
        let rent = r.rent, desc = `Rent ${r.number} (${due})`;
        if (promoLeft > 0 && r.promotion_id) {
          const p = get('SELECT * FROM promotions WHERE id=?', r.promotion_id);
          if (p) { rent = applyPromo(rent, p); desc += ` – ${p.name}`; }
          promoLeft--;
        }
        postLedger({ facility_id: f.id, tenant_id: r.tenant_id, rental_id: r.id, date: due, type: 'charge', category: 'rent', description: desc, amount: rent, reference: `RENT:${r.id}:${due}` });
        if (r.insurance_premium > 0) postLedger({ facility_id: f.id, tenant_id: r.tenant_id, rental_id: r.id, date: due, type: 'charge', category: 'insurance', description: `Protection plan ${r.number}`, amount: r.insurance_premium, reference: `INS:${r.id}:${due}` });
        stats.rentPosted++;
        due = addMonths(due, 1, anchor);
      }
      update('rentals', r.id, { next_due_date: due, promo_months_left: promoLeft });
    }
  });

  // 2b. autopay (charges card on file on due date)
  for (const t of all("SELECT t.id FROM tenants t WHERE t.facility_id=? AND t.autopay=1 AND t.status='active'", f.id)) {
    const a = tenantAccount(t.id, asOf);
    const dueToday = get("SELECT 1 x FROM ledger WHERE tenant_id=? AND type='charge' AND category='rent' AND date=? AND voided=0", t.id, asOf);
    if (dueToday && a.balance > 0) {
      const res = await integ.chargeCard({ amount: a.balance, description: 'Autopay' }).catch(() => null);
      if (res?.ok) {
        const tenant = get('SELECT * FROM tenants WHERE id=?', t.id);
        const before = all("SELECT r.*, u.number FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.tenant_id=? AND r.status='active'", t.id);
        postLedger({ facility_id: f.id, tenant_id: t.id, date: asOf, type: 'payment', category: 'payment', description: 'Autopay', amount: a.balance, method: 'card', reference: res.reference });
        lienPaymentAlert({ tenant, before, amount: a.balance, method: 'card (autopay)', balanceBefore: a.balance, balanceAfter: 0, source: 'Autopay charge' });
      }
    }
  }

  // 3. late fees, lien steps, gate
  const accts = facilityAccounts([f.id], asOf);
  const tenants = all("SELECT * FROM tenants WHERE facility_id=?", f.id);
  for (const t of tenants) {
    const rentals = all("SELECT * FROM rentals WHERE tenant_id=? AND status='active'", t.id);
    const acct = accts.get(t.id) || EMPTY_ACCT;
    const cycle = delinquencyCycle(t.id, acct, { persist: true });
    if (rentals.length && cycle) {
      const monthly = rentals.reduce((s, r) => s + r.rent, 0);
      f.late_fees.forEach((rule, i) => {
        if (acct.daysLate < rule.day) return;
        const ref = `LF${i}:${t.id}:${cycle}`;
        if (get('SELECT 1 x FROM ledger WHERE reference=?', ref)) return;
        const amt = rule.type === 'percent' ? round2(monthly * rule.amount / 100) : rule.amount;
        const feeDate = addDays(acct.oldestUnpaid, rule.day);
        postLedger({ facility_id: f.id, tenant_id: t.id, rental_id: rentals[0].id, date: feeDate > asOf ? asOf : feeDate, type: 'charge', category: 'late_fee', description: rule.name, amount: amt, reference: ref });
        stats.lateFees++;
      });
      if (f.lien_automation === 'auto') {
        for (const r of rentals) {
          if (r.lien_hold) continue;
          for (const step of f.lien_steps) {
            if (acct.daysLate < step.day) break;
            if (get('SELECT 1 x FROM lien_events WHERE rental_id=? AND step_key=? AND cycle=?', r.id, step.key, cycle)) continue;
            const stepDate = addDays(acct.oldestUnpaid, step.day) > asOf ? asOf : addDays(acct.oldestUnpaid, step.day);
            await completeLienStep({ rental: r, step, cycle, date: stepDate, auto: true, deliver });
            stats.lienSteps++;
          }
        }
      }
    } else if (rentals.length) {
      for (const r of rentals) if (r.lien_status !== 'current') update('rentals', r.id, { lien_status: 'current' });
    }
    const gs = gateState(t, acct, f, rentals.length > 0);
    const state = gs.allowed ? 'allowed' : 'denied';
    if (t.gate_last_state !== state && t.gate_code) {
      await integ.gateSetAccess({ facilityId: f.id, code: t.gate_code, allowed: gs.allowed, tenantName: `${t.first_name} ${t.last_name}` });
      update('tenants', t.id, { gate_last_state: state });
      if (t.gate_last_state) {
        insert('gate_events', { facility_id: f.id, tenant_id: t.id, code: t.gate_code, event: gs.allowed ? 'access_restored' : 'access_suspended', detail: gs.reason });
        stats.gateChanges++;
      }
    }
  }

  // 4. reservation expiry
  for (const l of all("SELECT * FROM leads WHERE facility_id=? AND status='reserved' AND reservation_expires<?", f.id, asOf)) {
    if (l.unit_id) run("UPDATE units SET status='vacant' WHERE id=? AND status='reserved'", l.unit_id);
    update('leads', l.id, { status: 'contacted', unit_id: null, notes: ((l.notes || '') + `\n[${asOf}] Reservation expired.`).trim() });
    stats.reservationsExpired++;
  }
  return stats;
}

export function applyPromo(rent, p) {
  if (p.discount_type === 'percent') return round2(rent * (1 - p.value / 100));
  if (p.discount_type === 'fixed_price') return round2(p.value);
  if (p.discount_type === 'amount_off') return round2(Math.max(0, rent - p.value));
  return rent;
}

/** First-period charge at move-in. */
export function firstPeriod(f, moveIn, rent) {
  if (f.billing_type === 'first') {
    const d = parse(moveIn);
    const dim = daysInMonth(d.getFullYear(), d.getMonth());
    const remaining = dim - d.getDate() + 1;
    const amount = f.prorate && d.getDate() !== 1 ? round2(rent * remaining / dim) : rent;
    const next = addMonths(moveIn.slice(0, 8) + '01', 1, 1);
    return { amount, nextDue: next, label: f.prorate && d.getDate() !== 1 ? `Prorated rent (${remaining}/${dim} days)` : 'First month rent' };
  }
  return { amount: rent, nextDue: addMonths(moveIn, 1), label: 'First month rent' };
}

export function generateGateCode() {
  for (;;) {
    const c = String(Math.floor(100000 + Math.random() * 900000));
    if (!get('SELECT 1 x FROM tenants WHERE gate_code=?', c)) return c;
  }
}
