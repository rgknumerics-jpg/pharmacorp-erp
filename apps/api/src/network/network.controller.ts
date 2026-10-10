import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CreateTransferRequestInput, NetworkService } from './network.service';

@ApiTags('network')
@ApiBearerAuth()
@Controller('network')
export class NetworkController {
  constructor(private readonly network: NetworkService) {}

  @Get('settings')
  @RequirePermissions('tenant.manage')
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.network.settings(user.tenantId);
  }

  @Put('settings')
  @RequirePermissions('tenant.manage')
  setCode(@CurrentUser() user: AuthenticatedUser, @Body() body: { networkCode: string | null }) {
    return this.network.setNetworkCode(user.tenantId, body?.networkCode ?? null);
  }

  @Get('stock')
  @RequirePermissions('purchases.read')
  findStock(@CurrentUser() user: AuthenticatedUser, @Query('q') q: string) {
    return this.network.findStock(user.tenantId, q ?? '');
  }

  @Get('requests')
  @RequirePermissions('purchases.read')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.network.list(user.tenantId);
  }

  @Post('requests')
  @RequirePermissions('purchases.write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTransferRequestInput) {
    return this.network.create(user, dto);
  }

  @Post('requests/:id/accept')
  @RequirePermissions('purchases.write')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.network.respond(user, id, 'accept');
  }

  @Post('requests/:id/reject')
  @RequirePermissions('purchases.write')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.network.respond(user, id, 'reject');
  }

  @Post('requests/:id/ship')
  @RequirePermissions('purchases.write')
  ship(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.network.ship(user, id);
  }

  @Post('requests/:id/receive')
  @RequirePermissions('purchases.write')
  receive(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.network.receive(user, id);
  }

  @Post('requests/:id/cancel')
  @RequirePermissions('purchases.write')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.network.cancel(user, id);
  }
}
