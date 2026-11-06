import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { MessageSquarePlus, Undo2, StickyNote, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { dateTime } from '../lib/format.js';
import { Card, Button, Modal, cx } from './ui.jsx';

/**
 * Note box for a tenant account. After saving, the author has a short window
 * (30s by default) to undo: the note is removed and its text goes back into the box.
 */
export const NoteComposer = forwardRef(function NoteComposer({ tenantId, notes, onAdded, onUndone, reload }, ref) {
  const { user, toast } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [deadlines, setDeadlines] = useState({}); // note id -> ms timestamp when undo expires
  const [now, setNow] = useState(Date.now());
  const box = useRef();
  useImperativeHandle(ref, () => ({ focus: () => { box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); box.current?.focus(); } }));

  // pick up undo windows reported by the server (e.g. after a reload)
  useEffect(() => {
    const d = {};
    for (const n of notes) if (n.user_id === user.id && n.undo_seconds_left > 0) d[n.id] = Date.now() + n.undo_seconds_left * 1000;
    setDeadlines((cur) => ({ ...d, ...Object.fromEntries(Object.entries(cur).filter(([id]) => notes.some((n) => String(n.id) === id))) }));
  }, [notes, user.id]);

  const active = Object.values(deadlines).some((t) => t > now);
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [active]);

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const r = await api.post(`/tenants/${tenantId}/notes`, { note: body });
      setText('');
      setDeadlines((d) => ({ ...d, [r.note.id]: Date.now() + r.undo_seconds * 1000 }));
      setNow(Date.now());
      onAdded?.();
      reload();
      toast(`Note saved – you can undo for ${r.undo_seconds} seconds`, 'info');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const undo = async (n) => {
    const previous = text;
    // put the text straight back in the box so it can be edited
    setText(previous.trim() ? `${n.body}\n${previous}` : n.body);
    setDeadlines((d) => { const c = { ...d }; delete c[n.id]; return c; });
    setTimeout(() => box.current?.focus(), 0);
    try {
      await api.del(`/tenants/${tenantId}/notes/${n.id}`);
      onUndone?.();
      reload();
    } catch (e) {
      setText(previous); // too late – the note stays in the account
      toast(e.message, 'error');
      reload();
    }
  };

  const recent = notes.slice(0, 4);
  return (
    <Card title={<span className="flex items-center gap-2"><StickyNote className="h-4 w-4 text-amber-500" />Account notes</span>} subtitle="Jot down what each conversation was about" className="no-print">
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea ref={box} rows={2} className="input" placeholder="e.g. Called about balance – promised to pay Friday." value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); }} maxLength={5000} />
        <Button icon={MessageSquarePlus} loading={busy} disabled={!text.trim()} onClick={add} className="whitespace-nowrap sm:self-start">Add Note</Button>
      </div>
      {recent.length > 0 && (
        <ul className="mt-3 space-y-2">
          {recent.map((n) => {
            const left = deadlines[n.id] ? Math.max(0, Math.ceil((deadlines[n.id] - now) / 1000)) : 0;
            return (
              <li key={n.id} className={cx('rounded-md px-3 py-2 text-sm', left > 0 ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-amber-50')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 whitespace-pre-wrap break-words">{n.body}</div>
                  {left > 0 && (
                    <button onClick={() => undo(n)} className="flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-blue-200 hover:bg-blue-100">
                      <Undo2 className="h-3.5 w-3.5" /> Undo ({left}s)
                    </button>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{n.user_name || 'Unknown'} · {dateTime(n.created_at)}{left > 0 && ' · can be undone'}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
});

/**
 * When the facility's reminder is on, asks before leaving a tenant account
 * if no note (or logged call) was added during this visit.
 */
export function LeaveWithoutNoteReminder({ enabled, notedThisVisit, onStay }) {
  const shouldBlock = enabled && !notedThisVisit;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => shouldBlock && currentLocation.pathname !== nextLocation.pathname);
  // closing the tab / refreshing: the browser shows its own generic prompt
  useEffect(() => {
    if (!shouldBlock) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [shouldBlock]);
  if (blocker.state !== 'blocked') return null;
  const stay = () => { blocker.reset(); onStay?.(); };
  return (
    <Modal open onClose={stay} size="sm" title={<span className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />No note added</span>}
      footer={<><Button variant="secondary" onClick={stay}>No, add a note</Button><Button onClick={() => blocker.proceed()}>Yes, leave</Button></>}>
      <p className="text-sm text-slate-700">Are you sure you wish to leave the tenant&rsquo;s account without making a note?</p>
    </Modal>
  );
}
