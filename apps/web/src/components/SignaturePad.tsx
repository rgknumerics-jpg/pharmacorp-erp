import { useEffect, useRef, useState } from 'react';

/** Pave de signature (doigt, stylet ou souris) -> PNG en data URL. */
export default function SignaturePad({ value, onChange, height = 140 }: { value?: string | null; onChange: (v: string | null) => void; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(!value);

  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = height * ratio; ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b3d2e';
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.offsetWidth, height); img.src = value; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const start = (e: React.PointerEvent) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); setEmpty(false); };
  const end = () => { if (!drawing.current) return; drawing.current = false; onChange(ref.current!.toDataURL('image/png')); };
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setEmpty(true); onChange(null); };

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-brand/50 bg-white">
        <canvas ref={ref} style={{ height, touchAction: 'none' }} className="w-full cursor-crosshair rounded-xl" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-muted">✍️ Signez ici</span>}
      </div>
      <button type="button" className="mt-1 text-xs font-bold text-red-700 underline" onClick={clear}>Effacer</button>
    </div>
  );
}
