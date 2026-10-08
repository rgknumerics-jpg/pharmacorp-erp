import { useCallback, useEffect, useRef, useState } from 'react';
import { api, can } from '../lib/api';
import { ErrorBox, PageTitle } from '../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Conv { key: string; name: string; role?: string; last: { body: string; at: string; kind: string } | null; unread: number }
interface Msg { id: string; body: string; kind: string; at: string; mine: boolean; sender: string }
const KIND: Record<string, { label: string; cls: string }> = { message: { label: 'Message', cls: '' }, info: { label: 'ℹ️ Information', cls: 'border-sky-500 bg-sky-50' }, alerte: { label: '🚨 Alerte', cls: 'border-red-600 bg-red-50' } };
const hm = (d: string) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Messagerie interne : discussion d'équipe, messages privés, informations et alertes du pharmacien. */
export default function Chat({ onRead }: { onRead?: () => void }) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [sel, setSel] = useState('all');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('message');
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const boss = can('users.write');

  const loadConvs = useCallback(() => api<Conv[]>('/chat/conversations').then(setConvs).catch((e) => setErr((e as Error).message)), []);
  const loadMsgs = useCallback(() => api<Msg[]>(`/chat/messages?with=${sel}`).then((m) => { setMsgs(m); onRead?.(); loadConvs(); }).catch((e) => setErr((e as Error).message)), [sel, onRead, loadConvs]);
  useEffect(() => { loadConvs(); }, [loadConvs]);
  useEffect(() => { loadMsgs(); const id = setInterval(loadMsgs, 8000); return () => clearInterval(id); }, [loadMsgs]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length, sel]);

  async function send() {
    const body = text.trim(); if (!body) return;
    setErr(null);
    try { await api('/chat/messages', { method: 'POST', json: { to: sel, body, kind } }); setText(''); setKind('message'); loadMsgs(); } catch (e) { setErr((e as Error).message); }
  }
  const cur = convs.find((c) => c.key === sel);
  return (
    <>
      <PageTitle title="Messagerie" sub="Discutez avec l’équipe, même quand vous ne vous croisez pas : messages, informations et alertes" />
      <div className="grid gap-3 md:grid-cols-[260px_1fr]">
        <div className="card max-h-[70vh] space-y-1 overflow-auto !p-2">
          {convs.map((c) => (
            <button key={c.key} onClick={() => setSel(c.key)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${sel === c.key ? 'bg-brand-soft text-brand' : 'hover:bg-slate-50'}`}>
              <span className="min-w-0"><b className="block truncate">{c.key === 'all' ? '👥 ' : '👤 '}{c.name}</b><span className="block truncate text-xs text-ink-muted">{c.last ? c.last.body : c.role ?? ''}</span></span>
              {c.unread > 0 && <span className="rounded-full bg-red-600 px-2 text-xs font-bold text-white">{c.unread}</span>}
            </button>
          ))}
        </div>
        <div className="card flex h-[70vh] flex-col !p-0">
          <div className="border-b border-ink-line px-4 py-2 font-extrabold">{cur?.name ?? 'Toute l’équipe'}{cur?.role && <span className="ml-2 text-xs font-normal text-ink-muted">{cur.role}</span>}</div>
          <div className="flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl border-l-4 px-3 py-2 text-sm shadow-sm ${KIND[m.kind]?.cls || 'border-transparent'} ${m.mine && m.kind === 'message' ? 'bg-emerald-100' : m.kind === 'message' ? 'bg-white' : ''}`}>
                  {m.kind !== 'message' && <div className="text-xs font-extrabold">{KIND[m.kind]?.label}</div>}
                  {!m.mine && <div className="text-xs font-bold text-brand">{m.sender}</div>}
                  <div className="whitespace-pre-wrap">{m.body}</div>
                  <div className="mt-0.5 text-right text-[10px] text-ink-muted">{hm(m.at)}</div>
                </div>
              </div>
            ))}
            {!msgs.length && <p className="p-6 text-center text-sm text-ink-muted">Aucun message. Écrivez le premier !</p>}
            <div ref={bottom} />
          </div>
          <div className="space-y-2 border-t border-ink-line p-3">
            <ErrorBox error={err} />
            <div className="flex flex-wrap items-end gap-2">
              {boss && <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="message">Message</option><option value="info">ℹ️ Information</option><option value="alerte">🚨 Alerte</option></select>}
              <textarea rows={2} className="min-w-[200px] flex-1" placeholder={sel === 'all' ? 'Message à toute l’équipe…' : 'Message privé…'} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="btn" disabled={!text.trim()} onClick={send}>Envoyer</button>
            </div>
            <p className="text-[11px] text-ink-muted">Entrée pour envoyer, Maj + Entrée pour aller à la ligne.{boss ? ' Les informations et alertes s’affichent en évidence chez tous les agents.' : ''}</p>
          </div>
        </div>
      </div>
    </>
  );
}
