import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare, Send, FileText, History, Printer, Edit, Plus, Trash2, Users, AlertTriangle } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { dateTime, titleCase } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Tabs, Modal, Field, Input, Select, Textarea, useAction } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import ComposeModal, { MERGE_FIELDS } from '../components/Compose.jsx';
import TenantPicker from '../components/TenantPicker.jsx';

const CH_COLOR = { email: 'blue', sms: 'purple', letter: 'amber', call: 'green', note: 'gray' };
const ST_COLOR = { sent: 'green', simulated: 'amber', failed: 'red', ready_to_print: 'blue', logged: 'gray' };

export default function Communications() {
  const { can } = useApp();
  const [tab, setTab] = useState('history');
  return (
    <div>
      <PageHeader icon={MessageSquare} title="Communications" subtitle="Email, text and letters to tenants and leads" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'history', label: 'History', icon: History }, { value: 'compose', label: 'Compose / Mass Message', icon: Send }, can('templates.manage') && { value: 'templates', label: 'Templates', icon: FileText }].filter(Boolean)} />
      {tab === 'history' && <HistoryTab />}
      {tab === 'compose' && <ComposeTab />}
      {tab === 'templates' && <Templates />}
    </div>
  );
}

function HistoryTab() {
  const { fac, facility } = useApp();
  const { data, loading } = useApi(fac('/communications'));
  const [ch, setCh] = useState('');
  const [view, setView] = useState(null);
  const nav = useNavigate();
  if (loading && !data) return <Spinner />;
  const rows = data.filter((c) => !ch || c.channel === ch);
  const ready = rows.filter((c) => c.channel === 'letter' && c.status === 'ready_to_print');
  return (
    <Card bodyClass="">
      <DataTable rows={rows} exportName="communications" onRowClick={setView}
        toolbar={<>
          <Select className="w-auto py-1.5" value={ch} onChange={(e) => setCh(e.target.value)} placeholder="All channels" options={['email', 'sms', 'letter', 'call', 'note']} />
          {ready.length > 0 && <Button size="sm" variant="secondary" icon={Printer} onClick={() => window.open(`/letter/${ready.slice(0, 100).map((c) => c.id).join(',')}`, '_blank')}>Print {Math.min(100, ready.length)} letters</Button>}
        </>}
        columns={[
          { key: 'created_at', label: 'When', render: (c) => <span className="whitespace-nowrap text-xs">{dateTime(c.created_at)}</span> },
          facility === 'all' && { key: 'facility_code', label: 'Fac' },
          { key: 'channel', label: 'Channel', render: (c) => <Badge color={CH_COLOR[c.channel]}>{c.channel}</Badge> },
          { key: 'to', label: 'Recipient', sortValue: (c) => c.last_name || c.lead_last, searchValue: (c) => `${c.first_name || c.lead_first} ${c.last_name || c.lead_last}`, csv: (c) => `${c.first_name || c.lead_first || ''} ${c.last_name || c.lead_last || ''}`,
            render: (c) => c.tenant_id ? <button className="link" onClick={(e) => { e.stopPropagation(); nav(`/tenants/${c.tenant_id}`); }}>{c.first_name} {c.last_name}</button> : <span>{c.lead_first} {c.lead_last} <Badge>lead</Badge></span> },
          { key: 'subject', label: 'Subject / Message', searchValue: (c) => `${c.subject} ${c.body}`, render: (c) => <div className="max-w-md truncate">{c.subject ? <b className="font-medium">{c.subject} – </b> : null}<span className="text-slate-500">{c.body}</span></div> },
          { key: 'status', label: 'Status', render: (c) => <Badge color={ST_COLOR[c.status]}>{titleCase(c.status)}</Badge> },
          { key: 'user_name', label: 'By', render: (c) => c.user_name || <span className="text-slate-400">Automatic</span> },
        ].filter(Boolean)} />
      {view && (
        <Modal open onClose={() => setView(null)} title={view.subject || titleCase(view.channel)} footer={view.channel === 'letter' && <Button icon={Printer} onClick={() => window.open(`/letter/${view.id}`, '_blank')}>Print Letter</Button>}>
          <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-500"><Badge color={CH_COLOR[view.channel]}>{view.channel}</Badge><Badge color={ST_COLOR[view.status]}>{titleCase(view.status)}</Badge>{view.to_address && <span>To: {view.to_address}</span>}<span>{dateTime(view.created_at)}</span></div>
          {view.error && <div className="mb-2 text-sm text-red-600">{view.error}</div>}
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm">{view.body}</pre>
        </Modal>
      )}
    </Card>
  );
}

function ComposeTab() {
  const { facility, facilities } = useApp();
  const [aud, setAud] = useState('pastdue');
  const [minDays, setMinDays] = useState(15);
  const [picked, setPicked] = useState([]);
  const [fid, setFid] = useState(facility !== 'all' ? facility : '');
  const [open, setOpen] = useState(false);
  const target = aud === 'selected' ? { tenant_ids: picked.map((p) => p.id) } : { audience: aud, minDays, facility_id: fid || undefined };
  const opts = [
    { v: 'all', l: 'All active tenants', d: 'Announcements, office closures, policy updates', icon: Users },
    { v: 'pastdue', l: 'All past-due tenants', d: 'Anyone with an unpaid balance past their due date', icon: AlertTriangle },
    { v: 'pastdue_min', l: 'Past due by at least…', d: 'Target a specific delinquency stage', icon: AlertTriangle },
    { v: 'autopay_off', l: 'Tenants not on autopay', d: 'Encourage autopay enrollment', icon: Users },
    { v: 'selected', l: 'Specific tenants', d: 'Pick individual tenants', icon: Users },
  ];
  return (
    <Card title="Who should receive this message?">
      {facility === 'all' && <Field label="Facility" className="mb-3 max-w-xs"><Select value={fid} onChange={(e) => setFid(e.target.value)} placeholder="All my facilities" options={facilities.map((f) => ({ value: f.id, label: f.name }))} /></Field>}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {opts.map((o) => (
          <button key={o.v} onClick={() => setAud(o.v)} className={`flex gap-3 rounded-lg border p-3 text-left ${aud === o.v ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-500'}`}>
            <o.icon className="mt-0.5 h-5 w-5 text-brand-600" /><div><div className="text-sm font-medium">{o.l}</div><div className="text-xs text-slate-500">{o.d}</div></div>
          </button>
        ))}
      </div>
      {aud === 'pastdue_min' && <Field label="Minimum days past due" className="mt-3 max-w-xs"><Input type="number" value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} /></Field>}
      {aud === 'selected' && (
        <div className="mt-3 max-w-lg">
          <TenantPicker value={null} facility={fid || facility} onChange={(t) => t && !picked.some((p) => p.id === t.id) && setPicked([...picked, t])} />
          <div className="mt-2 flex flex-wrap gap-1.5">{picked.map((p) => <Badge key={p.id} color="blue">{p.title}<button onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>×</button></Badge>)}</div>
        </div>
      )}
      <Button className="mt-4" icon={Send} disabled={aud === 'selected' && !picked.length} onClick={() => setOpen(true)}>Write Message</Button>
      <p className="mt-2 text-xs text-slate-500">Tenants who opted out of email or SMS are skipped automatically. Use Preview in the next step to see the recipient count.</p>
      {open && <ComposeModal open target={target} title="Compose message" onClose={() => setOpen(false)} />}
    </Card>
  );
}

function Templates() {
  const { data, reload } = useApi('/templates');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Spinner />;
  const save = () => run(() => (edit.id ? api.put(`/templates/${edit.id}`, edit) : api.post('/templates', edit)).then(() => { setEdit(null); reload(); }), 'Template saved');
  return (
    <Card bodyClass="" title="Message templates" subtitle="Used by automatic lien notices, move-in/out and manual messages" actions={<Button size="sm" icon={Plus} onClick={() => setEdit({ name: '', channel: 'email', category: 'General', subject: '', body: '' })}>New Template</Button>}>
      <DataTable rows={data} onRowClick={setEdit} columns={[
        { key: 'name', label: 'Name', render: (t) => <span className="font-medium">{t.name}</span> }, { key: 'category', label: 'Category' },
        { key: 'channel', label: 'Channel', render: (t) => <Badge color={CH_COLOR[t.channel]}>{t.channel}</Badge> }, { key: 'key', label: 'Key', render: (t) => <code className="text-xs text-slate-500">{t.key}</code> },
        { key: 'subject', label: 'Subject' },
      ]} />
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="lg" title={edit.id ? `Edit: ${edit.name}` : 'New template'} footer={<>{edit.id && <Button variant="ghost" icon={Trash2} onClick={() => confirm('Delete template?') && run(() => api.del(`/templates/${edit.id}`).then(() => { setEdit(null); reload(); }), 'Deleted')}>Delete</Button>}<div className="flex-1" /><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Channel"><Select value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })} options={['email', 'sms', 'letter']} /></Field>
            <Field label="Category"><Input value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field>
          </div>
          <Field label="Subject" className="mt-3"><Input value={edit.subject || ''} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
          <Field label="Body" className="mt-3"><Textarea rows={12} value={edit.body || ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          <div className="mt-2 text-xs text-slate-500">Merge fields: {MERGE_FIELDS.map((f) => <code key={f} className="mr-1 rounded bg-slate-100 px-1">{`{{${f}}}`}</code>)} and for rent increases <code className="rounded bg-slate-100 px-1">{'{{old_rent}} {{new_rent}} {{effective_date}}'}</code></div>
        </Modal>
      )}
    </Card>
  );
}
