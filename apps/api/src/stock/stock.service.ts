import { randomUUID } from 'crypto';
import { nextNumber } from '../common/numbering';
import { movementWhere, Scope, scopeOf, visibleProductIds } from '../common/vat-scope';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MovementType, Prisma } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { Allocation, allocateFefo, LotStock } from './fefo';
import { emit } from '../accounting/outbox';
import { AdjustStockDto, ValidateLotDto } from './stock.dto';

type Tx = Prisma.TransactionClient;

interface LevelRow {
  id: string;
  sku: string;
  name: string;
  min_stock: number;
  on_hand: number;
  sellable: number;
  expired: number;
  held: number;
}

/** Depots retenus pour une lecture : demande de l'ecran, restreinte au perimetre du role. */
function depotFilter(sc: Scope, depot?: string) {
  const asked = !depot || depot === 'all' ? null : [depot];
  const allowed = sc.depots;
  const set = asked && allowed ? asked.filter((x) => allowed.includes(x)) : (asked ?? allowed);
  if (!set) return { all: true, main: true, ids: [] as string[] };
  return { all: false, main: set.includes('main'), ids: set.filter((x) => x !== 'main') };
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Primitives transactionnelles (reutilisees par les ventes et les receptions)
  // ---------------------------------------------------------------------------------------------

  /**
   * Verrouille les produits concernes (ordre fixe -> pas d'interblocage). Deux caisses qui vendent le meme
   * produit au meme instant sont ainsi serialisees : l'allocation FEFO lit toujours un stock a jour.
   */
  async lockProducts(tx: Tx, productIds: string[]): Promise<void> {
    const ids = [...new Set(productIds)].sort();
    if (!ids.length) return;
    await tx.$queryRaw`SELECT id FROM products WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  }

  /** Lots vendables d'un produit (statut disponible) avec leur solde courant. */
  async sellableLots(tx: Tx, productId: string): Promise<LotStock[]> {
    const lots = await tx.lot.findMany({ where: { productId, status: 'available' } });
    if (!lots.length) return [];
    const sums = await tx.inventoryMovement.groupBy({
      by: ['lotId'],
      where: { productId, lotId: { in: lots.map((l) => l.id) }, depotId: null }, // la caisse ne preleve que dans le depot de vente
      _sum: { quantity: true },
    });
    const balance = new Map(sums.map((s) => [s.lotId, s._sum.quantity ?? 0]));
    return lots.map((l) => ({
      lotId: l.id,
      lotNumber: l.lotNumber,
      expiryDate: l.expiryDate,
      available: balance.get(l.id) ?? 0,
    }));
  }

  async lotBalance(tx: Tx, lotId: string): Promise<number> {
    const r = await tx.inventoryMovement.aggregate({ where: { lotId }, _sum: { quantity: true } });
    return r._sum.quantity ?? 0;
  }

  /** Allocation FEFO d'une sortie pour un produit (le produit doit deja etre verrouille). */
  async allocate(
    tx: Tx,
    product: { id: string; trackLots: boolean; oversellTolerance: number },
    quantity: number,
    explicitLotId?: string,
  ): Promise<Allocation[]> {
    if (!product.trackLots) {
      // Produit sans lot : le stock est la somme de ses mouvements ; meme regle de tolerance de survente.
      const onHand = (await tx.inventoryMovement.aggregate({ where: { productId: product.id, depotId: null }, _sum: { quantity: true } }))._sum.quantity ?? 0;
      return allocateFefo([{ lotId: '__none__', lotNumber: '', expiryDate: null, available: Math.max(0, onHand) }], quantity, product.oversellTolerance).map(
        (a) => (a.lotId === '__none__' ? { ...a, lotId: null } : a),
      );
    }
    const lots = await this.sellableLots(tx, product.id);
    if (explicitLotId) {
      // Derogation FEFO tracee : le lot demande doit etre vendable et suffisant (ARCHITECTURE.md section 17).
      const lot = lots.find((l) => l.lotId === explicitLotId);
      if (!lot) throw new ConflictException('Lot demande indisponible (inconnu, en attente de validation ou bloque).');
      return allocateFefo([lot], quantity, 0);
    }
    return allocateFefo(lots, quantity, product.oversellTolerance);
  }

  /**
   * Delotage automatique a la vente : si `unitProductId` est un produit "a l'unite" (issu d'un deconditionnement,
   * ARCHITECTURE.md -- Achats) et que son stock ne couvre pas `neededQty`, ouvre juste assez de boites du produit
   * parent (FEFO) pour combler l'ecart, avant que l'allocation normale ne s'execute. Ne fait rien si ce n'est pas
   * un produit detaillable, ou si le stock est deja suffisant ; ne leve jamais d'erreur -- un manque residuel est
   * simplement laisse a l'allocation (tolerance de survente), comme pour n'importe quel autre produit.
   */
  async ensureUnitStock(tx: Tx, tenantId: string, userId: string | undefined, unitProductId: string, neededQty: number): Promise<void> {
    const parent = await tx.product.findFirst({ where: { tenantId, unitProductId } });
    if (!parent || !parent.unitsPerBox || parent.unitsPerBox < 2) return;
    const onHand = (await tx.inventoryMovement.aggregate({ where: { productId: unitProductId, depotId: null }, _sum: { quantity: true } }))._sum.quantity ?? 0;
    const shortfall = neededQty - onHand;
    if (shortfall <= 0) return;
    let boxesNeeded = Math.ceil(shortfall / parent.unitsPerBox);
    const lots = parent.trackLots
      ? await this.sellableLots(tx, parent.id)
      : [{ lotId: '__none__', lotNumber: 'SANS-LOT', expiryDate: null, available: Math.max(0, (await tx.inventoryMovement.aggregate({ where: { productId: parent.id, depotId: null }, _sum: { quantity: true } }))._sum.quantity ?? 0) }];
    for (const lot of lots) {
      if (boxesNeeded <= 0) break;
      const boxes = Math.min(boxesNeeded, Math.max(0, lot.available));
      if (boxes <= 0) continue;
      const unitLot = await tx.lot.upsert({
        where: { tenantId_productId_lotNumber: { tenantId, productId: unitProductId, lotNumber: lot.lotNumber } },
        create: { tenantId, productId: unitProductId, lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, createdById: userId },
        update: {},
      });
      const reason = `Déconditionnement automatique de ${boxes} boîte(s) en ${boxes * parent.unitsPerBox} unité(s) (vente)`;
      await tx.inventoryMovement.create({ data: { tenantId, productId: parent.id, lotId: lot.lotId === '__none__' ? null : lot.lotId, quantity: -boxes, type: 'unpack', reason, createdById: userId, refType: 'product', refId: unitProductId } });
      await tx.inventoryMovement.create({ data: { tenantId, productId: unitProductId, lotId: unitLot.id, quantity: boxes * parent.unitsPerBox, type: 'unpack', reason, createdById: userId, refType: 'product', refId: parent.id } });
      boxesNeeded -= boxes;
    }
  }

  addMovement(
    tx: Tx,
    data: {
      tenantId: string;
      productId: string;
      lotId?: string | null;
      quantity: number;
      type: MovementType;
      refType?: string;
      refId?: string;
      reason?: string;
      idempotencyKey?: string;
      createdById?: string;
      depotId?: string | null;
    },
  ) {
    return tx.inventoryMovement.create({ data: { ...data, lotId: data.lotId ?? null, depotId: data.depotId ?? null } });
  }

  // ---------------------------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------------------------

  /** Niveaux de stock ; `depot` = 'all' (defaut), 'main' (comptoir / rayons) ou l'id d'une reserve. */
  async levels(tenantId: string, opts: { q?: string; lowOnly?: boolean; take: number; skip: number; roleId?: string; depot?: string; sort?: string }) {
    const sort = ['name_asc', 'name_desc', 'stock_asc', 'stock_desc', 'expired_asc', 'expired_desc'].includes(opts.sort ?? '') ? (opts.sort as string) : 'name_asc';
    const like = opts.q ? `%${opts.q.replace(/[%_\\]/g, '\\$&')}%` : null;
    return this.prisma.forTenant(tenantId, async (tx) => {
      const sc = opts.roleId ? await scopeOf(tx, opts.roleId) : { rates: null, suppliers: null, depots: null };
      const d = depotFilter(sc, opts.depot);
      const rows = await tx.$queryRaw<LevelRow[]>`
        SELECT p.id, p.sku, p.name, p.min_stock,
          COALESCE(SUM(m.quantity), 0)::int AS on_hand,
          COALESCE(SUM(CASE WHEN m.lot_id IS NULL OR (l.status = 'available' AND (l.expiry_date IS NULL OR l.expiry_date >= CURRENT_DATE)) THEN m.quantity ELSE 0 END), 0)::int AS sellable,
          COALESCE(SUM(CASE WHEN l.expiry_date < CURRENT_DATE THEN m.quantity ELSE 0 END), 0)::int AS expired,
          COALESCE(SUM(CASE WHEN l.status <> 'available' AND (l.expiry_date IS NULL OR l.expiry_date >= CURRENT_DATE) THEN m.quantity ELSE 0 END), 0)::int AS held
        FROM products p
        LEFT JOIN inventory_movements m ON m.product_id = p.id
          AND (${d.all}::boolean OR (m.depot_id IS NULL AND ${d.main}::boolean) OR m.depot_id = ANY(${d.ids}::uuid[]))
        LEFT JOIN lots l ON l.id = m.lot_id
        WHERE p.is_active = true
          AND (${sc.rates}::int[] IS NULL OR p.vat_rate = ANY(${sc.rates}::int[]))
          AND (${sc.suppliers}::text[] IS NULL OR p.supplier_codes ?| ${sc.suppliers}::text[])
          AND (${like}::text IS NULL OR p.name ILIKE ${like} OR p.sku ILIKE ${like} OR p.barcode ILIKE ${like} OR p.dci ILIKE ${like})
        GROUP BY p.id
        HAVING (${opts.lowOnly ?? false}::boolean = false) OR COALESCE(SUM(CASE WHEN m.lot_id IS NULL OR (l.status = 'available' AND (l.expiry_date IS NULL OR l.expiry_date >= CURRENT_DATE)) THEN m.quantity ELSE 0 END), 0) < p.min_stock
        ORDER BY
          CASE WHEN ${sort}::text = 'stock_desc' THEN COALESCE(SUM(m.quantity), 0) END DESC,
          CASE WHEN ${sort}::text = 'stock_asc' THEN COALESCE(SUM(m.quantity), 0) END ASC,
          CASE WHEN ${sort}::text = 'expired_desc' THEN COALESCE(SUM(CASE WHEN l.expiry_date < CURRENT_DATE THEN m.quantity ELSE 0 END), 0) END DESC,
          CASE WHEN ${sort}::text = 'expired_asc' THEN COALESCE(SUM(CASE WHEN l.expiry_date < CURRENT_DATE THEN m.quantity ELSE 0 END), 0) END ASC,
          CASE WHEN ${sort}::text = 'name_desc' THEN p.name END DESC,
          p.name ASC
        LIMIT ${opts.take} OFFSET ${opts.skip}`;
      return rows.map((r) => ({
        productId: r.id,
        sku: r.sku,
        name: r.name,
        minStock: r.min_stock,
        onHand: r.on_hand,
        sellable: r.sellable,
        expired: r.expired,
        held: r.held,
        belowMin: r.sellable < r.min_stock,
      }));
    });
  }

  async lotsOfProduct(tenantId: string, productId: string, roleId?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const sc = roleId ? await scopeOf(tx, roleId) : { rates: null, suppliers: null, depots: null };
      const lots = await tx.lot.findMany({ where: { productId }, orderBy: [{ expiryDate: 'asc' }] });
      const sums = await tx.inventoryMovement.groupBy({ by: ['lotId', 'depotId'], where: { productId, ...movementWhere(sc, null) }, _sum: { quantity: true } });
      const bal = new Map<string | null, number>();
      const byDepot = new Map<string | null, Record<string, number>>();
      for (const r of sums) { bal.set(r.lotId, (bal.get(r.lotId) ?? 0) + (r._sum.quantity ?? 0)); const m = byDepot.get(r.lotId) ?? {}; m[r.depotId ?? 'main'] = (m[r.depotId ?? 'main'] ?? 0) + (r._sum.quantity ?? 0); byDepot.set(r.lotId, m); }
      const today = Date.now();
      return lots
        .map((l) => ({
          id: l.id,
          lotNumber: l.lotNumber,
          expiryDate: l.expiryDate,
          status: l.status,
          quantity: bal.get(l.id) ?? 0,
          byDepot: Object.fromEntries(Object.entries(byDepot.get(l.id) ?? {}).filter(([, q]) => q !== 0)),
          daysToExpiry: l.expiryDate ? Math.floor((l.expiryDate.getTime() - today) / 86_400_000) : null,
          createdById: l.createdById,
        }))
        .filter((l) => l.quantity !== 0 || l.status !== 'available');
    });
  }

  /** Lots en stock qui expirent dans `days` jours (ou deja perimes), tries du plus urgent au moins urgent. */
  async expiring(tenantId: string, days: number) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.$queryRaw<
        { lot_id: string; product_id: string; name: string; sku: string; lot_number: string; expiry_date: Date; quantity: number; status: string }[]
      >`
        SELECT l.id AS lot_id, p.id AS product_id, p.name, p.sku, l.lot_number, l.expiry_date, l.status::text AS status,
               COALESCE(SUM(m.quantity), 0)::int AS quantity
        FROM lots l
        JOIN products p ON p.id = l.product_id
        LEFT JOIN inventory_movements m ON m.lot_id = l.id
        WHERE l.expiry_date IS NOT NULL AND l.expiry_date <= CURRENT_DATE + ${days}::int
        GROUP BY l.id, p.id
        HAVING COALESCE(SUM(m.quantity), 0) > 0
        ORDER BY l.expiry_date ASC, p.name ASC
        LIMIT 500`,
    ).then((rows) =>
      rows.map((r) => ({
        lotId: r.lot_id,
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        lotNumber: r.lot_number,
        expiryDate: r.expiry_date,
        quantity: r.quantity,
        status: r.status,
        expired: r.expiry_date.getTime() < Date.now() - 86_400_000,
      })),
    );
  }

  movements(tenantId: string, productId: string | undefined, take: number, skip: number, roleId?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const sc = roleId ? await scopeOf(tx, roleId) : { rates: null, suppliers: null, depots: null };
      const ids = await visibleProductIds(tx, sc);
      return tx.inventoryMovement.findMany({
        where: { AND: [productId ? { productId } : {}, movementWhere(sc, ids)] },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: { product: { select: { name: true, sku: true } }, lot: { select: { lotNumber: true, expiryDate: true } } },
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Depots (comptoir / rayons + reserves) et transferts
  // ---------------------------------------------------------------------------------------------

  /**
   * Valeur du stock et ventilations (famille, comptoir / réserves, rayon, TVA, laboratoire, conservation, péremption),
   * limitées au périmètre du rôle : produits (TVA, fournisseur) et dépôts masqués par l'administrateur ne comptent pas.
   */
  async valuation(tenantId: string, roleId: string | undefined, showCost: boolean) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const sc = roleId ? await scopeOf(tx, roleId) : { rates: null, suppliers: null, depots: null };
      const d = depotFilter(sc, 'all');
      const rows = await tx.$queryRaw<{ cat: string; depot: string | null; loc: string; vat: number; lab: string; storage: string; units: number; pv: number; sv: number; prods: number }[]>`
        SELECT COALESCE(c.name, 'Sans famille') AS cat, m.depot_id::text AS depot, COALESCE(NULLIF(trim(p.location), ''), 'Sans emplacement') AS loc, p.vat_rate AS vat,
               COALESCE(NULLIF(trim(p.laboratory), ''), 'Non renseigné') AS lab, p.storage AS storage,
               SUM(m.quantity)::int AS units, SUM(m.quantity::float * p.purchase_price)::float AS pv, SUM(m.quantity::float * p.sale_price)::float AS sv, COUNT(DISTINCT p.id)::int AS prods
        FROM inventory_movements m JOIN products p ON p.id = m.product_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = true
          AND (${d.all}::boolean OR (m.depot_id IS NULL AND ${d.main}::boolean) OR m.depot_id = ANY(${d.ids}::uuid[]))
          AND (${sc.rates}::int[] IS NULL OR p.vat_rate = ANY(${sc.rates}::int[]))
          AND (${sc.suppliers}::text[] IS NULL OR p.supplier_codes ?| ${sc.suppliers}::text[])
        GROUP BY 1, 2, 3, 4, 5, 6 HAVING SUM(m.quantity) > 0`;
      const ex = await tx.$queryRaw<{ expired_units: number; expired_pv: number; soon_units: number; soon_pv: number }[]>`
        WITH q AS (SELECT l.expiry_date, SUM(m.quantity) AS qty, p.purchase_price
                   FROM lots l JOIN products p ON p.id = l.product_id JOIN inventory_movements m ON m.lot_id = l.id
                   WHERE l.expiry_date IS NOT NULL AND p.is_active = true
                     AND (${d.all}::boolean OR (m.depot_id IS NULL AND ${d.main}::boolean) OR m.depot_id = ANY(${d.ids}::uuid[]))
                     AND (${sc.rates}::int[] IS NULL OR p.vat_rate = ANY(${sc.rates}::int[]))
                     AND (${sc.suppliers}::text[] IS NULL OR p.supplier_codes ?| ${sc.suppliers}::text[])
                   GROUP BY l.id, p.purchase_price HAVING SUM(m.quantity) > 0)
        SELECT COALESCE(SUM(qty) FILTER (WHERE expiry_date < CURRENT_DATE),0)::int AS expired_units, COALESCE(SUM(qty::float * purchase_price) FILTER (WHERE expiry_date < CURRENT_DATE),0)::float AS expired_pv,
               COALESCE(SUM(qty) FILTER (WHERE expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 90),0)::int AS soon_units, COALESCE(SUM(qty::float * purchase_price) FILTER (WHERE expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 90),0)::float AS soon_pv
        FROM q`;
      const depots = await tx.depot.findMany({ select: { id: true, name: true } });
      const depotName = (id: string | null) => (id === null ? 'Comptoir / rayons' : depots.find((x) => x.id === id)?.name ?? 'Réserve');
      const STORAGE: Record<string, string> = { normal: 'Ambiant', froid: 'Froid', stupefiant: 'Stupéfiants', psychotrope: 'Psychotropes', photosensible: 'Photosensible', inflammable: 'Inflammable' };
      const group = (key: (r: (typeof rows)[number]) => string) => {
        const m = new Map<string, { name: string; units: number; purchaseValue: number; saleValue: number }>();
        for (const r of rows) { const k = key(r); const v = m.get(k) ?? { name: k, units: 0, purchaseValue: 0, saleValue: 0 }; v.units += r.units; v.purchaseValue += r.pv; v.saleValue += r.sv; m.set(k, v); }
        return [...m.values()].map((v) => ({ ...v, purchaseValue: showCost ? Math.round(v.purchaseValue) : null, saleValue: Math.round(v.saleValue) })).sort((a, b) => (b.purchaseValue ?? b.saleValue) - (a.purchaseValue ?? a.saleValue));
      };
      const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
      return {
        canSeeCost: showCost,
        scopeNote: null as string | null, // aucune mention des restrictions : l'agent voit simplement la valeur de ce qu'il a le droit de voir
        total: { units: sum((r) => r.units), products: rows.length ? Math.max(...rows.map((r) => r.prods)) : 0, purchaseValue: showCost ? Math.round(sum((r) => r.pv)) : null, saleValue: Math.round(sum((r) => r.sv)), potentialMargin: showCost ? Math.round(sum((r) => r.sv - r.pv)) : null },
        byCategory: group((r) => r.cat).slice(0, 40),
        byDepot: group((r) => depotName(r.depot)),
        byLocation: group((r) => r.loc).slice(0, 40),
        byVat: group((r) => (r.vat ? `TVA ${r.vat} %` : 'Exonéré')),
        byLaboratory: group((r) => r.lab).slice(0, 15),
        byStorage: group((r) => STORAGE[r.storage] ?? r.storage),
        expiry: { expiredUnits: ex[0]?.expired_units ?? 0, expiredValue: showCost ? Math.round(ex[0]?.expired_pv ?? 0) : null, soonUnits: ex[0]?.soon_units ?? 0, soonValue: showCost ? Math.round(ex[0]?.soon_pv ?? 0) : null },
      };
    });
  }

  /** Depots visibles par le role, avec la valeur et le nombre d'unites en stock. Le depot de vente a pour id 'main'. */
  async depots(tenantId: string, roleId?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const sc = roleId ? await scopeOf(tx, roleId) : { rates: null, suppliers: null, depots: null };
      const ids = await visibleProductIds(tx, sc);
      const rows = await tx.depot.findMany({ orderBy: { name: 'asc' } });
      const totals = await tx.$queryRaw<{ depot: string | null; units: number; value: number }[]>`
        SELECT m.depot_id::text AS depot, COALESCE(SUM(m.quantity),0)::int AS units, COALESCE(SUM(m.quantity * p.purchase_price),0)::bigint::int AS value
        FROM inventory_movements m JOIN products p ON p.id = m.product_id
        WHERE (${ids}::uuid[] IS NULL OR p.id = ANY(${ids}::uuid[]))
        GROUP BY m.depot_id`;
      const t = (id: string | null) => totals.find((x) => x.depot === id) ?? { units: 0, value: 0 };
      const all = [{ id: 'main', name: 'Comptoir / rayons', kind: 'vente', note: 'Dépôt de vente : la caisse prélève ici', isActive: true, ...t(null) }, ...rows.map((d) => ({ ...d, ...t(d.id) }))];
      return sc.depots ? all.filter((d) => sc.depots!.includes(d.id)) : all;
    });
  }

  async saveDepot(user: AuthenticatedUser, body: { id?: string; name: string; kind?: string; note?: string; isActive?: boolean }) {
    const name = String(body.name ?? '').trim().slice(0, 60);
    if (name.length < 2) throw new BadRequestException('Nom du dépôt requis');
    const data = { name, kind: body.kind === 'vente_annexe' ? 'vente_annexe' : 'reserve', note: body.note?.slice(0, 200) || null, ...(body.isActive !== undefined ? { isActive: !!body.isActive } : {}) };
    try {
      return await this.prisma.forTenant(user.tenantId, (tx) => (body.id ? tx.depot.update({ where: { id: body.id }, data }) : tx.depot.create({ data: { ...data, tenantId: user.tenantId } })));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Un dépôt porte déjà ce nom');
      throw e;
    }
  }

  /** Transfert d'un lot entre depots ('main' = comptoir). Deux mouvements de signe oppose, meme reference. */
  async transfer(user: AuthenticatedUser, body: { productId: string; lotId?: string | null; from: string; to: string; quantity: number; note?: string }) {
    const qty = Math.trunc(Number(body.quantity));
    if (!(qty > 0)) throw new BadRequestException('Quantité invalide');
    if (body.from === body.to) throw new BadRequestException('Dépôts de départ et d’arrivée identiques');
    const dep = (x: string) => (x === 'main' ? null : x);
    const ref = randomUUID();
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      for (const d of [body.from, body.to]) if (d !== 'main' && !(await tx.depot.findFirst({ where: { id: d, isActive: true } }))) throw new NotFoundException('Dépôt introuvable');
      await this.lockProducts(tx, [body.productId]);
      const avail = (await tx.inventoryMovement.aggregate({ where: { productId: body.productId, lotId: body.lotId ?? null, depotId: dep(body.from) }, _sum: { quantity: true } }))._sum.quantity ?? 0;
      if (avail < qty) throw new BadRequestException(`Stock insuffisant dans le dépôt de départ (${avail})`);
      const reason = body.note?.slice(0, 200) || 'Transfert entre dépôts';
      for (const [d, q] of [[dep(body.from), -qty], [dep(body.to), qty]] as const) {
        await tx.inventoryMovement.create({ data: { tenantId: user.tenantId, productId: body.productId, lotId: body.lotId ?? null, depotId: d, quantity: q, type: 'transfer', refType: 'transfer', refId: ref, reason, createdById: user.userId } });
      }
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'stock.transferred', entityType: 'product', entityId: body.productId, metadata: { from: body.from, to: body.to, quantity: qty, lotId: body.lotId ?? null } });
    return { ok: true, ref };
  }

  // ---------------------------------------------------------------------------------------------
  // Ecriture
  // ---------------------------------------------------------------------------------------------

  // ---------------------------------------------------------------------------------------------
  // Destruction des produits périmés + procès-verbal
  // ---------------------------------------------------------------------------------------------

  /**
   * Détruit des lots périmés : sortie de stock (mise au rebut) et procès-verbal numéroté, signé du pharmacien connecté,
   * à imprimer en 3 exemplaires (direction départementale de la santé, comptabilité, archive).
   */
  async destroy(user: AuthenticatedUser, body: { lots: { lotId: string; quantity?: number; cause?: string }[]; method?: string; witness?: string; note?: string }) {
    const asked = (Array.isArray(body.lots) ? body.lots : []).slice(0, 200);
    if (!asked.length) throw new BadRequestException('Choisissez au moins un lot à détruire.');
    const { number, items, signer } = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const number = await nextNumber(tx, user.tenantId, 'PV');
      const items: { productId: string; lotId: string; name: string; lotNumber: string; expiryDate: string | null; quantity: number; unitCost: number; value: number; cause: string }[] = [];
      for (const a of asked) {
        const lot = await tx.lot.findUnique({ where: { id: a.lotId }, include: { product: true } });
        if (!lot) throw new NotFoundException('Lot introuvable');
        const balance = await this.lotBalance(tx, lot.id);
        const qty = Math.min(balance, Math.max(1, Math.round(Number(a.quantity) || balance)));
        if (qty <= 0) continue;
        const cause = ['perime', 'avarie', 'casse', 'autre'].includes(a.cause ?? '') ? (a.cause as string) : 'perime';
        if (cause === 'perime' && lot.expiryDate && lot.expiryDate > new Date()) throw new BadRequestException(`Le lot ${lot.lotNumber} de « ${lot.product.name} » n'est pas encore périmé : choisissez le motif « avarié » ou « cassé » pour le sortir.`);
        items.push({ productId: lot.productId, lotId: lot.id, name: lot.product.name, lotNumber: lot.lotNumber, expiryDate: lot.expiryDate ? lot.expiryDate.toISOString().slice(0, 10) : null, quantity: qty, unitCost: lot.product.purchasePrice, value: qty * lot.product.purchasePrice, cause });
      }
      if (!items.length) throw new BadRequestException('Aucune quantité à détruire dans les lots choisis.');
      const signer = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true, signature: true } });
      return { number, items, signer };
    });
    // sortie de stock de chaque lot (mise au rebut), rattachée au procès-verbal
    for (const it of items) await this.adjust(user.tenantId, { productId: it.productId, lotId: it.lotId, quantity: -it.quantity, type: it.cause === 'perime' ? 'expiry_writeoff' : 'loss', reason: `Destruction (${it.cause}) - procès-verbal ${number}` } as never, user);
    const rec = await this.prisma.forTenant(user.tenantId, (tx) => tx.destruction.create({ data: { tenantId: user.tenantId, number, items: items as unknown as Prisma.InputJsonValue, totalValue: items.reduce((s, i) => s + i.value, 0), method: (body.method ?? '').trim().slice(0, 120) || null, witness: (body.witness ?? '').trim().slice(0, 120) || null, notes: (body.note ?? '').trim().slice(0, 300) || null, pharmacistId: user.userId, pharmacistName: signer?.fullName ?? null, signature: signer?.signature ?? null } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'stock.destroyed', entityType: 'destruction', entityId: rec.id, metadata: { number, lots: items.length, value: rec.totalValue } });
    return rec;
  }

  async destructions(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.destruction.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, number: true, createdAt: true, totalValue: true, pharmacistName: true, items: true, method: true, witness: true, notes: true, signature: true, reason: true } }));
  }

  /** Ajustement manuel (casse, perte, peremption, inventaire) : motif obligatoire, journalise. */
  async adjust(tenantId: string, dto: AdjustStockDto, user: AuthenticatedUser) {
    const movement = await this.prisma.forTenant(tenantId, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new NotFoundException('Produit introuvable');
      await this.lockProducts(tx, [product.id]);

      if (product.trackLots && !dto.lotId) {
        throw new BadRequestException('Indiquez le lot concerne (produit gere par lot).');
      }
      if (dto.lotId) {
        const lot = await tx.lot.findUnique({ where: { id: dto.lotId } });
        if (!lot || lot.productId !== product.id) throw new NotFoundException('Lot introuvable pour ce produit');
        if (dto.quantity < 0 && (await this.lotBalance(tx, lot.id)) < -dto.quantity) {
          throw new ConflictException('Quantite superieure au stock du lot');
        }
      }
      if (dto.type !== 'adjustment' && dto.quantity > 0) {
        throw new BadRequestException('Une perte ou une mise au rebut est une quantite negative.');
      }
      const mv = await this.addMovement(tx, {
        tenantId,
        productId: product.id,
        lotId: dto.lotId,
        quantity: dto.quantity,
        type: dto.type as MovementType,
        reason: dto.reason,
        refType: 'adjustment',
        idempotencyKey: dto.idempotencyKey,
        createdById: user.userId,
      });
      await emit(tx, tenantId, 'stock.adjusted', { movementId: mv.id, productId: product.id, quantity: dto.quantity, unitCost: product.purchasePrice, reason: dto.reason, date: new Date().toISOString() });
      return mv;
    });
    await this.auditLog.record({
      tenantId,
      userId: user.userId,
      action: 'stock.adjusted',
      entityType: 'inventory_movement',
      entityId: movement.id,
      metadata: { productId: dto.productId, lotId: dto.lotId ?? null, quantity: dto.quantity, type: dto.type, reason: dto.reason },
    });
    return movement;
  }

  /**
   * Validation d'un lot a faible confiance. Regle du second role (ARCHITECTURE.md section 17) : la personne qui
   * a saisi/scanne le lot ne peut jamais le valider elle-meme.
   */
  async validateLot(tenantId: string, lotId: string, dto: ValidateLotDto, user: AuthenticatedUser) {
    const lot = await this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.lot.findUnique({ where: { id: lotId } });
      if (!current) throw new NotFoundException('Lot introuvable');
      if (current.status !== 'pending_review') throw new ConflictException('Ce lot n\'est pas en attente de validation');
      if (current.createdById && current.createdById === user.userId) {
        throw new ForbiddenException('Un autre professionnel doit valider ce lot (jamais la personne qui l\'a scanne).');
      }
      return tx.lot.update({
        where: { id: lotId },
        data: {
          status: dto.action === 'block' ? 'blocked' : 'available',
          validatedById: user.userId,
          ...(dto.expiryDate ? { expiryDate: new Date(dto.expiryDate) } : {}),
          ...(dto.lotNumber ? { lotNumber: dto.lotNumber } : {}),
        },
      });
    });
    await this.auditLog.record({
      tenantId,
      userId: user.userId,
      action: dto.action === 'block' ? 'stock.lot_blocked' : 'stock.lot_validated',
      entityType: 'lot',
      entityId: lotId,
      metadata: { expiryDate: dto.expiryDate ?? null, lotNumber: dto.lotNumber ?? null },
    });
    return lot;
  }

  async pendingLots(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.lot.findMany({
        where: { status: 'pending_review' },
        include: { product: { select: { name: true, sku: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }
}
