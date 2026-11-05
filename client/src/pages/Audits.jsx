import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { ClipboardCheck, CheckCircle2, Circle, Clock, Plus } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { date, today } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, useAction } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'];
export const STATUS = { draft: { color: 'amber', label: 'In progress' }, submitted: { color: 'blue', label: 'Awaiting manager' }, acknowledged: { color: 'green', label: 'Acknowledged' } };
const pctScore = (a) => (a.max_score ? Math.round((a.score / a.max_score) * 100) : 0);

export default function Audits() {
  const { fac, can, facility } = useApp();
  const { data } = useApi(fac('/audits'));
  const nav = useNavigate();
  const [run, busy] = useAction();
  if (!data) return <Spinner />;
  const start = (fid) => run(async () => { const r = await api.post('/audits', { facility_id: fid, visit_date: today() }); nav(`/audits/${r.id}`); }, 'Audit started');
  const codes = [...new Set(data.list.map((a) => a.facility_code))].slice(0, 3);
  const monthName = new Date(data.period + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      <PageHeader icon={ClipboardCheck} title="Property Audits" subtitle="Monthly district / area manager visits with scorecard and notes for the property manager" />
      <Card title={`${monthName} visit checklist`} subtitle="Every facility should be visited once per month">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.checklist.map((c) => (
            <div key={c.facility_id} className={`flex items-center gap-3 rounded-lg border p-3 ${c.audit && c.audit.status !== 'draft' ? 'border-emerald-200 bg-emerald-50/50' : c.audit ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'}`}>
              {c.audit && c.audit.status !== 'draft' ? <CheckCircle2 className="h-7 w-7 text-emerald-500" /> : c.audit ? <Clock className="h-7 w-7 text-amber-500" /> : <Circle className="h-7 w-7 text-slate-300" />}
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-slate-500">{c.audit ? `${STATUS[c.audit.status].label} · ${date(c.audit.visit_date)} · ${c.audit.auditor} · ${pctScore(c.audit)}%` : 'Not visited this month'}</div>
              </div>
              {c.audit ? <Button size="sm" variant="secondary" onClick={() => nav(`/audits/${c.audit.id}`)}>Open</Button> : can('audits.perform') && <Button size="sm" icon={Plus} loading={busy} onClick={() => start(c.facility_id)}>Start Visit</Button>}
            </div>
          ))}
        </div>
      </Card>
      {data.trend.length > 1 && (
        <Card title="Audit score trend" subtitle="Score % by month">
          <div className="h-60">
            <ResponsiveContainer>
              <LineChart data={data.trend} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="period" tickFormatter={(m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' })} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis domain={[50, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} formatter={(v) => `${v}%`} />
                {codes.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />}
                {codes.map((c, i) => <Line key={c} type="monotone" dataKey={c} stroke={SERIES[i]} strokeWidth={2} dot={{ r: 4, fill: SERIES[i], stroke: '#fff', strokeWidth: 2 }} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <Card title="All audits" bodyClass="">
        <DataTable rows={data.list} exportName="audits" onRowClick={(a) => nav(`/audits/${a.id}`)} columns={[
          { key: 'period', label: 'Month' }, facility === 'all' && { key: 'facility_name', label: 'Facility' },
          { key: 'visit_date', label: 'Visit', render: (a) => date(a.visit_date) }, { key: 'auditor', label: 'Auditor' },
          { key: 'score', label: 'Score', align: 'right', sortValue: pctScore, render: (a) => <span className={pctScore(a) < 80 ? 'font-semibold text-red-600' : 'font-semibold'}>{pctScore(a)}%</span> },
          { key: 'status', label: 'Status', render: (a) => <Badge color={STATUS[a.status].color}>{STATUS[a.status].label}</Badge> },
          { key: 'open_tasks', label: 'Open follow-ups', align: 'right' },
        ].filter(Boolean)} />
      </Card>
    </div>
  );
}
