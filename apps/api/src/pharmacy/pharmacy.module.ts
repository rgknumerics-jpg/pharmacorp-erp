import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';

@Module({ imports: [AuditLogModule], controllers: [PharmacyController], providers: [PharmacyService], exports: [PharmacyService] })
export class PharmacyModule {}