import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PharmacyService } from '../pharmacy/pharmacy.service';
import { TaxService } from '../tax/tax.service';
import { CompanyService } from '../company/company.service';

export interface Insight {
  id: string;
  category: 'fiscal' | 'tresorerie' | 'stock' | 'clients' | 'marge' | 'conformite' | 'paie';
  severity: 'urgent' | 'important' | 'conseil';
  title: string;
  detail: string;
  action?: string;
  amount?: number;
  legalBasis?: string;
  link?: string;
}

export const ADVISOR_DISCLAIMER =
  'Recommandations générées automatiquement à partir de vos données, dans le strict respect des textes (optimisation légale uniquement). A valider avec votre expert-comptable avant toute decision fiscale.';

const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;

/**
 * Conseiller de gestion : transforme les donnees de l'ERP en recommandations concretes (tresorerie, fiscalite,
 * stock, credit clients, marges, conformite). Aucune donnee ne sort de l'etablissement : tout est calcule ici.
 */
@Injectable()
export class AdvisorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tax: TaxService,
    private readonly pharmacy: PharmacyService,
    private readonly company: CompanyService,
  ) {}

  async insights(tenantId: string): Promise<{ insights: Insight[]; disclaimer: string; generatedAt: string }> {
    const out: Insight[] = [];
    const [alerts, receivables, profile] = await Promise.all([this.tax.alerts(tenantId), this.pharmacy.receivables(tenantId), this.company.profile(tenantId)]);

    const data = await this.prisma.forTenant(tenantId, async (tx) => {
      const sumAcc = async (prefixes: string[]) => {
        let t = 0;
        for (const p of prefixes) { const r = await tx.journalLine.aggregate({ where: { accountCode: { startsWith: p } }, _sum: { debit: true, credit: true } }); t += (r._sum.debit ?? 0) - (r._sum.credit ?? 0); }
        return t;
      };
      const cash = await sumAcc(['571']);
      const treasury = cash + (await sumAcc(['52']));
      const [expired] = await tx.$queryRaw<{ value: number; qty: number }[]>`
        SELECT COALESCE(SUM(q.qty * p.purchase_price),0)::int AS value, COALESCE(SUM(q.qty),0)::int AS qty FROM (
          SELECT l.id, l.product_id, SUM(m.quantity) AS qty FROM lots l JOIN inventory_movements m ON m.lot_id = l.id
          WHERE l.expiry_date < CURRENT_DATE GROUP BY l.id, l.product_id HAVING SUM(m.quantity) > 0) q JOIN products p ON p.id = q.product_id`;
      const [expiring] = await tx.$queryRaw<{ value: number; lots: number }[]>`
        SELECT COALESCE(SUM(q.qty * p.purchase_price),0)::int AS value, COUNT(*)::int AS lots FROM (
          SELECT l.id, l.product_id, SUM(m.quantity) AS qty FROM lots l JOIN inventory_movements m ON m.lot_id = l.id
          WHERE l.expiry_date >= CURRENT_DATE AND l.expiry_date <= CURRENT_DATE + 90 GROUP BY l.id, l.product_id HAVING SUM(m.quantity) > 0) q JOIN products p ON p.id = q.product_id`;
      const [dormant] = await tx.$queryRaw<{ value: number; products: number }[]>`
        SELECT COALESCE(SUM(s.qty * p.purchase_price),0)::int AS value, COUNT(*)::int AS products FROM (
          SELECT m.product_id, SUM(m.quantity) AS qty FROM inventory_movements m GROUP BY m.product_id HAVING SUM(m.quantity) > 0) s
        JOIN products p ON p.id = s.product_id
        WHERE p.created_at < now() - interval '90 days'
          AND NOT EXISTS (SELECT 1 FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE si.product_id = p.id AND sa.created_at > now() - interval '90 days')`;
      const lowMargin = await tx.$queryRaw<{ name: string; sale_price: number; purchase_price: number }[]>`
        SELECT name, sale_price, purchase_price FROM products
        WHERE is_active AND NOT price_free AND purchase_price > 0 AND sale_price > 0 AND sale_price < purchase_price * 1.10
        ORDER BY (sale_price::float / purchase_price) ASC LIMIT 10`;
      const pendingMomo = await tx.payment.count({ where: { status: 'pending_confirmation', createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } });
      const employees = await tx.employee.count({ where: { isActive: true } });
      const lastMonth = new Date(); lastMonth.setUTCDate(1); lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      const lastPeriod = lastMonth.toISOString().slice(0, 7);
      const lastRun = await tx.payrollRun.findUnique({ where: { tenantId_period: { tenantId, period: lastPeriod } } });
      const insurersDue = await tx.insurer.aggregate({ _sum: { balance: true } });
      const vat = await (async () => {
        const start = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1)), end = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, 1));
        const c = await tx.journalLine.aggregate({ where: { accountCode: '4431', entry: { date: { gte: start, lt: end } } }, _sum: { credit: true, debit: true } });
        const d = await tx.journalLine.aggregate({ where: { accountCode: '4452', entry: { date: { gte: start, lt: end } } }, _sum: { credit: true, debit: true } });
        return { collected: (c._sum.credit ?? 0) - (c._sum.debit ?? 0), deductible: (d._sum.debit ?? 0) - (d._sum.credit ?? 0) };
      })();
      const year = new Date().getUTCFullYear();
      const ytd = await tx.journalLine.groupBy({ by: ['accountCode'], where: { entry: { date: { gte: new Date(Date.UTC(year, 0, 1)) } }, accountCode: { gte: '6' } }, _sum: { debit: true, credit: true } });
      const products = ytd.filter((r) => r.accountCode.startsWith('7')).reduce((s, r) => s + (r._sum.credit ?? 0) - (r._sum.debit ?? 0), 0);
      const charges = ytd.filter((r) => r.accountCode.startsWith('6')).reduce((s, r) => s + (r._sum.debit ?? 0) - (r._sum.credit ?? 0), 0);
      const sales = ytd.filter((r) => r.accountCode.startsWith('70')).reduce((s, r) => s + (r._sum.credit ?? 0) - (r._sum.debit ?? 0), 0);
      return { cash, treasury, expired, expiring, dormant, lowMargin, pendingMomo, employees, lastPeriod, lastRun, insurersDue: insurersDue._sum.balance ?? 0, vat, products, charges, sales };
    });

    // ----- Fiscal : echeances et tresorerie -----
    const overdue = alerts.filter((a) => a.level === 'overdue');
    if (overdue.length) {
      const amt = overdue.reduce((s, a) => s + (a.estimate?.amount ?? 0), 0);
      out.push({ id: 'tax-overdue', category: 'fiscal', severity: 'urgent', title: overdue.length === 1 ? `En retard : ${overdue[0].label} (${overdue[0].period})` : `${overdue.length} échéances fiscales ou sociales en retard`, detail: `${overdue.slice(0, 6).map((a) => `${a.label} ${a.period} (${-a.daysLeft} j)`).join(' ; ')}${overdue.length > 6 ? '…' : ''}. ${overdue[0].penaltyNote ?? ''}`, action: 'Déclarez et payez au plus vite, puis enregistrez chaque quittance dans le calendrier fiscal. Si c\'est déjà fait, marquez-les comme payées. Une régularisation spontanee limite les pénalités (CGI art. 374 ter, à verifier).', amount: amt || undefined, legalBasis: 'CGI art. 461 bis et 373', link: 'tax' });
    }
    const due30 = alerts.filter((a) => a.level !== 'overdue');
    const toPay = alerts.reduce((s, a) => s + (a.estimate?.amount ?? 0), 0);
    if (due30.length) {
      const short = toPay > data.treasury;
      out.push({
        id: 'tax-provision', category: 'tresorerie', severity: short ? 'urgent' : 'important',
        title: short ? `Trésorerie insuffisante pour les échéances à venir` : `${due30.length} échéance(s) fiscale(s) et sociale(s) dans le mois`,
        detail: `Montant estimé à payer d'ici 30 jours : ${fcfa(toPay)} ; trésorerie disponible (caisse + banque + Mobile Money) : ${fcfa(data.treasury)}.`,
        action: short ? `Provisionnez ${fcfa(toPay - data.treasury)} des maintenant (encaissements clients, report d'achats non urgents). Si la gêne est réelle, une demande de remise ou de modération peut etre adressee à la DGID avant l'échéance (CGI art. 422 et 446), sans garantie d'accord.` : 'Bloquez ces montants sur un compte dédié pour ne pas les depenser ; deposez vos déclarations dès la première semaine du mois.',
        amount: toPay, legalBasis: 'CGI art. 461 bis (15 du mois, 20 en août)', link: 'tax',
      });
    }
    if (data.vat.deductible > data.vat.collected && data.vat.deductible > 0) {
      out.push({ id: 'vat-crédit', category: 'fiscal', severity: 'conseil', title: 'Crédit de TVA le mois dernier', detail: `TVA déductible ${fcfa(data.vat.deductible)} supérieure à la TVA collectée ${fcfa(data.vat.collected)}.`, action: 'Reportez ce crédit sur la déclaration suivante (ou demandez-en le remboursement selon les conditions du CGI). Conservez toutes les factures d\'achat conformes : sans facture, pas de deduction.', amount: data.vat.deductible - data.vat.collected });
    }
    if (data.products > 0) {
      const months = new Date().getUTCMonth() + 1;
      const resultAnnual = ((data.products - data.charges) / months) * 12, productsAnnual = (data.products / months) * 12;
      const is = Math.max(0, resultAnnual * 0.28), imf = productsAnnual * 0.01;
      if (profile.profile.incomeTax === 'IS') {
        out.push({
          id: 'is-vs-imf', category: 'fiscal', severity: 'conseil',
          title: imf > is ? 'L\'impôt minimum (IMF) dépassera probablement l\'IS cette année' : 'Projection de l\'impôt sur les sociétés',
          detail: `Projection annuelle : résultat ${fcfa(resultAnnual)}, IS à 28 % ${fcfa(is)}, IMF (1 % des produits) ${fcfa(imf)}. L'IMF est dû même en cas de perte et s'impute sur l'IS.`,
          action: 'Pour réduire légalement la base : comptabilisez toutes les charges réelles justifiées (loyer, salaires déclarés, amortissement du matériel et de l\'agencement, pertes de stock constatées par procès-verbal). Conservez les pièces 10 ans (Acte uniforme OHADA art. 24).',
          legalBasis: 'Note ACPCE 2026 : IS 28 %, IMF 1 % des produits en 4 acomptes',
        });
      }
      if (data.sales * (12 / Math.max(1, new Date().getUTCMonth() + 1)) < 60_000_000) {
        out.push({ id: 'smt', category: 'conformite', severity: 'conseil', title: 'Éligible au Système minimal de trésorerie (SMT)', detail: 'Votre chiffre d\'affaires annuel projeté est inférieur à 60 millions FCFA : le SMT simplifie les etats financiers d\'une entité de négoce.', action: 'Voyez avec votre comptable si l\'option pour le SMT (ou le maintien du Système normal) vous convient.', legalBasis: 'Acte uniforme OHADA relatif au droit comptable, art. 13' });
      }
    }

    // ----- Clients a credit et tiers payant -----
    const overdueClients = receivables.filter((r) => r.overdue > 0);
    if (overdueClients.length) {
      const total = overdueClients.reduce((s, r) => s + r.overdue, 0);
      out.push({ id: 'receivables-overdue', category: 'clients', severity: total > data.treasury * 0.2 ? 'important' : 'conseil', title: `${overdueClients.length} client(s) en retard de paiement`, detail: `${fcfa(total)} de créances au-delà du délai accordé ; plus ancienne : ${Math.max(...overdueClients.map((r) => r.oldestDays))} jours. Principaux : ${overdueClients.slice(0, 3).map((r) => `${r.name} (${fcfa(r.overdue)})`).join(', ')}.`, action: 'Relancez par WhatsApp depuis la fiche client, suspendez le crédit des clients au-delà de 90 jours, et proposez un échéancier écrit.', amount: total, link: 'customers' });
    }
    const over90 = receivables.reduce((s, r) => s + r.buckets.over90, 0);
    if (over90 > 0) out.push({ id: 'receivables-90', category: 'fiscal', severity: 'conseil', title: 'Créances de plus de 90 jours', detail: `${fcfa(over90)} de créances anciennes.`, action: 'Si le recouvrement devient incertain, une provision pour créance douteuse peut etre constituée en comptabilite (justificatifs de relance à conserver) ; sa déductibilité fiscale suit les conditions du CGI : à faire valider par le comptable.', amount: over90 });
    if (data.insurersDue > 0) out.push({ id: 'insurers-due', category: 'clients', severity: 'conseil', title: 'Tiers payant à encaisser', detail: `Les organismes vous doivent ${fcfa(data.insurersDue)}.`, action: 'Envoyez les relevés par organisme (onglet Clients > Tiers payant) et relancez à l\'échéance convenue.', amount: data.insurersDue, link: 'customers' });

    // ----- Stock -----
    if (data.expired.value > 0) out.push({ id: 'stock-expired', category: 'stock', severity: 'important', title: 'Produits périmés encore en stock', detail: `${data.expired.qty} unité(s) périmée(s), valeur d'achat ${fcfa(data.expired.value)} : ils ne seront jamais vendus par la caisse.`, action: 'Retirez-les physiquement, enregistrez la mise au rebut (Stock > Lots), et faites constater la destruction par procès-verbal pour justifier la charge en comptabilite.', amount: data.expired.value, link: 'stock' });
    if (data.expiring.value > 0) out.push({ id: 'stock-expiring', category: 'stock', severity: 'conseil', title: 'Stock a écouler sous 90 jours', detail: `${data.expiring.lots} lot(s) expirent dans les 90 jours (valeur d'achat ${fcfa(data.expiring.value)}).`, action: 'Mettez-les en avant au comptoir, proposez un retour ou un échange au fournisseur, ajustez les prochaines commandes.', amount: data.expiring.value, link: 'stock' });
    if (data.dormant.value > 0) out.push({ id: 'stock-dormant', category: 'tresorerie', severity: 'conseil', title: 'Stock dormant', detail: `${data.dormant.products} produit(s) sans aucune vente depuis 90 jours immobilisent ${fcfa(data.dormant.value)} de trésorerie.`, action: 'Réduisez ou suspendez leur réapprovisionnement ; négociez un retour fournisseur.', amount: data.dormant.value, link: 'stock' });

    // ----- Marges -----
    if (data.lowMargin.length) out.push({ id: 'low-margin', category: 'marge', severity: 'important', title: 'Produits vendus avec une marge très faible', detail: data.lowMargin.map((p) => `${p.name} : achat ${fcfa(p.purchase_price)}, vente ${fcfa(p.sale_price)}`).join(' ; '), action: 'Vérifiez le prix public (réglementé pour les médicaments) et le prix d\'achat ; renégociez avec le grossiste si besoin.', link: 'products' });

    // ----- Paie, encaissements, conformite -----
    if (data.employees > 0 && (!data.lastRun || data.lastRun.status !== 'validated')) out.push({ id: 'payroll-missing', category: 'paie', severity: 'important', title: `Paie de ${data.lastPeriod} non validée`, detail: 'Sans paie validée, ITS, TUS, CNSS et CAMU ne peuvent pas etre déclarés correctement avant le 15.', action: 'Calculez et validez la paie du mois (onglet Paie).', link: 'payroll' });
    if (data.pendingMomo > 0) out.push({ id: 'momo-pending', category: 'tresorerie', severity: 'important', title: 'Paiements Mobile Money non confirmes depuis plus de 24 h', detail: `${data.pendingMomo} paiement(s) en attente.`, action: 'Vérifiez sur votre releve operateur et confirmez ou marquez en echec (Ventes > en attente).', link: 'sales' });
    if (data.cash > 2_000_000) out.push({ id: 'cash-high', category: 'tresorerie', severity: 'conseil', title: 'Beaucoup d\'espèces en caisse', detail: `Solde comptable de caisse : ${fcfa(data.cash)}.`, action: 'Déposez régulièrement en banque : sécurité, et traçabilité des recettes en cas de contrôle.' });
    if (profile.completeness.missingFields.length) out.push({ id: 'profile', category: 'conformite', severity: 'conseil', title: `Profil légal complété à ${profile.completeness.percent} %`, detail: `A compléter quand vous le souhaitez : ${profile.completeness.missingFields.join(', ')}.`, action: 'Ces informations apparaîtront sur vos factures normalisées et vos déclarations ; rien n\'est bloquant.', link: 'company' });

    const order = { urgent: 0, important: 1, conseil: 2 };
    return { insights: out.sort((a, b) => order[a.severity] - order[b.severity]), disclaimer: ADVISOR_DISCLAIMER, generatedAt: new Date().toISOString() };
  }
}
