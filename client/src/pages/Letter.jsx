import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api } from '../lib/api.js';
import { Spinner, Button } from '../components/ui.jsx';

/** Printable letters on facility letterhead. /letter/1,2,3 prints several. */
export default function Letter() {
  const { id } = useParams();
  const [letters, setLetters] = useState(null);
  useEffect(() => { Promise.all(id.split(',').map((x) => api.get(`/communications/${x}`))).then(setLetters); }, [id]);
  if (!letters) return <Spinner />;
  return (
    <div className="min-h-full bg-slate-200 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[8.5in] justify-end no-print"><Button icon={Printer} onClick={() => window.print()}>Print {letters.length > 1 ? `${letters.length} letters` : 'letter'}</Button></div>
      {letters.map((c) => (
        <div key={c.id} className="mx-auto mb-6 min-h-[10in] max-w-[8.5in] bg-white p-[0.8in] shadow print:mb-0 print:shadow-none" style={{ breakAfter: 'page' }}>
          <div className="mb-8 border-b-2 border-slate-800 pb-3">
            <div className="text-xl font-bold">{c.facility.name}</div>
            <div className="text-sm text-slate-600">{c.facility.address}, {c.facility.city}, {c.facility.state} {c.facility.zip} · {c.facility.phone}</div>
          </div>
          {c.first_name && <div className="mb-6 text-sm leading-relaxed">{c.first_name} {c.last_name}<br />{c.address}<br />{c.city}, {c.state} {c.zip}</div>}
          {c.subject && <div className="mb-4 font-bold">{c.subject}</div>}
          <div className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed">{c.body}</div>
        </div>
      ))}
    </div>
  );
}
