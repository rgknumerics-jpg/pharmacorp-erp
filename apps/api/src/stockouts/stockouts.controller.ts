import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { StockoutsService } from './stockouts.service';

/** Journal des ruptures (ARCHITECTURE.md -- Achats) : vu par les roles qui achetent. */
@ApiTags('stockouts')
@ApiBearerAuth()
@Controller('stockouts')
export class StockoutsController {
  constructor(private readonly stockouts: StockoutsService) {}

  @Get()
  @RequirePermissions('stock.read')
  @ApiOkResponse({ description: 'Journal des ruptures du tenant courant, le plus recent en premier.' })
  list(@CurrentUser() user: AuthenticatedUser, @Query('take') take?: string, @Query('skip') skip?: string) {
    return this.stockouts.list(user.tenantId, Math.min(take ? Number(take) : 100, 500), skip ? Number(skip) : 0);
  }

  @Get('summary')
  @RequirePermissions('stock.read')
  @ApiOkResponse({ description: 'Produits les plus recherches en rupture sur la periode, du plus demande au moins demande.' })
  summary(@CurrentUser() user: AuthenticatedUser, @Query('days') days?: string) {
    return this.stockouts.summary(user.tenantId, days ? Number(days) : 30);
  }
}
