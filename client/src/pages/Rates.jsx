import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Tag, CalendarClock, Plus, Edit, X } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, date, pct, today, addDays, dateTime } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Tabs, Modal, Field, Input, Select, Textarea, Checkbox, useAction } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

export default function Rates() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'street';
  return (
    <div>
      <PageHeader icon={TrendingUp} title="Rate Management" subtitle="Street rates, existing-customer rate increases and promotions" />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ value: 'street', label: 'Street Rates', icon: Tag }, { value: 'ecri', label: 'Rent Increase Candidates', icon: TrendingUp }, { value: 'increases', label: 'Scheduled Increases', icon: CalendarClock }, { value: 'promos', label: 'Promotions', icon: Tag }]} />
      {tab === 'street' && <Street />}
      {tab === 'ecri' && <ECRI onDone={() => setSp({ tab: 'increases' })} />}
      {tab === 'increases' && <Increases />}
      {tab === 'promos' && <Promos />}
    </div>
  );
}

function Street() {
  const { fac, facility, facilities } = useApp();
  const { data, reload } = useApi(fac('/rates'));
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Spinner />;
  const fname = (id) => facilities.find((f) => f.id === id)?.code;
  return (
    <div className="space-y-4">
      <Card bodyClass="">
        <DataTable rows={data.rows} rowKey="key" exportName="street-rates" pageSize={50} columns={[
          facility === 'all' && { key: 'facility_id', label: 'Fac', render: (r) => fname(r.facility_id) },
          { key: 'unit_type', label: 'Type' }, { key: 'size', label: 'Size', sortValue: (r) => r.sqft },
          { key: 'total', label: 'Units', align: 'right' }, { key: 'vacant', label: 'Vacant', align: 'right' },
          { key: 'occupancy', label: 'Occupancy', align: 'right', render: (r) => <div className="flex items-center justify-end gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${r.occupancy}%`, background: r.occupancy >= 92 ? '#008300' : r.occupancy < 75 ? '#e34948' : '#2a78d6' }} /></div>{pct(r.occupancy, 0)}</div> },
          { key: 'street_rate', label: 'Street Rate', align: 'right', render: (r) => <span className="font-semibold">{money(r.street_rate)}{r.mixed && <span className="text-xs text-amber-600" title="Units in this group have different rates">*</span>}</span> },
          { key: 'per_sqft', label: '$/sq ft', align: 'right', render: (r) => money(r.per_sqft) },
          { key: 'avg_in_place', label: 'Avg In-Place', align: 'right', render: (r) => (r.avg_in_place ? money(r.avg_in_place) : '—') },
          { key: 'variance', label: 'vs Street', align: 'right', render: (r) => (r.variance !== null ? <span className={r.variance < 0 ? 'text-red-600' : 'text-emerald-600'}>{money(r.variance)}</span> : '—') },
          { key: 'suggestion', label: 'Insight', sortable: false, csv: (r) => r.suggestion?.text || '', render: (r) => r.suggestion && <span className={`flex items-center gap-1 text-xs ${r.suggestion.dir === 'up' ? 'text-emerald-700' : 'text-amber-700'}`}>{r.suggestion.dir === 'up' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{r.suggestion.text}</span> },
          { key: 'act', label: '', sortable: false, csv: false, render: (r) => <Button size="sm" variant="secondary" icon={Edit} onClick={() => setEdit({ ...r, new_rate: r.street_rate })}>Change</Button> },
        ].filter(Boolean)} />
      </Card>
      <Card title="Recent street rate changes" bodyClass="">
        <DataTable rows={data.history} searchable={false} pageSize={10} columns={[{ key: 'created_at', label: 'When', render: (h) => dateTime(h.created_at) }, { key: 'unit_type', label: 'Type' }, { key: 'size', label: 'Size' }, { key: 'old_rate', label: 'Old', align: 'right', render: (h) => money(h.old_rate) }, { key: 'new_rate', label: 'New', align: 'right', render: (h) => money(h.new_rate) }, { key: 'unit_count', label: 'Units', align: 'right' }, { key: 'user_name', label: 'By' }]} />
      </Card>
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title={`${edit.size} ${edit.unit_type} – street rate`} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.put('/rates', { facility_id: edit.facility_id, unit_type: edit.unit_type, size: edit.size, street_rate: Number(edit.new_rate) }).then(() => { setEdit(null); reload(); }), 'Street rate updated')}>Update {edit.total} units</Button></>}>
          <div className="mb-3 text-sm text-slate-600">{edit.occupied}/{edit.total} occupied ({pct(edit.occupancy, 0)}) · avg in-place {money(edit.avg_in_place)}</div>
          <Field label="New street rate"><Input type="number" value={edit.new_rate} onChange={(e) => setEdit({ ...edit, new_rate: e.target.value })} autoFocus /></Field>
          <div className="mt-2 flex gap-1.5">{[-10, -5, 5, 10].map((p) => <button key={p} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50" onClick={() => setEdit({ ...edit, new_rate: Math.round(edit.street_rate * (1 + p / 100)) })}>{p > 0 ? '+' : ''}{p}%</button>)}</div>
          <p className="mt-3 text-xs text-slate-500">Street rates apply to new move-ins. Existing tenants keep their current rent until you schedule a rent increase.</p>
        </Modal>
      )}
    </div>
  );
}

function ECRI({ onDone }) {
  const { fac, facility } = useApp();
  const [q, setQ] = useState({ minMonths: 12, minGap: 10, pct: 9 });
  const { data, loading } = useApi(fac(`/rates/ecri-candidates?minMonths=${q.minMonths}&minGap=${q.minGap}&pct=${q.pct}`));
  const [sel, setSel] = useState(new Set());
  const [overrides, setOverrides] = useState({});
  const [sched, setSched] = useState(null);
  const [run, busy] = useAction();
  const rows = (data || []).map((r) => ({ ...r, new_rent: overrides[r.rental_id] ?? r.new_rent }));
  const chosen = rows.filter((r) => sel.has(r.rental_id));
  const lift = chosen.reduce((s, r) => s + (r.new_rent - r.rent), 0);
  return (
    <Card bodyClass="">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-3">
        <Field label="Min. months as tenant"><Input type="number" className="w-28" value={q.minMonths} onChange={(e) => setQ({ ...q, minMonths: e.target.value })} /></Field>
        <Field label="Min. % below street"><Input type="number" className="w-28" value={q.minGap} onChange={(e) => setQ({ ...q, minGap: e.target.value })} /></Field>
        <Field label="Increase %"><Input type="number" className="w-24" value={q.pct} onChange={(e) => setQ({ ...q, pct: e.target.value })} /></Field>
        <div className="ml-auto text-right text-sm">{sel.size > 0 && <><div>{sel.size} selected · <b className="text-emerald-700">+{money(lift)}/mo</b> (+{money(lift * 12)}/yr)</div><Button className="mt-1" size="sm" onClick={() => setSched({ notice_date: today(), effective_date: addDays(today(), 30), sendNotice: true })}>Schedule Increases</Button></>}</div>
      </div>
      <div className="px-3 pt-2 text-xs text-slate-500">Tenants who are current, have been with you at least the minimum months, have no increase in the last 12 months, and pay below street rate.</div>
      {loading && !data ? <Spinner /> : (
        <DataTable rows={rows} rowKey="rental_id" selectable selected={sel} onSelectedChange={setSel} exportName="ecri-candidates" columns={[
          { key: 'name', label: 'Tenant', render: (r) => <Link className="link" to={`/tenants/${r.tenant_id}`}>{r.name}</Link> }, { key: 'unit', label: 'Unit' }, { key: 'size', label: 'Size' },
          { key: 'months', label: 'Tenure', align: 'right', render: (r) => `${r.months} mo` }, { key: 'rent', label: 'Current', align: 'right', render: (r) => money(r.rent) },
          { key: 'street_rate', label: 'Street', align: 'right', render: (r) => money(r.street_rate) }, { key: 'gap_pct', label: 'Below Street', align: 'right', render: (r) => pct(r.gap_pct, 0) },
          { key: 'new_rent', label: 'New Rent', align: 'right', render: (r) => <input type="number" className="input w-24 py-1 text-right" value={r.new_rent} onClick={(e) => e.stopPropagation()} onChange={(e) => setOverrides({ ...overrides, [r.rental_id]: Number(e.target.value) })} /> },
          { key: 'inc', label: 'Change', align: 'right', sortValue: (r) => r.new_rent - r.rent, render: (r) => <span className="text-emerald-700">+{money(r.new_rent - r.rent)}</span> },
        ]} />
      )}
      {sched && (
        <Modal open onClose={() => setSched(null)} size="sm" title={`Schedule ${chosen.length} rent increase(s)`} footer={<><Button variant="secondary" onClick={() => setSched(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.post('/rates/increases', { ...sched, items: chosen.map((r) => ({ rental_id: r.rental_id, new_rent: r.new_rent })) }).then((r) => { setSched(null); setSel(new Set()); onDone(); return r; }), (r) => `${r.scheduled} increases scheduled`)}>Schedule</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Notice date"><Input type="date" value={sched.notice_date} onChange={(e) => setSched({ ...sched, notice_date: e.target.value })} /></Field>
            <Field label="Effective date"><Input type="date" value={sched.effective_date} onChange={(e) => setSched({ ...sched, effective_date: e.target.value })} /></Field>
          </div>
          <Checkbox className="mt-3" label="Send rent increase notice letters now" checked={sched.sendNotice} onChange={(v) => setSched({ ...sched, sendNotice: v })} />
          <p className="mt-2 text-xs text-slate-500">Most states require at least 30 days notice. The new rent is applied automatically on the effective date by nightly processing.</p>
        </Modal>
      )}
    </Card>
  );
}

function Increases() {
  const { fac } = useApp();
  const { data, reload } = useApi(fac('/rates/increases'));
  const [run] = useAction();
  if (!data) return <Spinner />;
  return (
    <Card bodyClass="">
      <DataTable rows={data} exportName="rent-increases" columns={[
        { key: 'name', label: 'Tenant', sortValue: (r) => r.last_name, csv: (r) => `${r.first_name} ${r.last_name}`, render: (r) => <Link className="link" to={`/tenants/${r.tenant_id}`}>{r.first_name} {r.last_name}</Link> }, { key: 'number', label: 'Unit' },
        { key: 'old_rent', label: 'Old', align: 'right', render: (r) => money(r.old_rent) }, { key: 'new_rent', label: 'New', align: 'right', render: (r) => money(r.new_rent) },
        { key: 'pct', label: '%', align: 'right', sortValue: (r) => r.new_rent / r.old_rent, render: (r) => pct(((r.new_rent - r.old_rent) / r.old_rent) * 100) },
        { key: 'notice_date', label: 'Notice', render: (r) => date(r.notice_date) }, { key: 'effective_date', label: 'Effective', render: (r) => date(r.effective_date) },
        { key: 'status', label: 'Status', render: (r) => <Badge color={{ scheduled: 'blue', applied: 'green', cancelled: 'gray' }[r.status]}>{r.status}</Badge> }, { key: 'user_name', label: 'By' },
        { key: 'act', label: '', sortable: false, csv: false, render: (r) => r.status === 'scheduled' && <Button size="sm" variant="ghost" icon={X} onClick={() => confirm('Cancel this increase?') && run(() => api.put(`/rates/increases/${r.id}`, { status: 'cancelled' }).then(reload), 'Increase cancelled')}>Cancel</Button> },
      ]} />
    </Card>
  );
}

function Promos() {
  const { facility, fac } = useApp();
  const { data, reload } = useApi(fac('/promotions'));
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Spinner />;
  const desc = (p) => (p.discount_type === 'percent' ? `${p.value}% off` : p.discount_type === 'fixed_price' ? `${money(p.value)} rent` : `${money(p.value)} off`) + ` for ${p.months} month(s)`;
  return (
    <Card bodyClass="" title="Move-in promotions" actions={facility !== 'all' && <Button size="sm" icon={Plus} onClick={() => setEdit({ name: '', description: '', discount_type: 'percent', value: 50, months: 1, active: 1 })}>New Promotion</Button>}>
      <DataTable rows={data} searchable={false} onRowClick={(p) => setEdit({ ...p })} columns={[
        { key: 'name', label: 'Name', render: (p) => <span className="font-medium">{p.name}</span> }, { key: 'description', label: 'Description' },
        { key: 'terms', label: 'Discount', render: desc }, { key: 'active', label: 'Status', render: (p) => (p.active ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>) },
      ]} />
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit promotion' : 'New promotion'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => (edit.id ? api.put(`/promotions/${edit.id}`, edit) : api.post('/promotions', { ...edit, facility_id: Number(facility) })).then(() => { setEdit(null); reload(); }), 'Promotion saved')}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Input value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Discount type"><Select value={edit.discount_type} onChange={(e) => setEdit({ ...edit, discount_type: e.target.value })} options={[{ value: 'percent', label: 'Percent off' }, { value: 'amount_off', label: 'Dollar amount off' }, { value: 'fixed_price', label: 'Fixed rent (e.g. $1)' }]} /></Field>
            <Field label="Value"><Input type="number" value={edit.value} onChange={(e) => setEdit({ ...edit, value: Number(e.target.value) })} /></Field>
            <Field label="Number of months"><Input type="number" min="1" value={edit.months} onChange={(e) => setEdit({ ...edit, months: Number(e.target.value) })} /></Field>
            <div className="flex items-end"><Checkbox label="Active" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v ? 1 : 0 })} /></div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
