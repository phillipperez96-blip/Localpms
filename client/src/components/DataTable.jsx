import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { cx, Empty } from './ui.jsx';
import { downloadCSV } from '../lib/format.js';

/**
 * Sortable, searchable, paginated table with CSV export.
 * columns: [{ key, label, render?, sortValue?, align?, csv?, className? }]
 */
export default function DataTable({ columns, rows, searchable = true, pageSize = 25, exportName, onRowClick, toolbar, selectable, selected, onSelectedChange, rowKey = 'id', empty, rowClass, initialSort, dense, footer }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort || null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let r = rows || [];
    if (q.trim()) {
      const s = q.toLowerCase();
      r = r.filter((row) => columns.some((c) => { const v = c.searchValue ? c.searchValue(row) : row[c.key]; return v !== null && v !== undefined && String(v).toLowerCase().includes(s); }));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (row) => (col?.sortValue ? col.sortValue(row) : row[sort.key]);
      r = [...r].sort((a, b) => {
        const x = val(a), y = val(b);
        if (x === y) return 0;
        if (x === null || x === undefined || x === '') return 1;
        if (y === null || y === undefined || y === '') return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * (sort.dir === 'asc' ? 1 : -1);
      });
    }
    return r;
  }, [rows, q, sort, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const visible = pageSize ? filtered.slice(cur * pageSize, cur * pageSize + pageSize) : filtered;
  const toggleSort = (key) => setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));
  const allSel = selectable && filtered.length > 0 && filtered.every((r) => selected?.has(r[rowKey]));

  return (
    <div>
      {(searchable || toolbar || exportName) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5 no-print">
          {searchable && (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input className="input pl-8" placeholder="Filter…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            </div>
          )}
          <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          <span className="text-xs text-slate-500">{filtered.length.toLocaleString()} rows</span>
          {exportName && (
            <button className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50" onClick={() => downloadCSV(`${exportName}.csv`, columns.filter((c) => c.label && c.csv !== false), filtered)}>
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50">
            <tr>
              {selectable && <th className="th w-8"><input type="checkbox" className="accent-brand-600" checked={allSel} onChange={(e) => onSelectedChange(new Set(e.target.checked ? filtered.map((r) => r[rowKey]) : []))} /></th>}
              {columns.map((c) => (
                <th key={c.key} className={cx('th select-none', c.sortable !== false && 'cursor-pointer hover:text-slate-800', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.thClass)} onClick={() => c.sortable !== false && toggleSort(c.key)}>
                  <span className="inline-flex items-center gap-1">{c.label}{sort?.key === c.key && (sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visible.map((row, i) => (
              <tr key={row[rowKey] ?? i} onClick={() => onRowClick?.(row)} className={cx(onRowClick && 'cursor-pointer hover:bg-brand-50/50', rowClass?.(row))}>
                {selectable && <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="accent-brand-600" checked={selected?.has(row[rowKey])} onChange={(e) => { const s = new Set(selected); e.target.checked ? s.add(row[rowKey]) : s.delete(row[rowKey]); onSelectedChange(s); }} /></td>}
                {columns.map((c) => (
                  <td key={c.key} className={cx(dense ? 'px-3 py-1.5 text-sm' : 'td', c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center', c.className)}>
                    {c.render ? c.render(row) : row[c.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="bg-slate-50 font-semibold">{footer}</tfoot>}
        </table>
        {!filtered.length && (empty || <Empty title={q ? 'No matches' : 'No records'} />)}
      </div>
      {pageSize > 0 && pages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500 no-print">
          <span>Page {cur + 1} of {pages}</span>
          <div className="flex gap-1">
            <button className="rounded border border-slate-200 p-1 hover:bg-slate-50 disabled:opacity-40" disabled={cur === 0} onClick={() => setPage(cur - 1)}><ChevronLeft className="h-4 w-4" /></button>
            <button className="rounded border border-slate-200 p-1 hover:bg-slate-50 disabled:opacity-40" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
