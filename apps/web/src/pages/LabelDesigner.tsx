import { useRef, useState } from 'react';
import type { BrandingData, LabelBox, LabelKey } from '../lib/branding';
import { code128Svg } from '../lib/barcode';

const NAMES: Record<LabelKey, string> = { pharmacy: 'Nom de la pharmacie', name: 'Nom du produit', dci: 'DCI', expiry: 'Péremption', supplier: 'Fournisseur (abréviation)', lot: 'N° de lot', price: 'Prix', barcode: 'Code-barres' };
const SHOW: Record<LabelKey, keyof BrandingData['branding']['label']> = { pharmacy: 'showPharmacy', name: 'showName', dci: 'showDci', expiry: 'showExpiry', supplier: 'showSupplier', lot: 'showLot', price: 'showPrice', barcode: 'showBarcode' };
const SAMPLE: Record<LabelKey, string> = { pharmacy: '', name: 'PARACETAMOL 500 MG BTE 16', dci: 'paracétamol', expiry: 'Exp. 06/2028', supplier: 'LBX', lot: 'Lot A2401', price: '1 500 FCFA', barcode: '' };
const PX = 7; // pixels par mm dans l'aperçu

/** Aperçu de l'étiquette : on glisse chaque élément à l'endroit voulu, puis on règle sa taille. */
export function LabelDesigner({ d, onChange, onReset, disabled }: { d: BrandingData; onChange: (layout: Record<LabelKey, LabelBox>) => void; onReset: () => void; disabled?: boolean }) {
  const l = d.branding.label;
  const [sel, setSel] = useState<LabelKey>('name');
  const drag = useRef<{ k: LabelKey; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const keys = (Object.keys(NAMES) as LabelKey[]).filter((k) => l[SHOW[k]]);
  const set = (k: LabelKey, patch: Partial<LabelBox>) => onChange({ ...l.layout, [k]: { ...l.layout[k], ...patch } });
  const clamp = (v: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
  const down = (e: React.PointerEvent, k: LabelKey) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSel(k); drag.current = { k, sx: e.clientX, sy: e.clientY, ox: l.layout[k].x, oy: l.layout[k].y };
  };
  const move = (e: React.PointerEvent) => {
    const g = drag.current; if (!g) return;
    const b = l.layout[g.k];
    set(g.k, { x: clamp(g.ox + (e.clientX - g.sx) / PX, 0, l.widthMm - Math.min(b.w, 4)), y: clamp(g.oy + (e.clientY - g.sy) / PX, 0, l.heightMm - 2) });
  };
  const b = l.layout[sel];
  const num = (label: string, v: number, on: (n: number) => void, step = 0.5, min = 0) => (
    <label className="text-xs font-semibold">{label}<input type="number" step={step} min={min} disabled={disabled} className="mt-0.5 w-full" value={v} onChange={(e) => on(Number(e.target.value) || 0)} /></label>
  );
  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded-xl bg-slate-100 p-3">
        <div className="relative mx-auto bg-white shadow ring-1 ring-slate-400" style={{ width: l.widthMm * PX, height: l.heightMm * PX }} onPointerMove={move} onPointerUp={() => { drag.current = null; }}>
          {keys.map((k) => {
            const g = l.layout[k];
            const on = sel === k;
            return (
              <div key={k} onPointerDown={(e) => down(e, k)} className={`absolute cursor-move select-none overflow-hidden leading-tight ${on ? 'bg-sky-100/70 outline outline-2 outline-sky-500' : 'outline outline-1 outline-dashed outline-slate-300 hover:bg-sky-50'}`}
                style={{ left: g.x * PX, top: g.y * PX, width: g.w * PX, fontSize: g.fs * PX * 0.3528 * 1.0, textAlign: g.align ?? 'center', fontWeight: g.bold ? 800 : 400, height: k === 'barcode' ? (g.h ?? 7) * PX : undefined, touchAction: 'none' }}>
                {k === 'pharmacy' ? d.identity.name : k === 'barcode' ? <div style={{ height: '100%' }} dangerouslySetInnerHTML={{ __html: code128Svg('6001234567890', 28).replace('<svg', '<svg style="width:100%;height:100%"') }} /> : SAMPLE[k]}
              </div>
            );
          })}
        </div>
        <p className="mt-1 text-center text-[11px] text-ink-muted">Aperçu à l’échelle ({l.widthMm} × {l.heightMm} mm) — glissez un élément pour le placer.</p>
      </div>
      <div className="flex flex-wrap gap-1">{keys.map((k) => <button key={k} type="button" onClick={() => setSel(k)} className={`rounded-full px-3 py-1 text-xs font-bold ${sel === k ? 'bg-brand text-white' : 'bg-slate-100'}`}>{NAMES[k]}</button>)}</div>
      {keys.includes(sel) && (
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-6">
          {num('Gauche (mm)', b.x, (n) => set(sel, { x: clamp(n, 0, l.widthMm) }))}
          {num('Haut (mm)', b.y, (n) => set(sel, { y: clamp(n, 0, l.heightMm) }))}
          {num('Largeur (mm)', b.w, (n) => set(sel, { w: clamp(n, 5, l.widthMm) }))}
          {sel === 'barcode' ? num('Hauteur (mm)', b.h ?? 7, (n) => set(sel, { h: clamp(n, 3, l.heightMm) })) : num('Taille (pt)', b.fs, (n) => set(sel, { fs: clamp(n, 4, 30) }), 0.5, 4)}
          <label className="text-xs font-semibold">Alignement<select disabled={disabled} className="mt-0.5 w-full" value={b.align ?? 'center'} onChange={(e) => set(sel, { align: e.target.value as LabelBox['align'] })}><option value="left">Gauche</option><option value="center">Centré</option><option value="right">Droite</option></select></label>
          <label className="flex items-end gap-2 pb-1 text-xs font-semibold"><input type="checkbox" disabled={disabled} checked={!!b.bold} onChange={(e) => set(sel, { bold: e.target.checked })} /> Gras</label>
        </div>
      )}
      {!disabled && <button type="button" className="btn-alt !py-1 text-xs" onClick={onReset}>↺ Remettre la disposition par défaut pour ce format</button>}
    </div>
  );
}
