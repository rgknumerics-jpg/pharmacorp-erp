import { useState } from 'react';
import { api } from '../lib/api';
import { dateTimeFr } from '../lib/format';
import { Badge, ErrorBox, PageTitle, useLoad } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ACCEPT = '.myd,.frm,.myi,.rar,.zip,.csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,.json,.dbf,.db,.sqlite,.sqlite3,.mdb,.accdb,.sql,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff';

export default function Migration() {
  const history = useLoad(() => api<any[]>('/migration/jobs'));
  const [meta, setMeta] = useState<{ entities: Record<string, string>; fields: Record<string, Record<string, { label: string; required?: boolean }>> } | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(files: FileList) {
    setBusy(true); setErr(null);
    try {
      for (const f of Array.from(files)) {
        const form = new FormData(); form.append('file', f);
        const r = await api<any>('/migration/analyze', { method: 'POST', form });
        setMeta({ entities: r.entities, fields: r.fields });
        setJobs((js) => [...r.jobs, ...js]);
      }
      history.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const [folder, setFolder] = useState(() => { try { return localStorage.getItem('erp.wpfolder') ?? ''; } catch { return ''; } });
  const [since, setSince] = useState('2024-10-01');
  const [notes, setNotes] = useState<string[]>([]);
  async function readFolder() {
    setBusy(true); setErr(null); setNotes([]);
    try {
      try { localStorage.setItem('erp.wpfolder', folder); } catch { /* ignore */ }
      const r = await api<any>('/migration/analyze-folder', { method: 'POST', json: { folder, since } });
      setMeta({ entities: r.entities, fields: r.fields }); setNotes(r.notes ?? []);
      setJobs((js) => [...r.jobs, ...js]);
      history.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function open(id: string) {
    setErr(null);
    try { const j = await api<any>(`/migration/jobs/${id}`); setMeta({ entities: j.entities, fields: j.fields }); setJobs((js) => [j, ...js.filter((x) => x.id !== id)]); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <>
      <PageTitle title="Reprise des données" sub="Copiez les fichiers de votre ancien logiciel : l’ERP reconnaît et transcrit produits, stock, clients (créances, plafonds, avoirs), fournisseurs (dettes), ventes, dépenses et banque" />
      <div className="card mb-3 space-y-2 border-l-4 border-brand">
        <h3 className="font-extrabold">🗄 Lire la base installée sur cet ordinateur (WinPharma / MySQL)</h3>
        <p className="text-xs text-ink-muted">Pour une base dont les fichiers s’appellent PRODUIT.MYD, FOURNIS.MYD, ORDERS.MYD… (avec .frm et .MYI) : indiquez le <b>dossier</b> qui les contient. L’ERP lit produits, stock, fournisseurs, clients et l’historique des ventes ; les codes CIP des grossistes sont complétés automatiquement. Si vous avez une archive (.rar, .zip), décompressez-la d’abord.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[320px] flex-1 text-sm font-semibold">Dossier de la base<input className="w-full font-mono" placeholder={'C:\\Users\\…\\DB'} value={folder} onChange={(e) => setFolder(e.target.value)} /></label>
          <label className="text-sm font-semibold">Ventes depuis le<input type="date" className="block" value={since} onChange={(e) => setSince(e.target.value)} /></label>
          <button className="btn" disabled={busy || !folder.trim()} onClick={readFolder}>{busy ? 'Lecture en cours…' : 'Lire la base'}</button>
        </div>
        {notes.map((n) => <div key={n} className="rounded-lg bg-brand-soft p-2 text-sm font-bold text-brand">{n}</div>)}
      </div>
      <div className="card space-y-2">
        <label className="block rounded-xl border-2 border-dashed border-brand p-6 text-center font-bold text-brand hover:bg-brand-soft">
          {busy ? 'Analyse en cours…' : '📂 Choisir un ou plusieurs fichiers'}
          <input type="file" multiple accept={ACCEPT} className="hidden" disabled={busy} onChange={(e) => e.target.files?.length && upload(e.target.files)} />
        </label>
        <p className="text-xs text-ink-muted">Formats : Excel (xlsx, xls, ods), CSV / TXT, JSON, bases de données dBase (.dbf), SQLite (.db), Access (.mdb, .accdb), export SQL (.sql), PDF, photo ou scan (lecture OCR). Une base SQL Server / MySQL / Oracle : exportez-la en .sql, .csv ou Excel. Chaque table ou feuille est analysée séparément ; rien n’est enregistré avant votre validation.</p>
        <ErrorBox error={err} />
      </div>
      {meta && jobs.map((j) => <JobCard key={j.id} job={j} meta={meta} onChange={(nj) => { setJobs((js) => js.map((x) => (x.id === nj.id ? { ...x, ...nj } : x))); history.reload(); }} />)}
      <div className="card mt-4 overflow-auto"><h3 className="mb-2 font-extrabold">Historique des reprises</h3>
        <table className="w-full"><thead><tr><th>Date</th><th>Fichier</th><th>Tableau</th><th>Lignes</th><th>État</th><th /></tr></thead>
          <tbody>{(history.data ?? []).map((j) => <tr key={j.id}><td>{dateTimeFr(j.createdAt)}</td><td>{j.fileName}</td><td>{j.tableName}</td><td>{j.status === 'imported' ? `${j.rowsImported} / ${j.rowsTotal}` : j.rowsTotal}</td>
            <td>{j.status === 'imported' ? <Badge>importé</Badge> : <Badge tone="muted">à valider</Badge>}</td><td className="text-right"><button className="btn-alt !py-1" onClick={() => open(j.id)}>Ouvrir</button></td></tr>)}</tbody></table>
      </div>
    </>
  );
}

function JobCard({ job, meta, onChange }: { job: any; meta: { entities: Record<string, string>; fields: Record<string, Record<string, { label: string; required?: boolean }>> }; onChange: (j: any) => void }) {
  const [entity, setEntity] = useState<string>(job.entity);
  const [mapping, setMapping] = useState<Record<string, string>>(job.mapping ?? {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(job.report?.result ?? null);
  const { data: suppliers } = useLoad(() => api<{ id: string; name: string }[]>('/suppliers'));
  const fields = meta.fields[entity] ?? {};
  const r = job.report ?? {};
  const done = job.status === 'imported';

  const save = async (e: string, m: Record<string, string>) => {
    setBusy(true); setErr(null);
    try { const nj = await api<any>(`/migration/jobs/${job.id}`, { method: 'PUT', json: { entity: e, mapping: m } }); if (nj.mapping) setMapping(nj.mapping); onChange(nj); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true); setErr(null);
    try { const res = await api<any>(`/migration/jobs/${job.id}/import`, { method: 'POST' }); setResult(res); onChange({ id: job.id, status: 'imported' }); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="card mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-extrabold">{job.fileName} › {job.tableName}</h3>
        <Badge tone="muted">{job.format}</Badge><Badge tone="muted">{job.rowsTotal} lignes</Badge>
        {done && <Badge>importé</Badge>}
        <label className="ml-auto text-sm font-semibold">Contenu :{' '}
          <select value={entity} disabled={done || busy} onChange={(e) => { setEntity(e.target.value); setMapping({}); save(e.target.value, {}); }}>
            {Object.entries(meta.entities).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      {entity === 'products' && (
        <div className="rounded-lg border-l-4 border-sky-500 bg-sky-50 p-2 text-sm">
          <label className="font-semibold">Base produits d’un grossiste ?{' '}
            <select value={mapping.__supplier ?? ''} disabled={done || busy} onChange={(e) => { const m = { ...mapping }; if (e.target.value) m.__supplier = e.target.value; else delete m.__supplier; setMapping(m); save(entity, m); }}>
              <option value="">— non, catalogue de la pharmacie —</option>{suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {mapping.__supplier && <p className="mt-1 text-xs text-ink-muted">Le code de la base est enregistré comme <b>CIP de ce grossiste</b> ; chaque article garde son code interne. Les articles déjà connus (même CIP, code-barres ou nom) sont complétés, pas dupliqués, et leurs prix de vente sont conservés.</p>}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(fields).map(([f, d]) => (
          <label key={f} className="text-sm"><span className="font-semibold">{d.label}{d.required && <span className="text-red-700"> *</span>}</span>
            <select className="w-full" value={mapping[f] ?? ''} disabled={done || busy} onChange={(e) => { const m = { ...mapping, [f]: e.target.value }; if (!e.target.value) delete m[f]; setMapping(m); save(entity, m); }}>
              <option value="">— ignorer —</option>{(job.columns as string[]).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="rounded-lg bg-slate-50 p-2 text-sm">
        <b>Contrôle qualité :</b> {r.usable ?? '?'} ligne(s) exploitable(s) sur {job.rowsTotal}{r.duplicates ? ` · ${r.duplicates} doublon(s)` : ''}
        {(r.warnings ?? []).map((w: string) => <div key={w} className="text-amber-800">⚠ {w}</div>)}
        {(r.issues ?? []).slice(0, 8).map((i: any, k: number) => <div key={k} className="text-red-700">• {i.row ? `Ligne ${i.row} : ` : ''}{i.message}</div>)}
      </div>
      {job.preview?.length > 0 && (
        <div className="max-h-64 overflow-auto"><table className="w-full text-xs"><thead><tr>{(job.columns as string[]).map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{job.preview.map((row: any, k: number) => <tr key={k}>{(job.columns as string[]).map((c) => <td key={c}>{row[c]}</td>)}</tr>)}</tbody></table></div>
      )}
      <ErrorBox error={err} />
      {result && <div className="rounded-lg bg-brand-soft p-2 text-sm"><b>Import terminé :</b> {result.created} créé(s), {result.updated} mis à jour, {result.skipped} ignoré(s).
        {(result.notes ?? []).map((n: string) => <div key={n}>{n}</div>)}{(result.errors ?? []).slice(0, 10).map((e: any, k: number) => <div key={k} className="text-red-700">• {typeof e === 'string' ? e : `Ligne ${e.row} : ${e.message}`}</div>)}</div>}
      {!done && <button className="btn" disabled={busy} onClick={run}>{busy ? 'Traitement…' : `Importer dans l’ERP (${meta.entities[entity]})`}</button>}
    </div>
  );
}
