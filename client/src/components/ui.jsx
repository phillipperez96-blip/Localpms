import { useEffect, useState } from 'react';
import { X, Loader2, Inbox, AlertTriangle } from 'lucide-react';
import { useApp } from '../lib/store.jsx';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, className, children, ...p }) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
    ghost: 'text-slate-600 hover:bg-slate-100',
    warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
  }[variant];
  const s = { sm: 'px-2.5 py-1.5 text-xs gap-1.5', md: 'px-3.5 py-2 text-sm gap-2', lg: 'px-5 py-2.5 text-sm gap-2' }[size];
  return (
    <button className={cx('inline-flex items-center justify-center rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50', v, s, className)} disabled={loading || p.disabled} {...p}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      {children}
    </button>
  );
}

const BADGE = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200', blue: 'bg-blue-50 text-blue-700 ring-blue-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200', purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  black: 'bg-slate-800 text-white ring-slate-800', orange: 'bg-orange-50 text-orange-700 ring-orange-200',
};
export function Badge({ color = 'gray', children, className }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE[color], className)}>{children}</span>;
}

export function Card({ title, actions, children, className, bodyClass, subtitle }) {
  return (
    <div className={cx('card', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 no-print">{actions}</div>}
        </div>
      )}
      <div className={bodyClass ?? 'p-4'}>{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && <div className="rounded-lg bg-brand-600/10 p-2 text-brand-600 no-print"><Icon className="h-5 w-5" /></div>}
        <div>
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone = 'blue', onClick }) {
  const tones = { blue: 'bg-blue-50 text-blue-600', green: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600', purple: 'bg-violet-50 text-violet-600', slate: 'bg-slate-100 text-slate-600' };
  return (
    <div onClick={onClick} className={cx('card p-4', onClick && 'cursor-pointer transition hover:border-brand-500/40 hover:shadow')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
          {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
        </div>
        {Icon && <div className={cx('rounded-lg p-2', tones[tone])}><Icon className="h-5 w-5" /></div>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[6vh] no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('w-full rounded-xl bg-white shadow-2xl', w)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, className, hint }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
export const Input = (p) => <input {...p} className={cx('input', p.className)} />;
export const Textarea = (p) => <textarea rows={3} {...p} className={cx('input', p.className)} />;
export function Select({ options, placeholder, ...p }) {
  return (
    <select {...p} className={cx('input pr-8', p.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}
export function Checkbox({ label, checked, onChange, className }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700', className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 accent-brand-600" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 no-print', className)}>
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cx('-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium transition', value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {t.icon && <t.icon className="h-4 w-4" />}{t.label}
          {t.count !== undefined && <span className={cx('rounded-full px-1.5 text-xs', value === t.value ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const Spinner = ({ className }) => <div className={cx('flex items-center justify-center py-16 text-slate-400', className)}><Loader2 className="h-6 w-6 animate-spin" /></div>;
export function Empty({ title = 'Nothing here yet', children, icon: Icon = Inbox }) {
  return <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500"><Icon className="mb-2 h-8 w-8 text-slate-300" /><div className="text-sm font-medium">{title}</div>{children && <div className="mt-1 text-xs">{children}</div>}</div>;
}
export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4" />{error}</div>;
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 no-print">
      {toasts.map((t) => (
        <div key={t.id} className={cx('max-w-sm rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg', t.type === 'error' ? 'bg-red-600' : t.type === 'info' ? 'bg-slate-800' : 'bg-emerald-600')}>{t.msg}</div>
      ))}
    </div>
  );
}

/** Runs an async action with loading state and toasts. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (fn, success) => {
    setBusy(true);
    try { const r = await fn(); if (success) toast(typeof success === 'function' ? success(r) : success); return r; }
    catch (e) { toast(e.message, 'error'); return undefined; }
    finally { setBusy(false); }
  };
  return [run, busy];
}

export function Confirm({ open, title, message, onConfirm, onClose, confirmText = 'Confirm', variant = 'primary', busy, children }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={variant} loading={busy} onClick={onConfirm}>{confirmText}</Button></>}>
      <p className="text-sm text-slate-600">{message}</p>
      {children}
    </Modal>
  );
}

export function KV({ items, cols = 2 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3', cols === 3 ? 'grid-cols-2 md:grid-cols-3' : cols === 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2')}>
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="min-w-0"><dt className="text-xs text-slate-500">{k}</dt><dd className="truncate text-sm font-medium text-slate-800">{v ?? '—'}</dd></div>
      ))}
    </dl>
  );
}

export function lienColor(status) {
  return { current: 'green', reminder: 'amber', late_notice: 'amber', overlock: 'red', pre_lien: 'red', lien: 'red', advertise: 'purple', auction: 'purple', sold: 'gray' }[status] || 'gray';
}
export function daysColor(d) { return d <= 0 ? 'green' : d < 15 ? 'amber' : d < 45 ? 'orange' : 'red'; }
