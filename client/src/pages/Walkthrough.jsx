import { useMemo, useState } from 'react';
import { ClipboardList, Printer, Lock, Unlock, Route, ArrowUp, ArrowDown, GripVertical, RotateCcw, ArrowDownUp, Save } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, dateTime, lienLabel } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Select, Checkbox, Modal, useAction, cx } from '../components/ui.jsx';

// Natural alphanumeric compare: A2 < A10 < B1
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const unitOrder = (a, b) => a.facility_id - b.facility_id || natural(a.number, b.number);
const walkOrder = (a, b) => a.facility_id - b.facility_id || (a.walk_order ?? 1e9) - (b.walk_order ?? 1e9) || natural(a.number, b.number);

export default function Walkthrough() {
  const { fac, facility, facilityObj, can } = useApp();
  const { data, reload } = useApi(fac('/walkthrough'));
  const [order, setOrderState] = useState(() => { try { return localStorage.getItem('pms_walk_sort') || 'unit'; } catch { return 'unit'; } });
  const setOrder = (o) => { setOrderState(o); try { localStorage.setItem('pms_walk_sort', o); } catch { /* ignore */ } };
  const [show, setShow] = useState('all');
  const [building, setBuilding] = useState('');
  const [hideVacant, setHideVacant] = useState(false);
  const [editing, setEditing] = useState(false);
  const rows = useMemo(() => (data?.rows || [])
    .filter((r) => (!building || r.building === building) && (!hideVacant || r.tenant) && (show === 'all' || (show === 'actions' && r.action && !r.action.startsWith('Verify')) || (show === 'pastdue' && r.daysLate > 0 && r.balance > 0) || (show === 'overlocked' && r.overlocked)))
    .sort(order === 'walk' ? walkOrder : unitOrder), [data, show, building, hideVacant, order]);
  if (!data) return <Spinner />;
  const toLock = data.rows.filter((r) => r.action === 'OVERLOCK');
  const toUnlock = data.rows.filter((r) => r.action.startsWith('REMOVE'));
  const buildings = [...new Set(data.rows.map((r) => r.building))].sort(natural);
  const hasRoute = data.rows.some((r) => r.walk_order);
  const canEdit = can('walkthrough.order') && facility !== 'all';

  return (
    <div>
      <PageHeader icon={ClipboardList} title="Walkthrough / Lock Check" subtitle="Print and walk the property — verify locks, overlocks and vacants"
        actions={<>
          {canEdit && <Button variant="secondary" icon={Route} onClick={() => setEditing(true)}>Set Walk Order</Button>}
          <Button icon={Printer} onClick={() => window.print()}>Print Walkthrough</Button>
        </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 no-print">
        <div className="card flex items-center gap-3 border-red-200 p-4"><Lock className="h-6 w-6 text-red-600" /><div><div className="text-sm font-semibold">{toLock.length} unit(s) need an overlock</div><div className="text-xs text-slate-500">{toLock.map((r) => r.number).join(', ') || 'None'}</div></div></div>
        <div className="card flex items-center gap-3 border-emerald-200 p-4"><Unlock className="h-6 w-6 text-emerald-600" /><div><div className="text-sm font-semibold">{toUnlock.length} overlock(s) to remove</div><div className="text-xs text-slate-500">{toUnlock.map((r) => r.number).join(', ') || 'None'}</div></div></div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 no-print">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 shadow-sm" role="radiogroup" aria-label="Print order">
          {[['unit', 'Unit order'], ['walk', 'Walk-through order']].map(([k, l]) => (
            <button key={k} role="radio" aria-checked={order === k} onClick={() => setOrder(k)} className={cx('rounded px-3 py-1.5 text-sm font-medium', order === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
          ))}
        </div>
        <Select className="w-auto" value={show} onChange={(e) => setShow(e.target.value)} options={[{ value: 'all', label: 'All units' }, { value: 'actions', label: 'Action needed only' }, { value: 'pastdue', label: 'Past due only' }, { value: 'overlocked', label: 'Overlocked only' }]} />
        <Select className="w-auto" value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="All buildings" options={buildings} />
        <Checkbox label="Hide vacant" checked={hideVacant} onChange={setHideVacant} />
        <span className="ml-auto text-xs text-slate-500">{rows.length} units</span>
      </div>
      {order === 'walk' && !hasRoute && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 no-print">No walk order has been set yet, so units are shown in unit order.{canEdit && ' Click “Set Walk Order” to create one.'}</div>}
      <Card bodyClass="">
        <div className="hidden px-4 pt-4 print:block">
          <div className="text-lg font-bold">Property Walkthrough – {facility === 'all' ? 'All facilities' : facilityObj?.name}</div>
          <div className="text-xs">Sorted by: <b>{order === 'walk' ? 'Walk-through order' : 'Unit order'}</b> · Generated {dateTime(data.generated)} · Walked by: ____________________ · Date/Time: ______________</div>
        </div>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50"><tr>{['✓', order === 'walk' ? 'Stop' : null, 'Unit', 'Size', 'Status', 'Tenant', 'Balance', 'Past Due', 'Lien Stage', 'Overlock', 'Action', 'Notes'].filter(Boolean).map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.action === 'OVERLOCK' ? 'bg-red-50' : r.action.startsWith('REMOVE') ? 'bg-emerald-50' : ''}>
                <td className="px-3 py-1.5"><span className="inline-block h-4 w-4 rounded border border-slate-400" /></td>
                {order === 'walk' && <td className="px-3 py-1.5 text-xs tabular-nums text-slate-500">{r.walk_order ?? '—'}</td>}
                <td className="px-3 py-1.5 font-semibold">{facility === 'all' && <span className="mr-1 text-xs text-slate-400">{r.facility_code}</span>}{r.number}</td>
                <td className="px-3 py-1.5">{r.size}</td>
                <td className="px-3 py-1.5 capitalize">{r.status}</td>
                <td className="px-3 py-1.5">{r.tenant || <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.tenant && !r.tenant.startsWith('Reserved') ? money(r.balance) : ''}</td>
                <td className="px-3 py-1.5">{r.pastDueStatus === 'Current' ? <span className="text-emerald-700">Current</span> : r.pastDueStatus && <span className="font-semibold text-red-600">{r.pastDueStatus}</span>}</td>
                <td className="px-3 py-1.5">{r.lien_status && r.lien_status !== 'current' ? lienLabel(r.lien_status) : ''}</td>
                <td className="px-3 py-1.5">{r.overlocked ? <Badge color="black">YES</Badge> : <span className="text-slate-400">No</span>}</td>
                <td className="px-3 py-1.5 text-xs font-semibold">{r.action === 'OVERLOCK' ? <span className="text-red-700">⚠ OVERLOCK</span> : r.action.startsWith('REMOVE') ? <span className="text-emerald-700">REMOVE OVERLOCK</span> : <span className="font-normal text-slate-500">{r.action}</span>}</td>
                <td className="w-40 px-3 py-1.5"><span className="block border-b border-dotted border-slate-300">&nbsp;</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {editing && <WalkOrderEditor units={data.rows} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setOrder('walk'); reload(); }} />}
    </div>
  );
}

/** Property manager's tool for building the walking route. */
function WalkOrderEditor({ units, onClose, onSaved }) {
  const { facility } = useApp();
  const [list, setList] = useState(() => [...units].sort(walkOrder));
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [run, busy] = useAction();
  const buildingsInit = [...new Set([...units].sort(walkOrder).map((u) => u.building))];
  const [bOrder, setBOrder] = useState(buildingsInit);
  const [desc, setDesc] = useState({});
  const [snake, setSnake] = useState(false);

  const move = (from, to) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setList(next);
  };
  const applyBuildings = () => {
    const next = [];
    bOrder.forEach((b, i) => {
      const down = snake ? (i % 2 === 1) !== !!desc[b] : !!desc[b];
      const us = units.filter((u) => u.building === b).sort((x, y) => natural(x.number, y.number));
      next.push(...(down ? us.reverse() : us));
    });
    setList(next);
  };
  const moveB = (i, d) => { const n = [...bOrder]; [n[i], n[i + d]] = [n[i + d], n[i]]; setBOrder(n); };

  return (
    <Modal open onClose={onClose} size="xl" title="Set walkthrough order"
      footer={<><Button variant="ghost" icon={RotateCcw} onClick={() => setList([...units].sort(unitOrder))}>Reset to unit order</Button><div className="flex-1" /><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Save} loading={busy} onClick={() => run(() => api.put('/walkthrough/order', { facility_id: Number(facility), unit_ids: list.map((u) => u.id) }).then(onSaved), 'Walk order saved')}>Save Walk Order</Button></>}>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-1 text-sm font-semibold">Quick arrange by building</div>
            <p className="mb-2 text-xs text-slate-500">Put buildings in the order you walk them and choose each one&rsquo;s direction, then click Apply. Fine-tune individual units on the right.</p>
            <ul className="space-y-1.5">
              {bOrder.map((b, i) => (
                <li key={b} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-sm">
                  <span className="w-5 text-xs text-slate-400">{i + 1}.</span>
                  <span className="flex-1 font-medium">Building {b}</span>
                  <button className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs" onClick={() => setDesc({ ...desc, [b]: !desc[b] })} title="Direction">{desc[b] ? 'High → Low' : 'Low → High'}</button>
                  <button disabled={i === 0} onClick={() => moveB(i, -1)} className="rounded p-0.5 hover:bg-white disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                  <button disabled={i === bOrder.length - 1} onClick={() => moveB(i, 1)} className="rounded p-0.5 hover:bg-white disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            <Checkbox className="mt-2" label="Snake (alternate direction every other building)" checked={snake} onChange={setSnake} />
            <Button className="mt-3 w-full" variant="secondary" icon={ArrowDownUp} onClick={applyBuildings}>Apply building order</Button>
          </div>
        </div>
        <div className="lg:col-span-3">
          <div className="mb-1 flex items-center justify-between text-sm"><span className="font-semibold">Walking route ({list.length} stops)</span><span className="text-xs text-slate-500">Drag rows, use the arrows, or type a stop number</span></div>
          <ol className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {list.map((u, i) => (
              <li key={u.id} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragEnd={() => { setDrag(null); setOver(null); }}
                onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}
                className={cx('flex items-center gap-2 bg-white px-2 py-1 text-sm', over === i && drag !== null && 'border-t-2 border-brand-500', drag === i && 'opacity-40')}>
                <GripVertical className="h-4 w-4 cursor-grab text-slate-300" />
                <input aria-label={`Stop number for ${u.number}`} className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right text-xs tabular-nums" defaultValue={i + 1} key={`${u.id}-${i}`}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= list.length && n - 1 !== i) move(i, n - 1); else e.target.value = i + 1; }} />
                <span className="w-16 font-semibold">{u.number}</span>
                <span className="flex-1 truncate text-xs text-slate-500">{u.size} · {u.tenant || u.status}</span>
                <button disabled={i === 0} onClick={() => move(i, i - 1)} className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${u.number} up`}><ArrowUp className="h-4 w-4" /></button>
                <button disabled={i === list.length - 1} onClick={() => move(i, i + 1)} className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${u.number} down`}><ArrowDown className="h-4 w-4" /></button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
}
