import { useEffect, useState } from 'react';
import { Send, Eye } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/store.jsx';
import { Modal, Button, Field, Input, Select, Textarea, useAction, Badge } from './ui.jsx';

export const MERGE_FIELDS = ['first_name', 'last_name', 'unit', 'balance', 'days_late', 'rent', 'gate_code', 'due_day', 'facility_name', 'facility_phone', 'facility_address', 'gate_hours', 'today'];

/**
 * Message composer. target: { tenant_ids: [...] } | { lead_id } | { audience, facility_id }
 */
export default function ComposeModal({ open, onClose, target, title = 'Send Message', defaultTemplate, onSent }) {
  const { data: templates } = useApi(open ? '/templates' : null);
  const [channel, setChannel] = useState('email');
  const [tpl, setTpl] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(null);
  const [run, busy] = useAction();
  const payload = () => ({ channel, subject, body, template_key: tpl || null, ...(target.lead_id ? { lead_id: target.lead_id } : target.tenant_ids ? { audience: 'selected', tenant_ids: target.tenant_ids } : target) });

  useEffect(() => { if (open) { setPreview(null); if (!defaultTemplate) { setTpl(''); setSubject(''); setBody(''); } } }, [open, defaultTemplate]);
  useEffect(() => { if (open && defaultTemplate && templates) applyTpl(defaultTemplate); }, [open, defaultTemplate, templates]);
  function applyTpl(key) {
    setTpl(key);
    const t = templates?.find((x) => x.key === key);
    if (t) { setChannel(t.channel); setSubject(t.subject || ''); setBody(t.body || ''); }
  }
  const doPreview = () => run(async () => setPreview(await api.post('/communications/preview', payload())));
  const send = () => run(async () => {
    const r = await api.post('/communications/send', payload());
    onSent?.(r); onClose();
    return r;
  }, (r) => `Message ${channel === 'letter' ? 'created' : 'sent'}: ${[r.sent && `${r.sent} delivered`, r.simulated && `${r.simulated} simulated (demo)`, r.ready_to_print && `${r.ready_to_print} letters ready to print`, r.failed && `${r.failed} failed`, r.skipped && `${r.skipped} opted out`].filter(Boolean).join(', ')}`);

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg"
      footer={<><Button variant="secondary" icon={Eye} onClick={doPreview} loading={busy}>Preview</Button><Button icon={Send} onClick={send} loading={busy} disabled={!body.trim()}>{channel === 'letter' ? 'Create Letter(s)' : 'Send'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Template"><Select value={tpl} onChange={(e) => applyTpl(e.target.value)} placeholder="— Blank message —" options={(templates || []).map((t) => ({ value: t.key, label: `${t.name} (${t.channel})` }))} /></Field>
        <Field label="Channel"><Select value={channel} onChange={(e) => setChannel(e.target.value)} options={[{ value: 'email', label: 'Email' }, { value: 'sms', label: 'Text message (SMS)' }, { value: 'letter', label: 'Printed letter' }]} /></Field>
      </div>
      {channel !== 'sms' && <Field label="Subject" className="mt-3"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
      <Field label="Message" className="mt-3"><Textarea rows={channel === 'sms' ? 4 : 10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      {channel === 'sms' && <div className="mt-1 text-xs text-slate-500">{body.length} characters · {Math.max(1, Math.ceil(body.length / 160))} segment(s)</div>}
      <div className="mt-2 flex flex-wrap gap-1">
        <span className="mr-1 text-xs text-slate-500">Insert:</span>
        {MERGE_FIELDS.map((f) => <button key={f} type="button" onClick={() => setBody((b) => b + `{{${f}}}`)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-slate-200">{f}</button>)}
      </div>
      {preview && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-500"><Badge color="blue">{preview.count} recipient(s)</Badge> Preview for first recipient</div>
          {preview.subject && <div className="mb-1 text-sm font-semibold">{preview.subject}</div>}
          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{preview.body}</pre>
        </div>
      )}
    </Modal>
  );
}
