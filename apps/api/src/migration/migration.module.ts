import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { OCR_ENGINE, TesseractEngine } from '../ocr/ocr.engine';
import { SupplierHubModule } from '../suppliers/supplier-hub.module';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';

@Module({ imports: [AuditLogModule, AccountingModule, SupplierHubModule], controllers: [MigrationController], providers: [MigrationService, { provide: OCR_ENGINE, useClass: TesseractEngine }] })
export class MigrationModule {}