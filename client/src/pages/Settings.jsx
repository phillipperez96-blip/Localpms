import { Fragment, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Settings as Cog, Building2, Gavel, ShieldCheck, ClipboardCheck, Users, KeyRound, Plug, Plus, Trash2, Save, PlayCircle, RotateCcw, CheckCircle2, XCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, dateTime, titleCase } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Tabs, Modal, Field, Input, Select, Textarea, Checkbox, useAction, cx } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { RequireFacility } from '../components/Layout.jsx';

export default function Settings() {
  const { can } = useApp();
  const tabs = [
    can('settings.facility') && { value: 'facility', label: 'Facility', icon: Building2 },
    can('settings.facility') && { value: 'lien', label: 'Fees & Lien Schedule', icon: Gavel },
    can('settings.facility') && { value: 'insurance', label: 'Protection Plans', icon: ShieldCheck },
    can('settings.facility') && { value: 'audit', label: 'Audit Checklist', icon: ClipboardCheck },
    can('settings.users') && { value: 'users', label: 'Users', icon: Users },
    (can('settings.roles') || can('settings.users')) && { value: 'roles', label: 'Roles & Permissions', icon: KeyRound },
    can('settings.integrations') && { value: 'integrations', label: 'Integrations & System', icon: Plug },
  ].filter(Boolean);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || tabs[0]?.value;
  if (!tabs.length) return <div className="card p-6 text-sm">You don't have access to settings. {can('templates.manage') && <Link className="link" to="/communications">Manage message templates →</Link>}</div>;
  return (
    <div>
      <PageHeader icon={Cog} title="Settings" subtitle={can('templates.manage') ? <>Message templates are managed under <Link className="link" to="/communications">Communications</Link></> : null} />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={tabs} />
      {tab === 'facility' && <RequireFacility what="Facility settings"><FacilitySettings /></RequireFacility>}
      {tab === 'lien' && <RequireFacility what="Fee & lien settings"><LienSettings /></RequireFacility>}
      {tab === 'insurance' && <Insurance />}
      {tab === 'audit' && <RequireFacility what="Audit checklist"><AuditTemplate /></RequireFacility>}
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <Roles />}
      {tab === 'integrations' && <Integrations />}
    </div>
  );
}

function useFacilitySettings() {
  const { facility } = useApp();
  const q = useApi(`/settings/facility/${facility}`);
  const [f, setF] = useState(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  return { f, setF, facility, reload: q.reload };
}

function FacilitySettings() {
  const { f, setF, facility, reload } = useFacilitySettings();
  const { reloadMe } = useApp();
  const [run, busy] = useAction();
  if (!f) return <Spinner />;
  const s = (k, num) => (e) => setF({ ...f, [k]: num ? Number(e.target.value) : e.target.value });
  const save = () => run(() => api.put(`/settings/facility/${facility}`, { name: f.name, code: f.code, address: f.address, city: f.city, state: f.state, zip: f.zip, phone: f.phone, email: f.email, office_hours: f.office_hours, gate_hours: f.gate_hours, billing_type: f.billing_type, prorate: f.prorate, tax_rate: f.tax_rate, admin_fee: f.admin_fee, deposit: f.deposit, gate_deny_days: f.gate_deny_days, reservation_days: f.reservation_days }).then(() => { reload(); reloadMe(); }), 'Facility settings saved');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Facility information">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={f.name} onChange={s('name')} /></Field>
          <Field label="Code"><Input value={f.code || ''} onChange={s('code')} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={f.address || ''} onChange={s('address')} /></Field>
          <Field label="City"><Input value={f.city || ''} onChange={s('city')} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="State"><Input value={f.state || ''} onChange={s('state')} /></Field><Field label="Zip"><Input value={f.zip || ''} onChange={s('zip')} /></Field></div>
          <Field label="Phone"><Input value={f.phone || ''} onChange={s('phone')} /></Field>
          <Field label="Email"><Input value={f.email || ''} onChange={s('email')} /></Field>
          <Field label="Office hours" className="sm:col-span-2"><Input value={f.office_hours || ''} onChange={s('office_hours')} /></Field>
          <Field label="Gate hours" className="sm:col-span-2"><Input value={f.gate_hours || ''} onChange={s('gate_hours')} /></Field>
        </div>
      </Card>
      <div className="space-y-4">
        <Card title="Billing">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Billing cycle"><Select value={f.billing_type} onChange={s('billing_type')} options={[{ value: 'anniversary', label: 'Anniversary (move-in day)' }, { value: 'first', label: '1st of the month' }]} /></Field>
            <Field label="Proration" hint="1st-of-month billing only"><Select value={f.prorate} onChange={s('prorate', true)} options={[{ value: 1, label: 'Prorate first month' }, { value: 0, label: 'Charge full month' }]} /></Field>
            <Field label="Sales tax rate (merchandise)" hint="e.g. 0.0825 = 8.25%"><Input type="number" step="0.0001" value={f.tax_rate} onChange={s('tax_rate', true)} /></Field>
            <Field label="Admin fee (move-in)"><Input type="number" value={f.admin_fee} onChange={s('admin_fee', true)} /></Field>
            <Field label="Security deposit"><Input type="number" value={f.deposit} onChange={s('deposit', true)} /></Field>
            <Field label="Reservation hold (days)"><Input type="number" value={f.reservation_days} onChange={s('reservation_days', true)} /></Field>
          </div>
        </Card>
        <Card title="Gate access">
          <Field label="Deny gate access when past due by (days)" hint="Tenants on 'Automatic' are locked out at this many days past due and restored automatically when paid."><Input type="number" min="1" value={f.gate_deny_days} onChange={s('gate_deny_days', true)} /></Field>
        </Card>
        <NoteReminderCard facilityId={facility} enabled={!!f.note_reminder} onChange={(v) => { setF({ ...f, note_reminder: v ? 1 : 0 }); reloadMe(); }} />
        <Button icon={Save} loading={busy} onClick={save}>Save Facility Settings</Button>
      </div>
    </div>
  );
}

function NoteReminderCard({ facilityId, enabled, onChange }) {
  const { can, facilities } = useApp();
  const [run, busy] = useAction();
  if (!can('settings.note_reminder')) return null;
  const set = (facility_id, on) => run(() => api.put('/settings/note-reminder', { facility_id, enabled: on }).then(() => onChange(on)), `Note reminder turned ${on ? 'on' : 'off'}${facility_id === 'all' ? ' for all your facilities' : ''}`);
  return (
    <Card title="Account note reminder">
      <label className="flex cursor-pointer items-start gap-3">
        <button type="button" role="switch" aria-checked={enabled} disabled={busy} onClick={() => set(Number(facilityId), !enabled)}
          className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', enabled ? 'bg-brand-600' : 'bg-slate-300')}>
          <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', enabled ? 'left-[22px]' : 'left-0.5')} />
        </button>
        <span className="text-sm">
          <span className="font-medium">Remind staff to leave a note</span>
          <span className="block text-slate-500">When on, anyone leaving a tenant&rsquo;s account without adding a note (or logging a call) during that visit is asked: &ldquo;Are you sure you wish to leave the tenant&rsquo;s account without making a note?&rdquo;</span>
        </span>
      </label>
      {facilities.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-xs">
          <span className="self-center text-slate-500">All my facilities:</span>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => set('all', true)}>Turn on everywhere</Button>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => set('all', false)}>Turn off everywhere</Button>
        </div>
      )}
    </Card>
  );
}

function LienSettings() {
  const { f, setF, facility, reload } = useFacilitySettings();
  const { data: templates } = useApi('/templates');
  const [run, busy] = useAction();
  if (!f) return <Spinner />;
  const setFee = (i, ch) => setF({ ...f, late_fees: f.late_fees.map((x, j) => (j === i ? { ...x, ...ch } : x)) });
  const setStep = (i, ch) => setF({ ...f, lien_steps: f.lien_steps.map((x, j) => (j === i ? { ...x, ...ch } : x)) });
  const move = (i, d) => { const a = [...f.lien_steps]; [a[i], a[i + d]] = [a[i + d], a[i]]; setF({ ...f, lien_steps: a }); };
  const save = () => run(() => api.put(`/settings/facility/${facility}`, { late_fees: f.late_fees, lien_steps: f.lien_steps, lien_automation: f.lien_automation }).then(reload), 'Fee & lien schedule saved');
  return (
    <div className="space-y-4">
      <Card title="Late fees" subtitle="Assessed once per delinquency when an account reaches the day threshold" actions={<Button size="sm" variant="secondary" icon={Plus} onClick={() => setF({ ...f, late_fees: [...f.late_fees, { day: 10, name: 'Late Fee', type: 'flat', amount: 15 }] })}>Add Fee</Button>}>
        <div className="space-y-2">
          {f.late_fees.map((x, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2">
              <Field label="Day late" className="col-span-2"><Input type="number" value={x.day} onChange={(e) => setFee(i, { day: Number(e.target.value) })} /></Field>
              <Field label="Name" className="col-span-4"><Input value={x.name} onChange={(e) => setFee(i, { name: e.target.value })} /></Field>
              <Field label="Type" className="col-span-3"><Select value={x.type} onChange={(e) => setFee(i, { type: e.target.value })} options={[{ value: 'flat', label: 'Flat $' }, { value: 'percent', label: '% of rent' }]} /></Field>
              <Field label={x.type === 'flat' ? 'Amount $' : 'Percent'} className="col-span-2"><Input type="number" value={x.amount} onChange={(e) => setFee(i, { amount: Number(e.target.value) })} /></Field>
              <button className="col-span-1 mb-2 text-slate-400 hover:text-red-600" onClick={() => setF({ ...f, late_fees: f.late_fees.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Lien / past-due process" subtitle="Steps run in day order. Check your state's self-storage lien law for required notices and timing."
        actions={<Button size="sm" variant="secondary" icon={Plus} onClick={() => setF({ ...f, lien_steps: [...f.lien_steps, { key: `step_${Date.now().toString(36)}`, day: 90, name: 'New Step', template: '', channel: 'letter', fee: 0 }] })}>Add Step</Button>}>
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
          <span className="text-sm font-medium">Automation:</span>
          {[['auto', 'Automatic – steps run nightly (letters created, fees posted, units flagged)'], ['manual', 'Manual – show steps as due; manager completes each one']].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" className="accent-brand-600" checked={f.lien_automation === k} onChange={() => setF({ ...f, lien_automation: k })} />{l}</label>
          ))}
        </div>
        <div className="space-y-3">
          {f.lien_steps.map((x, i) => (
            <div key={x.key} className="rounded-lg border border-slate-200 p-3">
              <div className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-12 flex items-center gap-1 sm:col-span-1"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
                  <div className="flex flex-col">{i > 0 && <button onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3 text-slate-400" /></button>}{i < f.lien_steps.length - 1 && <button onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3 text-slate-400" /></button>}</div></div>
                <Field label="Day" className="col-span-3 sm:col-span-1"><Input type="number" value={x.day} onChange={(e) => setStep(i, { day: Number(e.target.value) })} /></Field>
                <Field label="Step name" className="col-span-9 sm:col-span-3"><Input value={x.name} onChange={(e) => setStep(i, { name: e.target.value })} /></Field>
                <Field label="Notice template" className="col-span-6 sm:col-span-3"><Select value={x.template || ''} onChange={(e) => setStep(i, { template: e.target.value })} placeholder="No notice" options={(templates || []).map((t) => ({ value: t.key, label: t.name }))} /></Field>
                <Field label="Send by" className="col-span-3 sm:col-span-2"><Select value={x.channel} onChange={(e) => setStep(i, { channel: e.target.value })} options={['email', 'sms', 'letter']} /></Field>
                <Field label="Fee $" className="col-span-2 sm:col-span-1"><Input type="number" value={x.fee || 0} onChange={(e) => setStep(i, { fee: Number(e.target.value) })} /></Field>
                <button className="col-span-1 mb-2 text-slate-400 hover:text-red-600" onClick={() => setF({ ...f, lien_steps: f.lien_steps.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 pl-0 sm:pl-[8.33%]">
                <Checkbox label="Overlock unit" checked={x.overlock} onChange={(v) => setStep(i, { overlock: v })} />
                <Checkbox label="Certified mail" checked={x.certified} onChange={(v) => setStep(i, { certified: v })} />
                <Checkbox label="Schedule auction" checked={x.auction} onChange={(v) => setStep(i, { auction: v })} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Button icon={Save} loading={busy} onClick={save}>Save Fee & Lien Schedule</Button>
    </div>
  );
}

function Insurance() {
  const { data, reload } = useApi('/settings/insurance');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Spinner />;
  return (
    <Card title="Tenant protection / insurance plans" bodyClass="" actions={<Button size="sm" icon={Plus} onClick={() => setEdit({ name: '', coverage: 2000, premium: 12, active: 1 })}>Add Plan</Button>}>
      <DataTable rows={data} searchable={false} onRowClick={(p) => setEdit({ ...p })} columns={[{ key: 'name', label: 'Plan' }, { key: 'coverage', label: 'Coverage', align: 'right', render: (p) => money(p.coverage, { whole: true }) }, { key: 'premium', label: 'Monthly', align: 'right', render: (p) => money(p.premium) }, { key: 'active', label: 'Status', render: (p) => (p.active ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>) }]} />
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title={edit.id ? 'Edit plan' : 'New plan'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => (edit.id ? api.put(`/settings/insurance/${edit.id}`, edit) : api.post('/settings/insurance', edit)).then(() => { setEdit(null); reload(); }), 'Plan saved')}>Save</Button></>}>
          <div className="grid gap-3">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Coverage $"><Input type="number" value={edit.coverage} onChange={(e) => setEdit({ ...edit, coverage: Number(e.target.value) })} /></Field><Field label="Monthly premium"><Input type="number" value={edit.premium} onChange={(e) => setEdit({ ...edit, premium: Number(e.target.value) })} /></Field></div>
            <Checkbox label="Active" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v ? 1 : 0 })} />
          </div>
        </Modal>
      )}
    </Card>
  );
}

function AuditTemplate() {
  const { f, setF, facility, reload } = useFacilitySettings();
  const [run, busy] = useAction();
  if (!f) return <Spinner />;
  const t = f.audit_template;
  const set = (nt) => setF({ ...f, audit_template: nt });
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Each item is scored 0–5 during the monthly visit. Changes apply to new audits.</p>
      {t.map((c, ci) => (
        <Card key={ci} title={<Input className="font-semibold" value={c.category} onChange={(e) => set(t.map((x, j) => (j === ci ? { ...x, category: e.target.value } : x)))} />} actions={<button className="text-slate-400 hover:text-red-600" onClick={() => set(t.filter((_, j) => j !== ci))}><Trash2 className="h-4 w-4" /></button>}>
          <div className="space-y-2">
            {c.items.map((it, ii) => (
              <div key={ii} className="flex gap-2"><Input value={it} onChange={(e) => set(t.map((x, j) => (j === ci ? { ...x, items: x.items.map((y, k) => (k === ii ? e.target.value : y)) } : x)))} /><button className="text-slate-400 hover:text-red-600" onClick={() => set(t.map((x, j) => (j === ci ? { ...x, items: x.items.filter((_, k) => k !== ii) } : x)))}><Trash2 className="h-4 w-4" /></button></div>
            ))}
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => set(t.map((x, j) => (j === ci ? { ...x, items: [...x.items, 'New item'] } : x)))}>Add item</Button>
          </div>
        </Card>
      ))}
      <div className="flex gap-2"><Button variant="secondary" icon={Plus} onClick={() => set([...t, { category: 'New Category', items: ['New item'] }])}>Add Category</Button><Button icon={Save} loading={busy} onClick={() => run(() => api.put(`/settings/facility/${facility}`, { audit_template: t }).then(reload), 'Checklist saved')}>Save Checklist</Button></div>
    </div>
  );
}

function UsersTab() {
  const { facilities, user } = useApp();
  const { data, reload } = useApi('/settings/users');
  const roles = useApi('/settings/roles');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  if (!data || !roles.data) return <Spinner />;
  const fname = (ids) => ids.map((id) => facilities.find((f) => f.id === id)?.code || `#${id}`).join(', ');
  return (
    <Card bodyClass="" title="Users" actions={<Button size="sm" icon={Plus} onClick={() => setEdit({ name: '', email: '', phone: '', role_id: roles.data.roles.at(-1).id, facility_ids: [], all_facilities: false, password: '', active: 1 })}>Add User</Button>}>
      <DataTable rows={data} onRowClick={(u) => setEdit({ ...u, password: '' })} columns={[
        { key: 'name', label: 'Name', render: (u) => <span className="font-medium">{u.name}{u.id === user.id && <Badge className="ml-1" color="blue">You</Badge>}</span> }, { key: 'email', label: 'Email' },
        { key: 'role_name', label: 'Role', render: (u) => <Badge color="purple">{u.role_name}</Badge> },
        { key: 'facilities', label: 'Facilities', render: (u) => (u.all_facilities ? <Badge color="blue">All facilities</Badge> : fname(u.facility_ids)) },
        { key: 'active', label: 'Status', render: (u) => (u.active ? <Badge color="green">Active</Badge> : <Badge>Disabled</Badge>) },
        { key: 'last_login', label: 'Last login', render: (u) => dateTime(u.last_login) },
      ]} />
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : 'Add user'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => (edit.id ? api.put(`/settings/users/${edit.id}`, { ...edit, active: !!edit.active, password: edit.password || undefined }) : api.post('/settings/users', edit)).then(() => { setEdit(null); reload(); }), 'User saved')}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Email (login)"><Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Role"><Select value={edit.role_id} onChange={(e) => setEdit({ ...edit, role_id: Number(e.target.value) })} options={roles.data.roles.map((r) => ({ value: r.id, label: r.name }))} /></Field>
            <Field label={edit.id ? 'New password (leave blank to keep)' : 'Password'} className="sm:col-span-2"><Input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          </div>
          <div className="mt-4"><div className="label">Facility access</div>
            <Checkbox label="All facilities (company-wide, including future facilities)" checked={edit.all_facilities} onChange={(v) => setEdit({ ...edit, all_facilities: v })} />
            {!edit.all_facilities && <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{facilities.map((f) => <Checkbox key={f.id} label={f.name} checked={edit.facility_ids.includes(f.id)} onChange={(v) => setEdit({ ...edit, facility_ids: v ? [...edit.facility_ids, f.id] : edit.facility_ids.filter((x) => x !== f.id) })} />)}</div>}
          </div>
          {edit.id && <Checkbox className="mt-4" label="Account active" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v ? 1 : 0 })} />}
        </Modal>
      )}
    </Card>
  );
}

function Roles() {
  const { can, reloadMe } = useApp();
  const { data, reload } = useApi('/settings/roles');
  const [roles, setRoles] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setRoles(data.roles); }, [data]);
  if (!roles) return <Spinner />;
  const editable = can('settings.roles');
  const groups = [...new Set(data.permissions.map((p) => p.group))];
  const toggle = (rid, key) => setRoles(roles.map((r) => (r.id === rid ? { ...r, permissions: r.permissions.includes(key) ? r.permissions.filter((p) => p !== key) : [...r.permissions, key] } : r)));
  const saveAll = () => run(async () => { for (const r of roles) await api.put(`/settings/roles/${r.id}`, { permissions: r.permissions }); reload(); reloadMe(); }, 'Permissions saved');
  return (
    <Card title="Roles & permissions" subtitle={editable ? 'Check a box to grant a permission to a role. Changes apply at the user’s next page load.' : 'View only'} actions={editable && <Button size="sm" icon={Save} loading={busy} onClick={saveAll}>Save Permissions</Button>} bodyClass="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-white"><tr><th className="th">Permission</th>{roles.map((r) => <th key={r.id} className="th text-center"><div>{r.name}</div><div className="text-[10px] font-normal normal-case text-slate-400">{r.users} user(s)</div></th>)}</tr></thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g}>
              <tr><td colSpan={roles.length + 1} className="bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</td></tr>
              {data.permissions.filter((p) => p.group === g).map((p) => (
                <tr key={p.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-1.5">{p.label}</td>
                  {roles.map((r) => <td key={r.id} className="text-center"><input type="checkbox" className="h-4 w-4 accent-brand-600" disabled={!editable || (r.slug === 'admin' && p.key === 'settings.roles')} checked={r.permissions.includes(p.key)} onChange={() => toggle(r.id, p.key)} /></td>)}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Integrations() {
  const { data, reload } = useApi('/settings/integrations');
  const { logout, user } = useApp();
  const [to, setTo] = useState({ email: '', sms: '' });
  const [result, setResult] = useState({});
  const [daily, setDaily] = useState(null);
  const [newFac, setNewFac] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Spinner />;
  const test = (type) => run(async () => { const r = await api.post('/settings/integrations/test', { type, to: to[type] }); setResult({ ...result, [type]: r }); });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Every integration runs in <b>demo mode</b> until its credentials are added. To go live, copy <code>.env.example</code> to <code>.env</code> in the project folder, fill in the keys, and restart the server. No code changes are needed.
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(data.integrations).map(([k, v]) => (
          <Card key={k} title={<span className="flex items-center gap-2">{v.label} {v.connected ? <Badge color="green"><CheckCircle2 className="h-3 w-3" />Connected</Badge> : <Badge color="amber">Demo mode</Badge>}</span>} subtitle={v.provider}>
            <p className="text-sm text-slate-600">{v.notes}</p>
            {v.vars.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{v.vars.map((x) => <code key={x} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{x}</code>)}</div>}
            {['email', 'sms', 'gate', 'payments'].includes(k) && (
              <div className="mt-3 flex gap-2">
                {(k === 'email' || k === 'sms') && <Input placeholder={k === 'email' ? 'you@company.com' : '+15125550123'} value={to[k]} onChange={(e) => setTo({ ...to, [k]: e.target.value })} />}
                <Button size="sm" variant="secondary" loading={busy} onClick={() => test(k)}>Send Test</Button>
              </div>
            )}
            {result[k] && <div className={cx('mt-2 text-xs', result[k].status === 'failed' ? 'text-red-600' : 'text-emerald-700')}>Result: {result[k].status}{result[k].error ? ` – ${result[k].error}` : ''}{result[k].reference ? ` (${result[k].reference})` : ''}</div>}
          </Card>
        ))}
      </div>
      <Card title="System">
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="font-medium">Nightly processing</div><div className="text-slate-500">Posts rent, late fees, lien steps, rent increases, autopay and gate lockouts. Runs automatically each day. Last run: <b>{data.lastProcessed || 'never'}</b></div></div>
            <Button variant="secondary" icon={PlayCircle} loading={busy} onClick={() => run(async () => { setDaily(await api.post('/settings/run-daily')); reload(); }, 'Daily processing complete')}>Run Now</Button>
          </div>
          {daily && <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(daily, null, 2)}</pre>}
          {user.all_facilities && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <div><div className="font-medium">Add a facility</div><div className="text-slate-500">Creates a new facility with default fees, lien schedule and audit checklist. Add units from Units & Site Map.</div></div>
                <Button variant="secondary" icon={Plus} onClick={() => setNewFac({ name: '', code: '', address: '', city: '', state: '', zip: '', phone: '' })}>Add Facility</Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <div><div className="font-medium text-red-700">Reset demo data</div><div className="text-slate-500">Deletes everything and regenerates fresh demo data. Everyone will be signed out.</div></div>
                <Button variant="danger" icon={RotateCcw} loading={busy} onClick={() => confirm('Erase ALL data and regenerate the demo?') && run(() => api.post('/settings/reset-demo').then(() => logout()), 'Demo data reset')}>Reset Demo</Button>
              </div>
            </>
          )}
          <div className="border-t border-slate-100 pt-3 text-xs text-slate-400">Server Node {data.node}</div>
        </div>
      </Card>
      {newFac && (
        <Modal open onClose={() => setNewFac(null)} title="Add facility" footer={<><Button variant="secondary" onClick={() => setNewFac(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.post('/settings/facilities', newFac).then(() => { setNewFac(null); window.location.reload(); }), 'Facility created')}>Create</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">{Object.keys(newFac).map((k) => <Field key={k} label={titleCase(k)}><Input value={newFac[k]} onChange={(e) => setNewFac({ ...newFac, [k]: e.target.value })} /></Field>)}</div>
        </Modal>
      )}
    </div>
  );
}
