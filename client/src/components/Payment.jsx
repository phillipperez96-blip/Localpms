import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { CreditCard, Info } from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { Modal, Button, Field, Input, Select, Checkbox, useAction } from './ui.jsx';
import { LienPaymentWarning } from './LienAlerts.jsx';

export const METHODS = [
  { value: 'cash', label: 'Cash' }, { value: 'check', label: 'Check' }, { value: 'card', label: 'Credit / Debit Card' },
  { value: 'ach', label: 'ACH / Bank Transfer' }, { value: 'money_order', label: 'Money Order' },
];

let stripePromise;
function loadStripe(key) {
  if (!stripePromise) stripePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = () => resolve(window.Stripe(key));
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return stripePromise;
}

/** Card entry: real Stripe Elements when a publishable key is configured, otherwise demo fields. */
export const CardInput = forwardRef(function CardInput(_, ref) {
  const { me } = useApp();
  const key = me?.integrations.stripePublishableKey;
  const mount = useRef();
  const [stripe, setStripe] = useState(null);
  const [card, setCard] = useState(null);
  const [demo, setDemo] = useState({ number: '4242 4242 4242 4242', exp: '12/29', cvc: '123', zip: '' });
  useEffect(() => {
    if (!key) return;
    let el;
    loadStripe(key).then((s) => { setStripe(s); el = s.elements().create('card', { style: { base: { fontSize: '15px' } } }); el.mount(mount.current); setCard(el); });
    return () => el?.destroy();
  }, [key]);
  useImperativeHandle(ref, () => ({
    async getPayment() {
      if (key) {
        const { paymentMethod, error } = await stripe.createPaymentMethod({ type: 'card', card });
        if (error) throw new Error(error.message);
        return { paymentMethodId: paymentMethod.id, last4: paymentMethod.card.last4 };
      }
      const digits = demo.number.replace(/\D/g, '');
      if (digits.length < 12) throw new Error('Enter a card number');
      return { last4: digits.slice(-4) };
    },
  }));
  if (key) return <div className="rounded-md border border-slate-300 px-3 py-3" ref={mount} />;
  return (
    <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-800"><Info className="h-3.5 w-3.5" /> Demo mode – cards are approved instantly and never charged. Connect Stripe in Settings → Integrations.</div>
      <div className="grid grid-cols-6 gap-2">
        <Field label="Card number" className="col-span-6"><Input value={demo.number} onChange={(e) => setDemo({ ...demo, number: e.target.value })} /></Field>
        <Field label="Exp" className="col-span-2"><Input value={demo.exp} onChange={(e) => setDemo({ ...demo, exp: e.target.value })} /></Field>
        <Field label="CVC" className="col-span-2"><Input value={demo.cvc} onChange={(e) => setDemo({ ...demo, cvc: e.target.value })} /></Field>
        <Field label="Zip" className="col-span-2"><Input value={demo.zip} onChange={(e) => setDemo({ ...demo, zip: e.target.value })} /></Field>
      </div>
    </div>
  );
});

export function PaymentModal({ open, onClose, tenant, balance, onPaid }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState(true);
  const cardRef = useRef();
  const [run, busy] = useAction();
  const [warn, setWarn] = useState(null);
  const { refreshAlerts } = useApp();
  useEffect(() => { if (open) { setAmount(balance > 0 ? balance.toFixed(2) : ''); setMethod('cash'); setReference(''); } }, [open, balance]);
  const submit = () => run(async () => {
    const card = method === 'card' ? await cardRef.current.getPayment() : {};
    const r = await api.post(`/tenants/${tenant.id}/payments`, { amount: Number(amount), method, reference, sendReceipt: receipt, ...card });
    onPaid?.(r);
    refreshAlerts();
    if (r.lienAlert) setWarn(r.lienAlert); else onClose();
    return r;
  }, (r) => `Payment of ${money(amount)} posted. New balance ${money(r.account.balance)}`);
  if (warn) return <LienPaymentWarning alert={warn} onClose={() => { setWarn(null); onClose(); }} />;
  return (
    <Modal open={open} onClose={onClose} title={`Take Payment – ${tenant?.first_name || ''} ${tenant?.last_name || ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" icon={CreditCard} loading={busy} onClick={submit} disabled={!(Number(amount) > 0)}>Post {money(amount)}</Button></>}>
      <div className="mb-4 flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
        <span className="text-sm text-slate-600">Current balance</span>
        <span className={`text-xl font-bold ${balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(balance)}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount"><Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} /></Field>
      </div>
      {balance > 0 && <div className="mt-2 flex gap-2">{[balance, ...[1, 2].map((m) => balance + (tenant?.rent || 0) * m)].map((v, i) => <button key={i} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50" onClick={() => setAmount(v.toFixed(2))}>{i === 0 ? 'Balance' : `+${i} mo`} {money(v)}</button>)}</div>}
      <div className="mt-3">
        {method === 'card' ? <CardInput ref={cardRef} /> : method !== 'cash' && <Field label={method === 'check' ? 'Check #' : 'Reference'}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
      </div>
      <Checkbox className="mt-3" label="Email a receipt to the tenant" checked={receipt} onChange={setReceipt} />
    </Modal>
  );
}
