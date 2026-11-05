export const money = (n, opts = {}) => {
  const v = Number(n || 0);
  const s = Math.abs(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: opts.whole ? 0 : 2, maximumFractionDigits: opts.whole ? 0 : 2 });
  return v < 0 ? `(${s})` : s;
};
export const num = (n) => Number(n || 0).toLocaleString('en-US');
export const pct = (n, d = 1) => `${Number(n || 0).toFixed(d)}%`;
export const date = (s) => {
  if (!s) return '—';
  const d = s.length <= 10 ? new Date(s + 'T00:00:00') : new Date(s.replace(' ', 'T') + (s.includes('Z') || s.includes('T') ? '' : 'Z'));
  return isNaN(d) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
export const dateTime = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? s : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const monthStart = () => today().slice(0, 8) + '01';
export const titleCase = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const phone = (p) => p || '—';

export const LIEN_LABELS = { current: 'Current', reminder: 'Reminder Sent', late_notice: 'Late Notice', overlock: 'Overlocked', pre_lien: 'Pre-Lien', lien: 'Lien Notice', advertise: 'Advertised', auction: 'Auction Scheduled', sold: 'Sold' };
export const lienLabel = (k) => LIEN_LABELS[k] || titleCase(k);

export function downloadCSV(filename, columns, rows) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(typeof c.csv === 'function' ? c.csv(r) : r[c.key])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
}
