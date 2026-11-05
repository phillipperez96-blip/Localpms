import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PhoneCall, Plus, Columns3, List, Mail, Phone, CalendarClock, DoorOpen, Bookmark, XCircle, Trash2 } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, date, today, addDays, dateTime, titleCase } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Tabs, Modal, Field, Input, Select, Textarea, Checkbox, useAction, Empty, cx } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import ComposeModal from '../components/Compose.jsx';

const STAGES = [
  { key: 'new', label: 'New', color: 'blue' }, { key: 'contacted', label: 'Contacted', color: 'amber' }, { key: 'reserved', label: 'Reserved', color: 'purple' },
  { key: 'converted', label: 'Moved In', color: 'green' }, { key: 'lost', label: 'Lost', color: 'gray' },
];
const SOURCES = ['Website', 'Phone Call', 'Walk-In', 'Google', 'SpareFoot', 'Referral', 'Drive-By', 'Facebook', 'Other'];
const SIZES = ['5x5', '5x10', '10x10', '10x15', '10x20', '10x30', '12x40'];

export default function Leads() {
  const { fac, facility } = useApp();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState('board');
  const { data, loading, reload } = useApi(fac('/leads'));
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (sp.get('open')) setOpenId(Number(sp.get('open'))); if (sp.get('new')) setCreating(true); }, [sp]);
  const close = () => { setOpenId(null); setCreating(false); setSp({}); };
  const T = today();

  return (
    <div>
      <PageHeader icon={PhoneCall} title="Leads & Reservations" subtitle="Track every inquiry from first call to move-in" actions={<Button icon={Plus} onClick={() => setCreating(true)}>New Lead</Button>} />
      <Tabs value={view} onChange={setView} tabs={[{ value: 'board', label: 'Pipeline', icon: Columns3 }, { value: 'list', label: 'List', icon: List }]} />
      {loading && !data ? <Spinner /> : view === 'board' ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {STAGES.map((s) => {
            const items = data.filter((l) => l.status === s.key);
            return (
              <div key={s.key} className="rounded-xl bg-slate-200/50 p-2">
                <div className="mb-2 flex items-center justify-between px-1"><span className="text-sm font-semibold text-slate-700">{s.label}</span><Badge color={s.color}>{items.length}</Badge></div>
                <div className="max-h-[70vh] space-y-2 overflow-y-auto">
                  {items.map((l) => (
                    <button key={l.id} onClick={() => setOpenId(l.id)} className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-brand-500">
                      <div className="flex items-start justify-between gap-2"><span className="font-medium">{l.first_name} {l.last_name}</span>{facility === 'all' && <span className="text-[10px] text-slate-400">{l.facility_code}</span>}</div>
                      <div className="text-xs text-slate-500">{[l.size_wanted, l.unit_type].filter(Boolean).join(' · ')}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <Badge>{l.source}</Badge>
                        {l.unit_number && <Badge color="purple">Unit {l.unit_number}</Badge>}
                        {l.follow_up_date && ['new', 'contacted'].includes(l.status) && <Badge color={l.follow_up_date <= T ? 'red' : 'gray'}><CalendarClock className="h-3 w-3" />{l.follow_up_date <= T ? 'Follow up today' : date(l.follow_up_date)}</Badge>}
                        {l.status === 'reserved' && l.reservation_expires && <Badge color={l.reservation_expires <= addDays(T, 1) ? 'red' : 'gray'}>Holds until {date(l.reservation_expires)}</Badge>}
                      </div>
                    </button>
                  ))}
                  {!items.length && <div className="py-6 text-center text-xs text-slate-400">No leads</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card bodyClass="">
          <DataTable rows={data} exportName="leads" onRowClick={(l) => setOpenId(l.id)} columns={[
            { key: 'name', label: 'Name', sortValue: (l) => l.last_name, searchValue: (l) => `${l.first_name} ${l.last_name}`, csv: (l) => `${l.first_name} ${l.last_name}`, render: (l) => <span className="font-medium">{l.first_name} {l.last_name}</span> },
            { key: 'status', label: 'Stage', render: (l) => { const s = STAGES.find((x) => x.key === l.status); return <Badge color={s?.color}>{s?.label}</Badge>; } },
            { key: 'phone', label: 'Phone' }, { key: 'source', label: 'Source' }, { key: 'size_wanted', label: 'Size' }, { key: 'unit_type', label: 'Type' },
            { key: 'unit_number', label: 'Reserved Unit' }, { key: 'follow_up_date', label: 'Follow-up', render: (l) => date(l.follow_up_date) },
            { key: 'created_at', label: 'Created', render: (l) => date(l.created_at?.slice(0, 10)) }, { key: 'assignee', label: 'Assigned' },
          ]} />
        </Card>
      )}
      {creating && <LeadForm onClose={close} reload={reload} />}
      {openId && <LeadDetail id={openId} onClose={close} reload={reload} />}
    </div>
  );
}

function LeadForm({ onClose, reload }) {
  const { facility, facilities } = useApp();
  const [f, setF] = useState({ facility_id: facility !== 'all' ? Number(facility) : facilities[0].id, first_name: '', last_name: '', phone: '', email: '', source: 'Phone Call', unit_type: 'Drive-Up', size_wanted: '10x10', desired_date: today(), follow_up_date: addDays(today(), 1), notes: '' });
  const [run, busy] = useAction();
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="New lead" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.first_name} onClick={() => run(() => api.post('/leads', f).then(() => { reload(); onClose(); }), 'Lead added')}>Save Lead</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {facility === 'all' && <Field label="Facility" className="sm:col-span-2"><Select value={f.facility_id} onChange={(e) => setF({ ...f, facility_id: Number(e.target.value) })} options={facilities.map((x) => ({ value: x.id, label: x.name }))} /></Field>}
        <Field label="First name"><Input value={f.first_name} onChange={s('first_name')} autoFocus /></Field>
        <Field label="Last name"><Input value={f.last_name} onChange={s('last_name')} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={s('phone')} /></Field>
        <Field label="Email"><Input value={f.email} onChange={s('email')} /></Field>
        <Field label="Source"><Select value={f.source} onChange={s('source')} options={SOURCES} /></Field>
        <Field label="Unit type"><Select value={f.unit_type} onChange={s('unit_type')} options={['Climate Controlled', 'Drive-Up', 'Parking']} /></Field>
        <Field label="Size wanted"><Select value={f.size_wanted} onChange={s('size_wanted')} options={SIZES} /></Field>
        <Field label="Needs storage by"><Input type="date" value={f.desired_date} onChange={s('desired_date')} /></Field>
        <Field label="Follow up on"><Input type="date" value={f.follow_up_date} onChange={s('follow_up_date')} /></Field>
      </div>
      <Field label="Notes" className="mt-3"><Textarea value={f.notes} onChange={s('notes')} /></Field>
    </Modal>
  );
}

function LeadDetail({ id, onClose, reload }) {
  const nav = useNavigate();
  const { data: l, reload: reloadLead } = useApi(`/leads/${id}`);
  const { data: units } = useApi(l ? `/units?facility=${l.facility_id}` : null);
  const [f, setF] = useState(null);
  const [reserve, setReserve] = useState(null);
  const [compose, setCompose] = useState(false);
  const [callNote, setCallNote] = useState('');
  const [run, busy] = useAction();
  useEffect(() => { if (l) setF({ ...l }); }, [l]);
  if (!l || !f) return <Modal open onClose={onClose} title="Lead"><Spinner /></Modal>;
  const refresh = () => { reload(); reloadLead(); };
  const save = (extra = {}, msg = 'Lead updated') => run(() => api.put(`/leads/${l.id}`, { ...f, ...extra }).then(refresh), msg);
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const vacant = (units || []).filter((u) => (u.status === 'vacant' || u.id === l.unit_id) && (!l.unit_type || u.unit_type === l.unit_type)).sort((a, b) => (a.size === l.size_wanted ? -1 : 1) - (b.size === l.size_wanted ? -1 : 1) || a.sqft - b.sqft);
  const open = ['new', 'contacted', 'reserved'].includes(l.status);

  return (
    <Modal open onClose={onClose} size="xl" title={<span className="flex items-center gap-2">{l.first_name} {l.last_name} <Badge color={STAGES.find((x) => x.key === l.status)?.color}>{STAGES.find((x) => x.key === l.status)?.label}</Badge></span>}
      footer={<><Button variant="ghost" icon={Trash2} onClick={() => confirm('Delete this lead?') && run(() => api.del(`/leads/${l.id}`).then(() => { reload(); onClose(); }), 'Lead deleted')}>Delete</Button><div className="flex-1" /><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={() => save()}>Save Changes</Button></>}>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {open && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="success" icon={DoorOpen} onClick={() => nav(`/move-in?lead=${l.id}${l.unit_id ? `&unit=${l.unit_id}` : ''}`)}>Convert to Move-In</Button>
              <Button size="sm" variant="secondary" icon={Bookmark} onClick={() => setReserve({ unit_id: l.unit_id || vacant[0]?.id || '', quoted_rate: l.quoted_rate || '', send: true })}>{l.status === 'reserved' ? 'Change Reservation' : 'Reserve a Unit'}</Button>
              <Button size="sm" variant="secondary" icon={Mail} onClick={() => setCompose(true)}>Send Email / Text</Button>
              <Button size="sm" variant="ghost" icon={XCircle} onClick={() => { const r = prompt('Reason lost?', 'Price too high'); if (r !== null) save({ status: 'lost', lost_reason: r }, 'Marked lost'); }}>Mark Lost</Button>
            </div>
          )}
          {reserve && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Unit" className="sm:col-span-2"><Select value={reserve.unit_id} onChange={(e) => { const u = vacant.find((x) => x.id === Number(e.target.value)); setReserve({ ...reserve, unit_id: e.target.value, quoted_rate: u?.street_rate }); }} options={vacant.map((u) => ({ value: u.id, label: `${u.number} · ${u.size} ${u.unit_type} · ${money(u.street_rate)}` }))} /></Field>
                <Field label="Quoted rate"><Input type="number" value={reserve.quoted_rate} onChange={(e) => setReserve({ ...reserve, quoted_rate: e.target.value })} /></Field>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Checkbox label="Email reservation confirmation" checked={reserve.send} onChange={(v) => setReserve({ ...reserve, send: v })} />
                <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setReserve(null)}>Cancel</Button><Button size="sm" loading={busy} onClick={() => run(() => api.post(`/leads/${l.id}/reserve`, { unit_id: Number(reserve.unit_id), quoted_rate: Number(reserve.quoted_rate), sendConfirmation: reserve.send }).then(() => { setReserve(null); refresh(); }), 'Unit reserved')}>Reserve</Button></div>
              </div>
            </div>
          )}
          {l.status === 'reserved' && <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2 text-sm">Holding unit <b>{l.unit_number}</b> ({l.width}x{l.length}) at <b>{money(l.quoted_rate)}</b>/mo until <b>{date(l.reservation_expires)}</b></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name"><Input value={f.first_name || ''} onChange={s('first_name')} /></Field>
            <Field label="Last name"><Input value={f.last_name || ''} onChange={s('last_name')} /></Field>
            <Field label="Phone"><Input value={f.phone || ''} onChange={s('phone')} /></Field>
            <Field label="Email"><Input value={f.email || ''} onChange={s('email')} /></Field>
            <Field label="Source"><Select value={f.source || ''} onChange={s('source')} options={SOURCES} /></Field>
            <Field label="Stage"><Select value={f.status} onChange={s('status')} options={STAGES.map((x) => ({ value: x.key, label: x.label }))} /></Field>
            <Field label="Unit type"><Select value={f.unit_type || ''} onChange={s('unit_type')} options={['Climate Controlled', 'Drive-Up', 'Parking']} /></Field>
            <Field label="Size wanted"><Select value={f.size_wanted || ''} onChange={s('size_wanted')} options={SIZES} /></Field>
            <Field label="Needs storage by"><Input type="date" value={f.desired_date || ''} onChange={s('desired_date')} /></Field>
            <Field label="Next follow-up"><Input type="date" value={f.follow_up_date || ''} onChange={s('follow_up_date')} /></Field>
          </div>
          <Field label="Notes"><Textarea value={f.notes || ''} onChange={s('notes')} /></Field>
          {l.lost_reason && <div className="text-sm text-slate-500">Lost reason: {l.lost_reason}</div>}
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Log a call</div>
          <div className="flex gap-2"><Input value={callNote} onChange={(e) => setCallNote(e.target.value)} placeholder="Call summary…" /><Button size="sm" icon={Phone} disabled={!callNote} onClick={() => run(() => api.post('/communications/log', { lead_id: l.id, channel: 'call', body: callNote }).then(() => { setCallNote(''); refresh(); }), 'Call logged')} /></div>
          <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">History</div>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {[...l.communications.map((c) => ({ t: c.created_at, k: c.channel, d: c.subject && c.channel !== 'call' ? c.subject : c.body })), ...l.activity.map((a) => ({ t: a.created_at, k: a.action, d: a.details }))].sort((a, b) => (a.t < b.t ? 1 : -1)).map((h, i) => (
              <div key={i} className="rounded-md bg-slate-50 px-2.5 py-1.5"><div className="text-[11px] text-slate-500">{dateTime(h.t)} · {titleCase(h.k)}</div><div className="text-sm">{h.d}</div></div>
            ))}
            <div className="rounded-md bg-slate-50 px-2.5 py-1.5"><div className="text-[11px] text-slate-500">{dateTime(l.created_at)}</div><div className="text-sm">Lead created ({l.source})</div></div>
          </div>
        </div>
      </div>
      {compose && <ComposeModal open target={{ lead_id: l.id }} defaultTemplate="lead_followup" title={`Message ${l.first_name}`} onClose={() => setCompose(false)} onSent={refresh} />}
    </Modal>
  );
}
