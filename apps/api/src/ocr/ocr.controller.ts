import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CreateOcrDocumentDto, RejectOcrDocumentDto, ValidateOcrDocumentDto } from './dto/ocr.dto';
import { OcrService } from './ocr.service';

@ApiTags('ocr')
@ApiBearerAuth()
@Controller('ocr/documents')
export class OcrController {
  constructor(private readonly ocr: OcrService) {}

  @Post()
  @RequirePermissions('ocr.use')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 8 * 1024 * 1024 } }))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOcrDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.ocr.create(user, dto, file);
  }

  @Get()
  @RequirePermissions('ocr.use')
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.ocr.list(user.tenantId, status);
  }

  @Get(':id')
  @RequirePermissions('ocr.use')
  one(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ocr.get(user.tenantId, id);
  }

  @Get(':id/image')
  @RequirePermissions('ocr.use')
  async image(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { data, fileName } = await this.ocr.image(user.tenantId, id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName ?? 'document')}"`);
    res.send(data);
  }

  @Post(':id/validate')
  @RequirePermissions('ocr.validate')
  validate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ValidateOcrDocumentDto) {
    return this.ocr.validate(user, id, dto);
  }

  @Post(':id/reject')
  @RequirePermissions('ocr.validate')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectOcrDocumentDto) {
    return this.ocr.reject(user, id, dto.reason);
  }
}
