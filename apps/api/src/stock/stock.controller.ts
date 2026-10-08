import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { AdjustStockDto, ValidateLotDto } from './stock.dto';
import { StockService } from './stock.service';

@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  /** Valeur du stock et ventilations, selon le périmètre du rôle (TVA, fournisseurs, dépôts). Le prix d'achat exige le droit « cost.read ». */
  @Get('valuation') @RequirePermissions('stock.read')
  valuation(@CurrentUser() user: AuthenticatedUser) { return this.stock.valuation(user.tenantId, user.roleId, user.permissions.includes('cost.read')); }

  @Get('depots')
  @RequirePermissions('stock.read')
  depots(@CurrentUser() user: AuthenticatedUser) { return this.stock.depots(user.tenantId, user.roleId); }

  @Post('depots')
  @RequirePermissions('stock.write')
  createDepot(@CurrentUser() user: AuthenticatedUser, @Body() b: { name: string; kind?: string; note?: string }) { return this.stock.saveDepot(user, b); }

  @Put('depots/:id')
  @RequirePermissions('stock.write')
  updateDepot(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { name: string; kind?: string; note?: string; isActive?: boolean }) { return this.stock.saveDepot(user, { ...b, id }); }

  @Post('transfers')
  @RequirePermissions('stock.write')
  transfer(@CurrentUser() user: AuthenticatedUser, @Body() b: { productId: string; lotId?: string | null; from: string; to: string; quantity: number; note?: string }) { return this.stock.transfer(user, b); }

  @Get('levels')
  @RequirePermissions('stock.read')
  levels(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('lowOnly') lowOnly?: string,
    @Query('depot') depot?: string,
    @Query('take', new ParseIntPipe({ optional: true })) take = 50,
    @Query('skip', new ParseIntPipe({ optional: true })) skip = 0,
    @Query('sort') sort?: string,
  ) {
    return this.stock.levels(user.tenantId, { q, lowOnly: lowOnly === 'true', take: Math.min(take, 200), skip, roleId: user.roleId, depot, sort });
  }

  @Get('products/:productId/lots')
  @RequirePermissions('stock.read')
  lots(@CurrentUser() user: AuthenticatedUser, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.stock.lotsOfProduct(user.tenantId, productId, user.roleId);
  }

  @Get('expiring')
  @RequirePermissions('stock.read')
  expiring(@CurrentUser() user: AuthenticatedUser, @Query('days', new ParseIntPipe({ optional: true })) days = 90) {
    return this.stock.expiring(user.tenantId, Math.min(Math.max(days, 0), 730));
  }

  @Get('pending-lots')
  @RequirePermissions('stock.validate_lot')
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.stock.pendingLots(user.tenantId);
  }

  @Get('movements')
  @RequirePermissions('stock.read')
  movements(
    @CurrentUser() user: AuthenticatedUser,
    @Query('productId') productId?: string,
    @Query('take', new ParseIntPipe({ optional: true })) take = 50,
    @Query('skip', new ParseIntPipe({ optional: true })) skip = 0,
  ) {
    return this.stock.movements(user.tenantId, productId, Math.min(take, 200), skip, user.roleId);
  }

  /** Destruction de lots périmés : sortie de stock + procès-verbal (3 exemplaires à imprimer). */
  @Post('destructions') @RequirePermissions('stock.write')
  destroy(@CurrentUser() user: AuthenticatedUser, @Body() b: { lots: { lotId: string; quantity?: number; cause?: string }[]; method?: string; witness?: string; note?: string }) { return this.stock.destroy(user, b); }

  @Get('destructions') @RequirePermissions('stock.read')
  destructions(@CurrentUser() user: AuthenticatedUser) { return this.stock.destructions(user.tenantId); }

  @Post('adjustments')
  @RequirePermissions('stock.write')
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: AuthenticatedUser) {
    return this.stock.adjust(user.tenantId, dto, user);
  }

  @Post('lots/:lotId/review')
  @RequirePermissions('stock.validate_lot')
  review(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Body() dto: ValidateLotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stock.validateLot(user.tenantId, lotId, dto, user);
  }
}
