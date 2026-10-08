import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService, private readonly prisma: PrismaService) {}

  @Get('users/me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findMe(user);
  }

  /** Chaque agent peut enregistrer ou refaire sa propre signature (pieces de caisse). */
  @Put('users/me/signature')
  async mySignature(@CurrentUser() user: AuthenticatedUser, @Body() body: { signature: string }) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(body?.signature ?? '') || body.signature.length > 300_000) throw new BadRequestException('Signature invalide');
    await this.prisma.user.update({ where: { id: user.userId }, data: { signature: body.signature } });
    return { ok: true };
  }

  @Get('users')
  @RequirePermissions('users.read')
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findAllForTenant(user.tenantId);
  }

  @Post('users')
  @RequirePermissions('users.write')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.create(user.tenantId, dto, user);
  }

  @Patch('users/:membershipId')
  @RequirePermissions('users.write')
  update(
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.update(user.tenantId, membershipId, dto, user);
  }
}
