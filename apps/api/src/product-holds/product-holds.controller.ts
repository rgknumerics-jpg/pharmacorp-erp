import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CreateProductHoldInput, ProductHoldsService } from './product-holds.service';

@ApiTags('product-holds')
@ApiBearerAuth()
@Controller('product-holds')
export class ProductHoldsController {
  constructor(private readonly holds: ProductHoldsService) {}

  @Get()
  @RequirePermissions('sales.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.holds.list(user.tenantId, status);
  }

  @Post()
  @RequirePermissions('sales.hold')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductHoldInput) {
    return this.holds.create(user, dto);
  }

  @Post(':id/fulfill')
  @RequirePermissions('sales.hold')
  fulfill(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.holds.fulfill(user, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('sales.hold')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.holds.cancel(user, id);
  }
}
