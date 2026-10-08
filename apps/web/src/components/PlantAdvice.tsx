import { useEffect, useState } from 'react';
import { api, can } from '../lib/api';
import { fcfa } from '../lib/format';
import { Badge, ErrorBox, Modal, useDebounced, useLoad } from './ui';

/* Conseil plantes & compléments alimentaires : données ouvertes (Wikidata, Dr. Duke, NCCIH, Wikipédia) — NON validées cliniquement. */

export interface PlantLite { id: string; nom: string; nomLatin: string; famille?: string }
export interface InShelf { id: string; name: string; form: string | null; dosage: string | null; salePrice: number; stock: number }
export interface Suggestion {
  besoin: string; besoinLibelle: string; plante: PlantLite; note: string; alertes: string[]; contreIndications: string[];
  connaissances: string | null; securite: string | null; enRayon: InShelf[];
}
interface Besoin { id: string; libelle: string; pourquoi: string; questions: string[]; intensite: 'forte' | 'normale'; declenche: { produit: string; type: string }[] }
export interface Advice { avertissement: string; besoins: Besoin[]; suggestions: Suggestion[]; ecartees: { plante: PlantLite; raison: string }[]; suppression: { message: string } | null }

interface Fiche extends PlantLite {
  nomsCommuns?: string[]; nomsAnglais?: string[]; resume?: string; usagesTexte?: string; usagesListe?: string[]; precautions?: string;
  securite?: string; connaissances?: string; toxique?: boolean; sources: { nom: string; url?: string; licence: string }[];
  interactions: { niveau: string; classes: string[]; message: string }[];
  conseils: { grossesse?: string; enfant?: string; contreIndications?: string[] } | null; avertissement: string;
}

const LEVEL: Record<string, string> = { deconseille: 'Déconseillé', avis: 'Avis du pharmacien', ok: 'Pas de restriction connue' };

export function Disclaimer({ text }: { text?: string }) {
  return <p className="text-xs text-ink-muted">⚠️ {text ?? 'Information documentaire issue de sources ouvertes, non validée cliniquement : à confirmer par le pharmacien. Un complément ne remplace jamais un traitement.'}</p>;
}

export function PlantModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: p, error } = useLoad(() => api<Fiche>(`/plants/${id}`), [id]);
  return (
    <Modal title={p ? `🌿 ${p.nom}` : 'Plante'} onClose={onClose} wide>
      <ErrorBox error={error} />
      {p && (
        <div className="space-y-3 text-sm">
          <div className="text-xs text-ink-muted"><i>{p.nomLatin}</i>{p.famille ? ` · ${p.famille}` : ''}{p.nomsAnglais?.length ? ` · EN : ${p.nomsAnglais.slice(0, 3).join(', ')}` : ''}</div>
          {p.toxique && <div className="rounded-lg bg-red-50 p-2 font-bold text-red-700">☠️ Plante ou parties de plante potentiellement toxiques — voir précautions.</div>}
          {p.resume && <p>{p.resume}</p>}
          {p.usagesListe && p.usagesListe.length > 0 && <div><b>Usages traditionnels :</b> {p.usagesListe.join(', ')}.</div>}
          {p.usagesTexte && <div><b>Usages :</b> {p.usagesTexte}</div>}
          {p.securite && <div className="rounded-lg bg-amber-50 p-2"><b>Sécurité (NCCIH, NIH) :</b><div className="whitespace-pre-line">{p.securite}</div></div>}
          {p.connaissances && <div><b>État des connaissances :</b><div className="whitespace-pre-line">{p.connaissances}</div></div>}
          {p.precautions && <div className="rounded-lg bg-amber-50 p-2"><b>Précautions :</b> {p.precautions}</div>}
          {p.conseils && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-2"><b>Grossesse / allaitement :</b> {LEVEL[p.conseils.grossesse ?? 'avis']}</div>
              <div className="rounded-lg bg-slate-50 p-2"><b>Enfant :</b> {LEVEL[p.conseils.enfant ?? 'avis']}</div>
            </div>
          )}
          {p.conseils?.contreIndications?.length ? <ul className="list-disc pl-5">{p.conseils.contreIndications.map((c) => <li key={c}>{c}</li>)}</ul> : null}
          {p.interactions.length > 0 && (
            <div><b>Interactions médicamenteuses connues (règles internes) :</b>
              <ul className="mt-1 space-y-1">{p.interactions.map((i, k) => <li key={k}><Badge tone={i.niveau === 'eviter' ? 'bad' : 'warn'}>{i.niveau === 'eviter' ? 'À éviter' : 'Prudence'}</Badge> {i.message}</li>)}</ul>
            </div>
          )}
          <div className="border-t border-ink-line pt-2 text-xs text-ink-muted">
            <b>Sources et licences :</b>
            <ul>{p.sources.map((s, k) => <li key={k}>{s.url ? <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.nom}</a> : s.nom} — {s.licence}</li>)}</ul>
            <p className="mt-1">Les textes issus de Wikipédia sont sous licence CC BY-SA 4.0 (attribution et partage dans les mêmes conditions).</p>
          </div>
          <Disclaimer text={p.avertissement} />
        </div>
      )}
    </Modal>
  );
}

function SuggestionCard({ s, onAdd }: { s: Suggestion; onAdd?: (productId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-emerald-300 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-base">🌿 {s.plante.nom}</b>
        <span className="text-xs text-ink-muted"><i>{s.plante.nomLatin}</i></span>
        <button className="btn-alt ml-auto !py-0.5 text-xs" onClick={() => setOpen(true)}>Fiche complète</button>
      </div>
      <p className="mt-1 text-sm">{s.note}</p>
      {s.alertes.length > 0 && <ul className="mt-1 space-y-0.5">{s.alertes.map((a, k) => <li key={k} className="text-xs font-semibold text-orange-700">⚠️ {a}</li>)}</ul>}
      {s.contreIndications.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-ink-muted">{s.contreIndications.map((c) => <li key={c}>{c}</li>)}</ul>}
      <div className="mt-2">
        {s.enRayon.length > 0 ? (
          <div className="space-y-1">
            <div className="text-xs font-bold text-brand">En rayon :</div>
            {s.enRayon.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft px-2 py-1 text-sm">
                <span className="flex-1"><b>{p.name}</b>{p.dosage ? ` ${p.dosage}` : ''} <span className="text-xs text-ink-muted">· stock {p.stock}</span></span>
                <b>{fcfa(p.salePrice)}</b>
                {onAdd && <button className="btn !py-0.5" onClick={() => onAdd(p.id)}>+ Ajouter</button>}
              </div>
            ))}
          </div>
        ) : <div className="text-xs text-ink-muted">Aucun produit à base de cette plante en stock dans votre pharmacie.</div>}
      </div>
      {open && <PlantModal id={s.plante.id} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * Proposition faite AVANT de valider la vente : le vendeur propose le complément au client.
 * - le client accepte : « + Ajouter » ajoute le produit au panier (retour à la saisie) ;
 * - le client décline : « Le client décline l'offre » envoie la vente à la caisse (ou poursuit l'encaissement).
 */
export function OfferGate({ advice, declineLabel, onAdd, onDecline, onBack }: { advice: Advice; declineLabel: string; onAdd: (productId: string) => void; onDecline: () => void; onBack: () => void }) {
  const b = advice.besoins[0];
  return (
    <Modal title="💡 Avant de valider : proposer un complément" onClose={onBack} wide>
      <div className="space-y-3">
        {b && (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm"><b>{b.libelle}</b><div className="mt-1">{b.pourquoi}</div>
            <details className="mt-1"><summary className="cursor-pointer font-bold">Questions à poser au client</summary><ul className="list-disc pl-5">{b.questions.map((q) => <li key={q}>{q}</li>)}</ul></details></div>
        )}
        <div className="grid gap-2 md:grid-cols-2">{advice.suggestions.map((s) => <SuggestionCard key={s.plante.id} s={s} onAdd={onAdd} />)}</div>
        {advice.ecartees.length > 0 && <div className="text-xs text-ink-muted">Écartées pour sécurité : {advice.ecartees.map((e) => `${e.plante.nom} (${e.raison})`).join(' · ')}</div>}
        <Disclaimer text={advice.avertissement} />
        <div className="flex flex-wrap gap-2 border-t border-ink-line pt-3">
          <button className="btn !py-3 text-base" autoFocus onClick={onDecline}>✋ Le client décline l’offre — {declineLabel}</button>
          <button className="btn-alt" onClick={onBack}>↩ Retour au panier</button>
        </div>
      </div>
    </Modal>
  );
}
/** Caisse : propose un complément à base de plante d'après le contenu du panier. */
export function BasketAdvice({ productIds, onAdd }: { productIds: string[]; onAdd: (productId: string) => void }) {
  const [pregnant, setPregnant] = useState(false);
  const [child, setChild] = useState(false);
  const [data, setData] = useState<Advice | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const key = useDebounced(`${[...productIds].sort().join(',')}|${pregnant}|${child}`, 700);
  useEffect(() => {
    if (!productIds.length) { setData(null); return; }
    api<Advice>('/plants/basket', { method: 'POST', json: { productIds, pregnant, child } }).then(setData).catch(() => setData(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!data || (!data.suggestions.length && !data.suppression)) return null;
  const visible = data.suggestions.filter((s) => !hidden.has(s.plante.id));
  if (!visible.length && !data.suppression) return null;
  const b = data.besoins[0];
  return (
    <div className="no-print space-y-2 rounded-xl border-2 border-emerald-500 bg-emerald-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl">🌿</span>
        <b className="flex-1">Conseil complémentaire{b ? ` — ${b.libelle}` : ''}</b>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={pregnant} onChange={(e) => setPregnant(e.target.checked)} /> enceinte / allaitante</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={child} onChange={(e) => setChild(e.target.checked)} /> enfant</label>
      </div>
      {data.suppression && <div className="rounded-lg bg-amber-100 p-2 text-sm font-semibold text-amber-900">{data.suppression.message}</div>}
      {b && !data.suppression && (
        <>
          <p className="text-sm">{b.pourquoi}</p>
          <details className="text-sm"><summary className="cursor-pointer font-bold">Questions à poser au client</summary><ul className="list-disc pl-5">{b.questions.map((q) => <li key={q}>{q}</li>)}</ul></details>
        </>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        {visible.map((s) => (
          <SuggestionCard key={s.plante.id} s={s} onAdd={onAdd} />
        ))}
      </div>
      {data.ecartees.length > 0 && <div className="text-xs text-ink-muted">Écartées pour sécurité : {data.ecartees.map((e) => `${e.plante.nom} (${e.raison})`).join(' · ')}</div>}
      <div className="flex items-center justify-between gap-2"><Disclaimer text={data.avertissement} />{visible.length > 0 && <button className="btn-alt !py-0.5 text-xs" onClick={() => setHidden(new Set(visible.map((s) => s.plante.id)))}>Ignorer</button>}</div>
    </div>
  );
}

/** Fiche produit : plantes contenues, besoins couverts et compléments associés. */
export function ProductPlantPanel({ productId }: { productId: string }) {
  const { data, error } = useLoad(() => api<{ contientPlantes: (Fiche & { conseils: Fiche['conseils'] })[]; besoins: Besoin[]; suggestions: Suggestion[]; suppression: { message: string } | null; avertissement: string }>(`/plants/product/${productId}`), [productId]);
  const [open, setOpen] = useState<string | null>(null);
  if (error || !data) return null;
  const nothing = !data.contientPlantes.length && !data.suggestions.length && !data.suppression;
  if (nothing) return null;
  return (
    <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
      <b>🌿 Plantes & compléments</b>
      {data.contientPlantes.length > 0 && (
        <div className="text-sm">Ce produit contient : {data.contientPlantes.map((p) => <button key={p.id} className="mr-2 font-bold text-brand underline" onClick={() => setOpen(p.id)}>{p.nom}</button>)}</div>
      )}
      {data.suppression && <div className="rounded-lg bg-amber-100 p-2 text-sm">{data.suppression.message}</div>}
      {data.besoins[0] && <p className="text-sm">{data.besoins[0].pourquoi}</p>}
      <div className="grid gap-2 md:grid-cols-2">{data.suggestions.map((s) => <SuggestionCard key={s.plante.id} s={s} />)}</div>
      <Disclaimer text={data.avertissement} />
      {open && <PlantModal id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Conseil du jour : une plante différente chaque jour (rotation déterministe). */
export function DayPlant() {
  const { data } = useLoad(() => api<{ date: string; plante: Fiche; contreIndications: string[]; besoins: { id: string; libelle: string }[]; avertissement: string }>('/plants/today'));
  const [open, setOpen] = useState(false);
  if (!data || !can('plants.read')) return null;
  const p = data.plante;
  return (
    <div className="card border-l-4 border-emerald-500">
      <div className="flex flex-wrap items-center gap-2"><Badge tone="ok">Conseil du jour</Badge><span className="text-xs text-ink-muted">{new Date(data.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      <h3 className="mt-1 text-lg font-extrabold">🌿 {p.nom} <span className="text-xs font-normal text-ink-muted"><i>{p.nomLatin}</i></span></h3>
      {data.besoins.length > 0 && <div className="text-xs font-bold text-brand">Pour : {data.besoins.map((b) => b.libelle).join(' · ')}</div>}
      {p.resume && <p className="mt-1 text-sm">{p.resume.length > 320 ? `${p.resume.slice(0, 320)}…` : p.resume}</p>}
      {data.contreIndications.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-orange-700">{data.contreIndications.map((c) => <li key={c}>{c}</li>)}</ul>}
      <div className="mt-2 flex items-center justify-between gap-2"><Disclaimer text={data.avertissement} /><button className="btn-alt" onClick={() => setOpen(true)}>Fiche complète</button></div>
      {open && <PlantModal id={p.id} onClose={() => setOpen(false)} />}
    </div>
  );
}
