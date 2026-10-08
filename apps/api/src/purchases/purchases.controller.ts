import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CreatePurchaseOrderDto, CreateSupplierDto, ReceiveGoodsDto, UpdateSupplierDto } from './dto/purchases.dto';
import { PurchasesService } from './purchases.service';

@ApiTags('purchases')
@ApiBearerAuth()
@Controller()
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get('suppliers')
  @RequirePermissions('purchases.read')
  suppliers(@CurrentUser() user: AuthenticatedUser, @Query('q') q?: string) {
    return this.purchases.suppliers(user.tenantId, q);
  }

  @Post('suppliers')
  @RequirePermissions('purchases.write')
  createSupplier(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierDto) {
    return this.purchases.createSupplier(user.tenantId, dto);
  }

  @Patch('suppliers/:id')
  @RequirePermissions('purchases.write')
  updateSupplier(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.purchases.updateSupplier(user.tenantId, id, dto);
  }

  @Get('purchase-orders')
  @RequirePermissions('purchases.read')
  orders(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.purchases.orders(user.tenantId, status);
  }

  @Get('purchase-orders/:id')
  @RequirePermissions('purchases.read')
  order(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.order(user.tenantId, id);
  }

  @Post('purchase-orders')
  @RequirePermissions('purchases.write')
  createOrder(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchases.createOrder(user, dto);
  }

  @Post('purchase-orders/:id/send')
  @RequirePermissions('purchases.write')
  send(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.setOrderStatus(user, id, 'ordered');
  }

  @Post('purchase-orders/:id/cancel')
  @RequirePermissions('purchases.write')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.setOrderStatus(user, id, 'cancelled');
  }

  @Get('goods-receipts')
  @RequirePermissions('purchases.read')
  receipts(@CurrentUser() user: AuthenticatedUser) {
    return this.purchases.receipts(user.tenantId);
  }

  @Get('goods-receipts/:id')
  @RequirePermissions('purchases.read')
  receipt(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.purchases.receipt(user.tenantId, id);
  }

  @Post('goods-receipts')
  @RequirePermissions('purchases.write')
  receive(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReceiveGoodsDto) {
    return this.purchases.receive(user, dto);
  }
}
