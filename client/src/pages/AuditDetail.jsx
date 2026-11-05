import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Send, CheckCircle2, Camera, Trash2, Printer, ListPlus, RotateCcw } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { date, dateTime, addDays, today } from '../lib/format.js';
import { Card, Button, Badge, Spinner, Field, Input, Textarea, Select, Modal, useAction, cx } from '../components/ui.jsx';
import { STATUS } from './Audits.jsx';

export default function AuditDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, user } = useApp();
  const { data: a, reload } = useApi(`/audits/${id}`);
  const users = useApi(a ? `/users/lookup?facility=${a.facility_id}` : null);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState('');
  const [visit, setVisit] = useState('');
  const [response, setResponse] = useState('');
  const [task, setTask] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (a) { setItems(a.items); setSummary(a.summary || ''); setVisit(a.visit_date); } }, [a]);
  if (!a) return <Spinner />;
  const editable = can('audits.perform') && a.status !== 'acknowledged';
  const score = items.reduce((s, i) => s + (Number(i.points) || 0), 0);
  const max = items.reduce((s, i) => s + i.max_points, 0);
  const scored = items.filter((i) => i.points !== null && i.points !== '').length;
  const cats = [...new Set(items.map((i) => i.category))];
  const setItem = (iid, ch) => setItems(items.map((i) => (i.id === iid ? { ...i, ...ch } : i)));
  const save = (then) => run(() => api.put(`/audits/${a.id}`, { items, summary, visit_date: visit }).then(then || reload), then ? undefined : 'Audit saved');
  const pctV = max ? Math.round((score / max) * 100) : 0;
  const upload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => run(() => api.post(`/audits/${a.id}/photos`, { dataUrl: r.result, caption: file.name }).then(reload), 'Photo added');
    r.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      <button onClick={() => nav('/audits')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 no-print"><ArrowLeft className="h-4 w-4" /> All audits</button>
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-xl font-bold">{a.facility_name} – Property Audit</h1><Badge color={STATUS[a.status].color}>{STATUS[a.status].label}</Badge></div>
            <div className="text-sm text-slate-500">{new Date(a.period + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} · Auditor: {a.auditor}</div>
            {editable ? <Field label="Visit date" className="mt-2 w-44"><Input type="date" value={visit} onChange={(e) => setVisit(e.target.value)} /></Field> : <div className="text-sm text-slate-500">Visited {date(a.visit_date)}</div>}
          </div>
          <div className="text-right">
            <div className={cx('text-4xl font-bold', pctV >= 90 ? 'text-emerald-600' : pctV >= 80 ? 'text-amber-600' : 'text-red-600')}>{pctV}%</div>
            <div className="text-sm text-slate-500">{score} / {max} points · {scored}/{items.length} scored</div>
            {a.previous && <div className="text-xs text-slate-400">Last visit: {Math.round((a.previous.score / a.previous.max_score) * 100)}% ({a.previous.period})</div>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 no-print">
          {editable && <Button variant="secondary" icon={Save} loading={busy} onClick={() => save()}>Save Draft</Button>}
          {editable && a.status === 'draft' && <Button icon={Send} loading={busy} onClick={() => save(() => api.post(`/audits/${a.id}/submit`, { force: scored < items.length && confirm(`${items.length - scored} items are not scored. Submit anyway?`) }).then(reload).then(() => {}))}>Submit to Manager</Button>}
          {a.status === 'submitted' && can('audits.perform') && <Button variant="ghost" icon={RotateCcw} onClick={() => run(() => api.post(`/audits/${a.id}/reopen`).then(reload), 'Reopened as draft')}>Reopen</Button>}
          {a.status === 'draft' && can('audits.perform') && <Button variant="ghost" icon={Trash2} onClick={() => confirm('Delete this draft?') && run(() => api.del(`/audits/${a.id}`).then(() => nav('/audits')), 'Draft deleted')}>Delete Draft</Button>}
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {cats.map((c) => {
            const ci = items.filter((i) => i.category === c);
            const cs = ci.reduce((s, i) => s + (Number(i.points) || 0), 0), cm = ci.reduce((s, i) => s + i.max_points, 0);
            return (
              <Card key={c} title={c} actions={<span className="text-sm font-semibold text-slate-600">{cs}/{cm}</span>} bodyClass="divide-y divide-slate-100">
                {ci.map((i) => (
                  <div key={i.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">{i.label}</span>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: i.max_points + 1 }, (_, n) => (
                          <button key={n} disabled={!editable} onClick={() => setItem(i.id, { points: n })}
                            className={cx('h-7 w-7 rounded-md text-xs font-semibold transition', Number(i.points) === n && i.points !== null ? (n >= 4 ? 'bg-emerald-600 text-white' : n >= 3 ? 'bg-amber-500 text-white' : 'bg-red-600 text-white') : 'bg-slate-100 text-slate-500 hover:bg-slate-200', !editable && 'cursor-default')}>{n}</button>
                        ))}
                        {editable && <button title="Create follow-up reminder" onClick={() => setTask({ title: `Audit follow-up: ${i.label}`, description: i.notes || '', due_date: addDays(today(), 7), priority: Number(i.points) < 3 ? 'high' : 'normal' })} className="ml-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600 no-print"><ListPlus className="h-4 w-4" /></button>}
                      </div>
                    </div>
                    {editable ? <input className="mt-2 w-full rounded border-0 bg-slate-50 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-brand-500" placeholder="Note for manager…" value={i.notes || ''} onChange={(e) => setItem(i.id, { notes: e.target.value })} />
                      : i.notes && <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{i.notes}</div>}
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
        <div className="space-y-4">
          <Card title="Notes for the property manager">
            {editable ? <Textarea rows={8} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Overall observations, praise, what to fix before next visit…" />
              : <p className="whitespace-pre-wrap text-sm">{a.summary || '—'}</p>}
          </Card>
          <Card title="Manager response">
            {a.status === 'acknowledged' ? (
              <div className="text-sm"><div className="mb-1 flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Acknowledged by {a.acknowledged_by_name} · {dateTime(a.acknowledged_at)}</div><p className="whitespace-pre-wrap">{a.manager_response || '—'}</p></div>
            ) : a.status === 'submitted' && can('audits.respond') ? (
              <div className="space-y-2"><Textarea value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Response / action plan…" /><Button className="w-full" variant="success" icon={CheckCircle2} loading={busy} onClick={() => run(() => api.post(`/audits/${a.id}/acknowledge`, { manager_response: response }).then(reload), 'Audit acknowledged')}>Acknowledge Audit</Button></div>
            ) : <p className="text-sm text-slate-500">{a.status === 'draft' ? 'Available once the auditor submits the visit.' : 'Waiting for the property manager.'}</p>}
          </Card>
          <Card title={`Follow-up reminders (${a.tasks.filter((t) => !t.title.startsWith('Review')).length})`} bodyClass="divide-y divide-slate-100">
            {a.tasks.filter((t) => !t.title.startsWith('Review')).map((t) => <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm"><span className={t.status === 'done' ? 'text-slate-400 line-through' : ''}>{t.title.replace('Audit follow-up: ', '')}</span><span className="text-xs text-slate-500">{t.assignee} · {date(t.due_date)}</span></div>)}
            {!a.tasks.length && <div className="px-4 py-3 text-xs text-slate-500">Use the <ListPlus className="inline h-3.5 w-3.5" /> icon on any item to assign a follow-up.</div>}
          </Card>
          <Card title="Photos" actions={editable && <label className="cursor-pointer"><span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600"><Camera className="h-4 w-4" />Add</span><input type="file" accept="image/*" capture="environment" className="hidden" onChange={upload} /></label>}>
            <div className="grid grid-cols-2 gap-2">
              {a.photos.map((p) => (
                <div key={p.id} className="group relative"><a href={`/uploads/${p.filename}`} target="_blank" rel="noreferrer"><img src={`/uploads/${p.filename}`} className="aspect-square w-full rounded-md object-cover" alt={p.caption} /></a>
                  {editable && <button onClick={() => run(() => api.del(`/audits/${a.id}/photos/${p.id}`).then(reload))} className="absolute right-1 top-1 hidden rounded bg-white/90 p-1 group-hover:block"><Trash2 className="h-3.5 w-3.5 text-red-600" /></button>}</div>
              ))}
            </div>
            {!a.photos.length && <p className="text-xs text-slate-500">No photos.</p>}
          </Card>
        </div>
      </div>
      {task && (
        <Modal open onClose={() => setTask(null)} title="Create follow-up reminder" footer={<><Button variant="secondary" onClick={() => setTask(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.post('/tasks', { ...task, facility_id: a.facility_id, audit_id: a.id, category: 'Audit' }).then(() => { setTask(null); reload(); }), 'Follow-up assigned')}>Create</Button></>}>
          <Field label="Title"><Input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} /></Field>
          <Field label="Details" className="mt-3"><Textarea value={task.description} onChange={(e) => setTask({ ...task, description: e.target.value })} /></Field>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Due"><Input type="date" value={task.due_date} onChange={(e) => setTask({ ...task, due_date: e.target.value })} /></Field>
            <Field label="Priority"><Select value={task.priority} onChange={(e) => setTask({ ...task, priority: e.target.value })} options={['low', 'normal', 'high']} /></Field>
            <Field label="Assign to"><Select value={task.assigned_to || ''} onChange={(e) => setTask({ ...task, assigned_to: Number(e.target.value) })} placeholder="Choose…" options={(users.data || []).map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
