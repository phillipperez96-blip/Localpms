import { all, get } from '../db.js';
import { facilityAccounts, facilityConfig, EMPTY_ACCT, delinquencyCycle } from '../core.js';
import { today } from '../util.js';

export const inList = (ids) => `(${ids.length ? ids.map(() => '?').join(',') : 'NULL'})`;

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

/** Active rentals with tenant, unit and account status for the given facilities. */
export function activeRentals(ids, asOf = today()) {
  const rows = all(`SELECT r.*, u.number, u.unit_type, u.width, u.length, u.sqft, u.street_rate, u.overlocked, u.building,
      t.first_name, t.last_name, t.phone, t.email, t.gate_code, t.gate_access, t.autopay, f.code facility_code, f.name facility_name
    FROM rentals r JOIN units u ON u.id=r.unit_id JOIN tenants t ON t.id=r.tenant_id JOIN facilities f ON f.id=r.facility_id
    WHERE r.status='active' AND r.facility_id IN ${inList(ids)}`, ...ids);
  const accts = facilityAccounts(ids, asOf);
  return rows.map((r) => ({ ...r, account: accts.get(r.tenant_id) || EMPTY_ACCT }));
}

/** Next pending lien step for a rental in its current delinquency cycle. */
export function nextLienStep(rental, acct, steps) {
  const cycle = delinquencyCycle(rental.tenant_id, acct);
  if (!cycle) return null;
  const done = new Set(all('SELECT step_key FROM lien_events WHERE rental_id=? AND cycle=?', rental.id, cycle).map((e) => e.step_key));
  const step = steps.find((s) => !done.has(s.key));
  if (!step) return null;
  return { ...step, dueIn: step.day - acct.daysLate, due: acct.daysLate >= step.day, completed: [...done], cycle };
}

export { facilityConfig };

export const fullName = (t) => `${t.first_name || ''} ${t.last_name || ''}`.trim();

export function facilityNames() {
  return Object.fromEntries(all('SELECT id, name FROM facilities').map((f) => [f.id, f.name]));
}

export function userNames() {
  return Object.fromEntries(all('SELECT id, name FROM users').map((u) => [u.id, u.name]));
}

export const getUnit = (id) => get('SELECT * FROM units WHERE id=?', id);
