import { Body, Controller, Get, Headers, Ip, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { SalesModule } from '../sales/sales.module';
import { OnlineService } from './online.service';
import { PortalAuth } from './portal-auth';

/**
 * API publique de la pharmacie pour l'application client, le site web et l'application livreur.
 * Les clients et livreurs s'authentifient avec leurs propres jetons (jamais ceux du personnel).
 */
@ApiTags('online')
@Controller('online')
export class OnlineController {
  constructor(private readonly s: OnlineService) {}

  @Public() @Get(':slug/info') info(@Param('slug') slug: string) { return this.s.info(slug); }
  @Public() @Get(':slug/catalog') catalog(@Param('slug') slug: string, @Query('q') q?: string, @Query('category') category?: string, @Query('take') take?: string, @Query('skip') skip?: string) { return this.s.catalog(slug, q, category, take, skip); }

  // ---- client
  @Public() @Post(':slug/register') register(@Param('slug') slug: string, @Body() b: any, @Ip() ip: string) { return this.s.register(slug, b ?? {}, ip); }
  @Public() @Post(':slug/login') login(@Param('slug') slug: string, @Body() b: any, @Ip() ip: string) { return this.s.login(slug, b ?? {}, ip); }
  @Public() @Get(':slug/me') me(@Param('slug') slug: string, @Headers('authorization') a?: string) { return this.s.me(slug, a); }
  @Public() @Get(':slug/orders') orders(@Param('slug') slug: string, @Headers('authorization') a?: string) { return this.s.myOrders(slug, a); }
  @Public() @Post(':slug/orders') order(@Param('slug') slug: string, @Body() b: any, @Headers('authorization') a?: string) { return this.s.createOrder(slug, a, b ?? {}); }
  @Public() @Post(':slug/orders/:id/pay') pay(@Param('slug') slug: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: { reference?: string }, @Headers('authorization') a?: string) { return this.s.declarePayment(slug, a, id, b?.reference ?? ''); }
  @Public() @Post(':slug/orders/:id/cancel') cancel(@Param('slug') slug: string, @Param('id', ParseUUIDPipe) id: string, @Headers('authorization') a?: string) { return this.s.cancelMine(slug, a, id); }
  @Public() @Get(':slug/notifications') notifs(@Param('slug') slug: string, @Headers('authorization') a?: string) { return this.s.notifications(slug, a, 'customer'); }
  @Public() @Post(':slug/notifications/read') notifsRead(@Param('slug') slug: string, @Headers('authorization') a?: string) { return this.s.notifications(slug, a, 'customer', true); }

  // ---- livreur
  @Public() @Post(':slug/courier/login') cLogin(@Param('slug') slug: string, @Body() b: any, @Ip() ip: string) { return this.s.courierLogin(slug, b ?? {}, ip); }
  @Public() @Get(':slug/courier/orders') cOrders(@Param('slug') slug: string, @Headers('authorization') a?: string) { return this.s.courierOrders(slug, a); }
  @Public() @Post(':slug/courier/orders/:id/status') cStatus(@Param('slug') slug: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: { status: string }, @Headers('authorization') a?: string) { return this.s.courierStatus(slug, a, id, b?.status); }
  @Public() @Get(':slug/courier/notifications') cNotifs(@Param('slug') slug: string, @Headers('authorization') a?: string) { return this.s.notifications(slug, a, 'courier'); }
  @Public() @Post(':slug/courier/notifications/read') cNotifsRead(@Param('slug') slug: string, @Headers('authorization') a?: string) { return this.s.notifications(slug, a, 'courier', true); }
}

/** Gestion des commandes en ligne et des livreurs par le personnel (ERP). */
@ApiTags('online-admin')
@Controller('online-orders')
export class OnlineAdminController {
  constructor(private readonly s: OnlineService) {}

  @Get() @RequirePermissions('online.manage') list(@CurrentUser() u: AuthenticatedUser, @Query('status') status?: string) { return this.s.list(u.tenantId, status); }
  @Get('summary') @RequirePermissions('online.manage') summary(@CurrentUser() u: AuthenticatedUser) { return this.s.summary(u.tenantId); }
  @Get('couriers') @RequirePermissions('online.manage') couriers(@CurrentUser() u: AuthenticatedUser) { return this.s.couriers(u.tenantId); }
  @Post('couriers') @RequirePermissions('online.manage') addCourier(@CurrentUser() u: AuthenticatedUser, @Body() b: any) { return this.s.saveCourier(u, null, b ?? {}); }
  @Patch('couriers/:id') @RequirePermissions('online.manage') editCourier(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: any) { return this.s.saveCourier(u, id, b ?? {}); }
  @Post(':id/accept') @RequirePermissions('online.manage') accept(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.s.accept(u, id); }
  @Post(':id/assign') @RequirePermissions('online.manage') assign(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { courierId?: string | null }) { return this.s.assign(u, id, b?.courierId ?? null); }
  @Post(':id/status') @RequirePermissions('online.manage') status(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { status: string; reason?: string }) { return this.s.setStatus(u, id, b?.status, b?.reason); }
  @Post(':id/confirm-payment') @RequirePermissions('online.manage') confirm(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.s.confirmPayment(u, id); }
}

@Module({ imports: [JwtModule.register({}), AuditLogModule, SalesModule], controllers: [OnlineController, OnlineAdminController], providers: [OnlineService, PortalAuth] })
export class OnlineModule {}
