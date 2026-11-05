import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { AlertTriangle, Gavel, DollarSign, Mail, ListChecks, Columns3, Lock, Plus, CheckCircle2, Pause } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, date, lienLabel, today, addDays } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Tabs, Stat, Modal, Field, Input, Select, Textarea, Checkbox, useAction, Empty, lienColor, daysColor } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { PaymentModal } from '../components/Payment.jsx';
import ComposeModal from '../components/Compose.jsx';
import { LienStepModal } from './TenantAccount.jsx';

export default function PastDues() {
  const { fac, facility, can } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'list';
  const { data, loading, reload } = useApi(fac('/pastdues'));
  const auctions = useApi(fac('/auctions'));
  const [sel, setSel] = useState(new Set());
  const [compose, setCompose] = useState(false);
  const [pay, setPay] = useState(null);
  const [step, setStep] = useState(null);
  const [bucket, setBucket] = useState('all');
  const nav = useNavigate();

  const rows = (data?.rows || []).filter((r) => bucket === 'all' || (bucket === 'due' && r.next?.due) || (bucket === '1-30' && r.daysLate <= 30) || (bucket === '31-60' && r.daysLate > 30 && r.daysLate <= 60) || (bucket === '60+' && r.daysLate > 60));
  const total = (data?.rows || []).reduce((s, r) => s + r.pastDue, 0);
  const dueNow = (data?.rows || []).filter((r) => r.next?.due && !r.lien_hold).length;
  const scheduled = (auctions.data || []).filter((a) => a.status === 'scheduled');

  return (
    <div>
      <PageHeader icon={AlertTriangle} title="Past Dues & Auctions" subtitle="Collections, lien process and auction management" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Past-due tenants" value={data?.rows.length ?? '—'} icon={AlertTriangle} tone="red" />
        <Stat label="Total past due" value={money(total, { whole: true })} icon={DollarSign} tone="amber" />
        <Stat label="Lien steps due now" value={dueNow} sub={data?.automation === 'auto' ? 'Automation ON – processed nightly' : data?.automation ? 'Manual mode' : ''} icon={ListChecks} tone="purple" onClick={() => { setSp({}); setBucket('due'); }} />
        <Stat label="Auctions scheduled" value={scheduled.length} icon={Gavel} tone="slate" onClick={() => setSp({ tab: 'auctions' })} />
      </div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ value: 'list', label: 'Past Due List', icon: ListChecks, count: data?.rows.length }, { value: 'pipeline', label: 'Lien Process', icon: Columns3 }, { value: 'auctions', label: 'Auctions', icon: Gavel, count: scheduled.length }]} />

      {loading && !data ? <Spinner /> : tab === 'list' ? (
        <Card bodyClass="">
          <DataTable rows={rows} exportName="past-dues" rowKey="rental_id" selectable={can('communications.send')} selected={sel} onSelectedChange={setSel} initialSort={{ key: 'daysLate', dir: 'desc' }}
            toolbar={<>
              {[['all', 'All'], ['due', 'Step due'], ['1-30', '1–30 days'], ['31-60', '31–60'], ['60+', '60+']].map(([k, l]) => <button key={k} onClick={() => setBucket(k)} className={`rounded-full px-3 py-1 text-xs font-medium ${bucket === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>)}
              {sel.size > 0 && <Button size="sm" icon={Mail} onClick={() => setCompose(true)}>Message {sel.size} selected</Button>}
            </>}
            columns={[
              { key: 'name', label: 'Tenant', render: (r) => <div><Link to={`/tenants/${r.tenant_id}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link><div className="text-xs text-slate-500">{r.phone}</div></div> },
              facility === 'all' && { key: 'facility_code', label: 'Fac' },
              { key: 'unit', label: 'Unit', render: (r) => <span className="flex items-center gap-1">{r.unit}{r.overlocked && <Lock className="h-3.5 w-3.5 text-slate-900" title="Overlocked" />}</span> },
              { key: 'rent', label: 'Rent', align: 'right', render: (r) => money(r.rent) },
              { key: 'pastDue', label: 'Past Due', align: 'right', render: (r) => <span className="font-semibold text-red-600">{money(r.pastDue)}</span> },
              { key: 'balance', label: 'Balance', align: 'right', render: (r) => money(r.balance) },
              { key: 'daysLate', label: 'Days', align: 'right', render: (r) => <Badge color={daysColor(r.daysLate)}>{r.daysLate}</Badge> },
              { key: 'lien_status', label: 'Current Stage', render: (r) => <div className="flex items-center gap-1"><Badge color={lienColor(r.lien_status)}>{lienLabel(r.lien_status)}</Badge>{r.lien_hold ? <Pause className="h-3.5 w-3.5 text-amber-600" title="On hold" /> : null}</div> },
              { key: 'next', label: 'Next Step', sortValue: (r) => r.next?.dueIn ?? 999, csv: (r) => r.next?.name || '', render: (r) => r.next ? <div className="text-xs"><div className="font-medium">{r.next.name}</div><div className={r.next.due ? 'font-semibold text-amber-700' : 'text-slate-500'}>{r.next.due ? 'Due now' : `in ${r.next.dueIn} day(s)`}</div></div> : <span className="text-xs text-slate-400">All steps done</span> },
              { key: 'lastContact', label: 'Last Contact', sortValue: (r) => r.lastContact?.created_at || '', csv: (r) => r.lastContact?.created_at || '', render: (r) => r.lastContact ? <span className="text-xs text-slate-500">{r.lastContact.channel} · {date(r.lastContact.created_at.slice(0, 10))}</span> : '—' },
              { key: 'act', label: '', sortable: false, csv: false, render: (r) => (
                <div className="flex gap-1 no-print">
                  {can('payments.take') && <Button size="sm" variant="success" icon={DollarSign} onClick={() => setPay(r)} title="Take payment" />}
                  {r.next && <Button size="sm" variant={r.next.due ? 'warning' : 'secondary'} icon={Gavel} onClick={() => setStep(r)} title={`Complete ${r.next.name}`} />}
                </div>) },
            ].filter(Boolean)} />
        </Card>
      ) : tab === 'pipeline' ? (
        <Pipeline data={data} onOpen={(r) => nav(`/tenants/${r.tenant_id}`)} />
      ) : (
        <Auctions q={auctions} pastDues={data?.rows || []} />
      )}

      {compose && <ComposeModal open target={{ tenant_ids: [...new Set(rows.filter((r) => sel.has(r.rental_id)).map((r) => r.tenant_id))] }} defaultTemplate="late_notice" title={`Message ${sel.size} past-due tenant(s)`} onClose={() => setCompose(false)} onSent={() => { setSel(new Set()); reload(); }} />}
      {pay && <PaymentModal open tenant={{ id: pay.tenant_id, first_name: pay.name, last_name: '', rent: pay.rent }} balance={pay.balance} onClose={() => setPay(null)} onPaid={() => { reload(); auctions.reload(); }} />}
      {step && <LienStepModal rental={step} step={step.next} onClose={() => setStep(null)} reload={() => { reload(); auctions.reload(); }} />}
    </div>
  );
}

function Pipeline({ data, onOpen }) {
  const steps = [{ key: 'current', name: 'Not yet notified', day: 1 }, ...data.steps];
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {steps.map((s) => {
        const items = data.rows.filter((r) => (s.key === 'current' ? r.lien_status === 'current' : r.lien_status === s.key));
        return (
          <div key={s.key} className="w-60 shrink-0 rounded-xl bg-slate-200/50 p-2">
            <div className="mb-2 px-1"><div className="flex items-center justify-between"><span className="text-sm font-semibold">{s.name}</span><Badge color={lienColor(s.key)}>{items.length}</Badge></div><div className="text-xs text-slate-500">Day {s.day}{s.fee ? ` · ${money(s.fee)} fee` : ''}{s.overlock ? ' · overlock' : ''}</div></div>
            <div className="max-h-[65vh] space-y-1.5 overflow-y-auto">
              {items.map((r) => (
                <button key={r.rental_id} onClick={() => onOpen(r)} className="block w-full rounded-lg border border-slate-200 bg-white p-2 text-left text-sm hover:border-brand-500">
                  <div className="flex justify-between"><span className="font-medium">{r.name}</span><span className="text-xs text-slate-500">{r.unit}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-red-600">{money(r.pastDue)}</span><span className="text-slate-500">{r.daysLate}d</span></div>
                </button>
              ))}
              {!items.length && <div className="py-4 text-center text-xs text-slate-400">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Auctions({ q, pastDues }) {
  const { can, facility } = useApp();
  const [sold, setSold] = useState(null);
  const [sched, setSched] = useState(null);
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  if (q.loading && !q.data) return <Spinner />;
  const eligible = pastDues.filter((r) => r.daysLate >= 45 && !(q.data || []).some((a) => a.rental_id === r.rental_id && a.status === 'scheduled'));
  return (
    <>
      <Card bodyClass="" title="Auctions" actions={can('auctions.manage') && <Button size="sm" icon={Plus} onClick={() => setSched({ rental_id: eligible[0]?.rental_id || '', scheduled_date: addDays(today(), 14), platform: 'StorageTreasures', listing_url: '', notes: '' })}>Schedule Auction</Button>}>
        <DataTable rows={q.data || []} exportName="auctions" columns={[
          { key: 'scheduled_date', label: 'Date', render: (a) => date(a.scheduled_date) },
          facility === 'all' && { key: 'facility_code', label: 'Fac' },
          { key: 'number', label: 'Unit', render: (a) => `${a.number} (${a.width}x${a.length})` },
          { key: 'tenant', label: 'Tenant', sortValue: (a) => a.last_name, csv: (a) => `${a.first_name} ${a.last_name}`, render: (a) => <Link className="link" to={`/tenants/${a.tenant_id}`}>{a.first_name} {a.last_name}</Link> },
          { key: 'platform', label: 'Platform' },
          { key: 'status', label: 'Status', render: (a) => <Badge color={{ scheduled: 'purple', sold: 'green', cancelled: 'gray', redeemed: 'blue' }[a.status]}>{a.status === 'redeemed' ? 'Redeemed (paid)' : a.status}</Badge> },
          { key: 'balance', label: 'Owed', align: 'right', render: (a) => (a.balance !== null ? money(a.balance) : '') },
          { key: 'sale_amount', label: 'Sold For', align: 'right', render: (a) => (a.sale_amount !== null ? money(a.sale_amount) : '') },
          { key: 'winning_bidder', label: 'Buyer' },
          { key: 'surplus', label: 'Surplus', align: 'right', render: (a) => (a.surplus ? <span className="font-medium text-amber-700">{money(a.surplus)}</span> : '') },
          { key: 'act', label: '', sortable: false, csv: false, render: (a) => a.status === 'scheduled' && can('auctions.manage') && (
            <div className="flex gap-1"><Button size="sm" variant="success" icon={CheckCircle2} onClick={() => setSold({ a, sale_amount: '', winning_bidder: '', bidder_phone: '', auction_fee: '', cleanout_deadline: addDays(today(), 3), notes: '' })}>Record Sale</Button><Button size="sm" variant="ghost" onClick={() => setEdit({ ...a })}>Edit</Button></div>) },
        ].filter(Boolean)} />
      </Card>
      <p className="mt-2 text-xs text-slate-500">Surplus proceeds (sale amount above the balance owed) must be held for the former tenant per state law. Auctions are cancelled automatically if the tenant pays in full.</p>

      {sched && (
        <Modal open onClose={() => setSched(null)} title="Schedule auction" footer={<><Button variant="secondary" onClick={() => setSched(null)}>Cancel</Button><Button loading={busy} disabled={!sched.rental_id} onClick={() => run(() => api.post('/auctions', { ...sched, rental_id: Number(sched.rental_id) }).then(() => { setSched(null); q.reload(); }), 'Auction scheduled')}>Schedule</Button></>}>
          <Field label="Unit / tenant (45+ days past due)"><Select value={sched.rental_id} onChange={(e) => setSched({ ...sched, rental_id: e.target.value })} placeholder="Choose…" options={eligible.map((r) => ({ value: r.rental_id, label: `${r.unit} – ${r.name} (${r.daysLate} days, ${money(r.balance)})` }))} /></Field>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Auction date"><Input type="date" value={sched.scheduled_date} onChange={(e) => setSched({ ...sched, scheduled_date: e.target.value })} /></Field>
            <Field label="Platform"><Select value={sched.platform} onChange={(e) => setSched({ ...sched, platform: e.target.value })} options={['StorageTreasures', 'Lockerfox', 'iBid', 'Live Auction', 'Online Auction']} /></Field>
          </div>
          <Field label="Listing URL" className="mt-3"><Input value={sched.listing_url} onChange={(e) => setSched({ ...sched, listing_url: e.target.value })} /></Field>
          <Field label="Notes" className="mt-3"><Textarea value={sched.notes} onChange={(e) => setSched({ ...sched, notes: e.target.value })} /></Field>
        </Modal>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={`Auction – unit ${edit.number}`} footer={<><Button variant="danger" onClick={() => run(() => api.put(`/auctions/${edit.id}`, { status: 'cancelled' }).then(() => { setEdit(null); q.reload(); }), 'Auction cancelled')}>Cancel Auction</Button><div className="flex-1" /><Button loading={busy} onClick={() => run(() => api.put(`/auctions/${edit.id}`, edit).then(() => { setEdit(null); q.reload(); }), 'Saved')}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Auction date"><Input type="date" value={edit.scheduled_date} onChange={(e) => setEdit({ ...edit, scheduled_date: e.target.value })} /></Field>
            <Field label="Platform"><Input value={edit.platform || ''} onChange={(e) => setEdit({ ...edit, platform: e.target.value })} /></Field>
          </div>
          <Field label="Listing URL" className="mt-3"><Input value={edit.listing_url || ''} onChange={(e) => setEdit({ ...edit, listing_url: e.target.value })} /></Field>
          <Field label="Notes" className="mt-3"><Textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </Modal>
      )}
      {sold && (
        <Modal open onClose={() => setSold(null)} title={`Record sale – unit ${sold.a.number}`} footer={<><Button variant="secondary" onClick={() => setSold(null)}>Cancel</Button><Button variant="success" loading={busy} onClick={() => run(() => api.post(`/auctions/${sold.a.id}/sold`, { ...sold, a: undefined, sale_amount: Number(sold.sale_amount), auction_fee: Number(sold.auction_fee) || 0 }).then(() => { setSold(null); q.reload(); }), 'Sale recorded – unit is now vacant')}>Record Sale</Button></>}>
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">Balance owed: <b>{money(sold.a.balance)}</b>. Proceeds are applied to the balance; any remainder is written off and any surplus is recorded.</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sale amount"><Input type="number" value={sold.sale_amount} onChange={(e) => setSold({ ...sold, sale_amount: e.target.value })} autoFocus /></Field>
            <Field label="Auction / sale fee (optional)"><Input type="number" value={sold.auction_fee} onChange={(e) => setSold({ ...sold, auction_fee: e.target.value })} /></Field>
            <Field label="Winning bidder"><Input value={sold.winning_bidder} onChange={(e) => setSold({ ...sold, winning_bidder: e.target.value })} /></Field>
            <Field label="Bidder phone"><Input value={sold.bidder_phone} onChange={(e) => setSold({ ...sold, bidder_phone: e.target.value })} /></Field>
            <Field label="Clean-out deadline"><Input type="date" value={sold.cleanout_deadline} onChange={(e) => setSold({ ...sold, cleanout_deadline: e.target.value })} /></Field>
          </div>
          {Number(sold.sale_amount) > 0 && <div className="mt-3 text-sm">Applied to balance: <b>{money(Math.min(Number(sold.sale_amount), sold.a.balance + (Number(sold.auction_fee) || 0)))}</b> · Surplus: <b>{money(Math.max(0, Number(sold.sale_amount) - sold.a.balance - (Number(sold.auction_fee) || 0)))}</b></div>}
          <Field label="Notes" className="mt-3"><Textarea value={sold.notes} onChange={(e) => setSold({ ...sold, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}
