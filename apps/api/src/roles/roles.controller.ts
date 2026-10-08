import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('roles.read')
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.findAllForTenant(user.tenantId);
  }

  @Get('permissions/catalog')
  @RequirePermissions('roles.read')
  findPermissionCatalog() {
    return this.rolesService.findPermissionCatalog();
  }

  @Post()
  @RequirePermissions('roles.write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: { name: string; permissions: string[] }) {
    return this.rolesService.create(user, body);
  }

  @Put(':id/label') @RequirePermissions('roles.write')
  rename(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { label: string }) { return this.rolesService.rename(user, id, body?.label); }

  @Put(':id')
  @RequirePermissions('roles.write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { name?: string; permissions?: string[] }) {
    return this.rolesService.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermissions('roles.write')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.remove(user, id);
  }
}
