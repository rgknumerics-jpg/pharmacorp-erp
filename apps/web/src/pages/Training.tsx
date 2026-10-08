import { useState } from 'react';
import { api, can } from '../lib/api';
import { Badge, ErrorBox, Field, Modal, PageTitle, useLoad } from '../components/ui';
import { DayPlant } from '../components/PlantAdvice';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TOPICS: Record<string, string> = { peremption: 'Péremptions et délivrance', vente: 'Technique de vente', panier: 'Panier moyen et conseil associé', bonnes_pratiques: 'Bonnes pratiques officinales', accueil: 'Accueil et relation client', caisse: 'Caisse et rigueur' };

export default function Training() {
  const [tab, setTab] = useState<'today' | 'progress' | 'manage'>('today');
  return (
    <>
      <PageTitle title="Formation" sub="Quelques minutes par jour : conseils et quiz pour progresser au comptoir" />
      <div className="mb-3"><DayPlant /></div>
      <div className="mb-3 flex gap-2"><button className={tab === 'today' ? 'btn' : 'btn-alt'} onClick={() => setTab('today')}>Aujourd’hui</button><button className={tab === 'progress' ? 'btn' : 'btn-alt'} onClick={() => setTab('progress')}>Progression</button>{can('training.manage') && <button className={tab === 'manage' ? 'btn' : 'btn-alt'} onClick={() => setTab('manage')}>Contenus (pharmacien)</button>}</div>
      {tab === 'today' && <Today />}
      {tab === 'progress' && <Progress />}
      {tab === 'manage' && <Manage />}
    </>
  );
}

function Today() {
  const { data, error } = useLoad(() => api<any>('/training/today'));
  const [res, setRes] = useState<Record<string, any>>({});
  if (!data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-3">
      {data.pendingValidation > 0 && can('training.manage') && <div className="rounded-lg bg-orange-50 p-2 text-sm">{data.pendingValidation} contenu(s) attendent votre validation (onglet « Contenus »).</div>}
      {data.tip && <div className="card border-l-4 border-brand"><div className="text-xs font-bold uppercase text-brand">💡 Conseil du jour · {data.tip.topic}</div><h3 className="font-extrabold">{data.tip.title}</h3><p className="text-sm">{data.tip.body}</p></div>}
      {data.quiz.map((q: any) => (
        <div key={q.id} className="card">
          <div className="text-xs font-bold uppercase text-ink-muted">{q.topic}</div><h3 className="font-extrabold">{q.question}</h3>
          <div className="mt-2 grid gap-1">{q.options.map((o: string, i: number) => {
            const r = res[q.id];
            const cls = !r ? 'btn-alt justify-start' : i === r.answerIndex ? 'btn justify-start' : i === r.chosen ? 'btn-red justify-start' : 'btn-alt justify-start opacity-60';
            return <button key={i} className={cls} disabled={!!r} onClick={async () => { const a = await api<any>('/training/answers', { method: 'POST', json: { itemId: q.id, answer: i } }); setRes((x) => ({ ...x, [q.id]: { ...a, chosen: i } })); }}>{o}</button>;
          })}</div>
          {res[q.id] && <p className={`mt-2 text-sm font-semibold ${res[q.id].correct ? 'text-brand' : 'text-red-700'}`}>{res[q.id].correct ? '✓ Bonne réponse ! ' : '✗ '}{res[q.id].explanation}</p>}
        </div>
      ))}
      {data.quiz.length === 0 && <p className="card text-sm text-ink-muted">Pas de quiz disponible : les contenus doivent d’abord être validés par le pharmacien.</p>}
    </div>
  );
}

function Progress() {
  const { data } = useLoad(() => api<any>('/training/progress'));
  if (!data) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card"><h3 className="font-extrabold">Ma progression</h3><p className="text-3xl font-extrabold text-brand">{data.me.successRate} %</p><p className="text-sm text-ink-muted">{data.me.answered} réponse(s) · {data.me.activeDays30} jour(s) actif(s) sur 30</p>
        {data.byTopic.map((t: any) => <div key={t.topic} className="mt-1 flex justify-between text-sm"><span>{t.topic}</span><Badge tone={t.successRate >= 80 ? 'ok' : t.successRate >= 50 ? 'warn' : 'bad'}>{t.successRate} %</Badge></div>)}</div>
      {data.team && <div className="card"><h3 className="mb-2 font-extrabold">Équipe</h3>{data.team.map((t: any) => <div key={t.userId} className="flex justify-between border-b border-ink-line py-1 text-sm"><span>{t.name}</span><span>{t.successRate} % · {t.answered} rép. · {t.activeDays30} j</span></div>)}</div>}
    </div>
  );
}

function Manage() {
  const { data, reload } = useLoad(() => api<any[]>('/training/items'));
  const [edit, setEdit] = useState<any>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  async function status(ids: string[], s: string) { await api('/training/items/status', { method: 'POST', json: { ids, status: s } }); setSel(new Set()); reload(); }
  const drafts = data?.filter((i) => i.status === 'draft') ?? [];
  return (
    <>
      <div className="mb-3 rounded-lg bg-orange-50 p-2 text-sm">Rien n’est montré à l’équipe avant votre validation. Relisez chaque contenu : il doit être conforme aux pratiques de votre officine. Vous pouvez ajouter vos propres conseils associés et quiz.</div>
      <div className="mb-3 flex gap-2"><button className="btn" onClick={() => setEdit({ kind: 'quiz', topic: 'vente', title: '', body: '', options: ['', ''], answerIndex: 0, explanation: '' })}>+ Nouveau contenu</button>{sel.size > 0 && <button className="btn" onClick={() => status([...sel], 'validated')}>Valider la sélection ({sel.size})</button>}{drafts.length > 0 && <button className="btn-alt" onClick={() => setSel(new Set(drafts.map((d) => d.id)))}>Sélectionner les brouillons</button>}</div>
      <div className="space-y-2">{data?.map((i) => (
        <div key={i.id} className="card !p-3">
          <div className="flex items-start gap-2"><input type="checkbox" checked={sel.has(i.id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(i.id) : s.delete(i.id); setSel(s); }} />
            <div className="flex-1"><div className="text-xs font-bold uppercase text-ink-muted">{i.kind === 'quiz' ? 'Quiz' : 'Conseil'} · {TOPICS[i.topic]} {i.source === 'officine' && '· votre officine'}</div><b>{i.title}</b><p className="text-sm">{i.body}</p>{i.kind === 'quiz' && <ol className="ml-4 list-decimal text-sm">{i.options.map((o: string, k: number) => <li key={k} className={k === i.answerIndex ? 'font-bold text-brand' : ''}>{o}</li>)}</ol>}</div>
            <div className="flex flex-col items-end gap-1">{i.status === 'validated' ? <Badge>validé</Badge> : <Badge tone="warn">brouillon</Badge>}<button className="btn-alt !py-1" onClick={() => setEdit(i)}>Modifier</button>{i.status === 'draft' && <button className="btn !py-1" onClick={() => status([i.id], 'validated')}>Valider</button>}<button className="btn-alt !py-1" onClick={() => status([i.id], 'archived')}>Archiver</button></div>
          </div>
        </div>
      ))}</div>
      {edit && <Editor item={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function Editor({ item, onClose, onSaved }: { item: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...item, options: item.options ?? [] });
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={item.id ? 'Modifier le contenu' : 'Nouveau contenu'} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3"><Field label="Type"><select className="w-full" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="quiz">Quiz</option><option value="tip">Conseil</option></select></Field><Field label="Thème"><select className="w-full" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>{Object.entries(TOPICS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
        <Field label="Titre"><input className="w-full" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={f.kind === 'quiz' ? 'Question' : 'Conseil'}><textarea className="w-full" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        {f.kind === 'quiz' && <>
          {f.options.map((o: string, i: number) => <div key={i} className="flex items-center gap-2"><input type="radio" checked={f.answerIndex === i} onChange={() => setF({ ...f, answerIndex: i })} /><input className="flex-1" value={o} onChange={(e) => setF({ ...f, options: f.options.map((x: string, k: number) => (k === i ? e.target.value : x)) })} /></div>)}
          {f.options.length < 6 && <button className="btn-alt" onClick={() => setF({ ...f, options: [...f.options, ''] })}>+ Réponse</button>}
          <Field label="Explication (affichée après la réponse)"><textarea className="w-full" rows={2} value={f.explanation ?? ''} onChange={(e) => setF({ ...f, explanation: e.target.value })} /></Field>
        </>}
        <ErrorBox error={error} />
        <button className="btn" onClick={async () => { try { const body = { kind: f.kind, topic: f.topic, title: f.title, body: f.body, ...(f.kind === 'quiz' ? { options: f.options.filter((o: string) => o.trim()), answerIndex: f.answerIndex, explanation: f.explanation } : {}) }; await api(item.id ? `/training/items/${item.id}` : '/training/items', { method: item.id ? 'PUT' : 'POST', json: body }); onSaved(); } catch (e) { setError((e as Error).message); } }}>Enregistrer (en brouillon)</button>
      </div>
    </Modal>
  );
}