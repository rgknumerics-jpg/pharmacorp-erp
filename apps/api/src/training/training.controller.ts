import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { TrainingItemInput, TrainingService } from './training.service';

@ApiTags('training')
@ApiBearerAuth()
@Controller('training')
export class TrainingController {
  constructor(private readonly t: TrainingService) {}

  @Get('today') @RequirePermissions('training.use')
  today(@CurrentUser() u: AuthenticatedUser) { return this.t.today(u); }

  @Post('answers') @RequirePermissions('training.use')
  answer(@CurrentUser() u: AuthenticatedUser, @Body() b: { itemId: string; answer: number }) { return this.t.answer(u, String(b.itemId), Number(b.answer)); }

  @Get('progress') @RequirePermissions('training.use')
  progress(@CurrentUser() u: AuthenticatedUser) { return this.t.progress(u); }

  @Get('items') @RequirePermissions('training.manage')
  items(@CurrentUser() u: AuthenticatedUser) { return this.t.items(u.tenantId); }

  @Post('items') @RequirePermissions('training.manage')
  create(@CurrentUser() u: AuthenticatedUser, @Body() b: TrainingItemInput) { return this.t.create(u, b); }

  @Put('items/:id') @RequirePermissions('training.manage')
  update(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: TrainingItemInput) { return this.t.update(u, id, b); }

  @Post('items/status') @RequirePermissions('training.manage')
  status(@CurrentUser() u: AuthenticatedUser, @Body() b: { ids: string[]; status: 'validated' | 'archived' }) { return this.t.setStatus(u, (b.ids ?? []).map(String), b.status === 'archived' ? 'archived' : 'validated'); }
}