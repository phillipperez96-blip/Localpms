import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { DollarSign, Mail, DoorClosed, Edit, KeyRound, RefreshCw, Lock, Unlock, ShieldCheck, Plus, Minus, Ban, MessageSquarePlus, Phone, ShoppingCart, Pause, Play, ArrowLeft, CheckCircle2, Circle, Printer, Gavel } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, date, dateTime, lienLabel, titleCase, today } from '../lib/format.js';
import { Card, Button, Badge, Spinner, ErrorBox, Tabs, Modal, Field, Input, Select, Textarea, Checkbox, KV, useAction, Empty, Confirm, lienColor, daysColor } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { PaymentModal } from '../components/Payment.jsx';
import ComposeModal from '../components/Compose.jsx';
import { NoteComposer, LeaveWithoutNoteReminder } from '../components/AccountNotes.jsx';

export default function TenantAccount() {
  const { id } = useParams();
  const { can, toast } = useApp();
  const nav = useNavigate();
  const { data: d, loading, error, reload } = useApi(`/tenants/${id}`);
  const [tab, setTab] = useState('units');
  const [modal, setModal] = useState(null);
  const [notesThisVisit, setNotesThisVisit] = useState(0); // notes/calls added since opening this account
  const noteBox = useRef();
  useEffect(() => setNotesThisVisit(0), [id]);
  const [run, busy] = useAction();
  if (loading && !d) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const t = d.tenant, a = d.account;
  const active = d.rentals.filter((r) => r.status === 'active');
  const pastDue = a.daysLate > 0 && a.balance > 0;
  const rent = active.reduce((s, r) => s + r.rent + r.insurance_premium, 0);

  return (
    <div className="space-y-4">
      <button onClick={() => nav(-1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 no-print"><ArrowLeft className="h-4 w-4" /> Back</button>
      {/* header */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{t.first_name} {t.last_name}</h1>
              {t.status === 'former' ? <Badge>Former tenant</Badge> : pastDue ? <Badge color={daysColor(a.daysLate)}>{a.daysLate} days past due</Badge> : <Badge color="green">Current</Badge>}
              {t.autopay ? <Badge color="blue">Autopay</Badge> : null}
              {t.military ? <Badge color="purple">Military</Badge> : null}
              {!d.gate.allowed && t.status === 'active' && <Badge color="black"><Lock className="h-3 w-3" /> Gate denied</Badge>}
            </div>
            <div className="mt-1 text-sm text-slate-500">{t.company && <>{t.company} · </>}{d.facility.name} · Units: {active.map((r) => r.number).join(', ') || '—'} · Tenant #{t.id}</div>
            <div className="mt-1 flex flex-wrap gap-4 text-sm text-slate-600"><span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{t.phone || '—'}</span><span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{t.email || '—'}</span></div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-500">Balance</div>
            <div className={`text-3xl font-bold tabular-nums ${a.balance > 0 ? (pastDue ? 'text-red-600' : 'text-slate-900') : 'text-emerald-600'}`}>{money(a.balance)}</div>
            {pastDue && <div className="text-xs text-red-600">{money(a.pastDue)} past due since {date(a.oldestUnpaid)}</div>}
            {active.length > 0 && <div className="text-xs text-slate-500">Monthly: {money(rent)}</div>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 no-print">
          {can('payments.take') && <Button variant="success" icon={DollarSign} onClick={() => setModal('pay')}>Take Payment</Button>}
          {can('communications.send') && <Button variant="secondary" icon={Mail} onClick={() => setModal('msg')}>Send Message</Button>}
          <Button variant="secondary" icon={Phone} onClick={() => setModal('call')}>Log Call / Note</Button>
          {can('tenants.edit') && <Button variant="secondary" icon={Edit} onClick={() => setModal('edit')}>Edit Info</Button>}
          {can('ledger.adjust') && <Button variant="secondary" icon={Plus} onClick={() => setModal('adjust')}>Charge / Credit</Button>}
          {can('merch.sell') && <Button variant="secondary" icon={ShoppingCart} onClick={() => nav(`/merchandise?tenant=${t.id}`)}>Sell Merchandise</Button>}
          {can('payments.refund') && a.balance < 0 && <Button variant="secondary" icon={Minus} onClick={() => setModal('refund')}>Refund Credit</Button>}
          {can('movein.perform') && <Button variant="secondary" icon={Plus} onClick={() => nav(`/move-in?tenant=${t.id}`)}>Rent Another Unit</Button>}
        </div>
      </div>

      <NoteComposer ref={noteBox} tenantId={t.id} notes={d.notes} reload={reload} onAdded={() => setNotesThisVisit((n) => n + 1)} onUndone={() => setNotesThisVisit((n) => Math.max(0, n - 1))} />
      <LeaveWithoutNoteReminder enabled={d.facility.note_reminder} notedThisVisit={notesThisVisit > 0} onStay={() => noteBox.current?.focus()} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Contact & Identification">
            <KV items={[['Address', [t.address, [t.city, t.state, t.zip].filter(Boolean).join(', ')].filter(Boolean).join(', ') || '—'], ['Alt phone', t.alt_phone], ["Driver's license", t.dl_number ? `${t.dl_number} (${t.dl_state || ''})` : null], ['Date of birth', date(t.dob)], ['Emergency contact', t.emergency_name ? `${t.emergency_name} ${t.emergency_phone || ''}` : null], ['Opt-ins', `${t.email_opt_in ? 'Email ✓' : 'Email ✗'} · ${t.sms_opt_in ? 'SMS ✓' : 'SMS ✗'}`], ['Autopay', t.autopay ? t.autopay_method || 'On' : 'Off'], ['Customer since', date(t.created_at?.slice(0, 10))]]} />
            {t.notes && <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">{t.notes}</div>}
          </Card>
          <GateCard d={d} reload={reload} />
        </div>

        <div className="lg:col-span-2">
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'units', label: 'Units', count: active.length }, { value: 'ledger', label: 'Ledger', count: d.ledger.length },
            { value: 'notes', label: 'Notes & History', count: d.notes.length }, { value: 'comms', label: 'Communications', count: d.communications.length },
            { value: 'lien', label: 'Lien History', count: d.lienEvents.length }, { value: 'sales', label: 'Purchases', count: d.sales.length },
          ]} />
          {tab === 'units' && (
            <div className="space-y-3">
              {d.rentals.map((r) => <RentalCard key={r.id} r={r} d={d} reload={reload} onMoveOut={() => setModal({ moveout: r })} />)}
              {!d.rentals.length && <Card><Empty title="No rentals" /></Card>}
              {d.increases.filter((x) => x.status === 'scheduled').map((x) => <div key={x.id} className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">Rent increase scheduled for unit {x.number}: {money(x.old_rent)} → {money(x.new_rent)} effective {date(x.effective_date)}</div>)}
            </div>
          )}
          {tab === 'ledger' && <Ledger rows={d.ledger} reload={reload} />}
          {tab === 'notes' && <Notes d={d} />}
          {tab === 'comms' && (
            <Card bodyClass="divide-y divide-slate-100">
              {d.communications.map((c) => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500"><Badge color={c.channel === 'sms' ? 'purple' : c.channel === 'letter' ? 'amber' : c.channel === 'call' ? 'green' : 'blue'}>{c.channel}</Badge>{dateTime(c.created_at)} · {c.user_name || 'System'} · <span className="capitalize">{c.status?.replace(/_/g, ' ')}</span>
                    {c.channel === 'letter' && <Link to={`/letter/${c.id}`} target="_blank" className="link ml-auto flex items-center gap-1"><Printer className="h-3 w-3" />Print</Link>}</div>
                  {c.subject && <div className="mt-1 text-sm font-medium">{c.subject}</div>}
                  <div className="line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">{c.body}</div>
                </div>
              ))}
              {!d.communications.length && <Empty title="No communications" />}
            </Card>
          )}
          {tab === 'lien' && (
            <Card bodyClass="">
              <DataTable searchable={false} pageSize={0} rows={d.lienEvents} columns={[
                { key: 'date', label: 'Date', render: (e) => date(e.date) }, { key: 'unit', label: 'Unit' }, { key: 'step_name', label: 'Step' },
                { key: 'fee', label: 'Fee', align: 'right', render: (e) => (e.fee ? money(e.fee) : '—') }, { key: 'by', label: 'By', render: (e) => (e.auto ? <Badge>Automatic</Badge> : e.user_name) }, { key: 'notes', label: 'Notes' }]} />
            </Card>
          )}
          {tab === 'sales' && (
            <Card bodyClass="">
              <DataTable searchable={false} pageSize={0} rows={d.sales} columns={[{ key: 'date', label: 'Date', render: (s) => date(s.date) }, { key: 'id', label: 'Sale #' }, { key: 'method', label: 'Paid By', render: (s) => (s.method === 'account' ? 'Charged to account' : titleCase(s.method)) }, { key: 'total', label: 'Total', align: 'right', render: (s) => money(s.total) }]} />
            </Card>
          )}
        </div>
      </div>

      {modal === 'pay' && <PaymentModal open tenant={{ ...t, rent }} balance={a.balance} onClose={() => setModal(null)} onPaid={reload} />}
      {modal === 'msg' && <ComposeModal open target={{ tenant_ids: [t.id] }} title={`Message ${t.first_name} ${t.last_name}`} defaultTemplate={pastDue ? 'late_notice' : undefined} onClose={() => setModal(null)} onSent={reload} />}
      {modal === 'call' && <LogModal tenant={t} onClose={() => setModal(null)} reload={() => { setNotesThisVisit((n) => n + 1); reload(); }} />}
      {modal === 'edit' && <EditTenant tenant={t} onClose={() => setModal(null)} reload={reload} />}
      {modal === 'adjust' && <AdjustModal tenant={t} rentals={active} onClose={() => setModal(null)} reload={reload} />}
      {modal === 'refund' && <RefundModal tenant={t} credit={-a.balance} onClose={() => setModal(null)} reload={reload} />}
      {modal?.moveout && <MoveOutModal rental={modal.moveout} balance={a.balance} onClose={() => setModal(null)} reload={reload} />}
    </div>
  );
}

function RentalCard({ r, d, reload, onMoveOut }) {
  const { can } = useApp();
  const [run, busy] = useAction();
  const [step, setStep] = useState(false);
  const active = r.status === 'active';
  const steps = d.facility.lien_steps;
  const done = new Set(r.nextStep?.completed || []);
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">Unit {r.number}</span>
            <span className="text-sm text-slate-500">{r.width}x{r.length} {r.unit_type}</span>
            {active ? <Badge color={lienColor(r.lien_status)}>{lienLabel(r.lien_status)}</Badge> : <Badge>Moved out {date(r.move_out_date)}</Badge>}
            {r.overlocked && active ? <Badge color="black"><Lock className="h-3 w-3" />Overlocked</Badge> : null}
            {r.lien_hold ? <Badge color="amber"><Pause className="h-3 w-3" />Lien on hold</Badge> : null}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-slate-500">Rent</div>{money(r.rent)}{r.rent < r.street_rate && <span className="text-xs text-slate-400"> (street {money(r.street_rate)})</span>}</div>
            <div><div className="text-xs text-slate-500">Move-in</div>{date(r.move_in_date)}</div>
            <div><div className="text-xs text-slate-500">Next due</div>{active ? date(r.next_due_date) : '—'}</div>
            <div><div className="text-xs text-slate-500">Protection</div>{r.insurance_name ? <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />{money(r.insurance_premium)}</span> : 'None'}</div>
          </div>
          {r.promotion_name && <div className="mt-1 text-xs text-violet-700">Promotion: {r.promotion_name}</div>}
          {!active && r.move_out_reason && <div className="mt-1 text-xs text-slate-500">Reason: {r.move_out_reason} {r.vacate_notes && `· ${r.vacate_notes}`}</div>}
        </div>
        {active && (
          <div className="flex flex-wrap gap-2 no-print">
            {can('pastdue.manage') && <Button size="sm" variant="secondary" icon={r.overlocked ? Unlock : Lock} loading={busy} onClick={() => run(() => api.put(`/units/${r.unit_id}`, { overlocked: !r.overlocked }).then(reload), r.overlocked ? 'Overlock removed' : 'Unit overlocked')}>{r.overlocked ? 'Remove Overlock' : 'Overlock'}</Button>}
            {can('pastdue.manage') && <Button size="sm" variant="ghost" icon={r.lien_hold ? Play : Pause} onClick={() => run(() => api.put(`/rentals/${r.id}`, { lien_hold: !r.lien_hold }).then(reload), r.lien_hold ? 'Lien process resumed' : 'Lien process paused')}>{r.lien_hold ? 'Resume Lien' : 'Hold Lien'}</Button>}
            {can('moveout.perform') && <Button size="sm" variant="danger" icon={DoorClosed} onClick={onMoveOut}>Move Out</Button>}
          </div>
        )}
      </div>
      {active && d.account.daysLate > 0 && d.account.balance > 0 && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lien process · {d.account.daysLate} days late</div>
            {r.nextStep && can('pastdue.manage') && <Button size="sm" variant={r.nextStep.due ? 'warning' : 'secondary'} icon={Gavel} onClick={() => setStep(true)}>Complete: {r.nextStep.name}</Button>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {steps.map((s) => {
              const isDone = done.has(s.key);
              const isNext = r.nextStep?.key === s.key;
              return <span key={s.key} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${isDone ? 'bg-emerald-100 text-emerald-800' : isNext ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>{isDone ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}Day {s.day}: {s.name}</span>;
            })}
          </div>
        </div>
      )}
      {step && <LienStepModal rental={r} step={r.nextStep} onClose={() => setStep(false)} reload={reload} />}
    </div>
  );
}

export function LienStepModal({ rental, step, onClose, reload }) {
  const [notes, setNotes] = useState('');
  const [send, setSend] = useState(true);
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title={`Complete lien step: ${step.name}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.post(`/pastdues/${rental.id || rental.rental_id}/step`, { step_key: step.key, notes, send }).then(() => { reload(); onClose(); }), `${step.name} completed`)}>Complete Step</Button></>}>
      <ul className="mb-3 list-disc pl-5 text-sm text-slate-600">
        {step.template && <li>Creates the “{titleCase(step.template)}” {step.channel === 'letter' ? 'letter (printable)' : step.channel}</li>}
        {step.fee > 0 && <li>Posts a {money(step.fee)} fee to the account</li>}
        {step.overlock && <li>Marks the unit as overlocked</li>}
        {step.certified && <li>Reminder: send via certified mail and record the tracking # in notes</li>}
        {step.auction && <li>Schedules an auction (14 days out by default)</li>}
      </ul>
      <Field label="Notes (tracking #, details)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {step.template && step.channel !== 'letter' && <Checkbox className="mt-2" label={`Send the ${step.channel} now`} checked={send} onChange={setSend} />}
    </Modal>
  );
}

function GateCard({ d, reload }) {
  const { can } = useApp();
  const [run, busy] = useAction();
  const [code, setCode] = useState('');
  const t = d.tenant;
  const set = (body, msg) => run(() => api.post(`/tenants/${t.id}/gate`, body).then(reload), msg);
  return (
    <Card title="Gate Access" actions={<KeyRound className="h-4 w-4 text-slate-400" />}>
      <div className="flex items-center justify-between">
        <div><div className="text-xs text-slate-500">Access code</div><div className="font-mono text-2xl font-bold tracking-widest">{t.gate_code}</div></div>
        <div className="text-right">{d.gate.allowed ? <Badge color="green">Access allowed</Badge> : <Badge color="red">Access denied</Badge>}<div className="mt-1 text-xs text-slate-500">{d.gate.reason}</div></div>
      </div>
      {can('gate.manage') && t.status === 'active' && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <Field label="Access rule"><Select value={t.gate_access} onChange={(e) => set({ access: e.target.value }, 'Gate access updated')} options={[{ value: 'auto', label: `Automatic (deny at ${d.facility.gate_deny_days}+ days past due)` }, { value: 'allowed', label: 'Always allow (override)' }, { value: 'denied', label: 'Always deny (lockout)' }]} /></Field>
          <div className="flex gap-2">
            <Input placeholder="New code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} maxLength={8} />
            <Button size="sm" variant="secondary" disabled={code.length < 4} loading={busy} onClick={() => set({ code }, 'Gate code changed').then(() => setCode(''))}>Set</Button>
            <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy} onClick={() => set({ regenerate: true }, 'New gate code generated')} title="Generate random code" />
          </div>
        </div>
      )}
      {d.gateEvents.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <div className="mb-1 text-xs font-semibold text-slate-500">Recent gate activity</div>
          {d.gateEvents.slice(0, 6).map((e) => <div key={e.id} className="flex justify-between py-0.5 text-xs"><span className={e.event.includes('denied') || e.event.includes('suspend') ? 'text-red-600' : 'text-slate-600'}>{titleCase(e.event)}</span><span className="text-slate-400">{dateTime(e.created_at)}</span></div>)}
        </div>
      )}
    </Card>
  );
}

function Ledger({ rows, reload }) {
  const { can } = useApp();
  const [voidRow, setVoidRow] = useState(null);
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  return (
    <Card bodyClass="">
      <DataTable rows={rows} exportName="ledger" pageSize={30} rowClass={(l) => (l.voided ? 'opacity-50 line-through' : '')} columns={[
        { key: 'date', label: 'Date', render: (l) => date(l.date) },
        { key: 'description', label: 'Description', render: (l) => <div><div>{l.description}</div>{(l.reference || l.user_name) && <div className="text-xs text-slate-400">{[l.method && titleCase(l.method), l.reference, l.user_name].filter(Boolean).join(' · ')}</div>}</div> },
        { key: 'charge', label: 'Charges', align: 'right', sortValue: (l) => (l.type === 'charge' || l.type === 'refund' ? l.amount : 0), csv: (l) => (l.type === 'charge' || l.type === 'refund' ? l.amount : ''), render: (l) => (l.type === 'charge' || l.type === 'refund' ? money(l.amount) : '') },
        { key: 'credit', label: 'Payments / Credits', align: 'right', sortValue: (l) => (l.type === 'payment' || l.type === 'credit' ? l.amount : 0), csv: (l) => (l.type === 'payment' || l.type === 'credit' ? l.amount : ''), render: (l) => (l.type === 'payment' || l.type === 'credit' ? <span className="text-emerald-700">{money(l.amount)}</span> : '') },
        { key: 'running', label: 'Balance', align: 'right', render: (l) => money(l.running) },
        { key: 'act', label: '', sortable: false, csv: false, render: (l) => !l.voided && (l.type === 'payment' ? can('payments.refund') : can('ledger.adjust')) && <button className="text-xs text-red-600 hover:underline no-print" onClick={() => { setVoidRow(l); setReason(''); }}>Void</button> },
      ]} />
      <Confirm open={!!voidRow} title="Void ledger entry" variant="danger" confirmText="Void entry" busy={busy} onClose={() => setVoidRow(null)}
        message={voidRow && `Void ${voidRow.type} of ${money(voidRow.amount)} – "${voidRow.description}"? ${voidRow.type === 'payment' && voidRow.method === 'card' ? 'The card payment will be refunded.' : ''}`}
        onConfirm={() => run(() => api.post(`/ledger/${voidRow.id}/void`, { reason }).then(() => { setVoidRow(null); reload(); }), 'Entry voided')}>
        <Field label="Reason" className="mt-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Waived – first time late" /></Field>
      </Confirm>
    </Card>
  );
}

function Notes({ d }) {
  const [show, setShow] = useState('all');
  const items = [
    ...d.notes.map((n) => ({ key: 'n' + n.id, at: n.created_at, who: n.user_name, kind: 'note', label: 'Note', text: n.body })),
    ...d.history.map((h) => ({ key: 'h' + h.id, at: h.created_at, who: h.user_name, kind: h.action, label: titleCase(h.action), text: h.details })),
  ].filter((x) => show === 'all' || (show === 'notes' ? x.kind === 'note' : x.kind !== 'note')).sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <Card>
      <div className="mb-4 flex gap-1.5 no-print">{[['all', 'Everything'], ['notes', 'Notes only'], ['history', 'Account history']].map(([k, l]) => <button key={k} onClick={() => setShow(k)} className={`rounded-full px-3 py-1 text-xs font-medium ${show === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>)}</div>
      <ol className="relative space-y-3 border-l border-slate-200 pl-4">
        {items.map((n) => (
          <li key={n.key}>
            <div className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white ${n.kind === 'note' ? 'bg-amber-400' : n.kind === 'payment' ? 'bg-emerald-500' : n.kind.includes('lien') || n.kind === 'overlock' ? 'bg-red-500' : 'bg-slate-400'}`} />
            <div className="text-xs text-slate-500">{dateTime(n.at)} · {n.who || 'System'} · {n.label}</div>
            <div className={`whitespace-pre-wrap text-sm ${n.kind === 'note' ? 'rounded bg-amber-50 px-2 py-1' : ''}`}>{n.text}</div>
          </li>
        ))}
      </ol>
      {!items.length && <Empty title="Nothing yet" />}
    </Card>
  );
}

function LogModal({ tenant, onClose, reload }) {
  const [f, setF] = useState({ channel: 'call', direction: 'outbound', body: '' });
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title="Log call or note" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.body.trim()} onClick={() => run(() => api.post('/communications/log', { ...f, tenant_id: tenant.id }).then(() => { reload(); onClose(); }), 'Logged')}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} options={[{ value: 'call', label: 'Phone call' }, { value: 'note', label: 'In-person / note' }]} /></Field>
        <Field label="Direction"><Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} options={['outbound', 'inbound']} /></Field>
      </div>
      <Field label="Summary" className="mt-3"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="e.g. Left voicemail re: past due balance. Promised to pay Friday." /></Field>
    </Modal>
  );
}

export function TenantFields({ f, set }) {
  const F = (k, label, props = {}) => <Field label={label} className={props.className}><Input value={f[k] ?? ''} onChange={(e) => set({ ...f, [k]: e.target.value })} {...props} className="" /></Field>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {F('first_name', 'First name *')}{F('last_name', 'Last name *')}
      {F('phone', 'Phone')}{F('email', 'Email', { type: 'email' })}
      {F('company', 'Company (optional)')}{F('alt_phone', 'Alternate phone')}
      {F('address', 'Street address', { className: 'sm:col-span-2' })}
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">{F('city', 'City')}{F('state', 'State')}{F('zip', 'Zip')}</div>
      {F('dl_number', "Driver's license #")}{F('dl_state', 'DL state')}
      {F('dob', 'Date of birth', { type: 'date' })}
      <div />
      {F('emergency_name', 'Emergency contact')}{F('emergency_phone', 'Emergency phone')}
      <div className="flex flex-wrap gap-4 sm:col-span-2">
        <Checkbox label="Active military" checked={f.military} onChange={(v) => set({ ...f, military: v ? 1 : 0 })} />
        <Checkbox label="Email opt-in" checked={f.email_opt_in ?? 1} onChange={(v) => set({ ...f, email_opt_in: v ? 1 : 0 })} />
        <Checkbox label="SMS opt-in" checked={f.sms_opt_in ?? 1} onChange={(v) => set({ ...f, sms_opt_in: v ? 1 : 0 })} />
      </div>
    </div>
  );
}

function EditTenant({ tenant, onClose, reload }) {
  const [f, setF] = useState({ ...tenant });
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title="Edit tenant" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.put(`/tenants/${tenant.id}`, f).then(() => { reload(); onClose(); }), 'Tenant updated')}>Save</Button></>}>
      <TenantFields f={f} set={setF} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Checkbox label="Autopay enabled" checked={f.autopay} onChange={(v) => setF({ ...f, autopay: v ? 1 : 0 })} />
        {f.autopay ? <Input placeholder="Card on file (e.g. Visa •••• 4242)" value={f.autopay_method || ''} onChange={(e) => setF({ ...f, autopay_method: e.target.value })} /> : null}
      </div>
      <Field label="Account notes (shown on account)" className="mt-3"><Textarea value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Modal>
  );
}

function AdjustModal({ tenant, rentals, onClose, reload }) {
  const [f, setF] = useState({ type: 'credit', category: 'credit', amount: '', description: '', rental_id: rentals[0]?.id || '' });
  const [run, busy] = useAction();
  const cats = f.type === 'credit' ? [{ value: 'credit', label: 'General credit' }, { value: 'late_fee_waiver', label: 'Late fee waiver' }, { value: 'write_off', label: 'Bad debt write-off' }, { value: 'promo', label: 'Promotional credit' }]
    : [{ value: 'misc', label: 'Misc. charge' }, { value: 'lock_cut', label: 'Lock cut fee' }, { value: 'cleaning_fee', label: 'Cleaning fee' }, { value: 'late_fee', label: 'Late fee' }, { value: 'nsf_fee', label: 'NSF / returned payment fee' }, { value: 'rent', label: 'Rent' }];
  return (
    <Modal open onClose={onClose} title="Post charge or credit" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!(Number(f.amount) > 0)} onClick={() => run(() => api.post(`/tenants/${tenant.id}/adjustments`, { ...f, amount: Number(f.amount) }).then(() => { reload(); onClose(); }), 'Posted')}>Post</Button></>}>
      <div className="mb-3 flex gap-2">{['credit', 'charge'].map((t) => <button key={t} onClick={() => setF({ ...f, type: t, category: t === 'credit' ? 'credit' : 'misc' })} className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium capitalize ${f.type === t ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200'}`}>{t === 'credit' ? <Minus className="mr-1 inline h-4 w-4" /> : <Plus className="mr-1 inline h-4 w-4" />}{t}</button>)}</div>
      <div className="grid gap-3">
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={cats} /></Field>
        <Field label="Amount"><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {rentals.length > 1 && <Field label="Unit"><Select value={f.rental_id} onChange={(e) => setF({ ...f, rental_id: e.target.value })} options={rentals.map((r) => ({ value: r.id, label: r.number }))} /></Field>}
      </div>
    </Modal>
  );
}

function RefundModal({ tenant, credit, onClose, reload }) {
  const [amount, setAmount] = useState(credit.toFixed(2));
  const [method, setMethod] = useState('check');
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title="Refund credit balance" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.post(`/tenants/${tenant.id}/refund`, { amount: Number(amount), method }).then(() => { reload(); onClose(); }), 'Refund recorded')}>Refund</Button></>}>
      <p className="mb-3 text-sm text-slate-600">Credit available: <b>{money(credit)}</b></p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Refund by"><Select value={method} onChange={(e) => setMethod(e.target.value)} options={['check', 'cash', 'card']} /></Field>
      </div>
    </Modal>
  );
}

function MoveOutModal({ rental, balance, onClose, reload }) {
  const [f, setF] = useState({ date: today(), reason: 'No longer needed', notes: '', cleaningFee: '', waiveBalance: false, markUnrentable: false, inspection: { 'Broom clean': true, 'Lock removed': true, 'No damage': true, 'Trash removed': true } });
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title={`Move out – Unit ${rental.number}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" icon={DoorClosed} loading={busy} onClick={() => run(() => api.post('/moveout', { ...f, rental_id: rental.id, cleaningFee: Number(f.cleaningFee) || 0 }).then(() => { reload(); onClose(); }), `Unit ${rental.number} moved out`)}>Complete Move-Out</Button></>}>
      {balance > 0 && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">This tenant has an outstanding balance of <b>{money(balance)}</b>. Collect payment first, or waive it below.</div>}
      {balance < 0 && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Tenant has a credit of <b>{money(-balance)}</b> – you can refund it from the account after move-out.</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Move-out date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Reason"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} options={['No longer needed', 'Moved out of area', 'Bought a house', 'Downsized', 'Price', 'Moved to competitor', 'Transferred to another unit', 'Dissatisfied', 'Other']} /></Field>
      </div>
      <div className="mt-4"><div className="label">Vacate inspection</div>
        <div className="grid grid-cols-2 gap-2">{Object.keys(f.inspection).map((k) => <Checkbox key={k} label={k} checked={f.inspection[k]} onChange={(v) => setF({ ...f, inspection: { ...f.inspection, [k]: v } })} />)}</div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Cleaning / trash fee"><Input type="number" value={f.cleaningFee} onChange={(e) => setF({ ...f, cleaningFee: e.target.value })} placeholder="0.00" /></Field>
      </div>
      <Field label="Notes" className="mt-3"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <div className="mt-3 space-y-2">
        {balance > 0 && <Checkbox label={`Waive remaining balance (${money(balance)})`} checked={f.waiveBalance} onChange={(v) => setF({ ...f, waiveBalance: v })} />}
        <Checkbox label="Mark unit unrentable (needs cleaning / repair)" checked={f.markUnrentable} onChange={(v) => setF({ ...f, markUnrentable: v })} />
      </div>
      <p className="mt-3 text-xs text-slate-500">Gate code will be removed if the tenant has no other units. A move-out confirmation email is sent automatically.</p>
    </Modal>
  );
}
