import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SupplierHubController } from './supplier-hub.controller';
import { CipReferenceService } from './cip-reference.service';
import { SupplierHubService } from './supplier-hub.service';

@Module({ imports: [AuditLogModule], controllers: [SupplierHubController], providers: [SupplierHubService, CipReferenceService], exports: [SupplierHubService, CipReferenceService] })
export class SupplierHubModule {}
