import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CashClosingDto, GardeDto, PayInvoiceDto, SupplierInvoiceDto, UpdateInvoiceDueDto } from './analytics.dto';
import { AnalyticsService } from './analytics.service';
import { PurchasingService } from './purchasing.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(private readonly a: AnalyticsService, private readonly p: PurchasingService) {}

  @Get('analytics/cockpit') @RequirePermissions('analytics.read')
  cockpit(@CurrentUser() u: AuthenticatedUser) { return this.a.cockpit(u.tenantId, u.roleId); }

  @Get('analytics/insights') @RequirePermissions('analytics.read')
  insights(@CurrentUser() u: AuthenticatedUser) { return this.a.insights(u.tenantId); }

  @Get('analytics/risks') @RequirePermissions('analytics.read')
  risks(@CurrentUser() u: AuthenticatedUser) { return this.a.risks(u.tenantId); }

  @Get('analytics/reorder') @RequirePermissions('purchases.read')
  reorder(@CurrentUser() u: AuthenticatedUser) { return this.a.reorder(u.tenantId); }

  @Get('analytics/finance') @RequirePermissions('analytics.read')
  finance(@CurrentUser() u: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    return this.a.finance(u.tenantId, from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1), to ? new Date(to) : new Date(now.getTime() + 86_400_000));
  }

  @Get('analytics/suppliers') @RequirePermissions('purchases.read')
  suppliers(@CurrentUser() u: AuthenticatedUser) { return this.a.suppliersAnalysis(u.tenantId); }

  @Get('analytics/price-history/:productId') @RequirePermissions('purchases.read')
  priceHistory(@CurrentUser() u: AuthenticatedUser, @Param('productId', ParseUUIDPipe) productId: string) { return this.a.priceHistory(u.tenantId, productId); }

  @Post('cash/closings') @RequirePermissions('sales.create')
  closing(@CurrentUser() u: AuthenticatedUser, @Body() dto: CashClosingDto) { return this.a.cashClosing(u.tenantId, u.userId, dto.counted, dto.note); }

  @Get('analytics/proposals') @RequirePermissions('purchases.read')
  proposals(@CurrentUser() u: AuthenticatedUser, @Query('mode') mode = 'month', @Query('date') date?: string, @Query('to') to?: string, @Query('horizon') horizon?: string) { return this.p.proposals(u.tenantId, ['day', 'month', 'season', 'garde'].includes(mode) ? mode : 'month', { date, to, horizon: horizon ? Number(horizon) : undefined }); }

  @Post('analytics/proposals/orders') @RequirePermissions('purchases.write')
  proposalOrders(@CurrentUser() u: AuthenticatedUser, @Body() b: { lines: { productId: string; quantity: number; supplierId?: string | null }[]; defaultSupplierId?: string | null }) { return this.p.ordersFromGroups(u, b?.lines ?? [], b?.defaultSupplierId); }

  @Post('analytics/reorder/orders') @RequirePermissions('purchases.write')
  orders(@CurrentUser() u: AuthenticatedUser, @Body() b: { supplierIds?: string[]; quantities?: Record<string, number> }) { return this.p.ordersFromProposal(u, b.supplierIds, b.quantities); }

  @Post('purchase-orders/from-lines') @RequirePermissions('purchases.write')
  fromLines(@CurrentUser() u: AuthenticatedUser, @Body() b: { supplierId: string; lines: { productId: string; quantity: number }[] }) { return this.p.orderFromLines(u, b.supplierId, b.lines); }

  @Get('purchase-orders/:id/message') @RequirePermissions('purchases.read')
  message(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.p.orderMessage(u.tenantId, id); }

  @Get('supplier-invoices') @RequirePermissions('purchases.read')
  invoices(@CurrentUser() u: AuthenticatedUser, @Query('status') status?: string) { return this.p.invoices(u.tenantId, status); }

  @Post('supplier-invoices') @RequirePermissions('purchases.write')
  createInvoice(@CurrentUser() u: AuthenticatedUser, @Body() dto: SupplierInvoiceDto) { return this.p.createInvoice(u, dto); }

  @Patch('supplier-invoices/:id') @RequirePermissions('purchases.write')
  due(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDueDto) { return this.p.setDueDate(u, id, dto.dueDate); }

  @Post('supplier-invoices/:id/payments') @RequirePermissions('purchases.write')
  pay(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayInvoiceDto) { return this.p.pay(u, id, dto); }

  @Get('garde-periods') @RequirePermissions('stock.read')
  gardes(@CurrentUser() u: AuthenticatedUser) { return this.p.gardes(u.tenantId); }

  @Post('garde-periods') @RequirePermissions('purchases.write')
  addGarde(@CurrentUser() u: AuthenticatedUser, @Body() dto: GardeDto) { return this.p.addGarde(u, dto); }

  @Delete('garde-periods/:id') @RequirePermissions('purchases.write')
  delGarde(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.p.deleteGarde(u, id); }
}