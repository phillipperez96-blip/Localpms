import { useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { dateTime, titleCase, addDays, today } from '../lib/format.js';
import { Card, PageHeader, Badge, Spinner, Input, Select } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

export default function ActivityLog() {
  const { fac, facility } = useApp();
  const [f, setF] = useState({ from: addDays(today(), -30), to: today(), entity: '', user: '' });
  const users = useApi(fac('/users/lookup'));
  const { data } = useApi(fac(`/activity?from=${f.from}&to=${f.to}&entity=${f.entity}&user=${f.user}`));
  return (
    <div>
      <PageHeader icon={History} title="Activity Log" subtitle="Who did what, and when — every change is recorded" />
      <Card bodyClass="">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input type="date" className="w-auto" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <Input type="date" className="w-auto" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          <Select className="w-auto" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} placeholder="All areas" options={['tenant', 'unit', 'lead', 'audit', 'task', 'rates', 'settings', 'user', 'role', 'communication', 'daily_close', 'product', 'sale', 'gate', 'system']} />
          <Select className="w-auto" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} placeholder="All users" options={(users.data || []).map((u) => ({ value: u.id, label: u.name }))} />
        </div>
        {!data ? <Spinner /> : (
          <DataTable rows={data} exportName="activity-log" pageSize={50} columns={[
            { key: 'created_at', label: 'When', render: (a) => <span className="whitespace-nowrap text-xs">{dateTime(a.created_at)}</span> },
            facility === 'all' && { key: 'facility_code', label: 'Fac' },
            { key: 'user_name', label: 'User', render: (a) => a.user_name || <Badge>System</Badge> },
            { key: 'entity_type', label: 'Area', render: (a) => <Badge color="blue">{titleCase(a.entity_type)}</Badge> },
            { key: 'action', label: 'Action', render: (a) => titleCase(a.action) },
            { key: 'details', label: 'Details', render: (a) => a.entity_type === 'tenant' && a.entity_id ? <Link className="hover:underline" to={`/tenants/${a.entity_id}`}>{a.details}</Link> : a.entity_type === 'audit' && a.entity_id ? <Link className="hover:underline" to={`/audits/${a.entity_id}`}>{a.details}</Link> : a.details },
          ].filter(Boolean)} />
        )}
      </Card>
    </div>
  );
}
