import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, RefreshCw, Lock, Unlock, Activity, Settings2, Radio } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, dateTime, titleCase } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Tabs, Field, Input, Select, useAction, Stat } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

export default function Gate() {
  const { fac, facility, can } = useApp();
  const { data, reload } = useApi(fac('/gate'));
  const [tab, setTab] = useState('codes');
  const [show, setShow] = useState('all');
  const [code, setCode] = useState('');
  const [sim, setSim] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Spinner />;
  const denied = data.rows.filter((r) => !r.allowed);
  const rows = data.rows.filter((r) => show === 'all' || (show === 'denied' ? !r.allowed : r.gate_access !== 'auto'));
  const setAccess = (r, access) => run(() => api.post(`/tenants/${r.id}/gate`, { access }).then(reload), 'Gate access updated');

  return (
    <div>
      <PageHeader icon={KeyRound} title="Gate Access" subtitle={data.connected ? 'Connected to gate system' : 'Demo mode – gate changes are simulated (connect in Settings → Integrations)'}
        actions={<Button variant="secondary" icon={RefreshCw} loading={busy} onClick={() => run(() => api.post(fac('/gate/sync'), { full: true }).then(reload), (r) => `Pushed ${r.pushed} codes to gate system`)}>Sync All Codes</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active codes" value={data.rows.length} icon={KeyRound} />
        <Stat label="Access denied" value={denied.length} icon={Lock} tone="red" onClick={() => { setTab('codes'); setShow('denied'); }} />
        <Stat label="Manual overrides" value={data.rows.filter((r) => r.gate_access !== 'auto').length} icon={Settings2} tone="amber" onClick={() => { setTab('codes'); setShow('override'); }} />
        <Card title="Lockout rule" bodyClass="px-4 py-3 text-sm">
          {data.settings.map((s) => <div key={s.id}>{data.settings.length > 1 && <b>{s.name}: </b>}Deny at <b>{s.gate_deny_days}</b>+ days past due</div>)}
          {can('settings.facility') && <Link to="/settings?tab=facility" className="link text-xs">Change per facility →</Link>}
        </Card>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'codes', label: 'Access Codes', icon: KeyRound }, { value: 'log', label: 'Gate Activity', icon: Activity }, { value: 'sim', label: 'Keypad Simulator', icon: Radio }]} />
      {tab === 'codes' && (
        <Card bodyClass="">
          <DataTable rows={rows} exportName="gate-codes" toolbar={<Select className="w-auto py-1.5" value={show} onChange={(e) => setShow(e.target.value)} options={[{ value: 'all', label: 'All tenants' }, { value: 'denied', label: 'Access denied' }, { value: 'override', label: 'Manual overrides' }]} />} columns={[
            { key: 'name', label: 'Tenant', render: (r) => <Link className="link" to={`/tenants/${r.id}`}>{r.name}</Link> }, { key: 'units', label: 'Units' },
            { key: 'gate_code', label: 'Code', render: (r) => <span className="font-mono">{r.gate_code}</span> },
            { key: 'allowed', label: 'Access', render: (r) => (r.allowed ? <Badge color="green"><Unlock className="h-3 w-3" />Allowed</Badge> : <Badge color="red"><Lock className="h-3 w-3" />Denied</Badge>) },
            { key: 'reason', label: 'Reason' }, { key: 'balance', label: 'Balance', align: 'right', render: (r) => money(r.balance) },
            { key: 'gate_access', label: 'Rule', render: (r) => <select className="input w-auto py-1 text-xs" value={r.gate_access} onChange={(e) => setAccess(r, e.target.value)}><option value="auto">Automatic</option><option value="allowed">Always allow</option><option value="denied">Always deny</option></select> },
            { key: 'synced', label: 'Synced', render: (r) => (r.synced ? <span className="text-xs text-emerald-600">✓</span> : <span className="text-xs text-amber-600">Pending</span>) },
          ]} />
        </Card>
      )}
      {tab === 'log' && (
        <Card bodyClass="">
          <DataTable rows={data.events} exportName="gate-activity" columns={[
            { key: 'created_at', label: 'When', render: (e) => dateTime(e.created_at) },
            { key: 'event', label: 'Event', render: (e) => <Badge color={e.event.includes('denied') || e.event.includes('suspend') || e.event.includes('removed') ? 'red' : e.event.includes('restored') || e.event.includes('created') ? 'green' : 'gray'}>{titleCase(e.event)}</Badge> },
            { key: 'name', label: 'Tenant', searchValue: (e) => `${e.first_name} ${e.last_name}`, render: (e) => (e.tenant_id ? <Link className="link" to={`/tenants/${e.tenant_id}`}>{e.first_name} {e.last_name}</Link> : 'Unknown') },
            { key: 'code', label: 'Code', render: (e) => <span className="font-mono">{e.code}</span> }, { key: 'number', label: 'Unit' }, { key: 'detail', label: 'Detail' },
          ]} />
        </Card>
      )}
      {tab === 'sim' && (
        <Card title="Keypad simulator" subtitle="Demo: enter a code to see how the gate would respond" className="max-w-md">
          <div className="flex gap-2"><Input className="font-mono text-lg tracking-widest" value={code} maxLength={8} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="Enter code" /><Button loading={busy} onClick={() => run(async () => { setSim(await api.post(fac('/gate/simulate'), { code })); reload(); })}>Enter</Button></div>
          {sim && <div className={`mt-4 rounded-lg p-4 text-center ${sim.event === 'entry' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}><div className="text-2xl font-bold">{sim.event === 'entry' ? 'ACCESS GRANTED' : 'ACCESS DENIED'}</div><div className="text-sm">{sim.tenant || ''} {sim.detail}</div></div>}
        </Card>
      )}
    </div>
  );
}
