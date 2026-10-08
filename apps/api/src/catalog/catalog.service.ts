import { scopeOf, visibleProductIds } from '../common/vat-scope';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, CreateProductDto, UpdateProductDto } from './dto/product.dto';

type ProductRow = Prisma.ProductGetPayload<object>;

/** Les prix d'achat (donnee sensible) ne sortent du serveur que pour un role portant `cost.read` (ARCHITECTURE.md section 7). */
export function serializeProduct(p: ProductRow, user: Pick<AuthenticatedUser, 'permissions'>) {
  const { purchasePrice, ...rest } = p;
  return user.permissions.includes('cost.read') ? { ...rest, purchasePrice } : rest;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Recherche multi-mots, mots non terminés acceptés : « safo pa » retrouve « Saforelle Pain » (chaque mot doit commencer ou figurer
   * dans le nom, la DCI ou le code). Les mots qui commencent un mot du nom passent en premier.
   * withStock : ajoute le stock vendable au comptoir (et marque les produits détaillables).
   */
  async search(user: AuthenticatedUser, q: string | undefined, take: number, skip: number, includeInactive: boolean, withStock = false) {
    const term = q?.trim();
    const words = (term ?? '').split(/\s+/).filter(Boolean).slice(0, 6);
    const rows = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const ids = await visibleProductIds(tx, await scopeOf(tx, user.roleId));
      const found = await tx.product.findMany({
        where: {
          ...(ids ? { id: { in: ids } } : {}),
          ...(includeInactive ? {} : { isActive: true }),
          ...(words.length
            ? { OR: [{ barcode: { equals: term } }, { AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: 'insensitive' as const } }, { dci: { contains: w, mode: 'insensitive' as const } }, { sku: { contains: w, mode: 'insensitive' as const } }] })) }] }
            : {}),
        },
        orderBy: { name: 'asc' },
        take: words.length > 1 ? Math.min(400, (take + skip) * 6) : take,
        skip: words.length > 1 ? 0 : skip,
      });
      let list = found;
      if (words.length > 1) {
        const starts = (name: string, w: string) => name.toLowerCase().split(/[^a-z0-9àâäéèêëîïôöùûüç]+/).some((x) => x.startsWith(w.toLowerCase()));
        const score = (p: { name: string }) => words.reduce((s, w) => s + (starts(p.name, w) ? 2 : 1), 0);
        list = [...found].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name)).slice(skip, skip + take);
      }
      let stock = new Map<string, number>(), detail = new Set<string>();
      if (withStock && list.length) {
        const pid = list.map((p) => p.id);
        const rowsS = await tx.$queryRaw<{ pid: string; q: number }[]>`SELECT product_id AS pid, SUM(quantity)::int AS q FROM inventory_movements WHERE product_id = ANY(${pid}::uuid[]) AND depot_id IS NULL GROUP BY product_id`;
        stock = new Map(rowsS.map((r) => [r.pid, r.q]));
        const parents = await tx.product.findMany({ where: { unitProductId: { in: pid } }, select: { unitProductId: true } });
        detail = new Set(parents.map((x) => x.unitProductId as string));
      }
      return list.map((p) => ({ p, stock: withStock ? stock.get(p.id) ?? 0 : undefined, detail: withStock ? !!(p.unitsPerBox && p.unitsPerBox > 1) || detail.has(p.id) : undefined }));
    });
    return rows.map((r) => ({ ...serializeProduct(r.p, user), ...(r.stock !== undefined ? { stock: r.stock, detail: r.detail } : {}) }));
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const p = await this.prisma.forTenant(user.tenantId, (tx) => tx.product.findUnique({ where: { id } }));
    if (!p) throw new NotFoundException('Produit introuvable');
    return serializeProduct(p, user);
  }

  async findByBarcode(user: AuthenticatedUser, code: string) {
    const p = await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.product.findFirst({ where: { OR: [{ barcode: code }, { sku: code }], isActive: true } }),
    );
    if (!p) throw new NotFoundException('Aucun produit pour ce code');
    return serializeProduct(p, user);
  }

  async create(user: AuthenticatedUser, dto: CreateProductDto) {
    try {
      const p = await this.prisma.forTenant(user.tenantId, (tx) =>
        tx.product.create({ data: { ...dto, tenantId: user.tenantId } }),
      );
      await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'products.created', entityType: 'product', entityId: p.id, metadata: { sku: p.sku, name: p.name } });
      return serializeProduct(p, user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Un produit avec ce code (SKU) existe deja');
      }
      throw e;
    }
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateProductDto) {
    try {
      let before: { salePrice: number; purchasePrice: number; vatRate: number; priceFree: boolean } | null = null;
      const p = await this.prisma.forTenant(user.tenantId, async (tx) => {
        const exists = await tx.product.findUnique({ where: { id } });
        if (!exists) throw new NotFoundException('Produit introuvable');
        before = { salePrice: exists.salePrice, purchasePrice: exists.purchasePrice, vatRate: exists.vatRate, priceFree: exists.priceFree };
        return tx.product.update({ where: { id }, data: dto });
      });
      const sensitive = ['salePrice', 'purchasePrice', 'vatRate', 'priceFree'].filter((k) => k in dto);
      await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: sensitive.length ? 'products.price_changed' : 'products.updated', entityType: 'product', entityId: id, metadata: { ...dto, before } });
      return serializeProduct(p, user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Un produit avec ce code (SKU) existe deja');
      }
      throw e;
    }
  }

  categories(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.category.findMany({ orderBy: { name: 'asc' } }));
  }

  async createCategory(tenantId: string, dto: CreateCategoryDto) {
    try {
      return await this.prisma.forTenant(tenantId, (tx) => tx.category.create({ data: { name: dto.name, tenantId } }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Categorie deja existante');
      throw e;
    }
  }
}
