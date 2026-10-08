import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PayrollParameters } from './payroll-calc';
import { EmployeeDto, RunDto, UpdateEmployeeDto } from './payroll.dto';
import { PayrollService } from './payroll.service';

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('employees') @RequirePermissions('payroll.read')
  employees(@CurrentUser() u: AuthenticatedUser) { return this.payroll.employees(u.tenantId); }

  @Post('employees') @RequirePermissions('payroll.write')
  create(@CurrentUser() u: AuthenticatedUser, @Body() dto: EmployeeDto) { return this.payroll.createEmployee(u, dto); }

  @Patch('employees/:id') @RequirePermissions('payroll.write')
  update(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) { return this.payroll.updateEmployee(u, id, dto); }

  @Get('parameters') @RequirePermissions('payroll.read')
  params(@CurrentUser() u: AuthenticatedUser) { return this.payroll.parameters(u.tenantId); }

  @Put('parameters') @RequirePermissions('payroll.write')
  setParams(@CurrentUser() u: AuthenticatedUser, @Body() body: { parameters: PayrollParameters }) { return this.payroll.setParameters(u, body.parameters); }

  @Get('runs') @RequirePermissions('payroll.read')
  runs(@CurrentUser() u: AuthenticatedUser) { return this.payroll.runs(u.tenantId); }

  @Post('runs') @RequirePermissions('payroll.write')
  compute(@CurrentUser() u: AuthenticatedUser, @Body() dto: RunDto) { return this.payroll.compute(u, dto); }

  @Get('runs/:id') @RequirePermissions('payroll.read')
  run(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.payroll.run(u.tenantId, id); }

  @Post('runs/:id/validate') @RequirePermissions('payroll.write')
  validate(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.payroll.validate(u, id); }
}