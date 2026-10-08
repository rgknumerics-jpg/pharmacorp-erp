import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { AddPaymentsDto, ConfirmPaymentDto, CreateSaleDto, VoidSaleDto } from './dto/sales.dto';
import { SalesStatsService } from './sales-stats.service';
import { SalesService } from './sales.service';
import { TicketLineInput, TicketsService } from './tickets.service';

/** Vendeur (sales.ticket) ou caissière (sales.create) : l'un des deux suffit pour les tickets. */
function seller(u: AuthenticatedUser) {
  if (!u.permissions.includes('sales.ticket') && !u.permissions.includes('sales.create')) throw new ForbiddenException('Permission manquante : saisir une vente (vendeur) ou encaisser (caisse).');
}

@ApiTags('sales')
@ApiBearerAuth()
@Controller()
export class SalesController {
  constructor(private readonly sales: SalesService, private readonly stats: SalesStatsService, private readonly tickets: TicketsService) {}

  @Get('sales')
  @RequirePermissions('sales.read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('kind') kind?: string,
    @Query('customer') customer?: string,
    @Query('method') method?: string,
    @Query('seller') sellerId?: string,
    @Query('take', new ParseIntPipe({ optional: true })) take = 50,
    @Query('skip', new ParseIntPipe({ optional: true })) skip = 0,
  ) {
    return this.sales.list(user.tenantId, { from, to, status, q, kind, customer, method, seller: sellerId, take: Math.min(take, 500), skip, roleId: user.roleId });
  }

  // --- Statistiques de vente (avant « sales/:id » pour ne pas être prises pour un identifiant)
  @Get('sales/stats/catalog')
  @RequirePermissions('sales.read')
  statCatalog(@CurrentUser() user: AuthenticatedUser) { return this.stats.catalog(user); }

  @Get('sales/stats-overview') @RequirePermissions('sales.read')
  statOverview(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const today = new Date().toISOString().slice(0, 10);
    const t = ok(to) ?? today, f = ok(from) ?? new Date(new Date(`${t}T00:00:00Z`).getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
    return this.stats.overview(user, f, t);
  }

  @Get('sales/stats/:report')
  @RequirePermissions('sales.read')
  statRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('report') report: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('customerId') customerId?: string,
    @Query('min') min?: string,
    @Query('order') order?: string,
    @Query('kind') kind?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 500,
  ) {
    const day = (s: string | undefined, def: Date, end = false) => { const d = s && /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(`${s.slice(0, 10)}T00:00:00+01:00`) : def; if (end && s) d.setDate(d.getDate() + 1); return d; };
    const today = new Date(`${new Date(Date.now() + 3600_000).toISOString().slice(0, 10)}T00:00:00+01:00`);
    const f = day(from, today);
    const t = to ? day(to, f, true) : new Date(Math.max(+f, +today) + 86_400_000);
    return this.stats.run(user, report, { from: f, to: t, customerId, min: min !== undefined && min !== '' ? Number(min) : undefined, order, kind, limit });
  }

  // --- Tickets vendeur -> caisse
  @Post('tickets')
  createTicket(@CurrentUser() user: AuthenticatedUser, @Body() body: { items: TicketLineInput[]; customerId?: string; note?: string }) { seller(user); return this.tickets.create(user, body); }

  @Get('tickets')
  listTickets(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) { seller(user); return this.tickets.list(user, ['open', 'paid', 'cancelled'].includes(status ?? '') ? status : 'open'); }

  @Get('tickets/:id')
  oneTicket(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { seller(user); return this.tickets.one(user, id); }

  @Post('tickets/:id/cancel')
  cancelTicket(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { reason?: string }) { seller(user); return this.tickets.cancel(user, id, body?.reason); }

  @Get('sales/:id')
  @RequirePermissions('sales.read')
  one(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.findOne(user.tenantId, id, user.roleId);
  }

  @Post('sales')
  @RequirePermissions('sales.create')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSaleDto) {
    return this.sales.create(user, dto);
  }

  @Post('sales/:id/payments')
  @RequirePermissions('sales.create')
  addPayments(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddPaymentsDto) {
    return this.sales.addMorePayments(user, id, dto);
  }

  @Post('sales/:id/void')
  @RequirePermissions('sales.void')
  voidSale(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSaleDto) {
    return this.sales.voidSale(user, id, dto.reason);
  }

  @Post('payments/:id/confirm')
  @RequirePermissions('sales.create')
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmPaymentDto) {
    return this.sales.confirmPayment(user, id, dto.reference);
  }

  @Post('payments/:id/fail')
  @RequirePermissions('sales.create')
  fail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.failPayment(user, id);
  }
}
