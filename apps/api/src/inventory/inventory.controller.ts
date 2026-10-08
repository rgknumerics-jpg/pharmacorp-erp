import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/sessions')
export class InventoryController {
  constructor(private readonly i: InventoryService) {}
  @Get() @RequirePermissions('stock.read') list(@CurrentUser() u: AuthenticatedUser) { return this.i.sessions(u.tenantId); }
  @Post() @RequirePermissions('inventory.manage') open(@CurrentUser() u: AuthenticatedUser, @Body() b: { scope?: string; note?: string }) { return this.i.open(u, b.scope === 'partial' ? 'partial' : 'full', b.note?.slice(0, 300)); }
  /** Le comptage est ouvert a toute l'equipe du stock ; seule la validation est reservee. */
  @Post(':id/counts') @RequirePermissions('stock.read') count(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { productId: string; lotId?: string | null; counted: number }) { return this.i.count(u, id, String(b.productId), b.lotId ? String(b.lotId) : null, Number(b.counted)); }
  @Get(':id/report') @RequirePermissions('stock.read') report(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.i.report(u.tenantId, id); }
  @Post(':id/validate') @RequirePermissions('inventory.manage') validate(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.i.validate(u, id); }
  @Post(':id/cancel') @RequirePermissions('inventory.manage') cancel(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.i.cancel(u, id); }
}