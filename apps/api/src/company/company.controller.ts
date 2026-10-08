import { Body, Controller, Delete, Get, Param, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { UpdateCompanyProfileDto } from './company.dto';
import { CompanyService } from './company.service';

@ApiTags('company')
@ApiBearerAuth()
@Controller('company')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get('profile') @RequirePermissions('company.view')
  profile(@CurrentUser() u: AuthenticatedUser) { return this.company.profile(u.tenantId); }

  @Put('profile') @RequirePermissions('company.manage')
  update(@CurrentUser() u: AuthenticatedUser, @Body() dto: UpdateCompanyProfileDto) { return this.company.update(u, dto); }

  @Post('documents/:key') @RequirePermissions('company.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@CurrentUser() u: AuthenticatedUser, @Param('key') key: string, @UploadedFile() file?: Express.Multer.File) { return this.company.upload(u, key, file); }

  /** Logo, slogan, messages et modèles imprimés : lus par la caisse (ticket, bon, étiquette). */
  @Get('branding')
  branding(@CurrentUser() u: AuthenticatedUser) { return this.company.branding(u.tenantId); }

  @Get('settings')
  settings(@CurrentUser() u: AuthenticatedUser) { return this.company.settings(u.tenantId); }

  @Post('lists/:kind') @RequirePermissions('products.write')
  addToList(@CurrentUser() u: AuthenticatedUser, @Param('kind') kind: string, @Body() b: { value: string }) { return this.company.addToList(u, kind, b?.value); }

  @Put('settings') @RequirePermissions('company.manage')
  updateSettings(@CurrentUser() u: AuthenticatedUser, @Body() body: Record<string, unknown>) { return this.company.updateSettings(u, body ?? {}); }

  @Put('branding') @RequirePermissions('company.manage')
  updateBranding(@CurrentUser() u: AuthenticatedUser, @Body() body: Record<string, unknown>) { return this.company.updateBranding(u, body ?? {}); }

  @Post('documents-custom') @RequirePermissions('company.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadCustom(@CurrentUser() u: AuthenticatedUser, @Body('label') label: string, @UploadedFile() file?: Express.Multer.File) { return this.company.uploadCustom(u, label, file); }

  @Delete('documents/:key') @RequirePermissions('company.manage')
  removeCustom(@CurrentUser() u: AuthenticatedUser, @Param('key') key: string) { return this.company.removeCustom(u, key); }

  @Get('documents/:key') @RequirePermissions('company.view')
  async file(@CurrentUser() u: AuthenticatedUser, @Param('key') key: string, @Res() res: Response) {
    const d = await this.company.file(u.tenantId, key);
    res.setHeader('Content-Type', d.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.fileName)}"`);
    res.send(Buffer.from(d.data));
  }
}