import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DoorOpen, Check, ChevronRight, ChevronLeft, PartyPopper, KeyRound, Printer } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, date, today } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Field, Input, Select, Checkbox, ErrorBox, Spinner, useAction, cx } from '../components/ui.jsx';
import { RequireFacility } from '../components/Layout.jsx';
import TenantPicker from '../components/TenantPicker.jsx';
import SignaturePad from '../components/SignaturePad.jsx';
import { CardInput, METHODS } from '../components/Payment.jsx';
import { TenantFields } from './TenantAccount.jsx';

const area = (s) => s.split('x').reduce((x, y) => x * Number(y), 1);
const STEPS = ['Unit', 'Tenant', 'Terms', 'Lease', 'Payment'];

export default function MoveIn() {
  return <RequireFacility what="Move-in"><Wizard /></RequireFacility>;
}

function Wizard() {
  const { facility, facilityObj, toast } = useApp();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const { data: units } = useApi(`/units?facility=${facility}`);
  const { data: plans } = useApi('/insurance-plans');
  const { data: promos } = useApi(`/promotions?facility=${facility}`);
  const [unitId, setUnitId] = useState(sp.get('unit') ? Number(sp.get('unit')) : null);
  const [filter, setFilter] = useState({ type: '', size: '' });
  const [existing, setExisting] = useState(null);
  const [tenant, setTenant] = useState({ state: facilityObj?.state || '', email_opt_in: 1, sms_opt_in: 1 });
  const [leadId, setLeadId] = useState(sp.get('lead') ? Number(sp.get('lead')) : null);
  const [terms, setTerms] = useState({ move_in_date: today(), rent: '', promotion_id: '', insurance_plan_id: '', gate_code: '' });
  const [quote, setQuote] = useState(null);
  const [signature, setSignature] = useState(null);
  const [agree, setAgree] = useState(false);
  const [pay, setPay] = useState({ method: 'card', amount: '', reference: '' });
  const [autopay, setAutopay] = useState(false);
  const [done, setDone] = useState(null);
  const cardRef = useRef();
  const [run, busy] = useAction();

  // prefill from lead or existing tenant
  useEffect(() => {
    if (leadId) api.get(`/leads/${leadId}`).then((l) => { setTenant((t) => ({ ...t, first_name: l.first_name, last_name: l.last_name, phone: l.phone, email: l.email })); if (l.unit_id) setUnitId(l.unit_id); if (l.quoted_rate) setTerms((x) => ({ ...x, rent: l.quoted_rate })); });
  }, [leadId]);
  useEffect(() => {
    const tid = sp.get('tenant');
    if (tid) api.get(`/tenants/${tid}`).then((d) => setExisting({ id: d.tenant.id, title: `${d.tenant.first_name} ${d.tenant.last_name}`, subtitle: d.tenant.phone }));
  }, [sp]);

  const unit = units?.find((u) => u.id === unitId);
  useEffect(() => { if (unit && !terms.rent) setTerms((t) => ({ ...t, rent: unit.street_rate })); }, [unit]);
  useEffect(() => {
    if (!unitId || step < 2) return;
    api.post('/movein/quote', { unit_id: unitId, ...terms, rent: Number(terms.rent) || undefined, promotion_id: terms.promotion_id || null, insurance_plan_id: terms.insurance_plan_id || null }).then((q) => { setQuote(q); setPay((p) => ({ ...p, amount: q.total.toFixed(2) })); });
  }, [unitId, terms.move_in_date, terms.rent, terms.promotion_id, terms.insurance_plan_id, step]);

  const available = useMemo(() => (units || []).filter((u) => (u.status === 'vacant' || (u.status === 'reserved' && (u.reservation?.lead_id === leadId || u.id === unitId))) && (!filter.type || u.unit_type === filter.type) && (!filter.size || u.size === filter.size)), [units, filter, leadId, unitId]);
  const types = [...new Set((units || []).map((u) => u.unit_type))];
  const sizes = [...new Set((units || []).filter((u) => !filter.type || u.unit_type === filter.type).map((u) => u.size))].sort((a, b) => area(a) - area(b));

  const canNext = [!!unit, existing || (tenant.first_name && tenant.last_name), !!quote, !!signature && agree, true][step];

  const complete = () => run(async () => {
    const card = pay.method === 'card' && Number(pay.amount) > 0 ? await cardRef.current.getPayment() : {};
    const body = { unit_id: unitId, tenant_id: existing?.id, tenant: existing ? undefined : { ...tenant, autopay: autopay ? 1 : 0, autopay_method: autopay && card.last4 ? `Card •••• ${card.last4}` : undefined }, lead_id: leadId, ...terms,
      rent: Number(terms.rent), promotion_id: terms.promotion_id || null, insurance_plan_id: terms.insurance_plan_id || null, gate_code: terms.gate_code || undefined, signature,
      payment: { method: pay.method, amount: Number(pay.amount), reference: pay.reference, ...card } };
    const r = await api.post('/movein', body);
    setDone({ ...r, unit, total: quote.total, paid: Number(pay.amount), name: existing?.title || `${tenant.first_name} ${tenant.last_name}` });
  }, 'Move-in complete!');

  if (done) return (
    <div className="mx-auto max-w-xl card p-8 text-center">
      <PartyPopper className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
      <h2 className="text-xl font-bold">Welcome aboard, {done.name}!</h2>
      <p className="mt-1 text-slate-500">Unit {done.unit.number} ({done.unit.size} {done.unit.unit_type}) is now rented.</p>
      <div className="mx-auto mt-5 w-fit rounded-xl bg-slate-900 px-8 py-4 text-white"><div className="flex items-center justify-center gap-2 text-xs uppercase tracking-wider text-slate-400"><KeyRound className="h-3.5 w-3.5" /> Gate code</div><div className="font-mono text-4xl font-bold tracking-[0.3em]">{done.gate_code}</div></div>
      <div className="mt-5 grid grid-cols-2 gap-2 text-sm"><div className="rounded bg-slate-50 p-2">Charges: <b>{money(done.total)}</b></div><div className="rounded bg-slate-50 p-2">Paid: <b>{money(done.paid)}</b></div></div>
      {done.paymentReference && <div className="mt-2 text-xs text-slate-500">Payment ref: {done.paymentReference}</div>}
      <div className="mt-6 flex justify-center gap-2">
        <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>
        <Button onClick={() => nav(`/tenants/${done.tenantId}`)}>Open Tenant Account</Button>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader icon={DoorOpen} title="New Move-In" subtitle={facilityObj?.name} />
      <div className="mb-5 flex items-center gap-1 overflow-x-auto">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center">
            <button disabled={i > step} onClick={() => setStep(i)} className={cx('flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium', i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-400 ring-1 ring-slate-200')}>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">{i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>{s}
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="mx-1 h-4 w-4 text-slate-300" />}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {step === 0 && (
            <Card title="Choose a unit" bodyClass="">
              <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
                <Select className="w-auto" value={filter.type} onChange={(e) => setFilter({ type: e.target.value, size: '' })} placeholder="All types" options={types} />
                <Select className="w-auto" value={filter.size} onChange={(e) => setFilter({ ...filter, size: e.target.value })} placeholder="All sizes" options={sizes} />
                <span className="ml-auto self-center text-xs text-slate-500">{available.length} available</span>
              </div>
              {!units ? <Spinner /> : (
                <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 xl:grid-cols-4">
                  {available.map((u) => (
                    <button key={u.id} onClick={() => { setUnitId(u.id); setTerms((t) => ({ ...t, rent: u.street_rate })); }} className={cx('rounded-lg border p-3 text-left transition', u.id === unitId ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-500')}>
                      <div className="flex items-center justify-between"><span className="font-bold">{u.number}</span>{u.status === 'reserved' && <Badge color="purple">Reserved</Badge>}</div>
                      <div className="text-sm text-slate-600">{u.size} · {u.unit_type}</div>
                      <div className="mt-1 font-semibold text-brand-700">{money(u.street_rate)}<span className="text-xs font-normal text-slate-500">/mo</span></div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}
          {step === 1 && (
            <Card title="Tenant information">
              <div className="mb-4">
                <div className="label">Existing tenant? (renting an additional unit)</div>
                <TenantPicker value={existing} onChange={setExisting} facility={facility} />
              </div>
              {!existing && <><div className="mb-3 border-t border-slate-100 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">New tenant</div><TenantFields f={tenant} set={setTenant} /></>}
            </Card>
          )}
          {step === 2 && (
            <Card title="Rental terms">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Move-in date"><Input type="date" value={terms.move_in_date} onChange={(e) => setTerms({ ...terms, move_in_date: e.target.value })} /></Field>
                <Field label="Monthly rent" hint={unit && `Street rate ${money(unit.street_rate)}`}><Input type="number" value={terms.rent} onChange={(e) => setTerms({ ...terms, rent: e.target.value })} /></Field>
                <Field label="Promotion"><Select value={terms.promotion_id} onChange={(e) => setTerms({ ...terms, promotion_id: e.target.value })} placeholder="None" options={(promos || []).filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} /></Field>
                <Field label="Gate code" hint="Leave blank to auto-generate"><Input value={terms.gate_code} maxLength={8} onChange={(e) => setTerms({ ...terms, gate_code: e.target.value.replace(/\D/g, '') })} /></Field>
              </div>
              <div className="mt-4">
                <div className="label">Tenant protection plan</div>
                <div className="grid gap-2 sm:grid-cols-4">
                  {[{ id: '', name: 'Decline', coverage: 0, premium: 0 }, ...(plans || [])].map((p) => (
                    <button key={p.id} onClick={() => setTerms({ ...terms, insurance_plan_id: p.id })} className={cx('rounded-lg border p-3 text-left text-sm', String(terms.insurance_plan_id) === String(p.id) ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-brand-500')}>
                      <div className="font-medium">{p.name}</div>
                      {p.id ? <div className="text-xs text-slate-500">${p.coverage.toLocaleString()} coverage · {money(p.premium)}/mo</div> : <div className="text-xs text-slate-500">Tenant provides own insurance</div>}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          )}
          {step === 3 && (
            <Card title="Rental agreement">
              <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
                <p className="mb-2 font-semibold text-slate-800">SELF-STORAGE RENTAL AGREEMENT — {facilityObj?.name}</p>
                <p className="mb-2">Occupant: <b>{existing?.title || `${tenant.first_name || ''} ${tenant.last_name || ''}`}</b> · Unit <b>{unit?.number}</b> ({unit?.size} {unit?.unit_type}) · Monthly rent <b>{money(terms.rent)}</b> · Move-in <b>{date(terms.move_in_date)}</b></p>
                <p className="mb-2">1. TERM. This agreement is month-to-month beginning on the move-in date. Rent is due in advance on the {facilityObj?.billing_type === 'first' ? '1st of each month' : 'same day of each month as the move-in date'}.</p>
                <p className="mb-2">2. LATE FEES & DEFAULT. Rent not paid when due is delinquent. Late fees apply per the posted fee schedule. Gate access is suspended when the account is {facilityObj?.gate_deny_days} or more days past due. The unit may be overlocked and Owner may deny access until paid in full.</p>
                <p className="mb-2">3. LIEN. Owner has a lien on all personal property stored in the unit for rent and charges due. If rent remains unpaid, Owner may sell the property at public sale in accordance with state law after required notices.</p>
                <p className="mb-2">4. USE. The unit shall be used for storage only. No hazardous, perishable or illegal items. No habitation.</p>
                <p className="mb-2">5. INSURANCE. Owner does not insure Occupant's property. Occupant must maintain insurance or enroll in the tenant protection plan.</p>
                <p>6. NOTICE. Occupant must provide notice and remove all property and their lock when vacating. Rent is not prorated at move-out.</p>
              </div>
              <Checkbox className="mt-3" label="Tenant has read and agrees to the rental agreement and fee schedule" checked={agree} onChange={setAgree} />
              <div className="mt-3"><div className="label">Tenant signature</div><SignaturePad onChange={setSignature} /></div>
            </Card>
          )}
          {step === 4 && (
            <Card title="Collect move-in payment">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Payment method"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} options={METHODS} /></Field>
                <Field label="Amount" hint={quote && `Due today ${money(quote.total)}`}><Input type="number" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
              </div>
              <div className="mt-3">{pay.method === 'card' ? <CardInput ref={cardRef} /> : pay.method !== 'cash' && <Field label="Reference / check #"><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>}</div>
              {pay.method === 'card' && !existing && <Checkbox className="mt-3" label="Enroll in autopay with this card" checked={autopay} onChange={setAutopay} />}
            </Card>
          )}
          <div className="mt-4 flex justify-between">
            <Button variant="secondary" icon={ChevronLeft} disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
            {step < 4 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
              : <Button variant="success" icon={Check} loading={busy} onClick={complete}>Complete Move-In</Button>}
          </div>
        </div>

        <Card title="Summary" className="h-fit lg:sticky lg:top-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Unit</dt><dd className="font-medium">{unit ? `${unit.number} · ${unit.size} ${unit.unit_type}` : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Tenant</dt><dd className="font-medium">{existing?.title || [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Rent</dt><dd className="font-medium">{terms.rent ? money(terms.rent) + '/mo' : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Move-in</dt><dd>{date(terms.move_in_date)}</dd></div>
          </dl>
          {quote && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Due today</div>
              {quote.items.map((i) => <div key={i.description} className="flex justify-between py-0.5 text-sm"><span className="text-slate-600">{i.description}</span><span className="tabular-nums">{money(i.amount)}</span></div>)}
              <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-bold"><span>Total</span><span>{money(quote.total)}</span></div>
              <div className="mt-1 text-xs text-slate-500">Next payment {money(Number(terms.rent) + (plans?.find((p) => String(p.id) === String(terms.insurance_plan_id))?.premium || 0))} due {date(quote.nextDue)}</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
