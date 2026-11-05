import { useEffect, useRef } from 'react';

export default function SignaturePad({ onChange }) {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current, ctx = c.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio; ctx.scale(ratio, ratio);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    let drawing = false;
    const pos = (e) => { const r = c.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return [p.clientX - r.left, p.clientY - r.top]; };
    const down = (e) => { drawing = true; ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); };
    const move = (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); e.preventDefault(); };
    const up = () => { if (drawing) { drawing = false; onChange?.(c.toDataURL('image/png')); } };
    c.addEventListener('mousedown', down); c.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    c.addEventListener('touchstart', down); c.addEventListener('touchmove', move); c.addEventListener('touchend', up);
    return () => { window.removeEventListener('mouseup', up); };
  }, [onChange]);
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); onChange?.(null); };
  return (
    <div>
      <canvas ref={ref} className="h-32 w-full cursor-crosshair rounded-md border border-slate-300 bg-white" style={{ touchAction: 'none' }} />
      <div className="mt-1 flex justify-between text-xs text-slate-500"><span>Sign above with mouse or finger</span><button type="button" className="link" onClick={clear}>Clear</button></div>
    </div>
  );
}
