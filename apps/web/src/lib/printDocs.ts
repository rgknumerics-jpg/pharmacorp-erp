/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadBranding } from './branding';
import { printHtml } from './print';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const f = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const dt = (d: string | Date) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const monthFr = (p: string) => new Date(`${p}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

async function letterhead(): Promise<string> {
  try {
    const b = await loadBranding();
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">${b.branding.logo ? `<img src="${b.branding.logo}" style="height:42px;object-fit:contain">` : ''}<div><b style="font-size:15px">${esc(b.identity.name)}</b>${b.branding.slogan ? `<div style="font-size:10px;font-style:italic">${esc(b.branding.slogan)}</div>` : ''}<div style="font-size:10px">${[b.identity.address, b.identity.city].filter(Boolean).map(esc).join(', ')}${b.identity.phone ? ` · Tél. ${esc(b.identity.phone)}` : ''}</div></div></div>`;
  } catch { return ''; }
}

const COPIES = ['EXEMPLAIRE PHARMACIE', 'EXEMPLAIRE COMPTABILITÉ', 'EXEMPLAIRE ARCHIVE'];

/** Pièce de caisse (dépense payée en espèces) : 2 exemplaires, avec signature de la caissière et du bénéficiaire. */
export async function printCashVoucher(v: any, copies = 2) {
  const head = await letterhead();
  const names = ['EXEMPLAIRE CAISSE', 'EXEMPLAIRE COMPTABILITÉ', 'EXEMPLAIRE BÉNÉFICIAIRE'];
  const one = (k: number) => `<section class="p"><div class="tag">${names[k]}</div>${head}
    <h2>PIÈCE DE CAISSE N° ${esc(v.number)}</h2>
    <div class="row"><span>Date : <b>${dt(v.createdAt)}</b></span><span>${esc(v.session?.register ?? '')} · ${esc(v.session?.number ?? '')}</span></div>
    <div class="row"><span>Nature : <b>${esc(v.categoryLabel)}</b></span></div>
    <div class="row"><span>Motif : ${esc(v.label)}</span></div>
    ${v.beneficiary ? `<div class="row"><span>Bénéficiaire : <b>${esc(v.beneficiary)}</b></span></div>` : ''}
    <div class="amt"><div class="big">${f(v.amount)}</div><div class="words">${esc(v.amountInWords)}</div></div>
    <div class="sig"><div><b>Caissier(ère) : ${esc(v.agent ?? '')}</b>${v.agentSignature ? `<img src="${v.agentSignature}" style="height:60px;display:block;margin-top:4px">` : '<div class="box"></div>'}</div><div><b>Reçu par (nom et signature) :</b><div class="box"></div></div></div></section>`;
  printHtml(Array.from({ length: Math.min(3, Math.max(1, copies)) }, (_, k) => one(k)).join(''),
    '.p{page-break-after:always;padding:12mm;font-size:12px;position:relative;min-height:120mm}.p:last-child{page-break-after:auto}.tag{position:absolute;top:6mm;right:10mm;border:1px solid #000;padding:1mm 3mm;font-weight:800;font-size:10px}h2{text-align:center;margin:5mm 0 4mm;font-size:16px;border-top:2px solid #000;border-bottom:2px solid #000;padding:2mm 0}.row{display:flex;justify-content:space-between;margin:1.5mm 0}.amt{margin:5mm 0;border:2px solid #000;padding:3mm;text-align:center}.big{font-size:24px;font-weight:900}.words{font-style:italic;margin-top:1mm}.sig{display:flex;gap:10mm;margin-top:6mm}.sig>div{flex:1}.box{height:22mm;border-bottom:1px dashed #000;margin-top:2mm}', '@page{size:A5 portrait;margin:0}');
}

/** Bulletins de paie : un exemplaire pharmacie, un pour la comptabilité, un pour l'archive (1 à 3 selon le choix). */
export async function printPayslips(slips: any[], period: string, copies = 3) {
  const head = await letterhead();
  const row = (l: string, v: number | null, bold = false, sub = '') => `<tr style="${bold ? 'border-top:1px solid #444;font-weight:800' : ''}"><td>${esc(l)}${sub ? `<small> ${esc(sub)}</small>` : ''}</td><td style="text-align:right">${v === null ? '' : f(v)}</td></tr>`;
  const sec = (t: string) => `<tr><td colspan="2" style="padding-top:6px;font-size:10px;font-weight:800;color:#0a7a3f;text-transform:uppercase">● ${esc(t)}</td></tr>`;
  const one = (slip: any, k: number) => {
    const d = slip.detail, l = d.lines, e = slip.employee;
    return `<section class="p"><div class="tag">${COPIES[k]}</div>${head}
      <h2>BULLETIN DE PAYE — ${esc(monthFr(period))}</h2>
      <div class="grid"><div>Nom : <b>${esc(e.fullName)}</b></div><div>N° matricule : <b>${esc(e.matricule ?? '—')}</b></div><div>Situation de famille : ${esc(e.familySituation ?? '—')}</div><div>Catégorie : ${esc(e.category ?? '—')}</div><div>Emploi : ${esc(e.jobTitle ?? '—')}</div><div>N° CNSS : ${esc(e.cnssNumber ?? '—')}</div></div>
      <table>
        ${row('Salaire de base', l?.baseSalary ?? d.gross - slip.bonuses)}
        ${l && l.seniority > 0 ? row('Ancienneté', l.seniority, false, `(${f(l.baseSalary)} × ${l.seniorityRate} %)`) : ''}
        ${(l?.earnings ?? []).map((x: any) => row(x.label, x.amount)).join('')}
        ${slip.bonuses > 0 ? row('Primes', slip.bonuses) : ''}
        ${row('SALAIRE BRUT', d.gross, true)}
        ${sec('Retenues sociales')}
        ${row('CNSS 4 %', d.employee.cnss, false, `sur ${f(d.gross)}`)}
        ${d.employee.camu > 0 ? row('CAMU 2,27 %', d.employee.camu) : ''}
        ${d.employee.tol > 0 ? row('TOL', d.employee.tol) : ''}
        ${l ? row('Salaire après retenues sociales', l.afterSocial, true) : ''}
        ${row('Précompte IRPP', d.employee.its, false, l ? `(base ${f(l.taxBaseMonthly)}, ${d.bases.parts} part(s))` : '')}
        ${row('TOTAL', d.net, true)}
        ${(d.allowances?.length ?? 0) > 0 ? sec('À ajouter') + d.allowances.map((a: any) => row(a.label, a.amount)).join('') + row('Montant des sommes dues', d.dueTotal ?? d.net, true) : ''}
        ${(d.deductions?.length ?? 0) > 0 ? sec('À retenir') + d.deductions.map((a: any) => row(a.label, a.amount)).join('') + row('Montant des déductions effectuées', d.deductionsTotal ?? 0, true) : ''}
        <tr style="border-top:2px solid #000;border-bottom:2px solid #000;font-size:15px;font-weight:900"><td style="padding:4px 0">NET À PAYER ►</td><td style="text-align:right">${f(d.netToPay ?? d.net)}</td></tr>
      </table>
      <div class="sig"><div>Signature de l’employé<div class="box"></div></div><div style="text-align:right">Signature de l’employeur<div class="box"></div></div></div></section>`;
  };
  const n = Math.min(3, Math.max(1, copies));
  // un salarié après l'autre : ses exemplaires se suivent
  printHtml(slips.flatMap((s) => Array.from({ length: n }, (_, k) => one(s, k))).join(''),
    '.p{page-break-after:always;padding:12mm;font-size:11.5px;position:relative}.p:last-child{page-break-after:auto}.tag{position:absolute;top:6mm;right:10mm;border:1px solid #000;padding:1mm 3mm;font-weight:800;font-size:10px}h2{text-align:center;margin:4mm 0;font-size:15px;border-top:2px solid #000;border-bottom:2px solid #000;padding:2mm 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:1mm 6mm;font-size:11px;margin-bottom:3mm}table{width:100%;border-collapse:collapse}td{padding:1.2mm 0}small{color:#555}.sig{display:flex;justify-content:space-between;gap:10mm;margin-top:8mm;font-size:11px}.sig>div{flex:1}.box{height:20mm;border-bottom:1px dashed #000}', '@page{size:A5 portrait;margin:0}');
}

/** Procès-verbal de destruction de produits périmés, signé du pharmacien : 3 exemplaires (direction départementale de la santé, comptabilité, archive interne). */
export async function printDestructionPV(d: any) {
  const head = await letterhead();
  const names = ['EXEMPLAIRE — MINISTÈRE DE LA SANTÉ', 'EXEMPLAIRE — COMPTABILITÉ', 'EXEMPLAIRE — ARCHIVE INTERNE (PHARMACIE)'];
  const CAUSE_FR: Record<string, string> = { perime: 'Périmé', avarie: 'Avarié', casse: 'Cassé', autre: 'Autre' };
  const items: any[] = d.items ?? [];
  const date = new Date(d.createdAt);
  const longDate = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const causes = [...new Set(items.map((i) => CAUSE_FR[i.cause] ?? 'Périmé'))];
  const rows = items.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.name)}</td><td>${esc(i.lotNumber)}</td><td>${i.expiryDate ? new Date(i.expiryDate).toLocaleDateString('fr-FR') : '—'}</td><td>${CAUSE_FR[i.cause] ?? 'Périmé'}</td><td style="text-align:right">${i.quantity}</td><td style="text-align:right">${f(i.unitCost)}</td><td style="text-align:right">${f(i.value)}</td></tr>`).join('');
  const units = items.reduce((s, i) => s + i.quantity, 0);
  const one = (k: number) => `<section class="p"><div class="tag">${names[k]}</div>${head}
    <h2>PROCÈS-VERBAL DE DESTRUCTION N° ${esc(d.number)}</h2>
    <p>Le <b>${esc(longDate)}</b>, nous soussigné(e) <b>${esc(d.pharmacistName ?? '………………………')}</b>, pharmacien responsable, avons procédé${d.method ? ` (${esc(d.method)})` : ''} à la destruction des produits pharmaceutiques ci-dessous (motif : ${esc(causes.join(', '))}), retirés du stock de l’officine${d.witness ? `, en présence de <b>${esc(d.witness)}</b>` : ''}.</p>
    <table><thead><tr><th>N°</th><th>Désignation</th><th>Lot</th><th>Péremption</th><th>Motif</th><th>Qté</th><th>Prix d’achat</th><th>Valeur</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5"><b>TOTAL</b></td><td style="text-align:right"><b>${units}</b></td><td></td><td style="text-align:right"><b>${f(d.totalValue)}</b></td></tr></tfoot></table>
    ${d.notes ? `<p><i>Observations : ${esc(d.notes)}</i></p>` : ''}
    <p class="mini">Les produits ci-dessus ont été sortis du stock (mise au rebut) et la charge correspondante, ${f(d.totalValue)}, est constatée en comptabilité sur présentation du présent procès-verbal.</p>
    <div class="sig"><div><b>Le pharmacien responsable</b><br>${esc(d.pharmacistName ?? '')}${d.signature ? `<img src="${d.signature}" style="height:70px;display:block;margin-top:4px">` : '<div class="box"></div>'}<small>Cachet et signature</small></div>
      <div><b>Témoin / Autorité</b><div class="box"></div><small>Nom, qualité, signature</small></div></div></section>`;
  printHtml([0, 1, 2].map(one).join(''),
    '.p{page-break-after:always;padding:14mm;font-size:12px;position:relative}.p:last-child{page-break-after:auto}.tag{position:absolute;top:6mm;right:12mm;border:1px solid #000;padding:1mm 3mm;font-weight:800;font-size:10px}h2{text-align:center;margin:5mm 0;font-size:16px;border-top:2px solid #000;border-bottom:2px solid #000;padding:2mm 0}table{width:100%;border-collapse:collapse;margin:4mm 0}th,td{border:1px solid #444;padding:1.4mm 2mm;font-size:11px}th{background:#eee}.mini{font-size:11px}.sig{display:flex;gap:14mm;margin-top:8mm}.sig>div{flex:1}.box{height:26mm;border-bottom:1px dashed #000;margin-top:2mm}small{color:#555}', '@page{size:A4 portrait;margin:0}');
}
