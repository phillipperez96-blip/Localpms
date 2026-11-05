import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Users, DoorOpen, DollarSign, ShieldCheck, Repeat, Lock } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { money, date, lienLabel } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, ErrorBox, Tabs, lienColor, daysColor } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { PaymentModal } from '../components/Payment.jsx';

export default function Tenants() {
  const { fac, facility, can } = useApp();
  const [status, setStatus] = useState('active');
  const [filter, setFilter] = useState('all');
  const [sp, setSp] = useSearchParams();
  const payMode = sp.get('pay') === '1';
  const [payFor, setPayFor] = useState(null);
  const { data, loading, error, reload } = useApi(fac(`/tenants?status=${status}`));
  const nav = useNavigate();
  const rows = (data || []).filter((t) => filter === 'all' || (filter === 'pastdue' && t.daysLate > 0 && t.balance > 0) || (filter === 'autopay' && t.autopay) || (filter === 'uninsured' && !t.insured && t.status === 'active') || (filter === 'credit' && t.balance < 0) || (filter === 'denied' && !t.gate_allowed && t.status === 'active'));
  const count = (f) => (data || []).filter((t) => (f === 'pastdue' ? t.daysLate > 0 && t.balance > 0 : f === 'autopay' ? t.autopay : f === 'uninsured' ? !t.insured : f === 'credit' ? t.balance < 0 : !t.gate_allowed)).length;

  const cols = [
    { key: 'name', label: 'Tenant', sortValue: (t) => `${t.last_name} ${t.first_name}`, searchValue: (t) => `${t.first_name} ${t.last_name} ${t.company || ''}`, csv: (t) => `${t.first_name} ${t.last_name}`,
      render: (t) => <div><div className="font-medium text-slate-900">{t.last_name}, {t.first_name} {t.military ? <span title="Military" className="text-xs">🎖</span> : null}</div>{t.company && <div className="text-xs text-slate-500">{t.company}</div>}</div> },
    facility === 'all' && { key: 'facility_code', label: 'Fac' },
    { key: 'units', label: 'Units', render: (t) => t.units || <span className="text-slate-400">—</span> },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email', render: (t) => <span className="text-slate-600">{t.email}</span> },
    { key: 'rent', label: 'Rent', align: 'right', render: (t) => money(t.rent) },
    { key: 'balance', label: 'Balance', align: 'right', render: (t) => <span className={t.balance > 0 ? (t.daysLate > 0 ? 'font-semibold text-red-600' : 'text-slate-800') : t.balance < 0 ? 'text-emerald-600' : 'text-slate-400'}>{money(t.balance)}</span> },
    { key: 'daysLate', label: 'Status', render: (t) => t.status === 'former' ? <Badge>Former</Badge> : t.daysLate > 0 && t.balance > 0 ? <Badge color={daysColor(t.daysLate)}>{t.daysLate}d · {lienLabel(t.lien_status)}</Badge> : <Badge color="green">Current</Badge> },
    { key: 'flags', label: '', sortable: false, csv: false, render: (t) => (
      <div className="flex gap-1 text-slate-400">
        {t.autopay ? <Repeat className="h-4 w-4 text-brand-500" title="Autopay" /> : null}
        {t.insured ? <ShieldCheck className="h-4 w-4 text-emerald-500" title="Protection plan" /> : null}
        {t.status === 'active' && !t.gate_allowed ? <Lock className="h-4 w-4 text-red-500" title={`Gate denied: ${t.gate_reason}`} /> : null}
      </div>) },
    { key: 'since', label: 'Since', render: (t) => date(t.since) },
    payMode && { key: 'pay', label: '', sortable: false, csv: false, render: (t) => <Button size="sm" variant="success" icon={DollarSign} onClick={(e) => { e.stopPropagation(); setPayFor(t); }}>Pay</Button> },
  ].filter(Boolean);

  return (
    <div>
      <PageHeader icon={Users} title="Tenants" subtitle="All tenant accounts" actions={can('movein.perform') && <Button icon={DoorOpen} onClick={() => nav('/move-in')}>New Move-In</Button>} />
      {payMode && <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">Find the tenant and click <b className="mx-1">Pay</b> to take a payment.<button className="link" onClick={() => setSp({})}>Done</button></div>}
      <Tabs value={status} onChange={setStatus} tabs={[{ value: 'active', label: 'Active' }, { value: 'former', label: 'Former' }, { value: 'all', label: 'All' }]} />
      <ErrorBox error={error} />
      <Card bodyClass="">
        {loading && !data ? <Spinner /> : (
          <DataTable columns={cols} rows={rows} exportName="tenants" onRowClick={(t) => nav(`/tenants/${t.id}`)} initialSort={{ key: 'name', dir: 'asc' }}
            toolbar={[['all', 'All'], ['pastdue', 'Past due'], ['credit', 'Credit balance'], ['autopay', 'Autopay'], ['uninsured', 'No protection'], ['denied', 'Gate denied']].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}{k !== 'all' && data ? ` (${count(k)})` : ''}</button>
            ))} />
        )}
      </Card>
      {payFor && <PaymentModal open tenant={payFor} balance={payFor.balance} onClose={() => setPayFor(null)} onPaid={reload} />}
    </div>
  );
}
