import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { Entity } from './mapping';
import { MigrationService } from './migration.service';

@ApiTags('migration')
@ApiBearerAuth()
@Controller('migration')
export class MigrationController {
  constructor(private readonly m: MigrationService) {}

  @Post('analyze') @RequirePermissions('migration.run')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 300 * 1024 * 1024 } }))
  analyze(@CurrentUser() u: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) { return this.m.analyze(u, file); }

  /** Base installée sur cet ordinateur (WinPharma / MySQL) : lecture directe du dossier, sans téléverser les fichiers. */
  @Post('analyze-folder') @RequirePermissions('migration.run')
  analyzeFolder(@CurrentUser() u: AuthenticatedUser, @Body() b: { folder?: string; since?: string }) { return this.m.analyzeFolder(u, b?.folder ?? '', b?.since); }

  @Get('jobs') @RequirePermissions('migration.run')
  list(@CurrentUser() u: AuthenticatedUser) { return this.m.list(u.tenantId); }

  @Get('jobs/:id') @RequirePermissions('migration.run')
  get(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.m.get(u.tenantId, id); }

  @Put('jobs/:id') @RequirePermissions('migration.run')
  remap(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { entity: Entity; mapping: Record<string, string> }) { return this.m.remap(u, id, b.entity, b.mapping); }

  @Post('jobs/:id/import') @RequirePermissions('migration.run')
  run(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.m.run(u, id); }
}