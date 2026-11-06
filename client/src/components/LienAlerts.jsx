import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Siren, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { dateTime } from '../lib/format.js';
import { Modal, Button, Checkbox, Field, Textarea, useAction, Badge } from './ui.jsx';

export const LIEN_ALERT_STEPS = [
  'Confirm whether a partial payment can be accepted under your state lien law (it may waive the right to sell)',
  'Stop or postpone the sale / cancel the auction listing if the balance is paid',
  'Remove the overlock once paid in full and verify gate access is restored',
  'Withdraw any newspaper / online sale advertisement',
  'Call the tenant to confirm the remaining balance and next due date',
  'Notify the district manager',
];

/** Urgent list of payments taken from tenants in lien status. */
export function LienAlertList({ items, onResolved, showFacility }) {
  const [resolving, setResolving] = useState(null);
  if (!items.length) return null;
  return (
    <div className="overflow-hidden rounded-xl border-2 border-red-300 bg-red-50 shadow-sm">
      <div className="flex items-center gap-2 bg-red-600 px-4 py-2.5 text-white">
        <Siren className="h-5 w-5 animate-pulse" />
        <span className="font-semibold">Lien payment alerts</span>
        <span className="rounded-full bg-white/20 px-2 text-xs font-bold">{items.length}</span>
        <span className="ml-auto hidden text-xs text-red-100 sm:block">Payment received from a tenant in lien status – act now</span>
      </div>
      <ul className="divide-y divide-red-200">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-red-900">{a.title}</div>
              <div className="text-sm text-red-800">{a.description}</div>
              <div className="mt-0.5 text-xs text-red-700/80">{dateTime(a.created_at)}{a.creator ? ` · taken by ${a.creator}` : ' · autopay'}{showFacility && a.facility_code ? ` · ${a.facility_code}` : ''}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              {a.tenant_id && <Link to={`/tenants/${a.tenant_id}`} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">Open Account</Link>}
              <Button size="sm" variant="danger" onClick={() => setResolving(a)}>Resolve</Button>
            </div>
          </li>
        ))}
      </ul>
      {resolving && <ResolveLienAlert alert={resolving} onClose={() => setResolving(null)} onDone={onResolved} />}
    </div>
  );
}

function ResolveLienAlert({ alert, onClose, onDone }) {
  const [done, setDone] = useState({});
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const { refreshAlerts } = useApp();
  const submit = () => run(async () => {
    const steps = LIEN_ALERT_STEPS.filter((_, i) => done[i]);
    const resolution = [steps.length ? `Steps taken: ${steps.join('; ')}.` : '', note.trim()].filter(Boolean).join(' ');
    await api.put(`/tasks/${alert.id}`, { status: 'done', resolution });
    refreshAlerts(); onDone?.(); onClose();
  }, 'Lien payment alert resolved');
  return (
    <Modal open onClose={onClose} title="Resolve lien payment alert" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" icon={CheckCircle2} loading={busy} disabled={!note.trim()} onClick={submit}>Mark Resolved</Button></>}>
      <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-900"><b>{alert.title}</b><div>{alert.description}</div></div>
      <div className="label">Steps completed</div>
      <div className="space-y-1.5">{LIEN_ALERT_STEPS.map((s, i) => <Checkbox key={i} label={s} checked={done[i]} onChange={(v) => setDone({ ...done, [i]: v })} />)}</div>
      <Field label="What was done? (required)" className="mt-3"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Accepted partial payment per DM; auction postponed to the 20th; tenant to pay remaining $88.30 Friday." /></Field>
    </Modal>
  );
}

/** Shown to the person who just took the payment. */
export function LienPaymentWarning({ alert, onClose }) {
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2 text-red-700"><Siren className="h-5 w-5" />Tenant is in lien status</span>}
      footer={<><Link to="/reminders" className="mr-auto self-center text-sm text-brand-600 hover:underline" onClick={onClose}>View alert in Reminders</Link><Button onClick={onClose}>I understand</Button></>}>
      <p className="text-sm text-slate-700">The payment was posted, and an <b>urgent lien payment alert</b> has been created for the office and management.</p>
      <div className="mt-3 flex flex-wrap gap-1.5"><Badge color="red">{alert.stage}</Badge>{alert.paidInFull ? <Badge color="green">Paid in full</Badge> : <Badge color="amber">Balance still owed</Badge>}</div>
      <div className="mt-3 text-sm font-medium">Next steps to review:</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">{(alert.steps || LIEN_ALERT_STEPS).map((s) => <li key={s}>{s}</li>)}</ul>
    </Modal>
  );
}
