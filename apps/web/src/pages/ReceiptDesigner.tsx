import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Field } from '../components/ui';
import type { Branding, BrandingData, ReceiptBlock, ReceiptKey } from '../lib/branding';
import { printReceipt, receiptDoc } from '../lib/print';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NAMES: Record<ReceiptKey, string> = {
  logo: 'Logo', name: 'Nom de la pharmacie', slogan: 'Slogan', address: 'Adresse', phone: 'Téléphone', email: 'E-mail', legal: 'Mentions légales (RCCM, NIU, compte…)', header: 'Message du haut', line1: 'Ligne de séparation',
  ticket: 'N° de ticket et date', cashier: 'Caissier(ère)', customer: 'Client', items: 'Articles vendus', total: 'Total', payments: 'Modes de paiement', footer: 'Message du bas', custom1: 'Ligne libre 1', custom2: 'Ligne libre 2', custom3: 'Ligne libre 3', thanks: 'Merci de votre confiance',
};
const LEGAL: [string, string][] = [['rccm', 'RCCM'], ['niu', 'NIU'], ['authorization', 'Autorisation d’exercice'], ['patente', 'N° de patente'], ['bank', 'Compte bancaire'], ['address', 'Adresse'], ['phone', 'Téléphone'], ['email', 'E-mail']];
const SAMPLE = {
  number: 'V-2026-00128', createdAt: new Date().toISOString(), total: 8500, paidAmount: 8500,
  items: [{ quantity: 2, unitPrice: 1500, lineTotal: 3000, product: { name: 'PARACETAMOL 500 MG BTE 16' } }, { quantity: 1, unitPrice: 5500, lineTotal: 5500, product: { name: 'VITAMINE C 1000 MG EFFERVESCENT' } }],
  payments: [{ method: 'cash', amount: 8500 }], customer: { name: 'Mme EXEMPLE Marie', phone: '+242 06 000 00 00' },
};

/** Ticket de caisse : aperçu à l'échelle réelle ; chaque élément se montre, se masque, se déplace (↑ ↓), s'aligne et se dimensionne. */
export function ReceiptDesigner({ d, onReceipt, write }: { d: BrandingData; onReceipt: (p: Partial<Branding['receipt']>) => void; write: boolean }) {
  const [settings, setSettings] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<any>('/company/settings').then(setSettings).catch((e) => setErr((e as Error).message)); }, []);
  const r = d.branding.receipt;
  const blocks = r.blocks;
  const upd = (key: ReceiptKey, patch: Partial<ReceiptBlock>) => onReceipt({ blocks: blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)) });
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= blocks.length) return; const n = [...blocks]; [n[i], n[j]] = [n[j], n[i]]; onReceipt({ blocks: n }); };
  const data: BrandingData = useMemo(() => ({ ...d, ticket: settings ? { fields: settings.ticketFields, bankName: settings.legal.bankName, bankAccount: settings.legal.bankAccount } : d.ticket }), [d, settings]);
  const doc = useMemo(() => receiptDoc(SAMPLE, data, 'Caissier exemple'), [data]);
  async function saveLegal() {
    setErr(null); setMsg(null);
    try { setSettings(await api('/company/settings', { method: 'PUT', json: { ticketFields: settings.ticketFields, legal: settings.legal } })); setMsg('Mentions légales enregistrées ✓ (pensez aussi à enregistrer les modèles en bas de page).'); } catch (e) { setErr((e as Error).message); }
  }
  const widthPx = Math.round((r.widthMm === 210 ? 148 : r.widthMm) * 3.78);
  return (
    <div className="space-y-3">
      <h4 className="pt-2 font-extrabold">Ticket de caisse</h4>
      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <div>
          <div className="mb-1 text-xs font-bold uppercase text-ink-muted">Aperçu à l’échelle ({r.widthMm === 210 ? 'A5' : `${r.widthMm} mm`})</div>
          <div className="overflow-auto rounded-xl bg-slate-200 p-3"><div className="mx-auto bg-white text-black shadow-lg" style={{ width: widthPx }}><style>{doc.css.replace(/\.t\{[^}]*\}/, `.t{padding:2mm;font-size:${r.widthMm === 210 ? 13 : 11}px;font-family:Arial,sans-serif}`)}</style><div dangerouslySetInnerHTML={{ __html: doc.html }} /></div></div>
          <div className="mt-2 flex flex-wrap gap-2">
            <select disabled={!write} value={r.widthMm} onChange={(e) => onReceipt({ widthMm: Number(e.target.value) as 58 | 80 | 210 })}><option value={58}>58 mm (petit rouleau)</option><option value={80}>80 mm (rouleau standard)</option><option value={210}>A5 (feuille)</option></select>
            <button className="btn-alt" onClick={() => printReceipt(SAMPLE, data, 'Caissier exemple')}>🖨 Ticket d’essai</button>
            {write && <button className="btn-alt" onClick={() => onReceipt({ blocks: 'reset' as unknown as ReceiptBlock[] })}>↺ Disposition par défaut</button>}
          </div>
        </div>
        <div className="space-y-2">
          <div className="max-h-[420px] space-y-1 overflow-auto rounded-xl bg-slate-50 p-2">
            {blocks.map((b, i) => (
              <div key={b.key} className={`rounded-lg bg-white p-2 text-sm ring-1 ${b.show ? 'ring-slate-200' : 'opacity-60 ring-slate-100'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex min-w-[210px] flex-1 items-center gap-2 font-bold"><input type="checkbox" disabled={!write} checked={b.show} onChange={(e) => upd(b.key, { show: e.target.checked })} />{NAMES[b.key]}</label>
                  <button type="button" disabled={!write || i === 0} className="btn-alt !px-2 !py-0.5" title="Monter" onClick={() => move(i, -1)}>↑</button>
                  <button type="button" disabled={!write || i === blocks.length - 1} className="btn-alt !px-2 !py-0.5" title="Descendre" onClick={() => move(i, 1)}>↓</button>
                  {b.key !== 'line1' && <select disabled={!write} value={b.align} onChange={(e) => upd(b.key, { align: e.target.value as ReceiptBlock['align'] })}><option value="left">Gauche</option><option value="center">Centré</option><option value="right">Droite</option></select>}
                  {b.key !== 'line1' && <label className="flex items-center gap-1 text-xs">{b.key === 'logo' ? 'Largeur %' : 'Taille'}<input type="number" disabled={!write} className="w-16" min={b.key === 'logo' ? 30 : 6} max={b.key === 'logo' ? 200 : 30} value={b.size} onChange={(e) => upd(b.key, { size: Number(e.target.value) || b.size })} /></label>}
                  {b.key !== 'logo' && b.key !== 'line1' && <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={!write} checked={b.bold} onChange={(e) => upd(b.key, { bold: e.target.checked })} />Gras</label>}
                </div>
                {b.key.startsWith('custom') && <input className="mt-1 w-full" maxLength={120} disabled={!write} placeholder="Texte libre (ex. Ouvert 7 j/7, WhatsApp 06 …)" value={b.text ?? ''} onChange={(e) => upd(b.key, { text: e.target.value })} />}
                {b.key === 'header' && <input className="mt-1 w-full" maxLength={200} disabled={!write} placeholder="Message en haut du ticket" value={r.header ?? ''} onChange={(e) => onReceipt({ header: e.target.value })} />}
                {b.key === 'footer' && <textarea rows={2} className="mt-1 w-full" maxLength={300} disabled={!write} placeholder="Message en bas du ticket (promotions, conditions d’échange…)" value={r.footer ?? ''} onChange={(e) => onReceipt({ footer: e.target.value })} />}
                {b.key === 'legal' && settings && (
                  <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
                    <div className="flex flex-wrap gap-2">{LEGAL.map(([k, l]) => <label key={k} className={`cursor-pointer rounded-full px-3 py-1 text-xs font-bold ${settings.ticketFields[k] ? 'bg-brand text-white' : 'bg-white ring-1 ring-slate-300'}`}><input type="checkbox" className="hidden" disabled={!write} checked={!!settings.ticketFields[k]} onChange={(e) => setSettings({ ...settings, ticketFields: { ...settings.ticketFields, [k]: e.target.checked } })} />{settings.ticketFields[k] ? '✓ ' : ''}{l}</label>)}</div>
                    <div className="grid gap-2 sm:grid-cols-2"><Field label="Banque"><input className="w-full" disabled={!write} value={settings.legal.bankName} onChange={(e) => setSettings({ ...settings, legal: { ...settings.legal, bankName: e.target.value } })} /></Field><Field label="N° de compte bancaire"><input className="w-full" disabled={!write} value={settings.legal.bankAccount} onChange={(e) => setSettings({ ...settings, legal: { ...settings.legal, bankAccount: e.target.value } })} /></Field></div>
                    <p className="text-xs text-ink-muted">RCCM, NIU, autorisation et patente viennent de la fiche « Identité » plus haut dans cette page : complétez-les pour qu’ils s’impriment.</p>
                    {write && <button className="btn-alt !py-1 text-xs" onClick={saveLegal}>Enregistrer les mentions légales</button>}
                    {msg && <span className="ml-2 text-xs font-bold text-brand">{msg}</span>}
                    {err && <span className="ml-2 text-xs font-bold text-red-700">{err}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
