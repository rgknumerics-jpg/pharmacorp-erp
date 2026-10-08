import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, ErrorBox, PageTitle, useDebounced } from '../components/ui';
import { DayPlant, Disclaimer, PlantModal } from '../components/PlantAdvice';

interface Hit { id: string; nom: string; nomLatin: string; famille?: string; resume?: string; toxique?: boolean }

const IDEAS = ['douleur articulaire', 'toux', 'digestion', 'sommeil', 'stress', 'fièvre', 'diarrhée', 'cystite', 'brûlure', 'fatigue'];

/** Module « Conseil » : plante du jour + recherche par plante ou par symptôme. */
export default function Plants() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (dq.trim().length < 2) { setHits([]); setTotal(0); return; }
    api<{ total: number; resultats: Hit[] }>(`/plants/search?q=${encodeURIComponent(dq.trim())}&limit=40`).then((r) => { setHits(r.resultats); setTotal(r.total); setError(null); }).catch((e: Error) => setError(e.message));
  }, [dq]);
  return (
    <>
      <PageTitle title="Conseil — plantes et compléments" sub="Plantes médicinales : fiches, précautions, interactions. Sources ouvertes (Wikidata, Dr. Duke/USDA, NCCIH/NIH, Wikipédia)." />
      <div className="space-y-4">
        <DayPlant />
        <div className="card space-y-2">
          <input className="w-full" placeholder="Une plante (curcuma, thym…) ou un symptôme (toux, douleur articulaire, sommeil…)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="flex flex-wrap gap-1">{IDEAS.map((i) => <button key={i} className="btn-alt !py-0.5 text-xs" onClick={() => setQ(i)}>{i}</button>)}</div>
          <ErrorBox error={error} />
          {dq.trim().length >= 2 && <div className="text-xs text-ink-muted">{total} résultat(s){total > hits.length ? ` — ${hits.length} affichés` : ''}</div>}
          <div className="grid gap-2 md:grid-cols-2">
            {hits.map((h) => (
              <button key={h.id} className="rounded-xl border border-ink-line p-3 text-left hover:bg-slate-50" onClick={() => setOpen(h.id)}>
                <div className="flex items-center gap-2"><b>🌿 {h.nom}</b>{h.toxique && <Badge tone="bad">toxicité possible</Badge>}</div>
                <div className="text-xs text-ink-muted"><i>{h.nomLatin}</i>{h.famille ? ` · ${h.famille}` : ''}</div>
                {h.resume && <p className="mt-1 text-sm">{h.resume}</p>}
              </button>
            ))}
          </div>
        </div>
        <Disclaimer />
      </div>
      {open && <PlantModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
