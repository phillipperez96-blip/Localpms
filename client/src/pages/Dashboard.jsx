import { useNavigate, Link } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend } from 'recharts';
import { Building, DoorOpen, DoorClosed, AlertTriangle, PhoneCall, Percent, DollarSign, Gavel, ClipboardCheck, ShoppingCart, LayoutDashboard, CheckCircle2, Circle, ArrowRight, Lock, ListTodo, Zap } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { money, pct, date, lienLabel, num } from '../lib/format.js';
import { Card, Stat, Spinner, ErrorBox, Badge, PageHeader, Empty, lienColor, daysColor, cx } from '../components/ui.jsx';
import { LienAlertList } from '../components/LienAlerts.jsx';
import { titleCase } from '../lib/format.js';

const S1 = '#2a78d6', S2 = '#eb6834';
const monthLabel = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' });
const tip = { contentStyle: { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }, cursor: { fill: 'rgba(100,116,139,0.08)' } };

export default function Dashboard() {
  const { fac, facility, facilityObj, can, user, alerts } = useApp();
  const { data: d, loading, error } = useApi(fac('/dashboard'));
  const auto = useApi(fac('/reminders/auto'));
  const nav = useNavigate();
  const isAll = facility === 'all';
  if (loading && !d) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!d) return null;
  const aging = Object.entries(d.pastDue.aging).map(([k, v]) => ({ bucket: k + ' days', amount: v, count: d.pastDue.agingCount[k] }));

  return (
    <div className="space-y-5">
      <PageHeader icon={LayoutDashboard} title={isAll ? 'Portfolio Dashboard' : facilityObj?.name} subtitle={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]} · ${date(d.asOf)}`} />

      <LienAlertList items={alerts.lienPayments} showFacility={isAll} />

      {d.unclosed && can('dailyclose.perform') && (
        <Link to="/daily-close" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 hover:bg-amber-100"><AlertTriangle className="h-4 w-4" /> Yesterday's daily close has not been completed. <span className="ml-auto font-medium">Close now →</span></Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Unit Occupancy" value={pct(d.occupancy.unit)} sub={`${num(d.units.occupied)} of ${num(d.units.rentable)} units`} icon={Building} tone="blue" onClick={() => nav('/units')} />
        <Stat label="Vacant Units" value={num(d.units.vacant)} sub={`${d.units.reserved} reserved · ${d.units.unrentable} unrentable`} icon={Percent} tone="green" onClick={() => nav('/units?status=vacant')} />
        <Stat label="Past Due" value={money(d.pastDue.amount, { whole: true })} sub={`${d.pastDue.count} tenants · ${pct(d.pastDue.pct)} of rentals`} icon={AlertTriangle} tone="red" onClick={() => nav('/past-dues')} />
        <Stat label="Move-Ins (MTD)" value={d.moves.inMTD} sub={`${d.moves.inToday} today`} icon={DoorOpen} tone="green" onClick={() => nav('/reports?r=move_activity')} />
        <Stat label="Move-Outs (MTD)" value={d.moves.outMTD} sub={`${d.moves.outToday} today · net ${d.moves.net >= 0 ? '+' : ''}${d.moves.net}`} icon={DoorClosed} tone="amber" onClick={() => nav('/reports?r=move_activity')} />
        <Stat label="Open Leads" value={d.leads.open} sub={`${d.leads.new} new · ${d.leads.reservations} reservations`} icon={PhoneCall} tone="purple" onClick={() => nav('/leads')} />
      </div>

      <Card title={<span className="flex items-center gap-2"><ListTodo className="h-4 w-4 text-brand-600" />Reminders & tasks</span>} actions={<Link to="/reminders" className="link text-xs">Open reminders</Link>} bodyClass="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="divide-y divide-slate-100">
          <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">To-do · due soon</div>
          {d.tasks.length === 0 && d.followUps.length === 0 && <Empty title="All caught up" />}
          {d.tasks.map((t) => (
            <Link to="/reminders" key={t.id} className="flex items-start gap-2 px-4 py-2.5 hover:bg-slate-50">
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm">{t.title}</div><div className="text-xs text-slate-500">{t.assignee || 'Unassigned'} · due {date(t.due_date)}</div></div>
              {(t.priority === 'high' || t.priority === 'urgent') && <Badge color="red">{t.priority === 'urgent' ? 'Urgent' : 'High'}</Badge>}
            </Link>
          ))}
          {d.followUps.map((l) => (
            <Link to={`/leads?open=${l.id}`} key={'l' + l.id} className="flex items-start gap-2 px-4 py-2.5 hover:bg-slate-50">
              <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm">Follow up: {l.first_name} {l.last_name}</div><div className="text-xs text-slate-500">{l.size_wanted} · {l.source} · {l.phone}</div></div>
            </Link>
          ))}
        </div>
        <div className="divide-y divide-slate-100">
          <div className="flex items-center gap-1 px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500"><Zap className="h-3.5 w-3.5 text-amber-500" />Automatic reminders</div>
          {(auto.data || []).slice(0, 8).map((a, i) => (
            <Link key={i} to={a.link} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
              <Badge color={{ auction: 'red', overlock: 'black', close: 'amber', inventory: 'amber' }[a.kind] || 'purple'}>{titleCase(a.kind)}</Badge>
              <span className="min-w-0 flex-1 truncate">{a.title}</span>
              <span className={cx('whitespace-nowrap text-xs', a.due < d.asOf ? 'text-red-600' : 'text-slate-500')}>{a.due === d.asOf ? 'Today' : date(a.due)}</span>
            </Link>
          ))}
          {auto.data && !auto.data.length && <Empty title="Nothing automatic right now" />}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Sq Ft Occupancy" value={pct(d.occupancy.sqft)} sub={`${num(d.occupancy.sqftOcc)} / ${num(d.occupancy.sqftTotal)} sq ft`} />
        <MiniStat label="Economic Occupancy" value={pct(d.occupancy.economic)} sub={`${money(d.occupancy.inPlace, { whole: true })} of ${money(d.occupancy.gpr, { whole: true })} potential`} />
        <MiniStat label="Collected (MTD)" value={money(d.revenue.collectedMTD, { whole: true })} sub={`${money(d.revenue.collectedToday)} today`} />
        <MiniStat label="Protection Enrollment" value={pct(d.revenue.insurancePct)} sub={`Merch MTD ${money(d.revenue.merchMTD)}`} />
      </div>

      {isAll && can('portfolio.view') && <Portfolio />}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Occupancy – last 12 months" className="xl:col-span-2" subtitle="Unit occupancy at month end">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={d.trend} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis domain={['dataMin - 3', 100]} tickFormatter={(v) => `${Math.round(v)}%`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip {...tip} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} labelFormatter={monthLabel} formatter={(v) => [pct(v), 'Occupancy']} />
                <Line type="monotone" dataKey="occupancy" stroke={S1} strokeWidth={2} dot={{ r: 3, fill: S1, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Past-due aging" subtitle={`${money(d.pastDue.amount)} across ${d.pastDue.count} tenants`}>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={aging} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip {...tip} formatter={(v, n, p) => [`${money(v)} (${p.payload.count} tenants)`, 'Past due']} />
                <Bar dataKey="amount" fill="#e34948" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Move-ins vs. move-outs" className="xl:col-span-3">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={d.trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip {...tip} labelFormatter={monthLabel} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="moveIns" name="Move-ins" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="moveOuts" name="Move-outs" fill={S2} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Largest past-due balances" className="xl:col-span-2" actions={<Link to="/past-dues" className="link text-xs">Manage past dues</Link>} bodyClass="">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="th">Tenant</th><th className="th">Unit</th><th className="th text-right">Past Due</th><th className="th text-right">Days</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.topPastDue.map((t) => (
                <tr key={t.tenant_id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/tenants/${t.tenant_id}`)}>
                  <td className="td font-medium">{t.name}{isAll && <span className="ml-1 text-xs text-slate-400">{t.facility_code}</span>}</td><td className="td">{t.unit}</td>
                  <td className="td text-right tabular-nums">{money(t.pastDue)}</td><td className="td text-right"><Badge color={daysColor(t.daysLate)}>{t.daysLate}</Badge></td>
                  <td className="td"><Badge color={lienColor(t.lien_status)}>{lienLabel(t.lien_status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.topPastDue.length && <Empty title="No past-due tenants 🎉" />}
        </Card>
        <div className="space-y-4">
          {!isAll && (
            <Card title="Monthly property audit">
              {d.audit ? (
                <Link to={`/audits/${d.audit.id}`} className="flex items-center gap-3">
                  {d.audit.status === 'draft' ? <ClipboardCheck className="h-8 w-8 text-amber-500" /> : <CheckCircle2 className="h-8 w-8 text-emerald-500" />}
                  <div className="text-sm">
                    <div className="font-medium">{d.audit.status === 'draft' ? 'Visit in progress' : 'Visit completed'} – {date(d.audit.visit_date)}</div>
                    <div className="text-slate-500">{d.audit.auditor} · Score {d.audit.max_score ? Math.round((d.audit.score / d.audit.max_score) * 100) : 0}% · <span className="capitalize">{d.audit.status}</span></div>
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 text-slate-400" />
                </Link>
              ) : <div className="flex items-center gap-3 text-sm"><Circle className="h-8 w-8 text-slate-300" /><div><div className="font-medium">Not visited yet this month</div><Link to="/audits" className="link text-xs">Go to audits</Link></div></div>}
            </Card>
          )}
          <Card title="At a glance" bodyClass="divide-y divide-slate-100">
            <Glance icon={Gavel} label="Auctions scheduled" value={d.auctionsScheduled} to="/past-dues?tab=auctions" />
            <Glance icon={Lock} label="Units overlocked" value={d.units.overlocked} to="/walkthrough" />
            <Glance icon={ShoppingCart} label="Products to reorder" value={d.lowStock} to="/merchandise?tab=inventory" />
            <Glance icon={PhoneCall} label="Lead follow-ups due" value={d.leads.followUps} to="/leads" />
            <Glance icon={DollarSign} label="Collected today" value={money(d.revenue.collectedToday)} to={!isAll ? '/daily-close' : '/reports?r=payments'} />
          </Card>
          {d.upcomingAuctions.length > 0 && (
            <Card title="Upcoming auctions" bodyClass="divide-y divide-slate-100">
              {d.upcomingAuctions.map((a) => (
                <Link key={a.id} to={`/tenants/${a.tenant_id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-50"><span>Unit {a.number} · {a.first_name} {a.last_name}</span><span className="text-xs text-slate-500">{date(a.scheduled_date)}</span></Link>
              ))}
            </Card>
          )}
        </div>
      </div>

      <Card title="Recent move activity (14 days)" bodyClass="">
        <table className="min-w-full divide-y divide-slate-100">
          <tbody className="divide-y divide-slate-100">
            {d.recentMoves.map((m) => (
              <tr key={m.id + m.kind} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/tenants/${m.tenant_id}`)}>
                <td className="td w-28">{m.kind === 'in' ? <Badge color="green">Move-in</Badge> : <Badge color="orange">Move-out</Badge>}</td>
                <td className="td font-medium">{m.first_name} {m.last_name}</td><td className="td">Unit {m.number}</td>
                <td className="td text-right text-slate-500">{date(m.kind === 'in' ? m.move_in_date : m.move_out_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!d.recentMoves.length && <Empty title="No recent moves" />}
      </Card>
    </div>
  );
}

const MiniStat = ({ label, value, sub }) => (
  <div className="card px-4 py-3"><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-semibold tabular-nums">{value}</div><div className="truncate text-xs text-slate-400">{sub}</div></div>
);
const Glance = ({ icon: Icon, label, value, to }) => (
  <Link to={to} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50"><Icon className="h-4 w-4 text-slate-400" /><span className="flex-1">{label}</span><span className="font-semibold tabular-nums">{value}</span></Link>
);

function Portfolio() {
  const { data } = useApi('/portfolio');
  const { setFacility } = useApp();
  if (!data) return null;
  return (
    <Card title="Facilities" subtitle="Click a facility to switch to it" bodyClass="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50"><tr>
          {['Facility', 'Occupancy', 'Econ. Occ', 'Vacant', 'Past Due', 'Move-ins', 'Move-outs', 'Open Leads', 'Collected MTD', 'Audit this month', 'Last Close'].map((h) => <th key={h} className="th">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {data.facilities.map((f) => (
            <tr key={f.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setFacility(f.id)}>
              <td className="td"><div className="whitespace-nowrap font-medium">{f.name}</div><div className="text-xs text-slate-500">{f.city}, {f.state}</div></td>
              <td className="td">
                <div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${f.occupancy.unit}%` }} /></div><span className="tabular-nums">{pct(f.occupancy.unit)}</span></div>
              </td>
              <td className="td tabular-nums">{pct(f.occupancy.economic)}</td>
              <td className="td tabular-nums">{f.units.vacant}</td>
              <td className="td tabular-nums"><span className={f.pastDue.pct > 10 ? 'font-semibold text-red-600' : ''}>{money(f.pastDue.amount, { whole: true })}</span><span className="text-xs text-slate-400"> · {f.pastDue.count}</span></td>
              <td className="td tabular-nums">{f.moves.inMTD}</td><td className="td tabular-nums">{f.moves.outMTD}</td><td className="td tabular-nums">{f.leads.open}</td>
              <td className="td tabular-nums">{money(f.revenue.collectedMTD, { whole: true })}</td>
              <td className="td">{f.audit ? <Badge color={f.audit.status === 'draft' ? 'amber' : 'green'}>{f.audit.status === 'draft' ? 'In progress' : `✓ ${date(f.audit.visit_date)}`}</Badge> : <Badge color="red">Not visited</Badge>}</td>
              <td className="td text-xs text-slate-500">{date(f.lastClose)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
