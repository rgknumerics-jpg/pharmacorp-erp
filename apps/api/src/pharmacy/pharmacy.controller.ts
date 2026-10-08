import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { InsurerDto, PrescriptionDto, SettlementDto } from './pharmacy.dto';
import { PharmacyService } from './pharmacy.service';

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller()
export class PharmacyController {
  constructor(private readonly ph: PharmacyService) {}

  @Get('insurers') @RequirePermissions('customers.read')
  insurers(@CurrentUser() u: AuthenticatedUser) { return this.ph.insurers(u.tenantId); }

  @Post('insurers') @RequirePermissions('customers.write')
  createInsurer(@CurrentUser() u: AuthenticatedUser, @Body() dto: InsurerDto) { return this.ph.createInsurer(u, dto); }

  @Patch('insurers/:id') @RequirePermissions('customers.write')
  updateInsurer(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InsurerDto) { return this.ph.updateInsurer(u, id, dto); }

  @Get('insurers/:id/statement') @RequirePermissions('customers.read')
  statement(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.ph.insurerStatement(u.tenantId, id); }

  @Post('insurers/:id/settlements') @RequirePermissions('customers.write')
  settle(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettlementDto) { return this.ph.settle(u, id, dto); }

  @Get('prescriptions') @RequirePermissions('sales.read')
  prescriptions(@CurrentUser() u: AuthenticatedUser, @Query('q') q?: string) { return this.ph.prescriptions(u.tenantId, q); }

  @Post('prescriptions') @RequirePermissions('sales.create')
  record(@CurrentUser() u: AuthenticatedUser, @Body() dto: PrescriptionDto) { return this.ph.recordPrescription(u, dto); }

  @Get('receivables') @RequirePermissions('customers.read')
  receivables(@CurrentUser() u: AuthenticatedUser) { return this.ph.receivables(u.tenantId); }
}