import { Body, Controller, Get, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { FilingDto } from './tax.dto';
import { TaxService } from './tax.service';

@ApiTags('tax')
@ApiBearerAuth()
@Controller('tax')
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Get('calendar') @RequirePermissions('tax.read')
  calendar(@CurrentUser() u: AuthenticatedUser, @Query('year', new ParseIntPipe({ optional: true })) year?: number) { return this.tax.calendar(u.tenantId, year ?? new Date().getFullYear()); }

  @Get('alerts') @RequirePermissions('tax.read')
  alerts(@CurrentUser() u: AuthenticatedUser) { return this.tax.alerts(u.tenantId); }

  @Get('estimate') @RequirePermissions('tax.read')
  estimate(@CurrentUser() u: AuthenticatedUser, @Query('obligation') obligation: string, @Query('period') period: string) { return this.tax.estimateOne(u.tenantId, obligation, period); }

  @Post('filings') @RequirePermissions('tax.manage')
  file(@CurrentUser() u: AuthenticatedUser, @Body() dto: FilingDto) { return this.tax.file(u, dto); }
}