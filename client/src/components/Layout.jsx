import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, DoorOpen, Map, PhoneCall, AlertTriangle, MessageSquare, ShoppingCart, Calculator, TrendingUp, ListTodo,
  ClipboardList, KeyRound, ClipboardCheck, BarChart3, History, Settings, Search, LogOut, Building2, Menu, X, Warehouse, UserPlus, DollarSign, ChevronDown,
} from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { cx, Badge } from './ui.jsx';

const NAV = [
  { section: 'Operations', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view', end: true },
    { to: '/tenants', label: 'Tenants', icon: Users, perm: 'tenants.view' },
    { to: '/move-in', label: 'Move-In', icon: DoorOpen, perm: 'movein.perform' },
    { to: '/units', label: 'Units & Site Map', icon: Map, perm: 'units.view' },
    { to: '/reminders', label: 'Reminders', icon: ListTodo },
    { to: '/walkthrough', label: 'Walkthrough', icon: ClipboardList, perm: 'walkthrough.view' },
    { to: '/gate', label: 'Gate Access', icon: KeyRound, perm: 'gate.manage' },
  ] },
  { section: 'Collections', items: [
    { to: '/past-dues', label: 'Past Dues & Auctions', icon: AlertTriangle, perm: 'pastdue.manage' },
    { to: '/communications', label: 'Communications', icon: MessageSquare, perm: 'communications.send' },
  ] },
  { section: 'Sales & Accounting', items: [
    { to: '/leads', label: 'Leads & Reservations', icon: PhoneCall, perm: 'leads.manage' },
    { to: '/merchandise', label: 'Merchandise', icon: ShoppingCart, perm: ['merch.sell', 'inventory.manage'] },
    { to: '/daily-close', label: 'Daily Close', icon: Calculator, perm: 'dailyclose.perform' },
    { to: '/rates', label: 'Rate Management', icon: TrendingUp, perm: 'rates.manage' },
  ] },
  { section: 'Oversight', items: [
    { to: '/audits', label: 'Property Audits', icon: ClipboardCheck, perm: ['audits.view', 'audits.perform'] },
    { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports.view' },
    { to: '/activity', label: 'Activity Log', icon: History, perm: 'activity.view' },
    { to: '/settings', label: 'Settings', icon: Settings, perm: ['settings.facility', 'settings.users', 'settings.roles', 'settings.integrations', 'templates.manage'] },
  ] },
];

export function allowed(can, perm) { return !perm || (Array.isArray(perm) ? perm.some(can) : can(perm)); }

export default function Layout() {
  const { user, can, logout, me } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const demo = me && !me.integrations.payments;

  return (
    <div className="flex h-full">
      {/* sidebar */}
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900 text-slate-300 transition-transform lg:static lg:translate-x-0 no-print', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
          <div className="rounded-lg bg-brand-600 p-1.5"><Warehouse className="h-5 w-5 text-white" /></div>
          <div className="leading-tight"><div className="font-bold text-white">LocalPMS</div><div className="text-[11px] text-slate-400">Storage Management</div></div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((g) => {
            const items = g.items.filter((i) => allowed(can, i.perm));
            if (!items.length) return null;
            return (
              <div key={g.section} className="mb-4">
                <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.section}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx('mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition', isActive ? 'bg-brand-600 text-white' : 'hover:bg-white/5 hover:text-white')}>
                    <i.icon className="h-4 w-4 shrink-0" />{i.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3 text-xs">
          <div className="font-medium text-white">{user.name}</div>
          <div className="text-slate-400">{user.role_name}</div>
          <button onClick={logout} className="mt-2 flex items-center gap-1.5 text-slate-400 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-5 no-print">
          <button className="lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <FacilitySwitcher />
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            {demo && <span className="hidden lg:block"><Badge color="amber">Demo mode · integrations simulated</Badge></span>}
            <QuickActions />
          </div>
        </header>
        <main className="print-area flex-1 overflow-y-auto p-3 sm:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function FacilitySwitcher() {
  const { facilities, facility, setFacility, can } = useApp();
  const canAll = can('portfolio.view') && facilities.length > 1;
  return (
    <div className="flex items-center gap-2">
      <Building2 className="hidden h-4 w-4 text-slate-400 sm:block" />
      <select className="input w-auto max-w-[14rem] py-1.5 font-medium" value={facility || ''} onChange={(e) => setFacility(e.target.value)}>
        {canAll && <option value="all">All Facilities (Portfolio)</option>}
        {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [show, setShow] = useState(false);
  const [idx, setIdx] = useState(0);
  const nav = useNavigate();
  const ref = useRef();
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => api.get(`/search?facility=all&q=${encodeURIComponent(q)}`).then((r) => { setRes(r); setIdx(0); }).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const go = (r) => {
    setShow(false); setQ('');
    if (r.type === 'tenant') nav(`/tenants/${r.id}`);
    else if (r.type === 'unit') nav(`/units?unit=${r.id}`);
    else nav(`/leads?open=${r.id}`);
  };
  return (
    <div className="relative hidden flex-1 md:block md:max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
      <input ref={ref} className="input py-1.5 pl-8" placeholder="Search tenants, units, phone, gate code…  (Ctrl+K)" value={q}
        onChange={(e) => { setQ(e.target.value); setShow(true); }} onFocus={() => setShow(true)} onBlur={() => setTimeout(() => setShow(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, res.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
          if (e.key === 'Enter' && res[idx]) go(res[idx]);
        }} />
      {show && res.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {res.map((r, i) => (
            <button key={r.type + r.id} onMouseDown={() => go(r)} className={cx('flex w-full items-center gap-3 px-3 py-2 text-left', i === idx ? 'bg-brand-50' : 'hover:bg-slate-50')}>
              <Badge color={r.type === 'tenant' ? 'blue' : r.type === 'unit' ? 'green' : 'purple'}>{r.type}</Badge>
              <div className="min-w-0"><div className="truncate text-sm font-medium">{r.title}</div><div className="truncate text-xs text-slate-500">{r.subtitle}</div></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickActions() {
  const { can } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const items = [
    can('movein.perform') && { label: 'Move-In', icon: DoorOpen, to: '/move-in' },
    can('payments.take') && { label: 'Take Payment', icon: DollarSign, to: '/tenants?pay=1' },
    can('leads.manage') && { label: 'New Lead', icon: UserPlus, to: '/leads?new=1' },
    can('merch.sell') && { label: 'Sell Merchandise', icon: ShoppingCart, to: '/merchandise' },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
        Quick Actions <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {items.map((i) => <button key={i.label} onMouseDown={() => nav(i.to)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"><i.icon className="h-4 w-4 text-slate-400" />{i.label}</button>)}
        </div>
      )}
    </div>
  );
}

/** Wrap pages that need a single facility (Move-In, POS, Daily Close…). */
export function RequireFacility({ children, what = 'this page' }) {
  const { facility, facilities, setFacility } = useApp();
  if (facility && facility !== 'all') return children;
  return (
    <div className="mx-auto mt-10 max-w-md card p-6 text-center">
      <Building2 className="mx-auto mb-3 h-8 w-8 text-brand-600" />
      <h2 className="font-semibold">Choose a facility</h2>
      <p className="mb-4 text-sm text-slate-500">{what} works with one facility at a time.</p>
      <div className="grid gap-2">{facilities.map((f) => <button key={f.id} onClick={() => setFacility(f.id)} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium hover:border-brand-500 hover:bg-brand-50">{f.name}</button>)}</div>
    </div>
  );
}
