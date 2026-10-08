import { useEffect, useRef, useState } from 'react';
import { api, can } from '../lib/api';
import { Badge, ErrorBox, Field, Modal, PageTitle, useDebounced, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Contact = { name: string; role?: string; phone?: string; email?: string };
const STATE: [string, string][] = [['', 'Tout'], ['linked', 'Reliés'], ['suggested', 'Propositions'], ['none', 'Non reliés'], ['unavailable', 'Indisponibles']];
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'muted'> = { a_traiter: 'bad', declare: 'warn', accepte: 'info', refuse: 'bad', avoir_recu: 'ok', clos: 'muted' };
const today = () => new Date().toISOString().slice(0, 10);

export default function Suppliers() {
  const [tab, setTab] = useState<'sup' | 'claims'>('sup');
  const { data: sum, reload } = useLoad(() => api<any>('/supplier-hub/claims/summary'), []) as any;
  return (
    <>
      <PageTitle title="Fournisseurs" sub="Grossistes (Laborex, Ubipharm, CEP…) : catalogue de CIP, commandes à leur format, réclamations, retours et avoirs" />
      <div className="mb-3 flex flex-wrap gap-2">
        <button className={tab === 'sup' ? 'btn' : 'btn-alt'} onClick={() => setTab('sup')}>Grossistes et catalogues</button>
        <button className={tab === 'claims' ? 'btn' : 'btn-alt'} onClick={() => setTab('claims')}>Réclamations, retours et avoirs{sum?.toDeclare ? <span className="ml-2 rounded-full bg-red-600 px-2 text-xs text-white">{sum.toDeclare}</span> : null}</button>
      </div>
      {tab === 'sup' ? <Hub /> : <Claims onChange={() => reload?.()} />}
    </>
  );
}

// ---------------------------------------------------------------- grossistes
function Hub() {
  const { data, error, reload } = useLoad(() => api<any[]>('/supplier-hub/overview'), []) as any;
  const [open, setOpen] = useState<any | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const { data: ref } = useLoad(() => api<{ total: number; byProvider: Record<string, number> }>('/supplier-hub/reference'), []) as any;
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  return (
    <>
      <ErrorBox error={error} />
      <div className="mb-3 rounded-xl border-l-4 border-sky-500 bg-sky-50 p-3 text-sm">
        <b>Importer la base produits d’un fournisseur</b>
        <ol className="ml-5 list-decimal text-ink-muted">
          <li>Téléchargez le fichier catalogue sur l’extranet du grossiste (CSV : CIP, désignation, DCI, quantité).</li>
          <li>Sur la carte du fournisseur ci-dessous, cliquez sur <b>⬆ Importer le catalogue</b> et choisissez le fichier.</li>
          <li>L’ERP relie les CIP à vos produits et mémorise le format du fichier de commande de ce fournisseur.</li>
        </ol>
        {ref && <div className="mt-1 text-xs"><b>Référentiel CIP déjà intégré :</b> {ref.total.toLocaleString('fr-FR')} codes ({Object.entries(ref.byProvider).map(([k, v]) => `${({ laborex: 'Laborex', cep: 'CEP / SEP', ubipharm: 'Ubipharm' } as Record<string, string>)[k] ?? k} : ${(v as number).toLocaleString('fr-FR')}`).join(' · ')}). Il est utilisé automatiquement à la création et à l’importation des produits : aucun import n’est nécessaire pour retrouver ces codes.</div>}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((s: any) => (
          <div key={s.id} className="card !p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-extrabold">{s.name} {s.abbreviation && <span className="text-xs text-ink-muted">({s.abbreviation})</span>}</div>
                {s.isWholesaler && <Badge tone="info">Grossiste</Badge>}
              </div>
              {s.claims.open > 0 && <Badge tone={s.claims.late || s.claims.urgent ? 'bad' : 'warn'}>{s.claims.open} réclamation(s){s.claims.late ? ` · ${s.claims.late} hors délai` : ''}</Badge>}
            </div>
            <div className="mt-2 text-xs text-ink-muted">
              {s.catalog.total ? <>Catalogue : <b>{s.catalog.total}</b> CIP · reliés <b>{s.catalog.linked}</b> · propositions <b>{s.catalog.suggested}</b> · indisponibles <b>{s.catalog.unavailable}</b></> : 'Aucun catalogue importé.'}
            </div>
            <div className="mt-1 text-xs text-ink-muted">{(s.contacts as Contact[] | null)?.length ? (s.contacts as Contact[]).map((c) => [c.name, c.role].filter(Boolean).join(' · ')).join(' | ') : 'Aucun contact enregistré.'}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {can('purchases.write') && <button className="btn !py-1 text-xs" onClick={() => setOpen({ ...s, autoImport: true })}>⬆ Importer le catalogue</button>}
              <button className="btn-alt !py-1 text-xs" onClick={() => setOpen(s)}>Catalogue et CIP</button>
              {can('purchases.write') && <button className="btn-alt !py-1 text-xs" onClick={() => setEdit(s)}>Fiche et contacts</button>}
            </div>
          </div>
        ))}
      </div>
      {can('purchases.write') && <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-alt" onClick={() => setEdit({ name: '', abbreviation: '', isWholesaler: true, contacts: [] })}>+ Nouveau fournisseur</button>
        {can('products.write') && <button className="btn" disabled={enriching} onClick={async () => { setEnriching(true); setEnrichMsg(null); try { const r = await api<{ scanned: number; filled: number; products: number }>('/supplier-hub/enrich', { method: 'POST' }); setEnrichMsg(`${r.filled} code(s) CIP ajouté(s) sur ${r.products} produit(s) (${r.scanned} produits examinés).`); reload(); } catch (e) { setEnrichMsg((e as Error).message); } finally { setEnriching(false); } }}>{enriching ? 'Recherche des CIP…' : '✨ Compléter automatiquement les CIP de mes produits'}</button>}
        {enrichMsg && <span className="text-sm font-bold text-brand">{enrichMsg}</span>}
      </div>}
      <p className="mt-2 text-xs text-ink-muted">Référentiel commun intégré : les codes CIP Laborex et CEP/SEP sont retrouvés à partir du nom du produit, à la création, à l’importation et par ce bouton (correspondance sûre à plus de 92 %). Les fournisseurs sont reconnus à leur nom ou abréviation (Laborex/LBX, CEP/SEP, Ubipharm).</p>
      {open && <CatalogModal sup={open} onClose={() => { setOpen(null); reload(); }} />}
      {edit && <SupplierEdit sup={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function SupplierEdit({ sup, onClose, onSaved }: { sup: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: sup.name ?? '', abbreviation: sup.abbreviation ?? '', isWholesaler: !!sup.isWholesaler, phone: sup.phone ?? '', email: sup.email ?? '' });
  const [contacts, setContacts] = useState<Contact[]>((sup.contacts as Contact[]) ?? []);
  const [err, setErr] = useState<string | null>(null);
  const upd = (i: number, k: keyof Contact, v: string) => setContacts(contacts.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  async function save() {
    setErr(null);
    const body: any = { name: f.name, abbreviation: f.abbreviation || undefined, isWholesaler: f.isWholesaler, phone: f.phone || undefined, email: f.email || undefined, contacts: contacts.filter((c) => c.name.trim()).map((c) => ({ name: c.name, role: c.role || undefined, phone: c.phone || undefined, email: c.email || undefined })) };
    try { await api(sup.id ? `/suppliers/${sup.id}` : '/suppliers', { method: sup.id ? 'PATCH' : 'POST', json: body }); onSaved(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title={sup.id ? sup.name : 'Nouveau fournisseur'} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Nom *" className="md:col-span-2"><input className="w-full" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Abréviation (étiquettes)"><input className="w-full" maxLength={12} value={f.abbreviation} onChange={(e) => setF({ ...f, abbreviation: e.target.value.toUpperCase() })} /></Field>
          <Field label="Grossiste ?"><label className="flex items-center gap-2 pt-2"><input type="checkbox" checked={f.isWholesaler} onChange={(e) => setF({ ...f, isWholesaler: e.target.checked })} /> Oui (catalogue CIP)</label></Field>
          <Field label="Téléphone"><input className="w-full" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="E-mail"><input className="w-full" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="mb-2 text-sm font-extrabold">Contacts (pour déclarer et relancer les réclamations)</div>
          {contacts.map((c, i) => (
            <div key={i} className="mb-2 grid gap-2 md:grid-cols-5">
              <input placeholder="Nom" value={c.name} onChange={(e) => upd(i, 'name', e.target.value)} />
              <input placeholder="Fonction (Commandes, Réclamations…)" value={c.role ?? ''} onChange={(e) => upd(i, 'role', e.target.value)} />
              <input placeholder="Téléphone / WhatsApp" value={c.phone ?? ''} onChange={(e) => upd(i, 'phone', e.target.value)} />
              <input placeholder="E-mail" value={c.email ?? ''} onChange={(e) => upd(i, 'email', e.target.value)} />
              <button className="btn-alt !py-1" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}>Retirer</button>
            </div>
          ))}
          <button className="btn-alt !py-1 text-xs" onClick={() => setContacts([...contacts, { name: '' }])}>+ Contact</button>
        </div>
        <ErrorBox error={err} />
        <button className="btn" onClick={save} disabled={f.name.trim().length < 2}>Enregistrer</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- catalogue d'un grossiste
function CatalogModal({ sup, onClose }: { sup: any; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [skip, setSkip] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<any | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q, 300);
  useEffect(() => { if (sup.autoImport) setTimeout(() => file.current?.click(), 250); }, [sup.autoImport]);
  const { data, error, reload } = useLoad(() => api<any>(`/supplier-hub/${sup.id}/catalog?q=${encodeURIComponent(dq)}&state=${state}&take=50&skip=${skip}`), [dq, state, skip]) as any;
  async function upload(f?: File | null) {
    if (!f) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r: any = await api(`/supplier-hub/${sup.id}/catalog/import`, { method: 'POST', form: fd });
      setMsg(`${r.total} CIP importés (${r.available} disponibles, ${r.unavailable} indisponibles) : ${r.linked} reliés, ${r.suggested} propositions, ${r.unmatched} sans correspondance. Le format du fichier de commande de ce grossiste est mémorisé.`);
      setSkip(0); reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  }
  async function acceptAll() {
    setBusy(true); setErr(null);
    try { const r: any = await api(`/supplier-hub/${sup.id}/catalog/accept-suggestions`, { method: 'POST', json: { minScore: 85 } }); setMsg(`${r.accepted} proposition(s) acceptée(s) (score ≥ 85).`); reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function link(item: any, productId: string | null) {
    setErr(null);
    try { await api(`/supplier-hub/${sup.id}/catalog/${item.id}/link`, { method: 'POST', json: { productId } }); setPick(null); reload(); } catch (e) { setErr((e as Error).message); }
  }
  const w = can('purchases.write');
  return (
    <Modal title={`Catalogue ${sup.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">Importez le fichier catalogue téléchargé sur l’extranet du grossiste (CIP, désignation, DCI, quantité disponible). L’ERP relie les CIP à vos produits et reprend le <b>format exact</b> de ce fichier pour vos commandes. Un même produit peut avoir un CIP chez chaque grossiste ; le code-barres interne reste celui de la fiche produit.</p>
        {w && <div className="flex flex-wrap items-center gap-2">
          <input ref={file} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Import…' : '⬆ Importer le catalogue (CSV)'}</button>
          <button className="btn-alt" disabled={busy} onClick={acceptAll}>Accepter les propositions ≥ 85</button>
        </div>}
        {msg && <div className="rounded-lg bg-brand-soft p-3 text-sm font-bold text-brand">{msg}</div>}
        <ErrorBox error={err ?? error} />
        <div className="flex flex-wrap items-center gap-2">
          <input className="min-w-[220px] flex-1" placeholder="🔎 CIP, désignation, DCI…" value={q} onChange={(e) => { setQ(e.target.value); setSkip(0); }} />
          {STATE.map(([k, l]) => <button key={k} className={`rounded-full px-3 py-1 text-xs font-bold ${state === k ? 'bg-brand text-white' : 'bg-slate-100'}`} onClick={() => { setState(k); setSkip(0); }}>{l}</button>)}
        </div>
        <div className="max-h-[50vh] overflow-auto rounded-lg border border-ink-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs"><tr><th className="px-2 py-1">CIP</th><th>Désignation</th><th>Dispo</th><th>Produit relié</th><th /></tr></thead>
            <tbody>
              {data?.items.map((i: any) => (
                <tr key={i.id} className="border-t border-ink-line">
                  <td className="px-2 font-mono text-xs">{i.cip}</td>
                  <td>{i.designation}<div className="text-[10px] text-ink-muted">{i.dci}</div></td>
                  <td>{i.available ? <Badge>oui</Badge> : <Badge tone="bad">non</Badge>}</td>
                  <td className="text-xs">
                    {i.product ? <b>{i.product.name}</b> : i.suggested ? <span className="text-amber-700">Proposé : {i.suggested.name} ({i.score})</span> : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-1 text-right">
                    {w && i.suggested && !i.product && <button className="text-xs font-bold text-brand underline" onClick={() => link(i, i.suggested.id)}>Accepter</button>}
                    {w && <button className="ml-2 text-xs font-bold text-brand underline" onClick={() => setPick(i)}>{i.product ? 'Changer' : 'Relier'}</button>}
                    {w && i.product && <button className="ml-2 text-xs text-red-600 underline" onClick={() => link(i, null)}>Délier</button>}
                  </td>
                </tr>
              ))}
              {data && !data.items.length && <tr><td colSpan={5} className="p-4 text-center text-ink-muted">Aucune ligne.</td></tr>}
            </tbody>
          </table>
        </div>
        {data && <div className="flex items-center justify-between text-xs text-ink-muted"><span>{data.total} ligne(s)</span><span className="flex gap-2"><button className="btn-alt !py-1" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - 50))}>←</button><button className="btn-alt !py-1" disabled={skip + 50 >= data.total} onClick={() => setSkip(skip + 50)}>→</button></span></div>}
      </div>
      {pick && <ProductPicker item={pick} onClose={() => setPick(null)} onPick={(p) => link(pick, p)} />}
    </Modal>
  );
}

function ProductPicker({ item, onClose, onPick }: { item: any; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState(item.designation.split(' ')[0] ?? '');
  const dq = useDebounced(q, 250);
  const { data } = useLoad(() => api<any>(`/products?q=${encodeURIComponent(dq)}&take=15`), [dq]) as any;
  const list: any[] = Array.isArray(data) ? data : data?.items ?? [];
  return (
    <Modal title={`Relier le CIP ${item.cip}`} onClose={onClose}>
      <div className="space-y-2">
        <div className="text-sm">{item.designation}</div>
        <input autoFocus className="w-full" placeholder="Chercher votre produit…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-auto">{list.map((p) => <button key={p.id} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-brand-soft" onClick={() => onPick(p.id)}>{p.name}</button>)}</div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- réclamations, retours, avoirs
function Claims({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState('open');
  const [supplierId, setSupplierId] = useState('');
  const [nature, setNature] = useState('');
  const [q, setQ] = useState('');
  const [late, setLate] = useState(false);
  const [add, setAdd] = useState(false);
  const [act, setAct] = useState<{ c: any; status: string } | null>(null);
  const [msg, setMsg] = useState<any | null>(null);
  const dq = useDebounced(q, 300);
  const { data: meta } = useLoad(() => api<any>('/supplier-hub/meta'), []) as any;
  const { data: sups } = useLoad(() => api<any[]>('/suppliers'), []) as any;
  const { data: sum, reload: reSum } = useLoad(() => api<any>('/supplier-hub/claims/summary'), []) as any;
  const { data, error, reload } = useLoad(() => api<any[]>(`/supplier-hub/claims?status=${status === 'all' ? '' : status}&supplierId=${supplierId}&nature=${nature}&q=${encodeURIComponent(dq)}&late=${late ? 1 : 0}`), [status, supplierId, nature, dq, late]) as any;
  const refresh = () => { reload(); reSum?.(); onChange(); };
  async function show(c: any, reminder: boolean) { setMsg({ ...(await api<any>(`/supplier-hub/claims/${c.id}/message?reminder=${reminder ? 1 : 0}`)), claim: c }); }
  const w = can('purchases.write');
  return (
    <>
      {sum && (
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          {[['À déclarer', sum.toDeclare, sum.toDeclare ? 'bad' : 'ok'], ['Hors délai (' + sum.delayDays + ' j)', sum.late, sum.late ? 'bad' : 'ok'], ['Échéance ≤ 2 jours', sum.urgent, sum.urgent ? 'warn' : 'ok'], ['Avoir à recevoir', sum.awaitingCredit, 'info'], ['Avoirs reçus (FCFA)', Number(sum.creditReceived).toLocaleString('fr-FR'), 'ok']].map(([l, v, t]) => <div key={String(l)} className="card !p-3 text-center"><div className="text-xs text-ink-muted">{l}</div><div className={`text-xl font-extrabold ${t === 'bad' ? 'text-red-600' : t === 'warn' ? 'text-amber-600' : ''}`}>{v}</div></div>)}
        </div>
      )}
      <div className="card mb-3 flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">En cours</option><option value="all">Toutes</option>{meta && Object.entries(meta.statuses).map(([k, l]) => <option key={k} value={k}>{String(l)}</option>)}</select>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Tous les fournisseurs</option>{sups?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={nature} onChange={(e) => setNature(e.target.value)}><option value="">Toutes natures</option>{meta && Object.entries(meta.natures).map(([k, l]) => <option key={k} value={k}>{String(l)}</option>)}</select>
        <input placeholder="🔎 Produit, n° RC, BL…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} /> Hors délai</label>
        {w && <button className="btn ml-auto" onClick={() => setAdd(true)}>+ Nouvelle réclamation / retour</button>}
      </div>
      <ErrorBox error={error} />
      <div className="space-y-2">
        {data?.map((c: any) => (
          <div key={c.id} className={`card !p-3 ${c.late ? 'border-l-4 border-red-600' : c.urgent ? 'border-l-4 border-amber-500' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <b>{c.number}</b><Badge tone={TONE[c.status]}>{c.statusLabel}</Badge><span className="text-sm">{c.natureLabel}</span>
              <span className="ml-auto text-xs text-ink-muted">{c.supplier?.name}</span>
            </div>
            <div className="mt-1 text-sm"><b>{c.productName}</b> × {c.quantity}{c.cip ? ` · CIP ${c.cip}` : ''}{c.blNumber ? ` · BL ${c.blNumber}` : ''}{c.returnGoods ? ' · retour de marchandise' : ''}</div>
            <div className="text-xs text-ink-muted">
              Livré le {String(c.deliveredAt).slice(0, 10)} · à déclarer avant le {String(c.deadline).slice(0, 10)}
              {c.status === 'a_traiter' && <b className={c.late ? 'text-red-600' : c.urgent ? 'text-amber-700' : ''}> · {c.late ? `${-c.daysLeft} jour(s) de retard` : `${c.daysLeft} jour(s) restant(s)`}</b>}
              {c.creditNoteRef || c.creditAmount ? ` · avoir ${c.creditNoteRef ?? ''} ${c.creditAmount ? Number(c.creditAmount).toLocaleString('fr-FR') + ' FCFA' : ''}` : ''}
            </div>
            {c.detail && <div className="text-xs">{c.detail}</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              {c.status !== 'clos' && <button className="btn-alt !py-1 text-xs" onClick={() => show(c, c.status !== 'a_traiter')}>{c.status === 'a_traiter' ? 'Message de déclaration' : 'Relancer'}</button>}
              {w && c.next.map((n: string) => <button key={n} className="btn-alt !py-1 text-xs" onClick={() => setAct({ c, status: n })}>→ {meta?.statuses[n] ?? n}</button>)}
            </div>
          </div>
        ))}
        {data && !data.length && <div className="card text-center text-ink-muted">Aucune réclamation.</div>}
      </div>
      {add && <NewClaim sups={sups ?? []} meta={meta} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); refresh(); }} />}
      {act && <Transition c={act.c} status={act.status} label={meta?.statuses[act.status]} onClose={() => setAct(null)} onSaved={() => { setAct(null); refresh(); }} />}
      {msg && (
        <Modal title={msg.subject} onClose={() => setMsg(null)} wide>
          <div className="space-y-3">
            <div className="text-sm text-ink-muted">{msg.contacts.length ? msg.contacts.map((x: Contact) => [x.name, x.role, x.phone, x.email].filter(Boolean).join(' · ')).join(' | ') : 'Aucun contact enregistré : ajoutez-en dans « Fiche et contacts ».'}</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{msg.body}</pre>
            <div className="flex flex-wrap gap-2">
              {msg.mailto && <a className="btn" href={msg.mailto}>Envoyer par e-mail</a>}
              {msg.waLink && <a className="btn-alt" href={msg.waLink} target="_blank" rel="noreferrer">Envoyer par WhatsApp</a>}
              <button className="btn-alt" onClick={() => navigator.clipboard?.writeText(msg.body)}>Copier le texte</button>
            </div>
            <p className="text-xs text-ink-muted">Après l’envoi, passez la réclamation à « Déclarée au fournisseur » pour suivre la réponse.</p>
          </div>
        </Modal>
      )}
    </>
  );
}

function NewClaim({ sups, meta, onClose, onSaved }: { sups: any[]; meta: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ supplierId: '', nature: 'non_livre', productName: '', cip: '', quantity: 1, blNumber: '', deliveredAt: today(), detail: '', returnGoods: false });
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setErr(null);
    try { await api('/supplier-hub/claims', { method: 'POST', json: { ...f, quantity: Number(f.quantity) || 1 } }); onSaved(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title="Nouvelle réclamation / retour fournisseur" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Fournisseur *"><select className="w-full" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Nature *"><select className="w-full" value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value })}>{meta && Object.entries(meta.natures).map(([k, l]) => <option key={k} value={k}>{String(l)}</option>)}</select></Field>
          <Field label="Date de livraison"><input type="date" className="w-full" value={f.deliveredAt} max={today()} onChange={(e) => setF({ ...f, deliveredAt: e.target.value })} /></Field>
          <Field label="Produit concerné *" className="md:col-span-2"><input className="w-full" value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} /></Field>
          <Field label="Quantité"><input type="number" min={1} className="w-full" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="CIP"><input className="w-full" value={f.cip} onChange={(e) => setF({ ...f, cip: e.target.value })} /></Field>
          <Field label="N° bon de livraison / facture"><input className="w-full" value={f.blNumber} onChange={(e) => setF({ ...f, blNumber: e.target.value })} /></Field>
          <Field label="Retour de marchandise"><label className="flex items-center gap-2 pt-2"><input type="checkbox" checked={f.returnGoods} onChange={(e) => setF({ ...f, returnGoods: e.target.checked })} /> Le produit est à reprendre</label></Field>
        </div>
        <Field label="Détail"><textarea rows={2} className="w-full" maxLength={400} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
        <p className="text-xs text-ink-muted">Le fournisseur n’accepte la réclamation que dans les {meta?.delayDays ?? 7} jours après la livraison : l’ERP calcule l’échéance et vous alerte.</p>
        <ErrorBox error={err} />
        <button className="btn" disabled={!f.supplierId || f.productName.trim().length < 2} onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}

function Transition({ c, status, label, onClose, onSaved }: { c: any; status: string; label?: string; onClose: () => void; onSaved: () => void }) {
  const [via, setVia] = useState('mail');
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setErr(null);
    try { await api(`/supplier-hub/claims/${c.id}`, { method: 'PATCH', json: { status, notes: notes || undefined, declaredVia: status === 'declare' ? via : undefined, creditNoteRef: ref || undefined, creditAmount: status === 'avoir_recu' ? Number(amount) : undefined } }); onSaved(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title={`${c.number} → ${label ?? status}`} onClose={onClose}>
      <div className="space-y-3">
        {status === 'declare' && <Field label="Déclarée par"><select className="w-full" value={via} onChange={(e) => setVia(e.target.value)}>{[['mail', 'E-mail'], ['whatsapp', 'WhatsApp'], ['extranet', 'Extranet'], ['telephone', 'Téléphone'], ['visite', 'Visite du délégué']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
        {status === 'avoir_recu' && <div className="grid gap-3 md:grid-cols-2"><Field label="N° de l’avoir"><input className="w-full" value={ref} onChange={(e) => setRef(e.target.value)} /></Field><Field label="Montant (FCFA) *"><input type="number" min={0} className="w-full" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>}
        <Field label="Note"><input className="w-full" maxLength={120} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <ErrorBox error={err} />
        <button className="btn" disabled={status === 'avoir_recu' && amount === ''} onClick={go}>Confirmer</button>
      </div>
    </Modal>
  );
}
