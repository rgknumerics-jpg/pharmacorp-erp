import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, CreditRepaymentDto, UpdateCustomerDto } from './dto/customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.read')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('take', new ParseIntPipe({ optional: true })) take = 30,
    @Query('skip', new ParseIntPipe({ optional: true })) skip = 0,
  ) {
    return this.customers.search(user.tenantId, q, Math.min(take, 200), skip);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  one(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.findOne(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('customers.write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('customers.write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(user, id, dto);
  }

  @Post(':id/repayments')
  @RequirePermissions('customers.collect')
  repay(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreditRepaymentDto) {
    return this.customers.repay(user, id, dto);
  }
}
