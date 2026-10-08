import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { scopeOf, visibleProductIds } from '../common/vat-scope';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

type ColType = 'text' | 'int' | 'money' | 'pct' | 'date';
export interface Col { key: string; label: string; type: ColType }
export interface Report { columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown>; note?: string }
export interface Params { from: Date; to: Date; customerId?: string; min?: number; limit: number; order?: string; kind?: string }

/** Catalogue des statistiques de vente (inspiré des requêtes usuelles des logiciels d'officine). `cost` = exige le droit de voir les marges. */
export const STAT_CATALOG: { key: string; label: string; group: string; cost?: boolean; needs?: 'customer' | 'min'; help: string; orderable?: boolean; toOrder?: boolean }[] = [
  { key: 'ventes_produits', label: 'Produits vendus (quantités)', group: 'Réapprovisionnement', help: 'Quantités vendues par produit sur la période, avec le stock actuel : à convertir en bon de commande.', toOrder: true },
  { key: 'stock_nul', label: 'Produits à stock nul', group: 'Réapprovisionnement', help: 'Produits actifs dont le stock du comptoir est nul ou négatif, avec leurs ventes récentes.', toOrder: true },
  { key: 'synthese_operateur', label: 'Synthèse par opérateur (caissier)', group: 'Chiffre d’affaires', help: 'Tickets, chiffre d’affaires, panier moyen et remises par opérateur qui a encaissé.' },
  { key: 'synthese_vendeur', label: 'Synthèse par vendeur', group: 'Chiffre d’affaires', help: 'Tickets et chiffre d’affaires par vendeur qui a saisi la vente.' },
  { key: 'ventilation_paiement', label: 'Total CA : espèces, MoMo, carte, crédit, assurance', group: 'Chiffre d’affaires', help: 'Ventilation journalière du chiffre d’affaires par mode de règlement.' },
  { key: 'ca_mensuel', label: 'Tableau récapitulatif du CA par mois et par année', group: 'Chiffre d’affaires', help: 'Chiffre d’affaires TTC de chaque mois, année par année (3 dernières années).' },
  { key: 'ca_categorie', label: 'CA et marge par catégorie', group: 'Chiffre d’affaires', cost: true, help: 'Chiffre d’affaires HT, quantités et marge par famille thérapeutique.' },
  { key: 'ca_fournisseur', label: 'CA et marge par fournisseur', group: 'Chiffre d’affaires', cost: true, help: 'Ventes rattachées au dernier fournisseur ayant livré le produit.' },
  { key: 'classification_produits', label: 'Classification des produits (ABC) par CA, marge, quantité', group: 'Produits', orderable: true, help: 'Classe A = 80 % du cumul, B = jusqu’à 95 %, C = le reste.' },
  { key: 'marges_produits', label: 'Statistiques de marges par produit', group: 'Produits', cost: true, needs: 'min', help: 'Marge par produit ; saisissez un taux minimum (ex. 29) pour ne garder que les marges supérieures.' },
  { key: 'ventilation_mois_produits', label: 'Ventilation des produits par mois', group: 'Produits', help: 'Quantités vendues, produit par produit, sur les 12 derniers mois.' },
  { key: 'prix_zero', label: 'Produits à prix de vente nul', group: 'Contrôles', help: 'Produits actifs dont le prix de vente est à 0 (hors prix libre).' },
  { key: 'tva_mensuelle', label: 'Déclaration TVA mensuelle (par taux et par opérateur)', group: 'Fiscalité', help: 'Base hors taxe et TVA par mois, par taux et par opérateur.' },
  { key: 'client', label: 'Statistiques des ventes d’un client', group: 'Clients', needs: 'customer', help: 'Tous les achats d’un client sur la période.' },
  { key: 'edition_detaillee', label: 'Éditions détaillées des ventes', group: 'Clients', help: 'Chaque ligne vendue : date, ticket, produit, quantité, prix, remise, total, opérateur.' },
];

const n = (v: unknown) => (typeof v === 'bigint' ? Number(v) : v === null || v === undefined ? 0 : Number(v));
const TZ = 'Africa/Brazzaville';
const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

@Injectable()
export class SalesStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Vue d'ensemble graphique : indicateurs (et évolution), courbe journalière, affluence par jour et heure, modes de paiement, meilleurs produits, familles, types de ventes. */
  async overview(user: AuthenticatedUser, from: string, to: string) {
    const f = new Date(`${from}T00:00:00Z`), t = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000);
    const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86_400_000));
    const pf = new Date(f.getTime() - days * 86_400_000);
    const cost = user.permissions.includes('cost.read');
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const tot = async (a: Date, b: Date) => (await tx.$queryRaw<{ ca: number; tickets: number; qty: number; margin: number }[]>`
        SELECT COALESCE(SUM(x.total),0)::float AS ca, COUNT(*)::int AS tickets, COALESCE(SUM(x.qty),0)::int AS qty, COALESCE(SUM(x.margin),0)::float AS margin FROM (
          SELECT s.id, s.total, (SELECT COALESCE(SUM(si.quantity),0) FROM sale_items si WHERE si.sale_id = s.id) AS qty,
                 (SELECT COALESCE(SUM(si.line_total - si.unit_cost * si.quantity),0) FROM sale_items si WHERE si.sale_id = s.id) AS margin
          FROM sales s WHERE s.status <> 'void' AND s.created_at >= ${a} AND s.created_at < ${b}) x`)[0];
      const [cur, prev] = [await tot(f, t), await tot(pf, f)];
      const daily = await tx.$queryRaw<{ d: string; ca: number; tickets: number }[]>`
        SELECT to_char(s.created_at AT TIME ZONE 'Africa/Brazzaville', 'YYYY-MM-DD') AS d, SUM(s.total)::float AS ca, COUNT(*)::int AS tickets
        FROM sales s WHERE s.status <> 'void' AND s.created_at >= ${f} AND s.created_at < ${t} GROUP BY 1 ORDER BY 1`;
      const heat = await tx.$queryRaw<{ dow: number; h: number; n: number }[]>`
        SELECT EXTRACT(DOW FROM s.created_at AT TIME ZONE 'Africa/Brazzaville')::int AS dow, EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'Africa/Brazzaville')::int AS h, COUNT(*)::int AS n
        FROM sales s WHERE s.status <> 'void' AND s.created_at >= ${f} AND s.created_at < ${t} GROUP BY 1, 2`;
      const pay = await tx.$queryRaw<{ method: string; amount: number }[]>`
        SELECT p.method::text AS method, SUM(p.amount)::float AS amount FROM payments p JOIN sales s ON s.id = p.sale_id
        WHERE s.status <> 'void' AND p.status = 'confirmed' AND s.created_at >= ${f} AND s.created_at < ${t} GROUP BY 1 ORDER BY 2 DESC`;
      const top = await tx.$queryRaw<{ name: string; qty: number; ca: number; margin: number }[]>`
        SELECT p.name, SUM(si.quantity)::int AS qty, SUM(si.line_total)::float AS ca, SUM(si.line_total - si.unit_cost * si.quantity)::float AS margin
        FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
        WHERE s.status <> 'void' AND s.created_at >= ${f} AND s.created_at < ${t} GROUP BY p.id ORDER BY ca DESC LIMIT 10`;
      const cats = await tx.$queryRaw<{ name: string; ca: number }[]>`
        SELECT COALESCE(c.name, 'Sans famille') AS name, SUM(si.line_total)::float AS ca
        FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.status <> 'void' AND s.created_at >= ${f} AND s.created_at < ${t} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`;
      const kinds = await tx.$queryRaw<{ kind: string; ca: number; tickets: number }[]>`
        SELECT s.kind, SUM(s.total)::float AS ca, COUNT(*)::int AS tickets FROM sales s WHERE s.status <> 'void' AND s.created_at >= ${f} AND s.created_at < ${t} GROUP BY 1 ORDER BY 2 DESC`;
      const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
      return {
        from, to, days,
        kpis: { ca: cur.ca, caPrev: prev.ca, caEvolution: pct(cur.ca, prev.ca), tickets: cur.tickets, ticketsEvolution: pct(cur.tickets, prev.tickets), basket: cur.tickets ? Math.round(cur.ca / cur.tickets) : 0, basketPrev: prev.tickets ? Math.round(prev.ca / prev.tickets) : 0, units: cur.qty, margin: cost ? Math.round(cur.margin) : null, marginRate: cost && cur.ca ? Math.round((cur.margin / cur.ca) * 1000) / 10 : null, perDay: Math.round(cur.ca / days) },
        daily, heat, payments: pay, top: top.map((x) => ({ ...x, margin: cost ? x.margin : null })), categories: cats, kinds,
      };
    });
  }

  catalog(user: AuthenticatedUser) {
    const cost = user.permissions.includes('cost.read');
    return STAT_CATALOG.filter((r) => !r.cost || cost);
  }

  async run(user: AuthenticatedUser, key: string, p: Params): Promise<Report> {
    const def = STAT_CATALOG.find((r) => r.key === key);
    if (!def) throw new BadRequestException('Statistique inconnue');
    if (def.cost && !user.permissions.includes('cost.read')) throw new BadRequestException('Cette statistique contient les marges : droit « voir les prix d’achat et les marges » requis.');
    if (def.needs === 'customer' && !p.customerId) throw new BadRequestException('Choisissez un client.');
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const ids = await visibleProductIds(tx, await scopeOf(tx, user.roleId));
      const scope = ids ? Prisma.sql`AND si.product_id = ANY(${ids}::uuid[])` : Prisma.empty;
      const kind = p.kind && ['V', 'A', 'B'].includes(p.kind) ? Prisma.sql`AND s.kind = ${p.kind}` : Prisma.empty;
      const period = Prisma.sql`s.status = 'completed' AND s.created_at >= ${p.from} AND s.created_at < ${p.to} ${kind}`;
      const ht = Prisma.sql`ROUND(si.line_total * 100.0 / (100 + si.vat_rate))`;
      const lim = Prisma.sql`LIMIT ${Math.min(Math.max(p.limit, 1), 2000)}`;
      const money: ColType = 'money', int: ColType = 'int', pct: ColType = 'pct', text: ColType = 'text';

      switch (key) {
        case 'ventes_produits': {
          const r = await tx.$queryRaw<any[]>`
            SELECT p.id AS product_id, p.name, p.sku, p.dci, SUM(si.quantity) AS qte, SUM(si.line_total) AS ca,
              COALESCE((SELECT SUM(m.quantity) FROM inventory_movements m WHERE m.product_id = p.id AND m.depot_id IS NULL), 0) AS stock
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
            WHERE ${period} ${scope} GROUP BY p.id ORDER BY qte DESC ${lim}`;
          return { columns: [{ key: 'name', label: 'Produit', type: text }, { key: 'dci', label: 'DCI', type: text }, { key: 'qte', label: 'Qté vendue', type: int }, { key: 'stock', label: 'Stock actuel', type: int }, { key: 'ca', label: 'CA TTC', type: money }], rows: r.map((x) => ({ productId: x.product_id, name: x.name, dci: x.dci, qte: n(x.qte), stock: n(x.stock), ca: n(x.ca) })), totals: { qte: r.reduce((s, x) => s + n(x.qte), 0), ca: r.reduce((s, x) => s + n(x.ca), 0) } };
        }
        case 'stock_nul': {
          const r = await tx.$queryRaw<any[]>`
            SELECT p.id AS product_id, p.name, p.dci,
              COALESCE((SELECT SUM(m.quantity) FROM inventory_movements m WHERE m.product_id = p.id AND m.depot_id IS NULL), 0) AS stock,
              COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'completed' AND s.created_at >= now() - interval '90 days'), 0) AS ventes90
            FROM products p WHERE p.is_active = true ${ids ? Prisma.sql`AND p.id = ANY(${ids}::uuid[])` : Prisma.empty}
            ORDER BY ventes90 DESC, p.name`;
          const rows = r.filter((x) => n(x.stock) <= 0).slice(0, 2000).map((x) => ({ productId: x.product_id, name: x.name, dci: x.dci, stock: n(x.stock), qte: Math.max(1, Math.ceil(n(x.ventes90) / 3)), ventes90: n(x.ventes90) }));
          return { columns: [{ key: 'name', label: 'Produit', type: text }, { key: 'dci', label: 'DCI', type: text }, { key: 'stock', label: 'Stock', type: int }, { key: 'ventes90', label: 'Vendus (90 j)', type: int }, { key: 'qte', label: 'Qté suggérée (1 mois)', type: int }], rows, note: 'La quantité suggérée correspond à un mois de ventes (90 jours / 3).' };
        }
        case 'synthese_operateur': {
          const r = await tx.$queryRaw<any[]>`
            SELECT COALESCE(u.full_name, '—') AS operateur, COUNT(*) AS tickets, SUM(s.total) AS ca, ROUND(AVG(s.total)) AS panier, SUM(s.discount) AS remises
            FROM sales s LEFT JOIN users u ON u.id = s.cashier_id WHERE ${Prisma.sql`s.status = 'completed' AND s.created_at >= ${p.from} AND s.created_at < ${p.to} ${kind}`} GROUP BY 1 ORDER BY ca DESC`;
          return { columns: [{ key: 'operateur', label: 'Opérateur', type: text }, { key: 'tickets', label: 'Tickets', type: int }, { key: 'ca', label: 'CA TTC', type: money }, { key: 'panier', label: 'Panier moyen', type: money }, { key: 'remises', label: 'Remises', type: money }], rows: r.map((x) => ({ operateur: x.operateur, tickets: n(x.tickets), ca: n(x.ca), panier: n(x.panier), remises: n(x.remises) })), totals: { tickets: r.reduce((s, x) => s + n(x.tickets), 0), ca: r.reduce((s, x) => s + n(x.ca), 0) } };
        }
        case 'synthese_vendeur': {
          const r = await tx.$queryRaw<any[]>`
            SELECT COALESCE(u.full_name, 'Vente directe (sans vendeur)') AS vendeur, COUNT(*) AS tickets, SUM(s.total) AS ca, ROUND(AVG(s.total)) AS panier
            FROM sales s LEFT JOIN users u ON u.id = s.seller_id WHERE ${Prisma.sql`s.status = 'completed' AND s.created_at >= ${p.from} AND s.created_at < ${p.to} ${kind}`} GROUP BY 1 ORDER BY ca DESC`;
          return { columns: [{ key: 'vendeur', label: 'Vendeur', type: text }, { key: 'tickets', label: 'Tickets', type: int }, { key: 'ca', label: 'CA TTC', type: money }, { key: 'panier', label: 'Panier moyen', type: money }], rows: r.map((x) => ({ vendeur: x.vendeur, tickets: n(x.tickets), ca: n(x.ca), panier: n(x.panier) })), totals: { tickets: r.reduce((s, x) => s + n(x.tickets), 0), ca: r.reduce((s, x) => s + n(x.ca), 0) } };
        }
        case 'ventilation_paiement': {
          const r = await tx.$queryRaw<any[]>`
            SELECT (s.created_at AT TIME ZONE ${TZ})::date AS jour, COUNT(DISTINCT s.id) AS tickets,
              SUM(CASE WHEN pa.method = 'cash' THEN pa.amount ELSE 0 END) AS especes,
              SUM(CASE WHEN pa.method = 'mtn_momo' THEN pa.amount ELSE 0 END) AS mtn,
              SUM(CASE WHEN pa.method = 'airtel_money' THEN pa.amount ELSE 0 END) AS airtel,
              SUM(CASE WHEN pa.method = 'card' THEN pa.amount ELSE 0 END) AS carte,
              SUM(CASE WHEN pa.method = 'credit' THEN pa.amount ELSE 0 END) AS credit,
              SUM(CASE WHEN pa.method = 'insurer' THEN pa.amount ELSE 0 END) AS assurance,
              SUM(CASE WHEN pa.method NOT IN ('cash','mtn_momo','airtel_money','card','cheque','transfer','credit','insurer') THEN pa.amount ELSE 0 END) AS autres,
              SUM(pa.amount) AS total
            FROM payments pa JOIN sales s ON s.id = pa.sale_id
            WHERE pa.status = 'confirmed' AND s.status <> 'void' AND s.created_at >= ${p.from} AND s.created_at < ${p.to} ${kind}
            GROUP BY 1 ORDER BY 1`;
          const rows = r.map((x) => ({ jour: String(x.jour instanceof Date ? x.jour.toISOString().slice(0, 10) : x.jour).slice(0, 10), tickets: n(x.tickets), especes: n(x.especes), mtn: n(x.mtn), airtel: n(x.airtel), carte: n(x.carte), credit: n(x.credit), assurance: n(x.assurance), autres: n(x.autres), total: n(x.total) }));
          const t: Record<string, number> = {};
          for (const k of ['tickets', 'especes', 'mtn', 'airtel', 'carte', 'credit', 'assurance', 'autres', 'total']) t[k] = rows.reduce((s, x) => s + (x as any)[k], 0);
          return { columns: [{ key: 'jour', label: 'Jour', type: 'date' }, { key: 'tickets', label: 'Tickets', type: int }, { key: 'especes', label: 'Espèces', type: money }, { key: 'mtn', label: 'MTN MoMo', type: money }, { key: 'airtel', label: 'Airtel Money', type: money }, { key: 'carte', label: 'Carte', type: money }, { key: 'credit', label: 'Crédit (bons)', type: money }, { key: 'assurance', label: 'Assurance', type: money }, { key: 'autres', label: 'Autres', type: money }, { key: 'total', label: 'Total', type: money }], rows, totals: t };
        }
        case 'ca_mensuel': {
          const r = await tx.$queryRaw<any[]>`
            SELECT EXTRACT(YEAR FROM s.created_at AT TIME ZONE ${TZ})::int AS annee, EXTRACT(MONTH FROM s.created_at AT TIME ZONE ${TZ})::int AS mois, SUM(s.total) AS ca
            FROM sales s WHERE s.status = 'completed' AND s.created_at >= date_trunc('year', now()) - interval '2 years' GROUP BY 1, 2 ORDER BY 1, 2`;
          const years = [...new Set(r.map((x) => n(x.annee)))];
          const rows = years.map((y) => { const o: Record<string, unknown> = { annee: String(y) }; let tot = 0; MONTHS.forEach((m, i) => { const v = n(r.find((x) => n(x.annee) === y && n(x.mois) === i + 1)?.ca); o[`m${i + 1}`] = v; tot += v; }); o.total = tot; return o; });
          return { columns: [{ key: 'annee', label: 'Année', type: text }, ...MONTHS.map((m, i) => ({ key: `m${i + 1}`, label: m, type: money as ColType })), { key: 'total', label: 'Total', type: money }], rows };
        }
        case 'ca_categorie': {
          const r = await tx.$queryRaw<any[]>`
            SELECT COALESCE(c.name, 'Sans catégorie') AS categorie, SUM(si.quantity) AS qte, SUM(si.line_total) AS ca_ttc, SUM(${ht}) AS ca_ht, SUM(${ht} - si.unit_cost * si.quantity) AS marge
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
            WHERE ${period} ${scope} GROUP BY 1 ORDER BY ca_ht DESC`;
          const rows = r.map((x) => ({ categorie: x.categorie, qte: n(x.qte), ca_ttc: n(x.ca_ttc), ca_ht: n(x.ca_ht), marge: n(x.marge), taux: n(x.ca_ht) ? Math.round((n(x.marge) / n(x.ca_ht)) * 1000) / 10 : 0 }));
          return { columns: [{ key: 'categorie', label: 'Catégorie', type: text }, { key: 'qte', label: 'Quantité', type: int }, { key: 'ca_ttc', label: 'CA TTC', type: money }, { key: 'ca_ht', label: 'CA HT', type: money }, { key: 'marge', label: 'Marge HT', type: money }, { key: 'taux', label: 'Taux de marge', type: pct }], rows, totals: { qte: rows.reduce((s, x) => s + x.qte, 0), ca_ttc: rows.reduce((s, x) => s + x.ca_ttc, 0), ca_ht: rows.reduce((s, x) => s + x.ca_ht, 0), marge: rows.reduce((s, x) => s + x.marge, 0) } };
        }
        case 'ca_fournisseur': {
          const r = await tx.$queryRaw<any[]>`
            SELECT COALESCE(su.name, 'Fournisseur non identifié') AS fournisseur, SUM(si.quantity) AS qte, SUM(${ht}) AS ca_ht, SUM(${ht} - si.unit_cost * si.quantity) AS marge
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
            LEFT JOIN LATERAL (SELECT gr.supplier_id FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id = gi.receipt_id WHERE gi.product_id = si.product_id AND gr.supplier_id IS NOT NULL ORDER BY gr.created_at DESC LIMIT 1) ls ON true
            LEFT JOIN suppliers su ON su.id = ls.supplier_id
            WHERE ${period} ${scope} GROUP BY 1 ORDER BY ca_ht DESC`;
          const rows = r.map((x) => ({ fournisseur: x.fournisseur, qte: n(x.qte), ca_ht: n(x.ca_ht), marge: n(x.marge), taux: n(x.ca_ht) ? Math.round((n(x.marge) / n(x.ca_ht)) * 1000) / 10 : 0 }));
          return { columns: [{ key: 'fournisseur', label: 'Fournisseur', type: text }, { key: 'qte', label: 'Quantité', type: int }, { key: 'ca_ht', label: 'CA HT', type: money }, { key: 'marge', label: 'Marge HT', type: money }, { key: 'taux', label: 'Taux de marge', type: pct }], rows, totals: { qte: rows.reduce((s, x) => s + x.qte, 0), ca_ht: rows.reduce((s, x) => s + x.ca_ht, 0), marge: rows.reduce((s, x) => s + x.marge, 0) } };
        }
        case 'classification_produits': {
          const hasCost = user.permissions.includes('cost.read');
          const by = p.order === 'marge' && hasCost ? 'marge' : p.order === 'qte' ? 'qte' : 'ca';
          const r = await tx.$queryRaw<any[]>`
            SELECT p.name, SUM(si.quantity) AS qte, SUM(si.line_total) AS ca, SUM(${ht} - si.unit_cost * si.quantity) AS marge
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE ${period} ${scope} GROUP BY p.id`;
          const list = r.map((x) => ({ name: x.name, qte: n(x.qte), ca: n(x.ca), marge: hasCost ? n(x.marge) : 0 })).sort((a, b) => (b as any)[by] - (a as any)[by]);
          const total = list.reduce((s, x) => s + Math.max(0, (x as any)[by]), 0) || 1;
          let cum = 0;
          const rows = list.slice(0, Math.min(p.limit, 2000)).map((x, i) => { cum += Math.max(0, (x as any)[by]); const c = (cum / total) * 100; return { rang: i + 1, name: x.name, qte: x.qte, ca: x.ca, ...(hasCost ? { marge: x.marge } : {}), part: Math.round(((x as any)[by] / total) * 1000) / 10, cumul: Math.round(c * 10) / 10, classe: c <= 80 ? 'A' : c <= 95 ? 'B' : 'C' }; });
          return { columns: [{ key: 'rang', label: '#', type: int }, { key: 'name', label: 'Produit', type: text }, { key: 'qte', label: 'Quantité', type: int }, { key: 'ca', label: 'CA TTC', type: money }, ...(hasCost ? [{ key: 'marge', label: 'Marge HT', type: money as ColType }] : []), { key: 'part', label: `Part (${by})`, type: pct }, { key: 'cumul', label: 'Cumul', type: pct }, { key: 'classe', label: 'Classe', type: text }], rows, note: `Classement par ${by === 'ca' ? 'chiffre d’affaires' : by === 'marge' ? 'marge' : 'quantité'}.` };
        }
        case 'marges_produits': {
          const r = await tx.$queryRaw<any[]>`
            SELECT p.name, SUM(si.quantity) AS qte, SUM(${ht}) AS ca_ht, SUM(si.unit_cost * si.quantity) AS cout
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE ${period} ${scope} GROUP BY p.id ORDER BY ca_ht DESC`;
          const rows = r.map((x) => { const ca = n(x.ca_ht), cout = n(x.cout); return { name: x.name, qte: n(x.qte), ca_ht: ca, cout, marge: ca - cout, taux: ca ? Math.round(((ca - cout) / ca) * 1000) / 10 : 0 }; }).filter((x) => p.min === undefined || x.taux > p.min).slice(0, Math.min(p.limit, 2000));
          return { columns: [{ key: 'name', label: 'Produit', type: text }, { key: 'qte', label: 'Quantité', type: int }, { key: 'ca_ht', label: 'CA HT', type: money }, { key: 'cout', label: 'Coût d’achat', type: money }, { key: 'marge', label: 'Marge', type: money }, { key: 'taux', label: 'Taux de marge', type: pct }], rows, totals: { qte: rows.reduce((s, x) => s + x.qte, 0), ca_ht: rows.reduce((s, x) => s + x.ca_ht, 0), marge: rows.reduce((s, x) => s + x.marge, 0) } };
        }
        case 'ventilation_mois_produits': {
          const r = await tx.$queryRaw<any[]>`
            SELECT p.name, EXTRACT(YEAR FROM s.created_at AT TIME ZONE ${TZ})::int AS annee, EXTRACT(MONTH FROM s.created_at AT TIME ZONE ${TZ})::int AS mois, SUM(si.quantity) AS qte
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
            WHERE s.status = 'completed' AND s.created_at >= date_trunc('month', now()) - interval '11 months' ${scope} GROUP BY p.id, 2, 3`;
          const now = new Date();
          const slots = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { y: d.getFullYear(), m: d.getMonth() + 1, label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` }; });
          const by = new Map<string, Record<string, unknown>>();
          for (const x of r) { const o: Record<string, any> = by.get(x.name) ?? { name: x.name, total: 0 }; const i = slots.findIndex((s) => s.y === n(x.annee) && s.m === n(x.mois)); if (i >= 0) { o[`m${i}`] = n(x.qte); o.total += n(x.qte); } by.set(x.name, o); }
          const rows = [...by.values()].sort((a, b) => (b.total as number) - (a.total as number)).slice(0, Math.min(p.limit, 2000));
          return { columns: [{ key: 'name', label: 'Produit', type: text }, ...slots.map((s, i) => ({ key: `m${i}`, label: s.label, type: int as ColType })), { key: 'total', label: 'Total', type: int }], rows };
        }
        case 'prix_zero': {
          const r = await tx.$queryRaw<any[]>`SELECT p.name, p.sku, p.dci FROM products p WHERE p.is_active = true AND p.sale_price = 0 AND p.price_free = false ${ids ? Prisma.sql`AND p.id = ANY(${ids}::uuid[])` : Prisma.empty} ORDER BY p.name LIMIT 2000`;
          return { columns: [{ key: 'name', label: 'Produit', type: text }, { key: 'sku', label: 'Code', type: text }, { key: 'dci', label: 'DCI', type: text }], rows: r.map((x) => ({ name: x.name, sku: x.sku, dci: x.dci })) };
        }
        case 'tva_mensuelle': {
          const r = await tx.$queryRaw<any[]>`
            SELECT to_char(s.created_at AT TIME ZONE ${TZ}, 'YYYY-MM') AS mois, si.vat_rate AS taux, COALESCE(u.full_name, '—') AS operateur, SUM(${ht}) AS base_ht, SUM(si.line_total - ${ht}) AS tva
            FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN users u ON u.id = s.cashier_id
            WHERE ${period} ${scope} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
          const rows = r.map((x) => ({ mois: x.mois, taux: n(x.taux), operateur: x.operateur, base_ht: n(x.base_ht), tva: n(x.tva) }));
          return { columns: [{ key: 'mois', label: 'Mois', type: text }, { key: 'taux', label: 'Taux TVA %', type: int }, { key: 'operateur', label: 'Opérateur', type: text }, { key: 'base_ht', label: 'Base HT', type: money }, { key: 'tva', label: 'TVA', type: money }], rows, totals: { base_ht: rows.reduce((s, x) => s + x.base_ht, 0), tva: rows.reduce((s, x) => s + x.tva, 0) } };
        }
        case 'client': {
          const r = await tx.$queryRaw<any[]>`
            SELECT s.created_at, s.number, p.name, si.quantity AS qte, si.unit_price AS pu, si.line_total AS total
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
            WHERE s.customer_id = ${p.customerId}::uuid AND s.status = 'completed' AND s.created_at >= ${p.from} AND s.created_at < ${p.to} ${scope} ORDER BY s.created_at DESC ${lim}`;
          return { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'number', label: 'Ticket', type: text }, { key: 'name', label: 'Produit', type: text }, { key: 'qte', label: 'Qté', type: int }, { key: 'pu', label: 'PU', type: money }, { key: 'total', label: 'Total', type: money }], rows: r.map((x) => ({ date: new Date(x.created_at).toISOString(), number: x.number, name: x.name, qte: n(x.qte), pu: n(x.pu), total: n(x.total) })), totals: { total: r.reduce((s, x) => s + n(x.total), 0) } };
        }
        case 'edition_detaillee': {
          const r = await tx.$queryRaw<any[]>`
            SELECT s.created_at, s.number, s.kind, p.name, si.quantity AS qte, si.unit_price AS pu, si.discount AS remise, si.line_total AS total, COALESCE(u.full_name, '—') AS operateur, COALESCE(v.full_name, '') AS vendeur
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id LEFT JOIN users u ON u.id = s.cashier_id LEFT JOIN users v ON v.id = s.seller_id
            WHERE ${period} ${scope} ORDER BY s.created_at DESC ${lim}`;
          return { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'number', label: 'Ticket', type: text }, { key: 'name', label: 'Produit', type: text }, { key: 'qte', label: 'Qté', type: int }, { key: 'pu', label: 'PU', type: money }, { key: 'remise', label: 'Remise', type: money }, { key: 'total', label: 'Total', type: money }, { key: 'operateur', label: 'Opérateur', type: text }, { key: 'vendeur', label: 'Vendeur', type: text }], rows: r.map((x) => ({ date: new Date(x.created_at).toISOString(), number: x.number, name: x.name, qte: n(x.qte), pu: n(x.pu), remise: n(x.remise), total: n(x.total), operateur: x.operateur, vendeur: x.vendeur })), totals: { qte: r.reduce((s, x) => s + n(x.qte), 0), total: r.reduce((s, x) => s + n(x.total), 0) } };
        }
      }
      throw new BadRequestException('Statistique non disponible');
    });
  }
}
