import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CreateAccountDto, ManualEntryDto, ReverseDto } from './accounting.dto';
import { AccountingService } from './accounting.service';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting')
export class AccountingController {
  constructor(private readonly acc: AccountingService) {}

  @Get('accounts') @RequirePermissions('accounting.read')
  accounts(@CurrentUser() u: AuthenticatedUser) { return this.acc.accounts(u.tenantId); }

  @Post('accounts') @RequirePermissions('accounting.write')
  createAccount(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateAccountDto) { return this.acc.createAccount(u, dto); }

  @Get('entries') @RequirePermissions('accounting.read')
  entries(
    @CurrentUser() u: AuthenticatedUser, @Query('journal') journal?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('take', new ParseIntPipe({ optional: true })) take = 100, @Query('skip', new ParseIntPipe({ optional: true })) skip = 0,
  ) { return this.acc.entries(u.tenantId, { journal, from, to, take: Math.min(take, 500), skip , roleId: u.roleId }); }

  @Post('entries') @RequirePermissions('accounting.write')
  manual(@CurrentUser() u: AuthenticatedUser, @Body() dto: ManualEntryDto) { return this.acc.manualEntry(u, dto); }

  @Post('entries/:id/reverse') @RequirePermissions('accounting.write')
  reverse(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseDto) { return this.acc.reverse(u, id, dto.reason); }

  @Get('ledger/:account') @RequirePermissions('accounting.read')
  ledger(@CurrentUser() u: AuthenticatedUser, @Param('account') account: string, @Query('from') from?: string, @Query('to') to?: string) { return this.acc.ledger(u.tenantId, account, from, to, u.roleId); }

  @Get('trial-balance') @RequirePermissions('accounting.read')
  balance(@CurrentUser() u: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) { return this.acc.trialBalance(u.tenantId, from, to, u.roleId); }

  @Get('statements') @RequirePermissions('accounting.read')
  statements(@CurrentUser() u: AuthenticatedUser, @Query('year', new ParseIntPipe({ optional: true })) year?: number) { return this.acc.statements(u.tenantId, year ?? new Date().getFullYear(), u.roleId); }

  @Get('reconciliation') @RequirePermissions('accounting.read')
  reconciliation(@CurrentUser() u: AuthenticatedUser) { return this.acc.reconciliation(u.tenantId); }

  @Get('outbox') @RequirePermissions('accounting.read')
  outbox(@CurrentUser() u: AuthenticatedUser) { return this.acc.outboxStatus(u.tenantId); }

  @Post('outbox/process') @RequirePermissions('accounting.write')
  process(@CurrentUser() u: AuthenticatedUser) { return this.acc.processTenant(u.tenantId); }

  @Post('outbox/retry-failed') @RequirePermissions('accounting.write')
  retry(@CurrentUser() u: AuthenticatedUser) { return this.acc.retryFailed(u); }
}