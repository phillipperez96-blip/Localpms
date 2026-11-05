import { useMemo, useState } from 'react';
import { ClipboardList, Printer, Lock, Unlock, CheckSquare } from 'lucide-react';
import { useApp, useApi } from '../lib/store.jsx';
import { money, dateTime, lienLabel } from '../lib/format.js';
import { Card, PageHeader, Button, Badge, Spinner, Select, Checkbox } from '../components/ui.jsx';

export default function Walkthrough() {
  const { fac, facility, facilityObj } = useApp();
  const { data } = useApi(fac('/walkthrough'));
  const [show, setShow] = useState('all');
  const [building, setBuilding] = useState('');
  const [hideVacant, setHideVacant] = useState(false);
  const rows = useMemo(() => (data?.rows || []).filter((r) => (!building || r.building === building) && (!hideVacant || r.tenant) && (show === 'all' || (show === 'actions' && r.action && !r.action.startsWith('Verify')) || (show === 'pastdue' && r.daysLate > 0 && r.balance > 0) || (show === 'overlocked' && r.overlocked))), [data, show, building, hideVacant]);
  if (!data) return <Spinner />;
  const toLock = data.rows.filter((r) => r.action === 'OVERLOCK');
  const toUnlock = data.rows.filter((r) => r.action.startsWith('REMOVE'));
  const buildings = [...new Set(data.rows.map((r) => r.building))];

  return (
    <div>
      <PageHeader icon={ClipboardList} title="Walkthrough / Lock Check" subtitle="Print and walk the property — verify locks, overlocks and vacants"
        actions={<Button icon={Printer} onClick={() => window.print()}>Print Walkthrough</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 no-print">
        <div className="card flex items-center gap-3 border-red-200 p-4"><Lock className="h-6 w-6 text-red-600" /><div><div className="text-sm font-semibold">{toLock.length} unit(s) need an overlock</div><div className="text-xs text-slate-500">{toLock.map((r) => r.number).join(', ') || 'None'}</div></div></div>
        <div className="card flex items-center gap-3 border-emerald-200 p-4"><Unlock className="h-6 w-6 text-emerald-600" /><div><div className="text-sm font-semibold">{toUnlock.length} overlock(s) to remove</div><div className="text-xs text-slate-500">{toUnlock.map((r) => r.number).join(', ') || 'None'}</div></div></div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 no-print">
        <Select className="w-auto" value={show} onChange={(e) => setShow(e.target.value)} options={[{ value: 'all', label: 'All units' }, { value: 'actions', label: 'Action needed only' }, { value: 'pastdue', label: 'Past due only' }, { value: 'overlocked', label: 'Overlocked only' }]} />
        <Select className="w-auto" value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="All buildings" options={buildings} />
        <Checkbox label="Hide vacant" checked={hideVacant} onChange={setHideVacant} />
        <span className="ml-auto text-xs text-slate-500">{rows.length} units</span>
      </div>
      <Card bodyClass="">
        <div className="hidden px-4 pt-4 print:block">
          <div className="text-lg font-bold">Property Walkthrough – {facility === 'all' ? 'All facilities' : facilityObj?.name}</div>
          <div className="text-xs">Generated {dateTime(data.generated)} · Walked by: ____________________ · Date/Time: ______________</div>
        </div>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50"><tr>{['✓', 'Unit', 'Size', 'Status', 'Tenant', 'Balance', 'Past Due', 'Lien Stage', 'Overlock', 'Action', 'Notes'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.action === 'OVERLOCK' ? 'bg-red-50' : r.action.startsWith('REMOVE') ? 'bg-emerald-50' : ''}>
                <td className="px-3 py-1.5"><span className="inline-block h-4 w-4 rounded border border-slate-400" /></td>
                <td className="px-3 py-1.5 font-semibold">{facility === 'all' && <span className="mr-1 text-xs text-slate-400">{r.facility_code}</span>}{r.number}</td>
                <td className="px-3 py-1.5">{r.size}</td>
                <td className="px-3 py-1.5 capitalize">{r.status}</td>
                <td className="px-3 py-1.5">{r.tenant || <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.tenant && !r.tenant.startsWith('Reserved') ? money(r.balance) : ''}</td>
                <td className="px-3 py-1.5">{r.pastDueStatus === 'Current' ? <span className="text-emerald-700">Current</span> : r.pastDueStatus && <span className="font-semibold text-red-600">{r.pastDueStatus}</span>}</td>
                <td className="px-3 py-1.5">{r.lien_status && r.lien_status !== 'current' ? lienLabel(r.lien_status) : ''}</td>
                <td className="px-3 py-1.5">{r.overlocked ? <Badge color="black">YES</Badge> : <span className="text-slate-400">No</span>}</td>
                <td className="px-3 py-1.5 text-xs font-semibold">{r.action === 'OVERLOCK' ? <span className="text-red-700">⚠ OVERLOCK</span> : r.action.startsWith('REMOVE') ? <span className="text-emerald-700">REMOVE OVERLOCK</span> : <span className="font-normal text-slate-500">{r.action}</span>}</td>
                <td className="w-40 px-3 py-1.5"><span className="block border-b border-dotted border-slate-300">&nbsp;</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
