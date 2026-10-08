import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { SfecService } from './sfec.service';

@ApiTags('sfec')
@ApiBearerAuth()
@Controller('sfec')
export class SfecController {
  constructor(private readonly sfec: SfecService) {}

  @Get('invoices') @RequirePermissions('sfec.read')
  list(@CurrentUser() u: AuthenticatedUser, @Query('status') status?: string) { return this.sfec.list(u.tenantId, status); }

  @Get('sales/:saleId') @RequirePermissions('sales.read')
  forSale(@CurrentUser() u: AuthenticatedUser, @Param('saleId', ParseUUIDPipe) saleId: string) { return this.sfec.forSale(u.tenantId, saleId); }

  @Post('process') @RequirePermissions('sfec.manage')
  process(@CurrentUser() u: AuthenticatedUser) { return this.sfec.processTenant(u.tenantId); }

  @Post('invoices/:id/retry') @RequirePermissions('sfec.manage')
  retry(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.sfec.retryNow(u, id); }
}