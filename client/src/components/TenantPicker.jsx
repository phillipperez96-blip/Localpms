import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../lib/api.js';

/** Search-as-you-type tenant chooser. value = {id, title, subtitle} | null */
export default function TenantPicker({ value, onChange, facility = 'all', placeholder = 'Search tenant by name, unit or phone…' }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  useEffect(() => {
    if (q.length < 2) { setRes([]); return; }
    const t = setTimeout(() => api.get(`/search?facility=${facility}&q=${encodeURIComponent(q)}`).then((r) => setRes(r.filter((x) => x.type === 'tenant'))), 200);
    return () => clearTimeout(t);
  }, [q, facility]);
  if (value) return (
    <div className="flex items-center justify-between rounded-md border border-brand-500 bg-brand-50 px-3 py-2 text-sm">
      <div><div className="font-medium">{value.title}</div><div className="text-xs text-slate-500">{value.subtitle}</div></div>
      <button onClick={() => onChange(null)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
    </div>
  );
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
      <input className="input pl-8" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {res.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {res.map((r) => <button key={r.id} onClick={() => { onChange(r); setQ(''); setRes([]); }} className="block w-full px-3 py-2 text-left hover:bg-slate-50"><div className="text-sm font-medium">{r.title}</div><div className="text-xs text-slate-500">{r.subtitle}</div></button>)}
        </div>
      )}
    </div>
  );
}
