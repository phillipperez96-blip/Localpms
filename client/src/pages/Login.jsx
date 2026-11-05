import { useEffect, useState } from 'react';
import { Warehouse, LogIn } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { Button, Input, Field, ErrorBox } from '../components/ui.jsx';

export default function Login() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState([]);
  useEffect(() => { api.get('/auth/demo-accounts').then(setAccounts).catch(() => {}); }, []);
  const submit = async (e, em = email, pw = password) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try { await login(em, pw); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-brand-700 p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-slate-900 p-8 text-white md:flex">
          <div className="flex items-center gap-2.5"><div className="rounded-lg bg-brand-600 p-2"><Warehouse className="h-6 w-6" /></div><span className="text-xl font-bold">LocalPMS</span></div>
          <div>
            <h2 className="text-2xl font-bold leading-snug">Everything your storage facilities need, in one place.</h2>
            <ul className="mt-4 space-y-1.5 text-sm text-slate-300">
              <li>• Tenants, move-ins, move-outs & billing</li><li>• Past-due & lien automation through auction</li><li>• Site map, walkthroughs & gate access</li><li>• Leads, rates, retail & daily close</li><li>• District manager audits & portfolio reporting</li>
            </ul>
          </div>
          <div className="text-xs text-slate-500">Demonstration build</div>
        </div>
        <div className="p-8">
          <h1 className="text-xl font-bold text-slate-900">Sign in</h1>
          <p className="mb-5 text-sm text-slate-500">{accounts.length ? <>Use any demo account. Password for all: <b>demo123</b></> : 'Sign in with your company account.'}</p>
          <ErrorBox error={err} />
          <form onSubmit={submit} className="space-y-3">
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <Button type="submit" icon={LogIn} loading={busy} className="w-full">Sign in</Button>
          </form>
          {accounts.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Quick sign-in as…</div>
              <div className="grid gap-1.5">
                {accounts.map((a) => (
                  <button key={a.email} onClick={() => { setEmail(a.email); submit(null, a.email, 'demo123'); }} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:border-brand-500 hover:bg-brand-50">
                    <span className="font-medium">{a.name}</span><span className="text-xs text-slate-500">{a.role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
