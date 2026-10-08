import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { BackupService } from './backup.service';

@ApiTags('backups')
@ApiBearerAuth()
@Controller('backups')
export class BackupController {
  constructor(private readonly b: BackupService) {}

  @Get() @RequirePermissions('backup.manage')
  list(@CurrentUser() u: AuthenticatedUser) { return this.b.list(u.tenantId); }

  @Post() @RequirePermissions('backup.manage')
  now(@CurrentUser() u: AuthenticatedUser) { return this.b.backup(u.tenantId, 'manual', u.userId); }

  @Put('settings') @RequirePermissions('backup.manage')
  settings(@CurrentUser() u: AuthenticatedUser, @Body() body: { autoEnabled?: boolean; frequencyHours?: number }) { return this.b.settings(u, body); }

  @Get(':id/download') @RequirePermissions('backup.manage')
  async download(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.b.download(u.tenantId, id);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${f.fileName}"`);
    res.send(f.data);
  }

  @Post(':id/restore') @RequirePermissions('backup.manage')
  restore(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { confirm: string }) { return this.b.restore(u, { recordId: id }, String(body.confirm ?? '')); }

  @Post('restore-file') @RequirePermissions('backup.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }))
  restoreFile(@CurrentUser() u: AuthenticatedUser, @Body() body: { confirm: string }, @UploadedFile() file?: Express.Multer.File) { return this.b.restore(u, { file: file?.buffer }, String(body.confirm ?? '')); }

  @Get('drive/auth-url') @RequirePermissions('backup.manage')
  authUrl(@CurrentUser() u: AuthenticatedUser) { return this.b.driveAuthUrl(u); }

  @Post('drive/disconnect') @RequirePermissions('backup.manage')
  disconnect(@CurrentUser() u: AuthenticatedUser) { return this.b.disconnectDrive(u); }

  /** Retour de Google apres consentement : pas de jeton applicatif (redirection navigateur), etat signe et date. */
  @Public()
  @Get('drive/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const web = process.env.WEB_APP_URL ?? 'http://localhost:5173';
    try { await this.b.driveCallback(code, state); res.redirect(`${web}/#backups?drive=ok`); } catch (e) { res.redirect(`${web}/#backups?drive=error&message=${encodeURIComponent((e as Error).message)}`); }
  }
}