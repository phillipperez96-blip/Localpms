import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ShoppingCart, Package, Receipt, Plus, Minus, Trash2, Printer, AlertTriangle, PackagePlus, ClipboardList, Edit } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, date, dateTime, titleCase } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Tabs, Modal, Field, Input, Select, Checkbox, useAction, Empty, cx } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import TenantPicker from '../components/TenantPicker.jsx';
import { CardInput } from '../components/Payment.jsx';
import { RequireFacility } from '../components/Layout.jsx';

export default function Merchandise() {
  const { can } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || (can('merch.sell') ? 'pos' : 'inventory');
  return (
    <div>
      <PageHeader icon={ShoppingCart} title="Merchandise" subtitle="Retail sales, linked to a tenant account or walk-in" />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[can('merch.sell') && { value: 'pos', label: 'Point of Sale', icon: ShoppingCart }, { value: 'sales', label: 'Sales History', icon: Receipt }, can('inventory.manage') && { value: 'inventory', label: 'Inventory', icon: Package }].filter(Boolean)} />
      <RequireFacility what="Merchandise">
        {tab === 'pos' && <POS />}
        {tab === 'sales' && <Sales />}
        {tab === 'inventory' && <Inventory />}
      </RequireFacility>
    </div>
  );
}

function POS() {
  const { facility, facilityObj } = useApp();
  const [sp] = useSearchParams();
  const { data: products, reload } = useApi(`/products?facility=${facility}`);
  const [cart, setCart] = useState([]);
  const [tenant, setTenant] = useState(null);
  const [customer, setCustomer] = useState('');
  const [method, setMethod] = useState('cash');
  const [cat, setCat] = useState('');
  const [receipt, setReceipt] = useState(null);
  const cardRef = useRef();
  const [run, busy] = useAction();
  useEffect(() => { const t = sp.get('tenant'); if (t) api.get(`/tenants/${t}`).then((d) => setTenant({ id: d.tenant.id, title: `${d.tenant.first_name} ${d.tenant.last_name}`, subtitle: `Balance ${money(d.account.balance)}` })); }, [sp]);
  if (!products) return <Spinner />;
  const add = (p) => setCart((c) => { const e = c.find((x) => x.p.id === p.id); return e ? c.map((x) => (x.p.id === p.id ? { ...x, qty: x.qty + 1 } : x)) : [...c, { p, qty: 1 }]; });
  const setQty = (id, q) => setCart((c) => (q <= 0 ? c.filter((x) => x.p.id !== id) : c.map((x) => (x.p.id === id ? { ...x, qty: q } : x))));
  const sub = cart.reduce((s, x) => s + x.p.price * x.qty, 0);
  const tax = cart.filter((x) => x.p.taxable).reduce((s, x) => s + x.p.price * x.qty, 0) * (facilityObj?.tax_rate || 0);
  const total = Math.round((sub + tax) * 100) / 100;
  const cats = [...new Set(products.map((p) => p.category))];
  const checkout = () => run(async () => {
    const card = method === 'card' ? await cardRef.current.getPayment() : {};
    const r = await api.post('/sales', { facility_id: Number(facility), tenant_id: tenant?.id, customer_name: customer, method, items: cart.map((x) => ({ product_id: x.p.id, qty: x.qty })), ...card });
    setReceipt(await api.get(`/sales/${r.id}`));
    setCart([]); reload();
  }, 'Sale complete');

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-3 flex flex-wrap gap-1.5">{['', ...cats].map((c) => <button key={c} onClick={() => setCat(c)} className={`rounded-full px-3 py-1 text-xs font-medium ${cat === c ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{c || 'All'}</button>)}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {products.filter((p) => p.active && (!cat || p.category === cat)).map((p) => (
            <button key={p.id} onClick={() => add(p)} disabled={p.qty_on_hand <= 0} className="card p-3 text-left transition hover:border-brand-500 hover:shadow disabled:opacity-40">
              <div className="text-sm font-medium leading-tight">{p.name}</div>
              <div className="mt-1 flex items-end justify-between"><span className="text-lg font-bold text-brand-700">{money(p.price)}</span><span className={cx('text-xs', p.qty_on_hand <= p.reorder_point ? 'text-red-600' : 'text-slate-400')}>{p.qty_on_hand} left</span></div>
            </button>
          ))}
        </div>
      </div>
      <Card title="Cart" className="h-fit lg:sticky lg:top-4">
        <div className="mb-3">
          <div className="label">Customer</div>
          <TenantPicker value={tenant} onChange={(t) => { setTenant(t); if (!t && method === 'account') setMethod('cash'); }} facility={facility} placeholder="Link to tenant (optional)…" />
          {!tenant && <Input className="mt-2" placeholder="Walk-in name (optional)" value={customer} onChange={(e) => setCustomer(e.target.value)} />}
        </div>
        {cart.length === 0 ? <Empty title="Cart is empty" icon={ShoppingCart}>Tap products to add them</Empty> : (
          <div className="divide-y divide-slate-100">
            {cart.map((x) => (
              <div key={x.p.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{x.p.name}</div><div className="text-xs text-slate-500">{money(x.p.price)} ea</div></div>
                <button onClick={() => setQty(x.p.id, x.qty - 1)} className="rounded border p-0.5"><Minus className="h-3 w-3" /></button>
                <span className="w-6 text-center text-sm">{x.qty}</span>
                <button onClick={() => setQty(x.p.id, x.qty + 1)} className="rounded border p-0.5"><Plus className="h-3 w-3" /></button>
                <span className="w-16 text-right text-sm tabular-nums">{money(x.p.price * x.qty)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{money(sub)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Tax ({((facilityObj?.tax_rate || 0) * 100).toFixed(2)}%)</span><span>{money(tax)}</span></div>
          <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{money(total)}</span></div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {[['cash', 'Cash'], ['card', 'Card'], ['check', 'Check'], ['account', 'Charge to account']].map(([k, l]) => (
            <button key={k} disabled={k === 'account' && !tenant} onClick={() => setMethod(k)} className={`rounded-md border px-2 py-1.5 text-xs font-medium disabled:opacity-40 ${method === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200'}`}>{l}</button>
          ))}
        </div>
        {method === 'card' && <div className="mt-3"><CardInput ref={cardRef} /></div>}
        <Button className="mt-3 w-full" variant="success" size="lg" loading={busy} disabled={!cart.length} onClick={checkout}>Complete Sale · {money(total)}</Button>
      </Card>
      {receipt && <ReceiptModal sale={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

export function ReceiptModal({ sale, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Receipt #${sale.id}`} size="sm" footer={<Button icon={Printer} onClick={() => window.print()}>Print Receipt</Button>}>
      <div className="font-mono text-sm" id="receipt">
        <div className="text-center"><div className="font-bold">{sale.facility.name}</div><div className="text-xs">{sale.facility.address}, {sale.facility.city} {sale.facility.state}</div><div className="text-xs">{sale.facility.phone}</div></div>
        <div className="my-2 border-t border-dashed" />
        <div className="text-xs">{dateTime(sale.created_at)} · {sale.user_name}<br />Customer: {sale.customer_name}</div>
        <div className="my-2 border-t border-dashed" />
        {sale.items.map((i) => <div key={i.id} className="flex justify-between"><span>{i.qty} × {i.name}</span><span>{money(i.qty * i.price)}</span></div>)}
        <div className="my-2 border-t border-dashed" />
        <div className="flex justify-between"><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
        <div className="flex justify-between"><span>Tax</span><span>{money(sale.tax)}</span></div>
        <div className="flex justify-between font-bold"><span>TOTAL</span><span>{money(sale.total)}</span></div>
        <div className="mt-1 text-xs">Paid by: {sale.method === 'account' ? 'Charged to tenant account' : titleCase(sale.method)} {sale.reference || ''}</div>
        <div className="mt-3 text-center text-xs">Thank you!</div>
      </div>
    </Modal>
  );
}

function Sales() {
  const { facility } = useApp();
  const { data } = useApi(`/sales?facility=${facility}`);
  const [r, setR] = useState(null);
  if (!data) return <Spinner />;
  return (
    <Card bodyClass="">
      <DataTable rows={data} exportName="sales" onRowClick={(s) => api.get(`/sales/${s.id}`).then(setR)} columns={[
        { key: 'id', label: '#' }, { key: 'date', label: 'Date', render: (s) => date(s.date) },
        { key: 'customer_name', label: 'Customer', render: (s) => s.tenant_id ? <Link className="link" onClick={(e) => e.stopPropagation()} to={`/tenants/${s.tenant_id}`}>{s.customer_name}</Link> : s.customer_name },
        { key: 'items', label: 'Items', sortValue: (s) => s.items.length, csv: (s) => s.items.map((i) => `${i.qty}x ${i.name}`).join('; '), render: (s) => <span className="text-xs text-slate-600">{s.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</span> },
        { key: 'method', label: 'Paid', render: (s) => (s.method === 'account' ? <Badge color="blue">On account</Badge> : titleCase(s.method)) },
        { key: 'total', label: 'Total', align: 'right', render: (s) => money(s.total) }, { key: 'user_name', label: 'Sold By' },
      ]} />
      {r && <ReceiptModal sale={r} onClose={() => setR(null)} />}
    </Card>
  );
}

function Inventory() {
  const { facility } = useApp();
  const { data, reload } = useApi(`/products?facility=${facility}`);
  const adj = useApi(`/inventory/adjustments?facility=${facility}`);
  const [edit, setEdit] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const [run, busy] = useAction();
  if (!data) return <Spinner />;
  const low = data.filter((p) => p.active && p.qty_on_hand <= p.reorder_point);
  const value = data.reduce((s, p) => s + p.qty_on_hand * (p.cost || 0), 0);
  const refresh = () => { reload(); adj.reload(); };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="text-xs text-slate-500">Products</div><div className="text-2xl font-bold">{data.length}</div></div>
        <div className="card p-4"><div className="text-xs text-slate-500">Inventory value (cost)</div><div className="text-2xl font-bold">{money(value)}</div></div>
        <div className={cx('card p-4', low.length && 'border-red-200 bg-red-50')}><div className="text-xs text-slate-500">Below reorder point</div><div className="text-2xl font-bold text-red-600">{low.length}</div>{low.length > 0 && <div className="truncate text-xs text-red-700">{low.map((p) => p.name).join(', ')}</div>}</div>
      </div>
      <Card bodyClass="" title="Products" actions={<Button size="sm" icon={Plus} onClick={() => setEdit({ sku: '', name: '', category: 'Supplies', price: '', cost: '', qty_on_hand: 0, reorder_point: 5, taxable: 1, active: 1 })}>Add Product</Button>}>
        <DataTable rows={data} exportName="inventory" rowClass={(p) => (p.qty_on_hand <= p.reorder_point ? 'bg-red-50/40' : '')} columns={[
          { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product', render: (p) => <span className="font-medium">{p.name}{!p.active && <Badge className="ml-1">Inactive</Badge>}</span> }, { key: 'category', label: 'Category' },
          { key: 'price', label: 'Price', align: 'right', render: (p) => money(p.price) }, { key: 'cost', label: 'Cost', align: 'right', render: (p) => money(p.cost) },
          { key: 'qty_on_hand', label: 'On Hand', align: 'right', render: (p) => <span className={p.qty_on_hand <= p.reorder_point ? 'font-bold text-red-600' : ''}>{p.qty_on_hand}</span> },
          { key: 'reorder_point', label: 'Reorder At', align: 'right' }, { key: 'sold_30', label: 'Sold (30d)', align: 'right' },
          { key: 'act', label: '', sortable: false, csv: false, render: (p) => <div className="flex gap-1"><Button size="sm" variant="secondary" icon={PackagePlus} onClick={() => setAdjust({ p, reason: 'received', qty_change: '', counted: p.qty_on_hand, notes: '' })}>Adjust</Button><Button size="sm" variant="ghost" icon={Edit} onClick={() => setEdit({ ...p })} /></div> },
        ]} />
      </Card>
      <Card bodyClass="" title="Inventory adjustments">
        <DataTable rows={adj.data || []} pageSize={15} columns={[
          { key: 'created_at', label: 'When', render: (a) => dateTime(a.created_at) }, { key: 'name', label: 'Product' },
          { key: 'qty_change', label: 'Change', align: 'right', render: (a) => <span className={a.qty_change > 0 ? 'text-emerald-600' : 'text-red-600'}>{a.qty_change > 0 ? '+' : ''}{a.qty_change}</span> },
          { key: 'reason', label: 'Reason', render: (a) => titleCase(a.reason) }, { key: 'notes', label: 'Notes' }, { key: 'user_name', label: 'User' },
        ]} />
      </Card>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : 'Add product'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => (edit.id ? api.put(`/products/${edit.id}`, edit) : api.post('/products', { ...edit, facility_id: Number(facility) })).then(() => { setEdit(null); refresh(); }), 'Product saved')}>Save</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="SKU"><Input value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} /></Field>
            <Field label="Category"><Select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} options={['Locks', 'Boxes', 'Supplies', 'Covers', 'Other']} /></Field>
            <Field label="Reorder point"><Input type="number" value={edit.reorder_point} onChange={(e) => setEdit({ ...edit, reorder_point: Number(e.target.value) })} /></Field>
            <Field label="Price"><Input type="number" step="0.01" value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} /></Field>
            <Field label="Cost"><Input type="number" step="0.01" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: Number(e.target.value) })} /></Field>
            {!edit.id && <Field label="Starting quantity"><Input type="number" value={edit.qty_on_hand} onChange={(e) => setEdit({ ...edit, qty_on_hand: Number(e.target.value) })} /></Field>}
          </div>
          <div className="mt-3 flex gap-4"><Checkbox label="Taxable" checked={edit.taxable} onChange={(v) => setEdit({ ...edit, taxable: v ? 1 : 0 })} /><Checkbox label="Active" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v ? 1 : 0 })} /></div>
        </Modal>
      )}
      {adjust && (
        <Modal open onClose={() => setAdjust(null)} title={`Adjust stock – ${adjust.p.name}`} size="sm" footer={<><Button variant="secondary" onClick={() => setAdjust(null)}>Cancel</Button><Button loading={busy} onClick={() => run(() => api.post(`/products/${adjust.p.id}/adjust`, { reason: adjust.reason, notes: adjust.notes, qty_change: adjust.reason === 'received' ? Number(adjust.qty_change) : -Math.abs(Number(adjust.qty_change)), counted: Number(adjust.counted) }).then(() => { setAdjust(null); refresh(); }), 'Inventory updated')}>Save</Button></>}>
          <p className="mb-3 text-sm text-slate-600">Currently on hand: <b>{adjust.p.qty_on_hand}</b></p>
          <Field label="Adjustment type"><Select value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} options={[{ value: 'received', label: 'Received shipment (+)' }, { value: 'damaged', label: 'Damaged / shrink (−)' }, { value: 'used', label: 'Used by facility (−)' }, { value: 'count', label: 'Physical count (set exact)' }]} /></Field>
          {adjust.reason === 'count' ? <Field label="Counted quantity" className="mt-3"><Input type="number" value={adjust.counted} onChange={(e) => setAdjust({ ...adjust, counted: e.target.value })} /></Field>
            : <Field label="Quantity" className="mt-3"><Input type="number" min="1" value={adjust.qty_change} onChange={(e) => setAdjust({ ...adjust, qty_change: e.target.value })} /></Field>}
          <Field label="Notes (PO #, vendor…)" className="mt-3"><Input value={adjust.notes} onChange={(e) => setAdjust({ ...adjust, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
