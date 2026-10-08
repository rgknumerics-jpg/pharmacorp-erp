import { scopeOf, visibleProductIds } from '../common/vat-scope';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { PrismaService } from '../prisma/prisma.service';
import { forecast } from './forecast';
import { basketComparison, OrderFact, ReceiptLine, supplierStats } from './suppliers';

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;
const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export interface Risk { id: string; level: 'rouge' | 'orange'; category: string; title: string; detail: string; amount?: number; link?: string }

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // =============================================================================================
  // Donnees de base
  // =============================================================================================

  /** Stock par produit (somme des mouvements), valeur au prix d'achat. */
  private stockByProduct(tx: Tx, ids: string[] | null = null, depots: string[] | null = null) {
    const main = !depots || depots.includes('main'), dep = (depots ?? []).filter((d) => d !== 'main');
    return tx.$queryRaw<{ id: string; name: string; sku: string; laboratory: string | null; category: string | null; min_stock: number; sale_price: number; purchase_price: number; price_free: boolean; on_hand: number }[]>`
      SELECT p.id, p.name, p.sku, p.laboratory, c.name AS category, p.min_stock, p.sale_price, p.purchase_price, p.price_free,
             COALESCE(mv.q, 0)::int AS on_hand
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN (SELECT m.product_id, SUM(m.quantity) AS q FROM inventory_movements m WHERE (${!depots}::boolean OR (m.depot_id IS NULL AND ${main}::boolean) OR m.depot_id = ANY(${dep}::uuid[])) GROUP BY m.product_id) mv ON mv.product_id = p.id
      WHERE p.is_active AND (${ids}::uuid[] IS NULL OR p.id = ANY(${ids}::uuid[]))`;
  }

  /** Ventes journalieres par produit sur `days` jours (hors ventes annulees). */
  private async dailySales(tx: Tx, days: number) {
    const rows = await tx.$queryRaw<{ product_id: string; d: Date; qty: number }[]>`
      SELECT si.product_id, date_trunc('day', s.created_at) AS d, SUM(si.quantity)::int AS qty
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.status <> 'void' AND s.created_at >= now() - (${days}::int * interval '1 day')
      GROUP BY si.product_id, d`;
    const today = startOfDay().getTime();
    const series = new Map<string, number[]>();
    for (const r of rows) {
      const idx = days - Math.round((today - startOfDay(r.d).getTime()) / DAY); // 0 = plus ancien ; days = aujourd'hui
      if (idx < 0 || idx > days) continue;
      const arr = series.get(r.product_id) ?? Array.from({ length: days + 1 }, () => 0);
      arr[idx] += r.qty;
      series.set(r.product_id, arr);
    }
    return series;
  }

  private async leadTimes(tx: Tx) {
    // delai observe par fournisseur (commande -> 1re reception), a defaut le delai annonce
    const rows = await tx.$queryRaw<{ supplier_id: string; lead: number | null; declared: number }[]>`
      SELECT su.id AS supplier_id, su.lead_time_days AS declared,
        (SELECT AVG(EXTRACT(EPOCH FROM (g.first_at - po.created_at)) / 86400)::float FROM purchase_orders po
           JOIN LATERAL (SELECT MIN(gr.created_at) AS first_at FROM goods_receipts gr WHERE gr.purchase_order_id = po.id) g ON g.first_at IS NOT NULL
           WHERE po.supplier_id = su.id) AS lead
      FROM suppliers su`;
    return new Map(rows.map((r) => [r.supplier_id, Math.max(1, Math.round(r.lead ?? r.declared))]));
  }

  /** Fournisseur habituel d'un produit : celui de la derniere reception. */
  private async lastSupplier(tx: Tx) {
    const rows = await tx.$queryRaw<{ product_id: string; supplier_id: string; name: string }[]>`
      SELECT DISTINCT ON (gi.product_id) gi.product_id, gr.supplier_id, su.name
      FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id = gi.receipt_id JOIN suppliers su ON su.id = gr.supplier_id
      WHERE gr.supplier_id IS NOT NULL ORDER BY gi.product_id, gr.created_at DESC`;
    return new Map(rows.map((r) => [r.product_id, { id: r.supplier_id, name: r.name }]));
  }

  // =============================================================================================
  // Reapprovisionnement (+ semaines de garde)
  // =============================================================================================

  async reorder(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const [stock, series, leads, suppliers] = await Promise.all([this.stockByProduct(tx), this.dailySales(tx, 400), this.leadTimes(tx), this.lastSupplier(tx)]);
      const today = startOfDay();
      const garde = await tx.gardePeriod.findFirst({ where: { endDate: { gte: today } }, orderBy: { startDate: 'asc' } });
      const gardeDays = garde ? Math.round((garde.endDate.getTime() - garde.startDate.getTime()) / DAY) + 1 : 0;
      const daysToGarde = garde ? Math.round((garde.startDate.getTime() - today.getTime()) / DAY) : null;
      const rows = stock.map((p) => {
        const sup = suppliers.get(p.id);
        const lead = sup ? leads.get(sup.id) ?? 3 : 3;
        const s = (series.get(p.id) ?? Array.from({ length: 401 }, () => 0)).slice(0, 400); // jusqu'a hier
        const gardeSoon = garde && daysToGarde !== null && daysToGarde <= lead + 7;
        const first = s.findIndex((x) => x > 0);
        const historyDays = first === -1 ? 0 : s.length - first;
        const f = forecast({ dailySales: s, historyDays: Math.max(historyDays, 1), stock: p.on_hand, leadTimeDays: lead, ...(gardeSoon ? { boostPct: garde!.upliftPct, boostDays: gardeDays } : {}) });
        const qty = Math.max(f.orderQty, p.min_stock > p.on_hand && f.dailyDemand > 0 ? p.min_stock - p.on_hand : 0);
        return { productId: p.id, name: p.name, sku: p.sku, stock: p.on_hand, ...f, orderQty: qty, supplier: sup?.name ?? null, supplierId: sup?.id ?? null, leadTimeDays: lead, orderValue: qty * p.purchase_price, gardeBoost: !!gardeSoon };
      });
      const order = { rupture: 0, critique: 1, a_commander: 2, surstock: 3, ok: 4, sans_vente: 5 } as const;
      rows.sort((a, b) => order[a.status] - order[b.status] || (a.ruptureInDays ?? 1e9) - (b.ruptureInDays ?? 1e9));
      const toOrder = rows.filter((r) => r.orderQty > 0);
      const bySupplier = new Map<string, { supplier: string; lines: number; value: number }>();
      for (const r of toOrder) { const k = r.supplier ?? 'Sans fournisseur habituel'; const v = bySupplier.get(k) ?? { supplier: k, lines: 0, value: 0 }; v.lines += 1; v.value += r.orderValue; bySupplier.set(k, v); }
      return {
        garde: garde ? { start: garde.startDate, end: garde.endDate, upliftPct: garde.upliftPct, daysToGarde, reinforceNow: daysToGarde !== null && daysToGarde <= 4 && daysToGarde >= -gardeDays } : null,
        products: rows,
        proposal: [...bySupplier.values()].sort((a, b) => b.value - a.value),
      };
    });
  }

  // =============================================================================================
  // Risques immediats
  // =============================================================================================

  async risks(tenantId: string): Promise<Risk[]> {
    const re = await this.reorder(tenantId);
    return this.prisma.forTenant(tenantId, async (tx) => {
      const out: Risk[] = [];
      const stock = await this.stockByProduct(tx);

      for (const r of re.products.filter((x) => x.status === 'rupture' && x.dailyDemand > 0).slice(0, 10)) out.push({ id: `rupt-${r.productId}`, level: 'rouge', category: 'Rupture', title: `${r.name} : en rupture`, detail: `Demande ≈ ${r.dailyDemand}/jour. Commande proposée : ${r.orderQty}${r.supplier ? ` chez ${r.supplier}` : ''}.`, link: 'reorder' });
      for (const r of re.products.filter((x) => x.status === 'critique').slice(0, 10)) out.push({ id: `crit-${r.productId}`, level: 'rouge', category: 'Rupture', title: `${r.name} risque d'être en rupture dans ${r.ruptureInDays} jour(s)`, detail: `Stock ${r.stock}, ≈ ${r.dailyDemand} vendus/jour, délai fournisseur ${r.leadTimeDays} j : commandez maintenant (${r.orderQty}).`, link: 'reorder' });

      const neg = stock.filter((p) => p.on_hand < 0);
      if (neg.length) out.push({ id: 'neg', level: 'rouge', category: 'Stock négatif', title: `${neg.length} produit(s) en stock négatif`, detail: neg.slice(0, 5).map((p) => `${p.name} (${p.on_hand})`).join(', ') + ' — inventaire à refaire.', link: 'stock' });

      const [exp] = await tx.$queryRaw<{ expired_value: number; expired_lots: number; soon_value: number }[]>`
        WITH q AS (SELECT l.id, l.expiry_date, p.purchase_price, SUM(m.quantity) AS qty FROM lots l JOIN products p ON p.id = l.product_id JOIN inventory_movements m ON m.lot_id = l.id WHERE l.expiry_date IS NOT NULL GROUP BY l.id, p.purchase_price HAVING SUM(m.quantity) > 0)
        SELECT COALESCE(SUM(CASE WHEN expiry_date < CURRENT_DATE THEN qty * purchase_price END),0)::int AS expired_value,
               COUNT(*) FILTER (WHERE expiry_date < CURRENT_DATE)::int AS expired_lots,
               COALESCE(SUM(CASE WHEN expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 180 THEN qty * purchase_price END),0)::int AS soon_value FROM q`;
      if (exp?.expired_lots) out.push({ id: 'expired', level: 'rouge', category: 'Péremption', title: `${exp.expired_lots} lot(s) périmé(s) en stock`, detail: `Valeur ${fcfa(exp.expired_value)} : à retirer des rayons et mettre au rebut.`, amount: exp.expired_value, link: 'stock' });
      if (exp?.soon_value) out.push({ id: 'expiring-180', level: 'orange', category: 'Péremption', title: `${fcfa(exp.soon_value)} de stock risque d'arriver à péremption dans les 6 prochains mois`, detail: 'Priorisez leur vente, négociez des retours fournisseurs, ajustez les commandes.', amount: exp.soon_value, link: 'stock' });

      const below = stock.filter((p) => !p.price_free && p.purchase_price > 0 && p.sale_price > 0 && p.sale_price < p.purchase_price);
      if (below.length) out.push({ id: 'below-cost', level: 'rouge', category: 'Prix', title: `${below.length} produit(s) vendu(s) en dessous du prix d'achat`, detail: below.slice(0, 5).map((p) => `${p.name} : achat ${fcfa(p.purchase_price)}, vente ${fcfa(p.sale_price)}`).join(' ; '), link: 'products' });
      const odd = stock.filter((p) => !p.price_free && p.purchase_price > 0 && p.sale_price >= p.purchase_price && (p.sale_price / p.purchase_price < 1.08 || p.sale_price / p.purchase_price > 3));
      if (odd.length) out.push({ id: 'odd-margin', level: 'orange', category: 'Marge', title: `${odd.length} produit(s) avec une marge anormale`, detail: odd.slice(0, 5).map((p) => `${p.name} : coefficient ${(p.sale_price / p.purchase_price).toFixed(2)}`).join(' ; ') + ' — vérifiez prix public et prix d\'achat.', link: 'products' });

      const [over] = await tx.$queryRaw<{ n: number; qty: number }[]>`SELECT COUNT(*)::int AS n, COALESCE(SUM(si.quantity),0)::int AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.note = 'Survente toleree' AND s.created_at > now() - interval '30 days'`;
      if (over?.n) out.push({ id: 'oversold', level: 'orange', category: 'Vente sans stock', title: `${over.qty} unité(s) vendue(s) sans stock sur 30 jours`, detail: 'Saisies de réception oubliées ou inventaire faux : à régulariser.', link: 'stock' });

      const [adj] = await tx.$queryRaw<{ n: number; value: number }[]>`SELECT COUNT(*)::int AS n, COALESCE(SUM(ABS(m.quantity) * p.purchase_price),0)::int AS value FROM inventory_movements m JOIN products p ON p.id = m.product_id WHERE m.type IN ('adjustment','loss') AND m.created_at > now() - interval '30 days'`;
      if (adj?.value) out.push({ id: 'inventory-gap', level: adj.value > 100_000 ? 'rouge' : 'orange', category: 'Écart d’inventaire', title: `Écarts et pertes de stock : ${fcfa(adj.value)} sur 30 jours`, detail: `${adj.n} ajustement(s). Détail dans le journal d'audit.`, amount: adj.value, link: 'audit' });

      // modifications de prix importantes (> 20 %)
      const priceLogs = await tx.auditLog.findMany({ where: { action: 'products.price_changed', createdAt: { gt: new Date(Date.now() - 30 * DAY) } }, orderBy: { createdAt: 'desc' }, take: 200 });
      const bigChanges = priceLogs.filter((l) => { const m = l.metadata as { before?: { salePrice?: number }; salePrice?: number } | null; const b = m?.before?.salePrice, a = m?.salePrice; return b && a !== undefined && Math.abs(a - b) / b > 0.2; });
      if (bigChanges.length) out.push({ id: 'price-change', level: 'orange', category: 'Modification de prix', title: `${bigChanges.length} modification(s) de prix de plus de 20 % sur 30 jours`, detail: 'Vérifiez qu\'elles sont justifiées (journal d\'audit : qui, quand, avant/après).', link: 'audit' });

      // annulations et remboursements inhabituels par utilisateur
      const voids = await tx.$queryRaw<{ user_id: string | null; voids: number; sales: number; refunded: number }[]>`
        SELECT s.cashier_id AS user_id, COUNT(*) FILTER (WHERE s.status = 'void')::int AS voids, COUNT(*)::int AS sales,
               COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'refunded'),0)::int AS refunded
        FROM sales s LEFT JOIN payments p ON p.sale_id = s.id WHERE s.created_at > now() - interval '30 days' GROUP BY s.cashier_id`;
      const users = new Map((await this.prisma.user.findMany({ where: { id: { in: voids.map((v) => v.user_id).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const totalVoids = voids.reduce((s, v) => s + v.voids, 0), totalSales = voids.reduce((s, v) => s + v.sales, 0);
      const avgRate = totalSales ? totalVoids / totalSales : 0;
      for (const v of voids) {
        const rate = v.sales ? v.voids / v.sales : 0;
        if (v.voids >= 3 && rate > Math.max(0.05, avgRate * 2)) out.push({ id: `void-${v.user_id}`, level: 'rouge', category: 'Annulations inhabituelles', title: `${users.get(v.user_id ?? '') ?? 'Utilisateur inconnu'} : ${v.voids} annulation(s) sur ${v.sales} vente(s) (${pct(v.voids, v.sales)} %)`, detail: `Moyenne de l'équipe : ${pct(totalVoids, totalSales)} %. Remboursé : ${fcfa(v.refunded)}.`, amount: v.refunded, link: 'audit' });
      }

      // activite hors horaires (avant 6 h ou apres 23 h)
      const night = await tx.$queryRaw<{ user_id: string | null; n: number }[]>`SELECT cashier_id AS user_id, COUNT(*)::int AS n FROM sales WHERE created_at > now() - interval '30 days' AND (EXTRACT(HOUR FROM created_at) < 6 OR EXTRACT(HOUR FROM created_at) >= 23) GROUP BY cashier_id`;
      const gardeCount = await tx.gardePeriod.count({ where: { startDate: { lte: new Date() }, endDate: { gte: new Date(Date.now() - 30 * DAY) } } });
      for (const n of night.filter((x) => x.n >= 3 && !gardeCount)) out.push({ id: `night-${n.user_id}`, level: 'orange', category: 'Activité anormale', title: `${n.n} vente(s) de nuit par ${users.get(n.user_id ?? '') ?? 'un utilisateur'}`, detail: 'Aucune garde enregistrée sur la période : à vérifier.', link: 'audit' });

      // caisse : dernier comptage avec ecart
      const closing = await tx.auditLog.findFirst({ where: { action: 'cash.closing' }, orderBy: { createdAt: 'desc' } });
      const cm = closing?.metadata as { diff?: number; expected?: number; counted?: number } | undefined;
      if (cm?.diff) out.push({ id: 'cash-gap', level: Math.abs(cm.diff) > 5000 ? 'rouge' : 'orange', category: 'Caisse incohérente', title: `Écart de caisse de ${fcfa(cm.diff)} au dernier comptage`, detail: `Attendu ${fcfa(cm.expected ?? 0)}, compté ${fcfa(cm.counted ?? 0)} (${closing!.createdAt.toLocaleString('fr-FR')}).`, amount: cm.diff, link: 'audit' });

      return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'rouge' ? -1 : 1));
    });
  }

  /** Comptage de caisse : compare les especes attendues (encaissements depuis le dernier comptage) au montant compte. */
  async cashClosing(tenantId: string, userId: string, counted: number, note?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const last = await tx.auditLog.findFirst({ where: { action: 'cash.closing' }, orderBy: { createdAt: 'desc' } });
      const since = last?.createdAt ?? new Date(0);
      const opening = (last?.metadata as { counted?: number } | undefined)?.counted ?? 0;
      const [r] = await tx.$queryRaw<{ cash_in: number; cash_out: number }[]>`
        SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'confirmed'),0)::int AS cash_in,
               COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'),0)::int AS cash_out
        FROM payments WHERE method = 'cash' AND COALESCE(confirmed_at, created_at) > ${since}`;
      const expected = opening + (r?.cash_in ?? 0) - (r?.cash_out ?? 0);
      const diff = counted - expected;
      await tx.auditLog.create({ data: { tenantId, userId, action: 'cash.closing', entityType: 'cash', metadata: { opening, cashIn: r?.cash_in ?? 0, refunds: r?.cash_out ?? 0, expected, counted, diff, note: note ?? null, since: since.toISOString() } } });
      return { opening, cashIn: r?.cash_in ?? 0, refunds: r?.cash_out ?? 0, expected, counted, diff };
    });
  }

  // =============================================================================================
  // Cockpit
  // =============================================================================================

  async cockpit(tenantId: string, roleId?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      // perimetre TVA du role : CA et valeur de stock calcules sans les produits masques
      const sc = roleId ? await scopeOf(tx, roleId) : null;
      const ids = sc ? await visibleProductIds(tx, sc) : null;
      const sumSales = async (from: Date, to: Date) => {
        const [r] = await tx.$queryRaw<{ ca: number; cost: number; tickets: number }[]>`
          SELECT COALESCE(SUM(si.line_total),0)::int AS ca, COALESCE(SUM(si.unit_cost * si.quantity),0)::int AS cost, COUNT(DISTINCT s.id)::int AS tickets
          FROM sales s JOIN sale_items si ON si.sale_id = s.id JOIN products p ON p.id = si.product_id
          WHERE s.status <> 'void' AND s.created_at >= ${from} AND s.created_at < ${to} AND (${ids}::uuid[] IS NULL OR p.id = ANY(${ids}::uuid[]))`;
        return r ?? { ca: 0, cost: 0, tickets: 0 };
      };
      const now = new Date(), d0 = startOfDay(now), tomorrow = new Date(d0.getTime() + DAY);
      const weekStart = new Date(d0.getTime() - ((d0.getDay() + 6) % 7) * DAY);
      const monthStart = new Date(d0.getFullYear(), d0.getMonth(), 1);
      const prevMonthStart = new Date(d0.getFullYear(), d0.getMonth() - 1, 1);
      const prevMonthSameDay = new Date(prevMonthStart.getTime() + (now.getTime() - monthStart.getTime()));
      const [today, week, month, prevMonth] = await Promise.all([sumSales(d0, tomorrow), sumSales(weekStart, tomorrow), sumSales(monthStart, tomorrow), sumSales(prevMonthStart, prevMonthSameDay)]);

      const acc = async (prefix: string) => { const r = await tx.journalLine.aggregate({ where: { accountCode: { startsWith: prefix } }, _sum: { debit: true, credit: true } }); return (r._sum.debit ?? 0) - (r._sum.credit ?? 0); };
      const treasury = (await acc('57')) + (await acc('52'));
      const customers = await tx.customer.aggregate({ _sum: { creditBalance: true } });
      const insurers = await tx.insurer.aggregate({ _sum: { balance: true } });
      const supplierDebt = await tx.supplierInvoice.aggregate({ where: { status: 'open' }, _sum: { amount: true, paidAmount: true } });
      const [monthCharges] = await tx.$queryRaw<{ charges: number }[]>`SELECT COALESCE(SUM(l.debit - l.credit),0)::int AS charges FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_code LIKE '6%' AND l.account_code NOT LIKE '6031%' AND l.account_code NOT LIKE '601%' AND e.date >= ${monthStart}`;

      const stock = await this.stockByProduct(tx, ids, sc?.depots ?? null);
      const stockValue = stock.reduce((s, p) => s + Math.max(0, p.on_hand) * p.purchase_price, 0);
      const re = await this.reorder(tenantId);
      const [dorm] = await tx.$queryRaw<{ now_value: number; prev_value: number }[]>`
        WITH st AS (SELECT p.id, p.purchase_price, COALESCE(SUM(m.quantity),0) AS qty_now,
                      COALESCE(SUM(m.quantity) FILTER (WHERE m.created_at <= now() - interval '30 days'),0) AS qty_prev
                    FROM products p LEFT JOIN inventory_movements m ON m.product_id = p.id GROUP BY p.id),
             s90 AS (SELECT DISTINCT si.product_id FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.status <> 'void' AND s.created_at > now() - interval '90 days'),
             s120 AS (SELECT DISTINCT si.product_id FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.status <> 'void' AND s.created_at > now() - interval '120 days' AND s.created_at <= now() - interval '30 days')
        SELECT COALESCE(SUM(CASE WHEN qty_now > 0 AND s90.product_id IS NULL THEN qty_now * purchase_price END),0)::int AS now_value,
               COALESCE(SUM(CASE WHEN qty_prev > 0 AND s120.product_id IS NULL THEN qty_prev * purchase_price END),0)::int AS prev_value
        FROM st LEFT JOIN s90 ON s90.product_id = st.id LEFT JOIN s120 ON s120.product_id = st.id`;
      const [exp] = await tx.$queryRaw<{ soon: number; expired_value: number }[]>`
        WITH q AS (SELECT l.expiry_date, p.purchase_price, SUM(m.quantity) AS qty FROM lots l JOIN products p ON p.id = l.product_id JOIN inventory_movements m ON m.lot_id = l.id WHERE l.expiry_date IS NOT NULL GROUP BY l.id, p.purchase_price HAVING SUM(m.quantity) > 0)
        SELECT COUNT(*) FILTER (WHERE expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 90)::int AS soon, COALESCE(SUM(qty * purchase_price) FILTER (WHERE expiry_date < CURRENT_DATE),0)::int AS expired_value FROM q`;
      const [cogs90] = await tx.$queryRaw<{ cost: number }[]>`SELECT COALESCE(SUM(si.unit_cost * si.quantity),0)::int AS cost FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.status <> 'void' AND s.created_at > now() - interval '90 days'`;
      const rotation = stockValue ? Math.round(((cogs90?.cost ?? 0) * 4 / stockValue) * 10) / 10 : 0; // rotations / an
      const coverDays = cogs90?.cost ? Math.round(stockValue / ((cogs90.cost) / 90)) : null;

      // --- commercial ---
      const top = await tx.$queryRaw<{ id: string; name: string; qty: number; ca: number; margin: number }[]>`
        SELECT p.id, p.name, SUM(si.quantity)::int AS qty, SUM(si.line_total)::int AS ca, SUM(si.line_total - si.unit_cost * si.quantity)::int AS margin
        FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
        WHERE s.status <> 'void' AND s.created_at > now() - interval '30 days' GROUP BY p.id ORDER BY ca DESC`;
      const byHour = await tx.$queryRaw<{ h: number; tickets: number; ca: number }[]>`SELECT EXTRACT(HOUR FROM created_at)::int AS h, COUNT(*)::int AS tickets, SUM(total)::int AS ca FROM sales WHERE status <> 'void' AND created_at > now() - interval '30 days' GROUP BY h ORDER BY h`;
      const bySeller = await tx.$queryRaw<{ user_id: string | null; tickets: number; ca: number }[]>`SELECT cashier_id AS user_id, COUNT(*)::int AS tickets, SUM(total)::int AS ca FROM sales WHERE status <> 'void' AND created_at > now() - interval '30 days' GROUP BY cashier_id ORDER BY ca DESC`;
      const sellerNames = new Map((await this.prisma.user.findMany({ where: { id: { in: bySeller.map((b) => b.user_id).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const byCategory = await tx.$queryRaw<{ name: string | null; ca: number; margin: number }[]>`SELECT c.name, SUM(si.line_total)::int AS ca, SUM(si.line_total - si.unit_cost * si.quantity)::int AS margin FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id WHERE s.status <> 'void' AND s.created_at > now() - interval '30 days' GROUP BY c.name ORDER BY ca DESC`;
      const byLab = await tx.$queryRaw<{ name: string | null; ca: number; margin: number }[]>`SELECT p.laboratory AS name, SUM(si.line_total)::int AS ca, SUM(si.line_total - si.unit_cost * si.quantity)::int AS margin FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE s.status <> 'void' AND s.created_at > now() - interval '30 days' GROUP BY p.laboratory ORDER BY ca DESC LIMIT 15`;
      const traffic = await tx.$queryRaw<{ w: Date; tickets: number }[]>`SELECT date_trunc('week', created_at) AS w, COUNT(*)::int AS tickets FROM sales WHERE status <> 'void' AND created_at > now() - interval '12 weeks' GROUP BY w ORDER BY w`;

      // --- clients ---
      const [cl] = await tx.$queryRaw<{ total: number; new30: number; active90: number; inactive: number; avg_freq: number }[]>`
        WITH c AS (SELECT cu.id, cu.created_at, MAX(s.created_at) AS last_at, COUNT(s.id) FILTER (WHERE s.created_at > now() - interval '90 days') AS n90
                   FROM customers cu LEFT JOIN sales s ON s.customer_id = cu.id AND s.status <> 'void' GROUP BY cu.id)
        SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new30,
               COUNT(*) FILTER (WHERE last_at > now() - interval '90 days')::int AS active90,
               COUNT(*) FILTER (WHERE last_at IS NULL OR last_at <= now() - interval '90 days')::int AS inactive,
               COALESCE(AVG(n90) FILTER (WHERE n90 > 0),0)::float AS avg_freq FROM c`;
      const rfm = await tx.$queryRaw<{ segment: string; n: number; ca: number }[]>`
        WITH c AS (SELECT cu.id, MAX(s.created_at) AS last_at, COUNT(s.id) AS n, COALESCE(SUM(s.total),0) AS ca FROM customers cu LEFT JOIN sales s ON s.customer_id = cu.id AND s.status <> 'void' AND s.created_at > now() - interval '365 days' GROUP BY cu.id)
        SELECT CASE WHEN last_at > now() - interval '30 days' AND n >= 6 THEN 'Fidèles'
                    WHEN last_at > now() - interval '30 days' THEN 'Actifs récents'
                    WHEN last_at > now() - interval '90 days' THEN 'À relancer'
                    WHEN last_at IS NOT NULL THEN 'Perdus' ELSE 'Jamais venus' END AS segment, COUNT(*)::int AS n, SUM(ca)::int AS ca
        FROM c GROUP BY segment ORDER BY ca DESC`;

      const totalCa30 = top.reduce((s, t) => s + t.ca, 0), totalMargin30 = top.reduce((s, t) => s + t.margin, 0);
      return {
        health: {
          caToday: today.ca, caWeek: week.ca, caMonth: month.ca, caPrevMonthSamePeriod: prevMonth.ca, evolutionPct: prevMonth.ca ? pct(month.ca - prevMonth.ca, prevMonth.ca) : null,
          grossMarginMonth: month.ca - month.cost, marginRate: pct(month.ca - month.cost, month.ca),
          estimatedProfitMonth: month.ca - month.cost - (monthCharges?.charges ?? 0),
          treasury, receivables: (customers._sum.creditBalance ?? 0) + (insurers._sum.balance ?? 0), supplierDebt: (supplierDebt._sum.amount ?? 0) - (supplierDebt._sum.paidAmount ?? 0), stockValue,
        },
        stock: {
          products: stock.length, stockValue, dormantValue: dorm?.now_value ?? 0, dormantEvolutionPct: dorm?.prev_value ? pct((dorm.now_value - dorm.prev_value), dorm.prev_value) : null,
          low: re.products.filter((p) => p.status === 'critique' || p.status === 'a_commander').length, ruptures: re.products.filter((p) => p.status === 'rupture').length,
          expiringSoon: exp?.soon ?? 0, expiredValue: exp?.expired_value ?? 0, rotationPerYear: rotation, coverDays,
          toOrder: re.products.filter((p) => p.orderQty > 0).length, overstock: re.products.filter((p) => p.status === 'surstock').length,
        },
        commercial: {
          tickets30: top.length ? bySeller.reduce((s, b) => s + b.tickets, 0) : 0,
          avgBasket: bySeller.reduce((s, b) => s + b.tickets, 0) ? Math.round(bySeller.reduce((s, b) => s + b.ca, 0) / bySeller.reduce((s, b) => s + b.tickets, 0)) : 0,
          topSold: [...top].sort((a, b) => b.qty - a.qty).slice(0, 10),
          topProfitable: [...top].sort((a, b) => b.margin - a.margin).slice(0, 10),
          highRotation: re.products.filter((p) => p.dailyDemand > 0).sort((a, b) => b.dailyDemand - a.dailyDemand).slice(0, 10).map((p) => ({ name: p.name, perDay: p.dailyDemand, monthsOfStock: p.monthsOfStock })),
          lowRotation: re.products.filter((p) => p.stock > 0 && (p.monthsOfStock ?? 999) > 6).sort((a, b) => (b.monthsOfStock ?? 999) - (a.monthsOfStock ?? 999)).slice(0, 10).map((p) => ({ name: p.name, perDay: p.dailyDemand, monthsOfStock: p.monthsOfStock ?? 'aucune vente' })),
          byHour, bySeller: bySeller.map((b) => ({ seller: sellerNames.get(b.user_id ?? '') ?? '—', tickets: b.tickets, ca: b.ca, avgBasket: b.tickets ? Math.round(b.ca / b.tickets) : 0 })),
          byCategory: byCategory.map((c) => ({ name: c.name ?? 'Sans famille', ca: c.ca, margin: c.margin })), byLaboratory: byLab.map((c) => ({ name: c.name ?? 'Non renseigné', ca: c.ca, margin: c.margin })),
          traffic: traffic.map((t) => ({ week: t.w, tickets: t.tickets })),
          caShareVsMargin: top.filter((t) => totalCa30 && pct(t.ca, totalCa30) >= 5).map((t) => ({ name: t.name, caPct: pct(t.ca, totalCa30), marginPct: pct(t.margin, totalMargin30) })),
        },
        clients: { ...(cl ?? {}), avgFrequency90: Math.round((cl?.avg_freq ?? 0) * 10) / 10, segments: rfm },
      };
    });
  }

  /** Messages de pilotage formules en clair (exemples : rupture dans 8 jours, 4,2 mois de stock, part de CA vs part de marge…). */
  async insights(tenantId: string) {
    const [c, re] = await Promise.all([this.cockpit(tenantId), this.reorder(tenantId)]);
    const out: { level: 'rouge' | 'orange' | 'vert' | 'info'; icon: string; text: string }[] = [];
    for (const p of re.products.filter((x) => (x.status === 'critique' || x.status === 'a_commander') && x.ruptureInDays !== null && x.ruptureInDays <= 15).slice(0, 5)) out.push({ level: p.status === 'critique' ? 'rouge' : 'orange', icon: '⚠️', text: `Attention : ${p.name} risque d'être en rupture dans ${p.ruptureInDays} jour(s).` });
    for (const p of re.products.filter((x) => x.status === 'surstock').slice(0, 3)) out.push({ level: 'info', icon: '📦', text: `Vous avez ${p.monthsOfStock} mois de stock sur ${p.name}.` });
    for (const s of c.commercial.caShareVsMargin.filter((x) => x.marginPct < x.caPct / 2).slice(0, 3)) out.push({ level: 'orange', icon: '💰', text: `${s.name} représente ${s.caPct} % du chiffre d'affaires mais seulement ${s.marginPct} % de la marge.` });
    if (c.stock.dormantEvolutionPct !== null && Math.abs(c.stock.dormantEvolutionPct) >= 5) out.push({ level: c.stock.dormantEvolutionPct > 0 ? 'orange' : 'vert', icon: c.stock.dormantEvolutionPct > 0 ? '🟠' : '🟢', text: `Votre stock dormant a ${c.stock.dormantEvolutionPct > 0 ? 'augmenté' : 'diminué'} de ${Math.abs(c.stock.dormantEvolutionPct)} % en 30 jours (${fcfa(c.stock.dormantValue)}).` });
    const risks = await this.risks(tenantId);
    const exp = risks.find((r) => r.id === 'expiring-180');
    if (exp) out.push({ level: 'rouge', icon: '🔴', text: exp.title + '.' });
    if (c.health.evolutionPct !== null) out.push({ level: c.health.evolutionPct >= 0 ? 'vert' : 'orange', icon: c.health.evolutionPct >= 0 ? '📈' : '📉', text: `Chiffre d'affaires du mois ${c.health.evolutionPct >= 0 ? 'en hausse' : 'en baisse'} de ${Math.abs(c.health.evolutionPct)} % par rapport à la même période du mois dernier.` });
    if (re.garde?.reinforceNow) out.push({ level: 'orange', icon: '🌙', text: `Semaine de garde dans ${re.garde.daysToGarde} jour(s) : renforcez le stock (${re.products.filter((p) => p.gardeBoost && p.orderQty > 0).length} produit(s) à commander, demande prévue +${re.garde.upliftPct} %).` });
    return out;
  }

  // =============================================================================================
  // Finances : ou va l'argent
  // =============================================================================================

  async finance(tenantId: string, from: Date, to: Date) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const grp = await tx.journalLine.groupBy({ by: ['accountCode'], where: { entry: { date: { gte: from, lt: to } } }, _sum: { debit: true, credit: true } });
      const sum = (test: (c: string) => boolean, side: 'd' | 'c') => grp.filter((g) => test(g.accountCode)).reduce((s, g) => s + (side === 'd' ? (g._sum.debit ?? 0) - (g._sum.credit ?? 0) : (g._sum.credit ?? 0) - (g._sum.debit ?? 0)), 0);
      const ca = sum((c) => c.startsWith('70'), 'c');
      const purchaseCost = sum((c) => c.startsWith('601') || c.startsWith('6031'), 'd');
      const salaries = sum((c) => c.startsWith('66'), 'd');
      const rent = sum((c) => c.startsWith('622'), 'd');
      const taxes = sum((c) => c.startsWith('64'), 'd');
      const losses = sum((c) => c.startsWith('658') || c.startsWith('659'), 'd');
      const otherCharges = sum((c) => c.startsWith('6') && !/^(601|6031|66|622|64|658|659)/.test(c), 'd');
      const otherIncome = sum((c) => c.startsWith('7') && !c.startsWith('70'), 'c');
      const grossMargin = ca - purchaseCost;
      const result = grossMargin - salaries - rent - taxes - losses - otherCharges + otherIncome;

      const acc = async (prefix: string) => { const r = await tx.journalLine.aggregate({ where: { accountCode: { startsWith: prefix } }, _sum: { debit: true, credit: true } }); return (r._sum.debit ?? 0) - (r._sum.credit ?? 0); };
      const treasury = { cash: await acc('571'), bank: await acc('521') - (await acc('5215')) - (await acc('5216')), mtn: await acc('5215'), airtel: await acc('5216') };
      const cashNow = treasury.cash + treasury.bank + treasury.mtn + treasury.airtel;

      const invoices = await tx.supplierInvoice.findMany({ where: { status: 'open' }, include: { supplier: { select: { name: true } } }, orderBy: { dueDate: 'asc' } });
      const customers = await tx.customer.findMany({ where: { creditBalance: { gt: 0 } }, select: { creditBalance: true, paymentTermDays: true } });
      const insurers = await tx.insurer.findMany({ where: { balance: { gt: 0 } }, select: { balance: true, paymentTermDays: true } });
      const lastRun = await tx.payrollRun.findFirst({ where: { status: 'validated' }, orderBy: { period: 'desc' } });
      const monthlyNet = (lastRun?.totals as Record<string, number> | undefined)?.net ?? 0;
      const [avgDaily] = await tx.$queryRaw<{ v: number }[]>`SELECT COALESCE(SUM(amount) / 30.0, 0)::float AS v FROM payments WHERE status = 'confirmed' AND method IN ('cash','card','mtn_momo','airtel_money') AND created_at > now() - interval '30 days'`;

      // prevision : encaissements moyens + creances qui arrivent a echeance - factures fournisseurs - salaires
      const today = startOfDay();
      const horizon = (days: number) => {
        const until = new Date(today.getTime() + days * DAY);
        const supplierOut = invoices.filter((i) => i.dueDate <= until).reduce((s, i) => s + i.amount - i.paidAmount, 0);
        const receivablesIn = Math.round(customers.reduce((s, c) => s + (c.paymentTermDays <= days ? c.creditBalance * 0.7 : 0), 0) + insurers.reduce((s, i) => s + (i.paymentTermDays <= days ? i.balance * 0.8 : 0), 0));
        const salesIn = Math.round((avgDaily?.v ?? 0) * days);
        const payroll = monthlyNet * Math.floor(days / 30);
        return { days, salesIn, receivablesIn, supplierOut, payroll, balance: cashNow + salesIn + receivablesIn - supplierOut - payroll };
      };

      const margins = async (groupBy: 'product' | 'category' | 'supplier') => {
        const rows = groupBy === 'product'
          ? await tx.$queryRaw<{ name: string; ca: number; margin: number }[]>`SELECT p.name, SUM(si.line_total)::int AS ca, SUM(si.line_total - si.unit_cost * si.quantity)::int AS margin FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE s.status <> 'void' AND s.created_at >= ${from} AND s.created_at < ${to} GROUP BY p.name ORDER BY margin DESC LIMIT 30`
          : groupBy === 'category'
            ? await tx.$queryRaw<{ name: string; ca: number; margin: number }[]>`SELECT COALESCE(c.name,'Sans famille') AS name, SUM(si.line_total)::int AS ca, SUM(si.line_total - si.unit_cost * si.quantity)::int AS margin FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id WHERE s.status <> 'void' AND s.created_at >= ${from} AND s.created_at < ${to} GROUP BY 1 ORDER BY margin DESC`
            : await tx.$queryRaw<{ name: string; ca: number; margin: number }[]>`SELECT COALESCE(su.name,'Sans fournisseur') AS name, SUM(si.line_total)::int AS ca, SUM(si.line_total - si.unit_cost * si.quantity)::int AS margin FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN lots l ON l.id = si.lot_id LEFT JOIN LATERAL (SELECT gr.supplier_id FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id = gi.receipt_id WHERE gi.lot_id = l.id LIMIT 1) r ON true LEFT JOIN suppliers su ON su.id = r.supplier_id WHERE s.status <> 'void' AND s.created_at >= ${from} AND s.created_at < ${to} GROUP BY 1 ORDER BY margin DESC`;
        return rows.map((r) => ({ ...r, rate: pct(r.margin, r.ca) }));
      };
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });

      return {
        period: { from, to },
        waterfall: [
          { label: "Chiffre d'affaires", amount: ca },
          { label: "Coût d'achat des produits vendus", amount: -purchaseCost },
          { label: 'Marge brute', amount: grossMargin, subtotal: true },
          { label: 'Salaires et charges sociales', amount: -salaries },
          { label: 'Loyers', amount: -rent },
          { label: 'Impôts et taxes', amount: -taxes },
          { label: 'Pertes de stock', amount: -losses },
          { label: 'Autres dépenses', amount: -otherCharges },
          ...(otherIncome ? [{ label: 'Autres produits', amount: otherIncome }] : []),
          { label: 'RÉSULTAT', amount: result, subtotal: true },
        ],
        marginRate: pct(grossMargin, ca),
        treasury: { ...treasury, total: cashNow },
        forecast: [horizon(30), horizon(60), horizon(90)],
        receivables: { customers: customers.reduce((s, c) => s + c.creditBalance, 0), insurers: insurers.reduce((s, i) => s + i.balance, 0) },
        supplierDebt: { total: invoices.reduce((s, i) => s + i.amount - i.paidAmount, 0), overdue: invoices.filter((i) => i.dueDate < today).reduce((s, i) => s + i.amount - i.paidAmount, 0), upcoming: invoices.slice(0, 20).map((i) => ({ id: i.id, supplier: i.supplier.name, number: i.number, dueDate: i.dueDate, due: i.amount - i.paidAmount, late: i.dueDate < today })) },
        margins: { byProduct: await margins('product'), byCategory: await margins('category'), bySupplier: await margins('supplier'), byStore: [{ name: tenant.name, ca, margin: grossMargin, rate: pct(grossMargin, ca) }] },
      };
    });
  }

  // =============================================================================================
  // Fournisseurs
  // =============================================================================================

  async suppliersAnalysis(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const allSuppliers = await tx.supplier.findMany({ where: { isActive: true } });
      const raw = await tx.$queryRaw<{ supplier_id: string; product_id: string; date: Date; quantity: number; unit_cost: number }[]>`
        SELECT gr.supplier_id, gi.product_id, gr.created_at AS date, gi.quantity, gi.unit_cost FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id = gi.receipt_id
        WHERE gr.supplier_id IS NOT NULL AND gr.created_at > now() - interval '400 days'`;
      const lines: ReceiptLine[] = raw.map((r) => ({ supplierId: r.supplier_id, productId: r.product_id, date: r.date, quantity: r.quantity, unitCost: r.unit_cost }));
      const pos = await tx.purchaseOrder.findMany({ where: { status: { not: 'draft' } }, include: { items: true, receipts: { select: { createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 } } });
      const orders: OrderFact[] = pos.map((o) => ({
        supplierId: o.supplierId, createdAt: o.createdAt, expectedAt: o.expectedAt, firstReceiptAt: o.receipts[0]?.createdAt ?? null,
        orderedQty: o.items.reduce((s, i) => s + i.quantity, 0), receivedQty: o.items.reduce((s, i) => s + Math.min(i.receivedQty, i.quantity), 0),
        missingProducts: o.status === 'received' || o.status === 'partially_received' ? o.items.filter((i) => i.receivedQty === 0).length : 0,
      }));
      const [margins] = [await tx.$queryRaw<{ supplier_id: string; ca: number; margin: number }[]>`
        SELECT r.supplier_id, SUM(si.line_total)::int AS ca, SUM(si.line_total - si.unit_cost * si.quantity)::int AS margin
        FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN LATERAL (SELECT gr.supplier_id FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id = gi.receipt_id WHERE gi.lot_id = si.lot_id LIMIT 1) r ON true
        WHERE s.status <> 'void' AND s.created_at > now() - interval '180 days' GROUP BY r.supplier_id`];
      const invoices = await tx.supplierInvoice.groupBy({ by: ['supplierId'], where: { status: 'open' }, _sum: { amount: true, paidAmount: true } });
      const activeIds = new Set<string>([...lines.map((l) => l.supplierId), ...orders.map((o) => o.supplierId), ...invoices.map((i) => i.supplierId)]);
      const suppliers = allSuppliers.filter((s) => activeIds.has(s.id) || s.isWholesaler);

      const stats = suppliers.map((s) => {
        const st = supplierStats(s.id, lines, orders);
        const m = margins.find((x) => x.supplier_id === s.id);
        const inv = invoices.find((i) => i.supplierId === s.id);
        return { id: s.id, name: s.name, paymentTermDays: s.paymentTermDays, payment: s.paymentTermDays ? `${s.paymentTermDays} jours` : 'Comptant', declaredLeadTime: s.leadTimeDays, ...st, marginObtained: m?.margin ?? 0, marginRate: m ? pct(m.margin, m.ca) : null, openDebt: (inv?._sum.amount ?? 0) - (inv?._sum.paidAmount ?? 0) };
      });

      const alerts: { level: 'vert' | 'orange'; text: string }[] = [];
      for (let i = 0; i < suppliers.length; i++) for (let j = i + 1; j < suppliers.length; j++) {
        const c = basketComparison(suppliers[i].id, suppliers[j].id, lines);
        if (c && Math.abs(c.diffPct) >= 2) {
          const cheap = c.diffPct < 0 ? suppliers[i] : suppliers[j], dear = c.diffPct < 0 ? suppliers[j] : suppliers[i];
          alerts.push({ level: 'vert', text: `🟢 ${cheap.name} est actuellement ${Math.abs(c.diffPct)} % moins cher que ${dear.name} sur votre panier habituel (${c.commonProducts} produit(s) communs).` });
        }
      }
      for (const s of stats) {
        if (s.recentLeadTimeDays && s.previousLeadTimeDays && s.recentLeadTimeDays >= s.previousLeadTimeDays * 1.5 && s.recentLeadTimeDays - s.previousLeadTimeDays >= 2) alerts.push({ level: 'orange', text: `⚠️ Le délai moyen de ${s.name} est passé de ${s.previousLeadTimeDays} à ${s.recentLeadTimeDays} jours.` });
        if (s.priceEvolutionPct !== null && s.priceEvolutionPct >= 5) alerts.push({ level: 'orange', text: `⚠️ Les prix de ${s.name} ont augmenté de ${s.priceEvolutionPct} % en 3 mois sur les mêmes produits.` });
        if (s.completeRate !== null && s.completeRate < 80) alerts.push({ level: 'orange', text: `⚠️ ${s.name} ne livre complètement que ${s.completeRate} % des commandes (${s.missingProducts} produit(s) manquant(s)).` });
      }
      return { suppliers: stats, alerts };
    });
  }

  /** Historique de prix d'un produit par fournisseur. */
  async priceHistory(tenantId: string, productId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.$queryRaw<{ supplier: string; date: Date; unit_cost: number; quantity: number }[]>`
      SELECT COALESCE(su.name,'—') AS supplier, gr.created_at AS date, gi.unit_cost, gi.quantity FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id = gi.receipt_id LEFT JOIN suppliers su ON su.id = gr.supplier_id
      WHERE gi.product_id = ${productId}::uuid ORDER BY gr.created_at DESC LIMIT 100`);
  }
}
