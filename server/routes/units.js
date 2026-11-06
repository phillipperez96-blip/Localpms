import { Router } from 'express';
import { all, get, insert, update, run, tx } from '../db.js';
import { scope, requirePerm, assertFacility } from '../auth.js';
import { today, round2 } from '../util.js';
import { inList, httpError, activeRentals, facilityConfig, fullName } from './helpers.js';
import { facilityAccounts, gateState, logActivity, EMPTY_ACCT } from '../core.js';
import { gateSetAccess, integrationStatus } from '../services/integrations.js';

const r = Router();

function unitsWithStatus(ids) {
  const units = all(`SELECT u.*, f.code facility_code FROM units u JOIN facilities f ON f.id=u.facility_id WHERE u.facility_id IN ${inList(ids)} ORDER BY u.facility_id, u.building, u.number`, ...ids);
  const rentals = new Map(activeRentals(ids).map((x) => [x.unit_id, x]));
  const reservations = new Map(all(`SELECT id, unit_id, first_name, last_name, reservation_expires FROM leads WHERE status='reserved' AND facility_id IN ${inList(ids)}`, ...ids).map((l) => [l.unit_id, l]));
  return units.map((u) => {
    const x = rentals.get(u.id);
    const res = reservations.get(u.id);
    return {
      ...u, size: `${u.width}x${u.length}`,
      rental: x ? { id: x.id, tenant_id: x.tenant_id, tenant: `${x.first_name} ${x.last_name}`, rent: x.rent, move_in_date: x.move_in_date, lien_status: x.lien_status, balance: x.account.balance, pastDue: x.account.pastDue, daysLate: x.account.daysLate, phone: x.phone, insured: x.insurance_premium > 0 } : null,
      reservation: res ? { lead_id: res.id, name: `${res.first_name} ${res.last_name}`, expires: res.reservation_expires } : null,
    };
  });
}

r.get('/units', requirePerm('units.view'), (req, res) => res.json(unitsWithStatus(scope(req))));

r.get('/units/:id', requirePerm('units.view'), (req, res) => {
  const u = get('SELECT * FROM units WHERE id=?', Number(req.params.id));
  if (!u) throw httpError(404, 'Unit not found');
  assertFacility(req, u.facility_id);
  const cur = unitsWithStatus([u.facility_id]).find((x) => x.id === u.id);
  const history = all('SELECT r.*, t.first_name, t.last_name FROM rentals r JOIN tenants t ON t.id=r.tenant_id WHERE r.unit_id=? ORDER BY r.move_in_date DESC', u.id);
  res.json({ ...cur, history });
});

const UNIT_FIELDS = ['number', 'building', 'unit_type', 'width', 'length', 'floor', 'door_type', 'street_rate', 'features', 'notes', 'map_x', 'map_y', 'map_w', 'map_h'];
r.post('/units', requirePerm('units.manage'), (req, res) => {
  const b = req.body;
  assertFacility(req, b.facility_id);
  if (get('SELECT 1 x FROM units WHERE facility_id=? AND number=?', b.facility_id, b.number)) throw httpError(400, 'Unit number already exists');
  const maxY = get('SELECT MAX(map_y+map_h) m FROM units WHERE facility_id=?', b.facility_id).m || 0;
  const data = Object.fromEntries(UNIT_FIELDS.filter((k) => b[k] !== undefined && b[k] !== '').map((k) => [k, b[k]]));
  const id = insert('units', { map_x: 0, map_y: maxY + 22, map_w: Number(b.width), map_h: Number(b.length), ...data, facility_id: b.facility_id, sqft: b.width * b.length, status: 'vacant' });
  logActivity({ facility_id: b.facility_id, user_id: req.user.id, entity_type: 'unit', entity_id: id, action: 'create', details: `Added unit ${b.number}` });
  res.json({ id });
});

r.put('/units/:id', requirePerm('units.manage', 'pastdue.manage'), (req, res) => {
  const u = get('SELECT * FROM units WHERE id=?', Number(req.params.id));
  if (!u) throw httpError(404, 'Unit not found');
  assertFacility(req, u.facility_id);
  const b = req.body, ch = {};
  const canManage = req.user.permissions.includes('units.manage');
  if (canManage) {
    for (const k of UNIT_FIELDS) if (b[k] !== undefined) ch[k] = b[k];
    if (b.width || b.length) ch.sqft = (b.width || u.width) * (b.length || u.length);
    if (b.status && ['vacant', 'unrentable'].includes(b.status)) {
      if (u.status === 'occupied') throw httpError(400, 'Unit is occupied');
      ch.status = b.status; ch.unrentable_reason = b.status === 'unrentable' ? b.unrentable_reason || 'Unrentable' : null;
    }
  }
  if (b.overlocked !== undefined) ch.overlocked = b.overlocked ? 1 : 0;
  update('units', u.id, ch);
  const what = b.overlocked !== undefined ? (b.overlocked ? 'Overlocked' : 'Overlock removed') : ch.status ? `Status → ${ch.status}` : 'Updated';
  logActivity({ facility_id: u.facility_id, user_id: req.user.id, entity_type: 'unit', entity_id: u.id, action: 'update', details: `${what} unit ${u.number}` });
  const rent = get("SELECT tenant_id FROM rentals WHERE unit_id=? AND status='active'", u.id);
  if (rent && b.overlocked !== undefined) logActivity({ facility_id: u.facility_id, user_id: req.user.id, entity_type: 'tenant', entity_id: rent.tenant_id, action: 'overlock', details: `${what} unit ${u.number}` });
  res.json({ ok: true });
});

r.get('/walkthrough', requirePerm('walkthrough.view'), (req, res) => {
  const ids = scope(req);
  const units = unitsWithStatus(ids);
  const facs = Object.fromEntries(ids.map((id) => [id, facilityConfig(id)]));
  const rows = units.map((u) => {
    const f = facs[u.facility_id];
    const olDay = f.lien_steps.find((s) => s.overlock)?.day ?? 999;
    let action = '';
    if (u.rental && u.rental.daysLate >= olDay && u.rental.balance > 0 && !u.overlocked) action = 'OVERLOCK';
    else if (u.overlocked && (!u.rental || u.rental.balance <= 0)) action = u.rental ? 'REMOVE OVERLOCK' : 'REMOVE OVERLOCK (vacant)';
    else if (u.status === 'vacant' && !u.rental) action = 'Verify vacant & unlocked';
    return {
      id: u.id, facility_id: u.facility_id, facility_code: u.facility_code, number: u.number, building: u.building, size: u.size, unit_type: u.unit_type, status: u.status,
      tenant: u.rental?.tenant || (u.reservation ? `Reserved: ${u.reservation.name}` : ''), balance: u.rental?.balance ?? 0, daysLate: u.rental?.daysLate ?? 0,
      pastDueStatus: !u.rental ? '' : u.rental.daysLate > 0 && u.rental.balance > 0 ? `${u.rental.daysLate} days` : 'Current',
      lien_status: u.rental?.lien_status || '', overlocked: !!u.overlocked, action, walk_order: u.walk_order,
    };
  });
  res.json({ rows, generated: new Date().toISOString(), facilities: ids.map((id) => ({ id, name: facs[id].name })) });
});

/** Save the property manager's walking route: unit_ids in the order they should be walked. */
r.put('/walkthrough/order', requirePerm('walkthrough.order'), (req, res) => {
  const fid = Number(req.body.facility_id);
  assertFacility(req, fid);
  const ids = (req.body.unit_ids || []).map(Number);
  const units = new Set(all('SELECT id FROM units WHERE facility_id=?', fid).map((u) => u.id));
  if (ids.length !== units.size || ids.some((id) => !units.has(id)) || new Set(ids).size !== ids.length) throw httpError(400, 'The walk order must list each unit of this facility once');
  tx(() => {
    run('UPDATE units SET walk_order=NULL WHERE facility_id=?', fid);
    ids.forEach((id, i) => run('UPDATE units SET walk_order=? WHERE id=?', i + 1, id));
  });
  logActivity({ facility_id: fid, user_id: req.user.id, entity_type: 'unit', action: 'walk_order', details: `Walkthrough order updated (${ids.length} units)` });
  res.json({ ok: true });
});

// ---------- gate ----------
r.get('/gate', requirePerm('gate.manage'), (req, res) => {
  const ids = scope(req);
  const accts = facilityAccounts(ids);
  const facs = Object.fromEntries(ids.map((id) => [id, facilityConfig(id)]));
  const tenants = all(`SELECT t.*, (SELECT group_concat(u.number, ', ') FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.tenant_id=t.id AND r.status='active') units FROM tenants t WHERE t.facility_id IN ${inList(ids)} AND t.status='active' ORDER BY t.last_name`, ...ids);
  const rows = tenants.map((t) => {
    const a = accts.get(t.id) || EMPTY_ACCT;
    const g = gateState(t, a, facs[t.facility_id], !!t.units);
    return { id: t.id, facility_id: t.facility_id, name: fullName(t), units: t.units, gate_code: t.gate_code, gate_access: t.gate_access, allowed: g.allowed, reason: g.reason, daysLate: a.daysLate, balance: a.balance, synced: t.gate_last_state === (g.allowed ? 'allowed' : 'denied') };
  });
  const events = all(`SELECT e.*, t.first_name, t.last_name, u.number FROM gate_events e LEFT JOIN tenants t ON t.id=e.tenant_id LEFT JOIN units u ON u.id=e.unit_id WHERE e.facility_id IN ${inList(ids)} ORDER BY e.created_at DESC LIMIT 150`, ...ids);
  res.json({ rows, events, settings: ids.map((id) => ({ id, name: facs[id].name, gate_deny_days: facs[id].gate_deny_days, gate_hours: facs[id].gate_hours })), connected: integrationStatus().gate.connected });
});

r.post('/gate/sync', requirePerm('gate.manage'), async (req, res) => {
  const ids = scope(req);
  const accts = facilityAccounts(ids);
  let pushed = 0;
  for (const id of ids) {
    const f = facilityConfig(id);
    for (const t of all("SELECT t.*, (SELECT COUNT(*) FROM rentals r WHERE r.tenant_id=t.id AND r.status='active') n FROM tenants t WHERE t.facility_id=? AND t.status='active'", id)) {
      const g = gateState(t, accts.get(t.id) || EMPTY_ACCT, f, t.n > 0);
      const s = g.allowed ? 'allowed' : 'denied';
      if (t.gate_last_state !== s || req.body.full) {
        await gateSetAccess({ facilityId: id, code: t.gate_code, allowed: g.allowed, tenantName: fullName(t) });
        update('tenants', t.id, { gate_last_state: s }); pushed++;
      }
    }
    logActivity({ facility_id: id, user_id: req.user.id, entity_type: 'gate', action: 'sync', details: `Gate sync pushed ${pushed} code(s)` });
  }
  res.json({ pushed });
});

r.post('/gate/simulate', requirePerm('gate.manage'), (req, res) => {
  // Demo helper: simulate a keypad entry to show how codes are evaluated.
  const ids = scope(req);
  const t = get(`SELECT * FROM tenants WHERE gate_code=? AND facility_id IN ${inList(ids)}`, ...[String(req.body.code || '')], ...ids);
  let event = 'entry_denied', detail = 'Unknown code';
  if (t) {
    const f = facilityConfig(t.facility_id);
    const acct = facilityAccounts([t.facility_id]).get(t.id) || EMPTY_ACCT;
    const g = gateState(t, acct, f, !!get("SELECT 1 x FROM rentals WHERE tenant_id=? AND status='active'", t.id));
    event = g.allowed ? 'entry' : 'entry_denied'; detail = g.allowed ? 'Keypad (simulated)' : `Denied – ${g.reason}`;
  }
  insert('gate_events', { facility_id: t?.facility_id || ids[0], tenant_id: t?.id, code: req.body.code, event, detail });
  res.json({ event, detail, tenant: t ? fullName(t) : null });
});

export default r;
export { unitsWithStatus };
