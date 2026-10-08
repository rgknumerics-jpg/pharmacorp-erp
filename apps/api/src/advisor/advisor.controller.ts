import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { AdvisorService } from './advisor.service';

@ApiTags('advisor')
@ApiBearerAuth()
@Controller('advisor')
export class AdvisorController {
  constructor(private readonly advisor: AdvisorService) {}

  @Get('insights') @RequirePermissions('advisor.read')
  insights(@CurrentUser() u: AuthenticatedUser) { return this.advisor.insights(u.tenantId); }
}