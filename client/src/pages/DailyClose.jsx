import { useEffect, useState } from 'react';
import { Calculator, Lock, CheckCircle2, Printer, AlertTriangle } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, date, dateTime, titleCase, today } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Field, Input, Textarea, useAction, Empty } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { RequireFacility } from '../components/Layout.jsx';

export default function DailyClose() { return <RequireFacility what="Daily close"><Close /></RequireFacility>; }

function Close() {
  const { facility, facilityObj } = useApp();
  const [day, setDay] = useState(today());
  const { data, loading, reload } = useApi(`/daily-close?facility=${facility}&date=${day}`);
  const [f, setF] = useState({ counted_cash: '', counted_check: '', deposit_ref: '', notes: '' });
  const [run, busy] = useAction();
  useEffect(() => { setF({ counted_cash: '', counted_check: '', deposit_ref: `DEP-${day.replace(/-/g, '')}`, notes: '' }); }, [day]);
  if (loading && !data) return <Spinner />;
  const by = data.byMethod;
  const cash = by.cash || 0, check = (by.check || 0) + (by.money_order || 0);
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const variance = (Number(f.counted_cash || 0) - cash) + (Number(f.counted_check || 0) - check);
  const c = data.close;

  return (
    <div className="space-y-4">
      <PageHeader icon={Calculator} title="Daily Close" subtitle={facilityObj?.name} actions={<><Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} className="w-auto" /><Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button></>} />
      <div className="print-only mb-2 text-lg font-bold">Daily Close – {facilityObj?.name} – {date(day)}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[['Cash', by.cash], ['Checks / MO', check], ['Card', by.card], ['ACH', by.ach], ['Total receipts', total]].map(([l, v]) => (
          <div key={l} className="card p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-xl font-bold tabular-nums">{money(v || 0)}</div></div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={c ? 'Day closed' : 'Count the drawer & close'} className="h-fit">
          {c ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" /> Closed by {c.user_name} at {dateTime(c.created_at)}</div>
              <div className="flex justify-between"><span>Expected cash</span><span>{money(c.expected_cash)}</span></div>
              <div className="flex justify-between"><span>Counted cash</span><span>{money(c.counted_cash)}</span></div>
              <div className="flex justify-between"><span>Expected checks</span><span>{money(c.expected_check)}</span></div>
              <div className="flex justify-between"><span>Counted checks</span><span>{money(c.counted_check)}</span></div>
              <div className="flex justify-between font-semibold"><span>Variance</span><span className={c.variance ? 'text-red-600' : 'text-emerald-600'}>{money(c.variance)}</span></div>
              <div className="flex justify-between"><span>Deposit ref</span><span>{c.deposit_ref}</span></div>
              {c.notes && <div className="rounded bg-slate-50 p-2 text-xs">{c.notes}</div>}
            </div>
          ) : (
            <div className="space-y-3">
              <Field label={`Cash counted (expected ${money(cash)})`}><Input type="number" step="0.01" value={f.counted_cash} onChange={(e) => setF({ ...f, counted_cash: e.target.value })} placeholder={cash.toFixed(2)} /></Field>
              <Field label={`Checks / money orders counted (expected ${money(check)})`}><Input type="number" step="0.01" value={f.counted_check} onChange={(e) => setF({ ...f, counted_check: e.target.value })} placeholder={check.toFixed(2)} /></Field>
              {(f.counted_cash !== '' || f.counted_check !== '') && <div className={`rounded-md px-3 py-2 text-sm font-medium ${Math.abs(variance) < 0.005 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{Math.abs(variance) < 0.005 ? 'Drawer balances ✓' : <><AlertTriangle className="mr-1 inline h-4 w-4" />Variance {money(variance)} – explain in notes</>}</div>}
              <Field label="Deposit reference / bag #"><Input value={f.deposit_ref} onChange={(e) => setF({ ...f, deposit_ref: e.target.value })} /></Field>
              <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
              <Button className="w-full" icon={Lock} loading={busy} onClick={() => run(() => api.post('/daily-close', { facility_id: Number(facility), date: day, counted_cash: f.counted_cash === '' ? cash : Number(f.counted_cash), counted_check: f.counted_check === '' ? check : Number(f.counted_check), deposit_ref: f.deposit_ref, notes: f.notes }).then(reload), 'Day closed')}>Close {date(day)}</Button>
            </div>
          )}
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title={`Transactions (${data.transactions.length})`} bodyClass="">
            <DataTable rows={data.transactions} searchable={false} pageSize={0} dense rowClass={(t) => (t.voided ? 'line-through opacity-50' : '')} columns={[
              { key: 'id', label: '#' }, { key: 'name', label: 'Customer', render: (t) => (t.first_name ? `${t.first_name} ${t.last_name}` : 'Walk-in') },
              { key: 'description', label: 'Description' }, { key: 'method', label: 'Method', render: (t) => titleCase(t.method) }, { key: 'reference', label: 'Ref' },
              { key: 'amount', label: 'Amount', align: 'right', render: (t) => money(t.type === 'refund' ? -t.amount : t.amount) }, { key: 'user_name', label: 'By' },
            ]} empty={<Empty title="No payments this day" />} />
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Charges posted">
              {data.charges.map((x) => <div key={x.category} className="flex justify-between py-0.5 text-sm"><span>{titleCase(x.category)} <span className="text-xs text-slate-400">×{x.n}</span></span><span className="tabular-nums">{money(x.total)}</span></div>)}
              {!data.charges.length && <div className="text-sm text-slate-400">None</div>}
            </Card>
            <Card title="Activity"><div className="text-sm">Move-ins: <b>{data.moves.in}</b><br />Move-outs: <b>{data.moves.out}</b></div></Card>
          </div>
        </div>
      </div>

      <Card title="Close history" bodyClass="" className="no-print">
        <DataTable rows={data.history} searchable={false} pageSize={10} onRowClick={(h) => setDay(h.date)} exportName="daily-close-history" columns={[
          { key: 'date', label: 'Date', render: (h) => date(h.date) }, { key: 'total', label: 'Total', align: 'right', render: (h) => money(h.total) },
          { key: 'counted_cash', label: 'Cash', align: 'right', render: (h) => money(h.counted_cash) }, { key: 'card_total', label: 'Card', align: 'right', render: (h) => money(h.card_total) },
          { key: 'variance', label: 'Variance', align: 'right', render: (h) => <span className={h.variance ? 'font-semibold text-red-600' : 'text-emerald-600'}>{money(h.variance)}</span> },
          { key: 'deposit_ref', label: 'Deposit' }, { key: 'user_name', label: 'Closed By' },
        ]} />
      </Card>
    </div>
  );
}
