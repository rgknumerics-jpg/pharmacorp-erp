import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

interface PromoInput { name: string; type: 'percent' | 'amount' | 'buy_x_get_y'; value?: number; buyQty?: number; freeQty?: number; productIds?: string[]; categoryIds?: string[]; startDate: string; endDate: string; isActive?: boolean }

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService, private readonly auditLog: AuditLogService) {}

  /** Promotions avec leur effet mesure (ventes concernees, remise accordee, CA et marge pendant la periode). */
  async list(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const promos = await tx.promotion.findMany({ orderBy: { startDate: 'desc' } });
      const out = [];
      for (const p of promos) {
        const [e] = await tx.$queryRaw<{ lines: number; discount: number; ca: number; margin: number }[]>`
          SELECT COUNT(*)::int AS lines, COALESCE(SUM(si.discount),0)::int AS discount, COALESCE(SUM(si.line_total),0)::int AS ca, COALESCE(SUM(si.line_total - si.unit_cost * si.quantity),0)::int AS margin
          FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.note = ${'Promotion : ' + p.name} AND s.status <> 'void'`;
        out.push({ ...p, effect: e });
      }
      return out;
    });
  }

  private check(i: PromoInput) {
    if (!i.name?.trim()) throw new BadRequestException('Nom requis');
    if (!['percent', 'amount', 'buy_x_get_y'].includes(i.type)) throw new BadRequestException('Type inconnu');
    if (i.type === 'percent' && !(i.value! > 0 && i.value! <= 100)) throw new BadRequestException('Pourcentage entre 1 et 100');
    if (i.type === 'amount' && !(i.value! > 0)) throw new BadRequestException('Montant de remise requis');
    if (i.type === 'buy_x_get_y' && !(i.buyQty! > 0 && i.freeQty! > 0)) throw new BadRequestException('Indiquez « x achetés » et « y offerts »');
    if (new Date(i.endDate) < new Date(i.startDate)) throw new BadRequestException('La fin précède le début');
  }

  async create(user: AuthenticatedUser, i: PromoInput) {
    this.check(i);
    const p = await this.prisma.forTenant(user.tenantId, (tx) => tx.promotion.create({ data: { tenantId: user.tenantId, name: i.name.slice(0, 100), type: i.type, value: Math.round(i.value ?? 0), buyQty: i.buyQty ?? 0, freeQty: i.freeQty ?? 0, productIds: i.productIds ?? [], categoryIds: i.categoryIds ?? [], startDate: new Date(i.startDate), endDate: new Date(i.endDate) } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'promotions.created', entityType: 'promotion', entityId: p.id, metadata: { name: p.name, type: p.type } });
    return p;
  }

  async update(user: AuthenticatedUser, id: string, i: Partial<PromoInput>) {
    const p = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const cur = await tx.promotion.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException('Promotion introuvable');
      return tx.promotion.update({ where: { id }, data: { ...(i.isActive !== undefined ? { isActive: i.isActive } : {}), ...(i.endDate ? { endDate: new Date(i.endDate) } : {}) } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'promotions.updated', entityType: 'promotion', entityId: id, metadata: { ...i } });
    return p;
  }

  async loyalty(tenantId: string) {
    const p = await this.prisma.forTenant(tenantId, async (tx) => (await tx.companyProfile.findUnique({ where: { tenantId } })) ?? tx.companyProfile.create({ data: { tenantId } }));
    const [s] = await this.prisma.forTenant(tenantId, (tx) => tx.$queryRaw<{ members: number; points: number; credit: number }[]>`SELECT COUNT(*) FILTER (WHERE loyalty_points > 0)::int AS members, COALESCE(SUM(loyalty_points),0)::int AS points, COALESCE(SUM(store_credit),0)::int AS credit FROM customers`);
    return { enabled: p.loyaltyEnabled, spendPerPoint: p.loyaltySpendPerPoint, pointValue: p.loyaltyPointValue, ...s, liability: (s?.points ?? 0) * p.loyaltyPointValue };
  }

  async setLoyalty(user: AuthenticatedUser, b: { enabled: boolean; spendPerPoint: number; pointValue: number }) {
    if (!(b.spendPerPoint >= 100) || !(b.pointValue >= 1)) throw new BadRequestException('Paramètres invalides');
    await this.prisma.forTenant(user.tenantId, (tx) => tx.companyProfile.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, loyaltyEnabled: !!b.enabled, loyaltySpendPerPoint: Math.round(b.spendPerPoint), loyaltyPointValue: Math.round(b.pointValue) }, update: { loyaltyEnabled: !!b.enabled, loyaltySpendPerPoint: Math.round(b.spendPerPoint), loyaltyPointValue: Math.round(b.pointValue) } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'promotions.loyalty_settings', entityType: 'company_profile', metadata: b });
    return this.loyalty(user.tenantId);
  }

  async active(tenantId: string) {
    const today = new Date(new Date().toISOString().slice(0, 10));
    return this.prisma.forTenant(tenantId, (tx) => tx.promotion.findMany({ where: { isActive: true, startDate: { lte: today }, endDate: { gte: today } } }));
  }
}

@ApiTags('promotions')
@ApiBearerAuth()
@Controller()
export class PromotionsController {
  constructor(private readonly p: PromotionsService) {}
  @Get('promotions') @RequirePermissions('products.read') list(@CurrentUser() u: AuthenticatedUser) { return this.p.list(u.tenantId); }
  @Get('promotions/active') @RequirePermissions('sales.create') active(@CurrentUser() u: AuthenticatedUser) { return this.p.active(u.tenantId); }
  @Post('promotions') @RequirePermissions('promotions.manage') create(@CurrentUser() u: AuthenticatedUser, @Body() b: PromoInput) { return this.p.create(u, b); }
  @Patch('promotions/:id') @RequirePermissions('promotions.manage') update(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: Partial<PromoInput>) { return this.p.update(u, id, b); }
  @Get('loyalty') @RequirePermissions('customers.read') loyalty(@CurrentUser() u: AuthenticatedUser) { return this.p.loyalty(u.tenantId); }
  @Put('loyalty') @RequirePermissions('promotions.manage') setLoyalty(@CurrentUser() u: AuthenticatedUser, @Body() b: { enabled: boolean; spendPerPoint: number; pointValue: number }) { return this.p.setLoyalty(u, b); }
}

@Module({ imports: [AuditLogModule], controllers: [PromotionsController], providers: [PromotionsService] })
export class PromotionsModule {}