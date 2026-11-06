import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ListTodo, Plus, CheckCircle2, Circle, Zap, Trash2, Calendar } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { date, today, addDays, titleCase } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Modal, Field, Input, Select, Textarea, useAction, Empty, Tabs, cx } from '../components/ui.jsx';
import { LienAlertList } from '../components/LienAlerts.jsx';

const KIND_COLOR = { lead: 'purple', reservation: 'purple', auction: 'red', rate: 'blue', inventory: 'amber', close: 'amber', overlock: 'black' };

export default function Reminders() {
  const { fac, facility, facilities, user, can, alerts, refreshAlerts } = useApp();
  const tasks = useApi(fac('/tasks'));
  const auto = useApi(fac('/reminders/auto'));
  const users = useApi(fac('/users/lookup'));
  const [filter, setFilter] = useState('open');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const T = today();
  const regular = (tasks.data || []).filter((t) => t.source !== 'lien_payment' || t.status === 'done');
  const list = regular.filter((t) => (filter === 'open' ? t.status === 'open' : filter === 'mine' ? t.status === 'open' && t.assigned_to === user.id : filter === 'overdue' ? t.status === 'open' && t.due_date && t.due_date < T : t.status === 'done'));
  const toggle = (t) => run(() => api.put(`/tasks/${t.id}`, { status: t.status === 'done' ? 'open' : 'done' }).then(() => { tasks.reload(); refreshAlerts(); }), t.status === 'done' ? 'Reopened' : 'Completed ✓');
  const fname = (id) => facilities.find((f) => f.id === id)?.code;

  return (
    <div>
      <PageHeader icon={ListTodo} title="Reminders & Tasks" subtitle="Urgent alerts, your to-do list, and automatic system reminders" actions={can('tasks.manage') && <Button icon={Plus} onClick={() => setEdit({ title: '', description: '', due_date: addDays(T, 1), priority: 'normal', category: 'Operations', assigned_to: user.id, facility_id: facility !== 'all' ? Number(facility) : facilities[0].id })}>New Reminder</Button>} />
      <div className="mb-4"><LienAlertList items={alerts.lienPayments} showFacility={facility === 'all'} onResolved={tasks.reload} /></div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Tabs value={filter} onChange={setFilter} tabs={[
            { value: 'open', label: 'All open', count: regular.filter((t) => t.status === 'open').length },
            { value: 'mine', label: 'Assigned to me', count: regular.filter((t) => t.status === 'open' && t.assigned_to === user.id).length },
            { value: 'overdue', label: 'Overdue', count: regular.filter((t) => t.status === 'open' && t.due_date && t.due_date < T).length },
            { value: 'done', label: 'Completed' },
          ]} />
          <Card bodyClass="divide-y divide-slate-100">
            {tasks.loading && !tasks.data ? <Spinner /> : list.map((t) => (
              <div key={t.id} className="group flex items-start gap-3 px-4 py-3">
                <button onClick={() => t.source !== 'lien_payment' && toggle(t)} className="mt-0.5" title={t.source === 'lien_payment' ? 'Resolved lien payment alert' : ''}>{t.status === 'done' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-300 hover:text-emerald-500" />}</button>
                <div className={cx('min-w-0 flex-1', t.source !== 'lien_payment' && 'cursor-pointer')} onClick={() => t.source !== 'lien_payment' && setEdit({ ...t })}>
                  <div className={cx('text-sm font-medium', t.status === 'done' && 'text-slate-400 line-through')}>{t.title}</div>
                  {t.description && <div className="line-clamp-2 text-xs text-slate-500">{t.description}</div>}
                  {t.resolution && <div className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800"><b>Resolution:</b> {t.resolution}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {t.due_date && <Badge color={t.status === 'open' && t.due_date < T ? 'red' : t.due_date === T ? 'amber' : 'gray'}><Calendar className="h-3 w-3" />{t.due_date === T ? 'Today' : date(t.due_date)}</Badge>}
                    {(t.priority === 'high' || t.priority === 'urgent') && <Badge color="red">{t.priority === 'urgent' ? 'Urgent' : 'High'}</Badge>}
                    {t.category && <Badge>{t.category}</Badge>}
                    {t.source === 'audit' && <Link to={`/audits/${t.audit_id}`} onClick={(e) => e.stopPropagation()}><Badge color="blue">From audit</Badge></Link>}
                    {facility === 'all' && <span>{fname(t.facility_id)}</span>}
                    <span>→ {t.assignee || 'Unassigned'}</span>{t.creator && t.creator !== t.assignee && <span>· from {t.creator}</span>}
                    {t.tenant_id && <Link className="link" to={`/tenants/${t.tenant_id}`} onClick={(e) => e.stopPropagation()}>{t.tenant_first} {t.tenant_last}</Link>}
                  </div>
                </div>
              </div>
            ))}
            {tasks.data && !list.length && <Empty title="Nothing here" />}
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card title={<span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-amber-500" />Automatic reminders</span>} subtitle="Generated from leads, reservations, auctions, inventory & collections" bodyClass="divide-y divide-slate-100">
            {auto.loading && !auto.data ? <Spinner /> : (auto.data || []).map((a, i) => (
              <Link key={i} to={a.link} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50">
                <Badge color={KIND_COLOR[a.kind]}>{titleCase(a.kind)}</Badge>
                <div className="min-w-0 flex-1"><div className="text-sm">{a.title}</div><div className="truncate text-xs text-slate-500">{a.detail}{facility === 'all' && ` · ${fname(a.facility_id)}`}</div></div>
                <span className={cx('whitespace-nowrap text-xs', a.due < T ? 'text-red-600' : 'text-slate-500')}>{a.due === T ? 'Today' : date(a.due)}</span>
              </Link>
            ))}
            {auto.data && !auto.data.length && <Empty title="No automatic reminders" />}
          </Card>
        </div>
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit reminder' : 'New reminder'}
          footer={<>{edit.id && can('tasks.manage') && <Button variant="ghost" icon={Trash2} onClick={() => run(() => api.del(`/tasks/${edit.id}`).then(() => { setEdit(null); tasks.reload(); }), 'Deleted')}>Delete</Button>}<div className="flex-1" /><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} disabled={!edit.title} onClick={() => run(() => (edit.id ? api.put(`/tasks/${edit.id}`, edit) : api.post('/tasks', edit)).then(() => { setEdit(null); tasks.reload(); }), 'Saved')}>Save</Button></>}>
          <Field label="Title"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} autoFocus /></Field>
          <Field label="Details" className="mt-3"><Textarea value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {!edit.id && facility === 'all' && <Field label="Facility"><Select value={edit.facility_id} onChange={(e) => setEdit({ ...edit, facility_id: Number(e.target.value) })} options={facilities.map((f) => ({ value: f.id, label: f.name }))} /></Field>}
            <Field label="Due date"><Input type="date" value={edit.due_date || ''} onChange={(e) => setEdit({ ...edit, due_date: e.target.value })} /></Field>
            <Field label="Priority"><Select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })} options={['low', 'normal', 'high']} /></Field>
            <Field label="Category"><Select value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} options={['Operations', 'Maintenance', 'Collections', 'Marketing', 'Retail', 'Audit', 'Other']} /></Field>
            <Field label="Assign to"><Select value={edit.assigned_to || ''} onChange={(e) => setEdit({ ...edit, assigned_to: Number(e.target.value) || null })} placeholder="Unassigned" options={(users.data || []).map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
