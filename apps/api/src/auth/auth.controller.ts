import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Poste de caisse : le code personnel identifie la personne qui travaille (jetons à ses propres droits). */
  @Post('pos-unlock')
  posUnlock(@CurrentUser() u: AuthenticatedUser, @Body() b: { mode: string; pin: string }, @Req() req: Request) { return this.authService.posUnlock(u.tenantId, b?.mode, b?.pin, req.ip); }

  @Get('pos-pin')
  async hasPin(@CurrentUser() u: AuthenticatedUser) { return { set: await this.authService.hasPosPin(u.tenantId, u.membershipId) }; }

  /** Mon code personnel (confirmé par mon mot de passe). */
  @Put('pos-pin')
  async setOwn(@CurrentUser() u: AuthenticatedUser, @Body() b: { password: string; pin: string }) { await this.authService.verifyOwnPassword(u.userId, b?.password); return this.authService.setPosPin(u.tenantId, u.membershipId, b?.pin, u.userId); }

  /** Code d'un membre de l'équipe, défini par l'administrateur. */
  @Put('pos-pin/:membershipId') @RequirePermissions('users.write')
  setFor(@CurrentUser() u: AuthenticatedUser, @Param('membershipId', ParseUUIDPipe) id: string, @Body() b: { pin: string }) { return this.authService.setPosPin(u.tenantId, id, b?.pin, u.userId); }

  @Public()
  @Post('login')
  @ApiOkResponse({ description: 'Jetons acces/refresh pour le tenant demande.' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto.email, dto.password, dto.tenantSlug, req.ip);
  }

  @Public()
  @Post('refresh')
  @ApiOkResponse({ description: 'Rotation des jetons : l\'ancien refresh token est revoque.' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOkResponse({ description: 'Revocation du refresh token (idempotent).' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }
}
