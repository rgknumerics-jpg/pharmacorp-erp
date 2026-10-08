import { useState } from 'react';
import { ErrorBox } from './ui';

/** Clavier de saisie du code personnel (4 à 8 chiffres) : tactile, ou clavier de l'ordinateur. */
export function PinPad({ title, subtitle, icon = '🔒', busyLabel = 'Vérification…', okLabel = 'Valider', onSubmit, onCancel }: { title: string; subtitle?: string; icon?: string; busyLabel?: string; okLabel?: string; onSubmit: (pin: string) => Promise<void>; onCancel?: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(p = pin) {
    if (p.length < 4 || busy) return;
    setBusy(true); setErr(null);
    try { await onSubmit(p); } catch (e) { setErr((e as Error).message); setPin(''); } finally { setBusy(false); }
  }
  const press = (d: string) => setPin((x) => (x.length < 8 ? x + d : x));
  return (
    <div className="mx-auto mt-6 max-w-xs space-y-3 text-center">
      <div className="text-4xl">{icon}</div>
      <h1 className="text-xl font-extrabold">{title}</h1>
      {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
      <div className="rounded-xl bg-slate-100 py-3 text-3xl tracking-[.5em]">{pin ? '•'.repeat(pin.length) : <span className="text-slate-300">••••</span>}</div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} className="rounded-xl bg-white py-3 text-xl font-bold shadow ring-1 ring-ink-line active:scale-95" onClick={() => press(d)}>{d}</button>)}
        <button className="rounded-xl bg-slate-100 py-3 font-bold" onClick={() => setPin('')}>C</button>
        <button className="rounded-xl bg-white py-3 text-xl font-bold shadow ring-1 ring-ink-line active:scale-95" onClick={() => press('0')}>0</button>
        <button className="rounded-xl bg-slate-100 py-3 font-bold" onClick={() => setPin((x) => x.slice(0, -1))}>⌫</button>
      </div>
      <input className="sr-only" autoFocus aria-label="Code" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
      <ErrorBox error={err} />
      <button className="btn w-full !py-3" disabled={pin.length < 4 || busy} onClick={() => go()}>{busy ? busyLabel : okLabel}</button>
      {onCancel && <button className="btn-alt w-full" onClick={onCancel}>Retour</button>}
    </div>
  );
}
