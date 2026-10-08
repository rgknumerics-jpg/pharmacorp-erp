import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { OCR_ENGINE, TesseractEngine } from './ocr.engine';
import { OcrController } from './ocr.controller';
import { OcrService } from './ocr.service';

@Module({
  imports: [AuditLogModule, PurchasesModule],
  controllers: [OcrController],
  providers: [OcrService, { provide: OCR_ENGINE, useClass: TesseractEngine }],
  exports: [OcrService],
})
export class OcrModule {}
