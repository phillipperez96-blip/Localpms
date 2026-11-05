import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Map as MapIcon, List, X, DoorOpen, User, Lock, Unlock, Ban, CheckCircle2, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, date, lienLabel } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Tabs, Field, Input, Select, Modal, KV, useAction, cx, lienColor } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

export const unitState = (u) => {
  if (u.status === 'unrentable') return 'unrentable';
  if (u.status === 'reserved') return 'reserved';
  if (u.status === 'vacant') return u.overlocked ? 'vacant_locked' : 'vacant';
  if (u.rental && u.rental.daysLate > 0 && u.rental.balance > 0) return u.rental.daysLate >= 30 ? 'pastdue30' : 'pastdue';
  return 'occupied';
};
export const STATE_STYLE = {
  occupied: { fill: '#dbeafe', stroke: '#2a78d6', label: 'Occupied – current' },
  pastdue: { fill: '#fef3c7', stroke: '#c98500', label: 'Past due (1–29 days)' },
  pastdue30: { fill: '#fee2e2', stroke: '#e34948', label: 'Past due (30+ days)' },
  vacant: { fill: '#dcfce7', stroke: '#1baf7a', label: 'Vacant' },
  vacant_locked: { fill: '#dcfce7', stroke: '#0f172a', label: 'Vacant – lock on unit' },
  reserved: { fill: '#ede9fe', stroke: '#6250d6', label: 'Reserved' },
  unrentable: { fill: '#e2e8f0', stroke: '#64748b', label: 'Unrentable' },
};

export default function Units() {
  const { fac, facility, can } = useApp();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(facility === 'all' ? 'list' : 'map');
  const { data, loading, reload } = useApi(fac('/units'));
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const statusFilter = sp.get('status') || '';
  useEffect(() => { const id = Number(sp.get('unit')); if (id && data) setSel(data.find((u) => u.id === id) || null); }, [sp, data]);
  useEffect(() => { if (facility === 'all') setTab('list'); }, [facility]);
  const selected = sel && data?.find((u) => u.id === sel.id);

  return (
    <div>
      <PageHeader icon={MapIcon} title="Units & Site Map" subtitle={data ? `${data.length} units` : ''} actions={can('units.manage') && facility !== 'all' && <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>Add Unit</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'map', label: 'Site Map', icon: MapIcon }, { value: 'list', label: 'Unit List', icon: List }]} />
      {loading && !data ? <Spinner /> : tab === 'map' ? (
        facility === 'all' ? <Card><p className="text-sm text-slate-500">Select a single facility to view its site map.</p></Card> : <SiteMap units={data} onSelect={setSel} selected={selected} />
      ) : (
        <Card bodyClass="">
          <DataTable rows={(data || []).filter((u) => !statusFilter || u.status === statusFilter)} exportName="units" onRowClick={setSel} pageSize={50}
            toolbar={statusFilter && <Badge color="blue">Status: {statusFilter} <button onClick={() => setSp({})}><X className="h-3 w-3" /></button></Badge>}
            columns={[
              { key: 'number', label: 'Unit', render: (u) => <span className="font-medium">{u.number}</span> },
              facility === 'all' && { key: 'facility_code', label: 'Fac' },
              { key: 'size', label: 'Size', sortValue: (u) => u.sqft }, { key: 'unit_type', label: 'Type' },
              { key: 'status', label: 'Status', render: (u) => { const s = STATE_STYLE[unitState(u)]; return <span className="inline-flex items-center gap-1.5 text-xs"><span className="h-2.5 w-2.5 rounded-sm border" style={{ background: s.fill, borderColor: s.stroke }} />{s.label}</span>; } },
              { key: 'tenant', label: 'Tenant', sortValue: (u) => u.rental?.tenant || '', searchValue: (u) => u.rental?.tenant || u.reservation?.name, csv: (u) => u.rental?.tenant || '', render: (u) => u.rental?.tenant || (u.reservation && <span className="text-violet-700">Reserved: {u.reservation.name}</span>) || '' },
              { key: 'street_rate', label: 'Street', align: 'right', render: (u) => money(u.street_rate) },
              { key: 'rent', label: 'Rent', align: 'right', sortValue: (u) => u.rental?.rent ?? null, csv: (u) => u.rental?.rent ?? '', render: (u) => (u.rental ? money(u.rental.rent) : '') },
              { key: 'balance', label: 'Balance', align: 'right', sortValue: (u) => u.rental?.balance ?? null, csv: (u) => u.rental?.balance ?? '', render: (u) => (u.rental ? <span className={u.rental.daysLate > 0 && u.rental.balance > 0 ? 'text-red-600' : ''}>{money(u.rental.balance)}</span> : '') },
              { key: 'overlocked', label: 'Lock', render: (u) => (u.overlocked ? <Badge color="black">Overlocked</Badge> : '') },
            ].filter(Boolean)} />
        </Card>
      )}
      {selected && <UnitPanel u={selected} onClose={() => { setSel(null); if (sp.get('unit')) setSp({}); }} reload={reload} />}
      {adding && <AddUnit onClose={() => setAdding(false)} reload={reload} />}
    </div>
  );
}

function SiteMap({ units, onSelect, selected }) {
  const [zoom, setZoom] = useState(1);
  const [type, setType] = useState('');
  const [hover, setHover] = useState(null);
  const buildings = useMemo(() => {
    const b = {};
    for (const u of units) {
      const g = (b[u.building] ||= { name: u.building, minX: Infinity, minY: Infinity, maxX: 0, maxY: 0, type: u.unit_type });
      g.minX = Math.min(g.minX, u.map_x); g.minY = Math.min(g.minY, u.map_y); g.maxX = Math.max(g.maxX, u.map_x + u.map_w); g.maxY = Math.max(g.maxY, u.map_y + u.map_h);
    }
    return Object.values(b);
  }, [units]);
  const W = Math.max(...units.map((u) => u.map_x + u.map_w)) + 40, H = Math.max(...units.map((u) => u.map_y + u.map_h)) + 10;
  const counts = units.reduce((a, u) => { const s = unitState(u); a[s] = (a[s] || 0) + 1; return a; }, {});
  const types = [...new Set(units.map((u) => u.unit_type))];

  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5">
        {Object.entries(STATE_STYLE).map(([k, s]) => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-slate-600"><span className="h-3 w-3 rounded-sm border-2" style={{ background: s.fill, borderColor: s.stroke }} />{s.label} <b>{counts[k] || 0}</b></span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-slate-600"><span className="h-3 w-3 rounded-sm border-[3px] border-slate-900 bg-white" />Overlocked</span>
        <div className="ml-auto flex items-center gap-1">
          <Select className="w-auto py-1 text-xs" value={type} onChange={(e) => setType(e.target.value)} placeholder="Highlight: all types" options={types} />
          <button className="rounded border border-slate-200 p-1.5 hover:bg-slate-50" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut className="h-4 w-4" /></button>
          <button className="rounded border border-slate-200 p-1.5 hover:bg-slate-50" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><ZoomIn className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="relative overflow-auto bg-slate-50 p-4" style={{ maxHeight: '70vh' }}>
        <svg width={W * 3.2 * zoom} viewBox={`-30 -14 ${W} ${H + 14}`} className="block select-none">
          {buildings.map((b) => (
            <g key={b.name}>
              <rect x={b.minX - 2} y={b.minY - 2} width={b.maxX - b.minX + 4} height={b.maxY - b.minY + 4} rx="2" fill="#fff" stroke="#cbd5e1" strokeWidth="0.6" />
              <text x={b.minX - 6} y={(b.minY + b.maxY) / 2} textAnchor="end" dominantBaseline="middle" fontSize="7" fontWeight="700" fill="#334155">{b.name}</text>
              <text x={b.minX} y={b.minY - 4} fontSize="3.2" fill="#64748b">{b.type}</text>
            </g>
          ))}
          {units.map((u) => {
            const s = STATE_STYLE[unitState(u)];
            const dim = type && u.unit_type !== type;
            const isSel = selected?.id === u.id;
            return (
              <g key={u.id} onClick={() => onSelect(u)} onMouseEnter={() => setHover(u)} onMouseLeave={() => setHover(null)} className="cursor-pointer" opacity={dim ? 0.25 : 1}>
                <rect x={u.map_x + 0.4} y={u.map_y + 0.4} width={u.map_w - 0.8} height={u.map_h - 0.8} rx="0.8" fill={s.fill} stroke={u.overlocked ? '#0f172a' : isSel ? '#0f172a' : s.stroke} strokeWidth={u.overlocked ? 1.4 : isSel ? 1.2 : 0.5} />
                <text x={u.map_x + u.map_w / 2} y={u.map_y + u.map_h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={u.map_w <= 5 ? 1.7 : 2.4} fill="#0f172a" pointerEvents="none">{u.number.slice(1)}</text>
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="pointer-events-none fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
            <b>{hover.number}</b> · {hover.size} {hover.unit_type} · {money(hover.street_rate)} · {hover.rental ? `${hover.rental.tenant} (${money(hover.rental.balance)})` : hover.reservation ? `Reserved – ${hover.reservation.name}` : hover.status}
          </div>
        )}
      </div>
    </Card>
  );
}

function UnitPanel({ u, onClose, reload }) {
  const { can } = useApp();
  const nav = useNavigate();
  const [run, busy] = useAction();
  const [rate, setRate] = useState(u.street_rate);
  const [reason, setReason] = useState('');
  const { data: detail } = useApi(`/units/${u.id}`);
  const s = STATE_STYLE[unitState(u)];
  const put = (body, msg) => run(() => api.put(`/units/${u.id}`, body).then(reload), msg);
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div><div className="text-lg font-bold">Unit {u.number}</div><div className="text-sm text-slate-500">{u.size} · {u.unit_type} · {u.sqft} sq ft</div></div>
        <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-md border-2 px-2 py-0.5 text-xs font-medium" style={{ background: s.fill, borderColor: s.stroke }}>{s.label}</span>{u.overlocked ? <Badge color="black">Overlocked</Badge> : null}{u.unrentable_reason && <Badge>{u.unrentable_reason}</Badge>}</div>
        <KV items={[['Street rate', money(u.street_rate)], ['Door', u.door_type], ['Building', u.building], ['Features', u.features]]} />
        {u.rental && (
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between"><div className="font-semibold">{u.rental.tenant}</div><Badge color={lienColor(u.rental.lien_status)}>{lienLabel(u.rental.lien_status)}</Badge></div>
            <KV items={[['Rent', money(u.rental.rent)], ['Balance', money(u.rental.balance)], ['Days late', u.rental.daysLate || 'Current'], ['Since', date(u.rental.move_in_date)], ['Phone', u.rental.phone], ['Protection', u.rental.insured ? 'Yes' : 'No']]} />
            <Button className="mt-3 w-full" variant="secondary" icon={User} onClick={() => nav(`/tenants/${u.rental.tenant_id}`)}>Open Tenant Account</Button>
          </div>
        )}
        {u.reservation && <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">Reserved for <b>{u.reservation.name}</b> until {date(u.reservation.expires)}</div>}
        <div className="grid gap-2">
          {(u.status === 'vacant' || u.status === 'reserved') && can('movein.perform') && <Button variant="success" icon={DoorOpen} onClick={() => nav(`/move-in?unit=${u.id}${u.reservation ? `&lead=${u.reservation.lead_id}` : ''}`)}>Move In to {u.number}</Button>}
          {can('pastdue.manage') && <Button variant="secondary" icon={u.overlocked ? Unlock : Lock} loading={busy} onClick={() => put({ overlocked: !u.overlocked }, u.overlocked ? 'Overlock removed' : 'Overlocked')}>{u.overlocked ? 'Remove Overlock' : 'Mark Overlocked'}</Button>}
        </div>
        {can('units.manage') && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manage unit</div>
            <div className="flex items-end gap-2"><Field label="Street rate (this unit only)" className="flex-1"><Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></Field><Button variant="secondary" loading={busy} onClick={() => put({ street_rate: Number(rate) }, 'Rate updated')}>Save</Button></div>
            {u.status === 'vacant' && <div className="flex items-end gap-2"><Field label="Reason" className="flex-1"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Door damaged" /></Field><Button variant="secondary" icon={Ban} loading={busy} onClick={() => put({ status: 'unrentable', unrentable_reason: reason }, 'Marked unrentable')}>Unrentable</Button></div>}
            {u.status === 'unrentable' && <Button variant="secondary" icon={CheckCircle2} loading={busy} onClick={() => put({ status: 'vacant' }, 'Unit is rentable')}>Mark Rentable</Button>}
          </div>
        )}
        {detail?.history?.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Rental history</div>
            {detail.history.map((h) => <div key={h.id} className="flex justify-between py-1 text-sm"><button className="link" onClick={() => nav(`/tenants/${h.tenant_id}`)}>{h.first_name} {h.last_name}</button><span className="text-xs text-slate-500">{date(h.move_in_date)} – {h.move_out_date ? date(h.move_out_date) : 'present'}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function AddUnit({ onClose, reload }) {
  const { facility } = useApp();
  const [f, setF] = useState({ number: '', building: '', unit_type: 'Drive-Up', width: 10, length: 10, street_rate: '', door_type: 'Roll-Up', features: '' });
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title="Add unit" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.post('/units', { ...f, facility_id: Number(facility), width: Number(f.width), length: Number(f.length), street_rate: Number(f.street_rate) }).then(() => { reload(); onClose(); }), 'Unit added')}>Add Unit</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Unit number"><Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
        <Field label="Building"><Input value={f.building} onChange={(e) => setF({ ...f, building: e.target.value })} /></Field>
        <Field label="Type"><Select value={f.unit_type} onChange={(e) => setF({ ...f, unit_type: e.target.value })} options={['Climate Controlled', 'Drive-Up', 'Parking', 'Locker', 'Wine Storage', 'Office / Commercial']} /></Field>
        <Field label="Door"><Select value={f.door_type} onChange={(e) => setF({ ...f, door_type: e.target.value })} options={['Roll-Up', 'Swing', 'Interior', 'Open']} /></Field>
        <Field label="Width (ft)"><Input type="number" value={f.width} onChange={(e) => setF({ ...f, width: e.target.value })} /></Field>
        <Field label="Length (ft)"><Input type="number" value={f.length} onChange={(e) => setF({ ...f, length: e.target.value })} /></Field>
        <Field label="Street rate"><Input type="number" value={f.street_rate} onChange={(e) => setF({ ...f, street_rate: e.target.value })} /></Field>
        <Field label="Features"><Input value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">New units are placed at the bottom of the site map.</p>
    </Modal>
  );
}
