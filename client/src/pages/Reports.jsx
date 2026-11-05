import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Printer, FileText } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { money, date, dateTime, pct, num, monthStart, today, addDays } from '../lib/format.js';
import { Card, PageHeader, Button, Spinner, Input, Select, ErrorBox, cx } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';

const fmt = (type, v) => (v === null || v === undefined || v === '' ? '' : type === 'money' ? money(v) : type === 'pct' ? pct(v) : type === 'number' ? num(v) : type === 'date' ? date(String(v).slice(0, 10)) : type === 'datetime' ? dateTime(v) : v);
const PRESETS = [['This month', () => [monthStart(), today()]], ['Last 30 days', () => [addDays(today(), -30), today()]], ['Last month', () => { const d = new Date(); const s = new Date(d.getFullYear(), d.getMonth() - 1, 1), e = new Date(d.getFullYear(), d.getMonth(), 0); const f = (x) => x.toISOString().slice(0, 10); return [f(s), f(e)]; }], ['Year to date', () => [today().slice(0, 4) + '-01-01', today()]], ['Last 12 months', () => [addDays(today(), -365), today()]]];

export default function Reports() {
  const { fac, facility, facilityObj } = useApp();
  const [sp, setSp] = useSearchParams();
  const { data: list } = useApi('/reports');
  const key = sp.get('r') || 'rent_roll';
  const [range, setRange] = useState([monthStart(), today()]);
  const def = list?.find((r) => r.key === key);
  const { data, loading, error } = useApi(list ? fac(`/reports/${key}?from=${range[0]}&to=${range[1]}`) : null);
  if (!list) return <Spinner />;
  const groups = [...new Set(list.map((r) => r.group))];

  return (
    <div>
      <PageHeader icon={BarChart3} title="Reports" subtitle={facility === 'all' ? 'All facilities' : facilityObj?.name} />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="h-fit no-print" bodyClass="py-2">
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g}</div>
              {list.filter((r) => r.group === g).map((r) => (
                <button key={r.key} onClick={() => setSp({ r: r.key })} className={cx('flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm', r.key === key ? 'bg-brand-50 font-medium text-brand-700' : 'hover:bg-slate-50')}><FileText className="h-3.5 w-3.5 shrink-0 opacity-50" />{r.name}</button>
              ))}
            </div>
          ))}
        </Card>
        <div className="lg:col-span-3">
          <Card title={def?.name} subtitle={def?.desc} actions={<Button size="sm" variant="secondary" icon={Printer} onClick={() => window.print()}>Print / PDF</Button>} bodyClass="">
            <div className="print-only px-4 pt-2 text-xs">{data?.facilities?.join(', ')} · {def?.range ? `${date(range[0])} – ${date(range[1])}` : `As of ${date(today())}`} · Generated {dateTime(data?.generated)}</div>
            {def?.range && (
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5 no-print">
                <Input type="date" className="w-auto py-1.5" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} />
                <span className="text-slate-400">to</span>
                <Input type="date" className="w-auto py-1.5" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} />
                {PRESETS.map(([l, f]) => <button key={l} onClick={() => setRange(f())} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs hover:bg-slate-200">{l}</button>)}
              </div>
            )}
            <ErrorBox error={error} />
            {loading && !data ? <Spinner /> : data && (
              <>
                {data.summary && <div className="flex flex-wrap gap-3 border-b border-slate-100 px-4 py-3">{data.summary.map((s) => <div key={s.label} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-xs capitalize text-slate-500">{s.label}</div><div className="font-semibold">{fmt(s.type, s.value)}</div></div>)}</div>}
                <DataTable key={key} rows={data.rows} exportName={`${key}-${today()}`} pageSize={100}
                  columns={data.columns.map((c) => ({ key: c.key, label: c.label, align: ['money', 'number', 'pct'].includes(c.type) ? 'right' : undefined, render: (r) => fmt(c.type, r[c.key]) }))}
                  footer={data.totals && <tr>{data.columns.map((c) => <td key={c.key} className={cx('px-3 py-2 text-sm', ['money', 'number', 'pct'].includes(c.type) && 'text-right tabular-nums')}>{data.totals[c.key] !== undefined ? (typeof data.totals[c.key] === 'string' ? data.totals[c.key] : fmt(c.type, data.totals[c.key])) : ''}</td>)}</tr>} />
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
