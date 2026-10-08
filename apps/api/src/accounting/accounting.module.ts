import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

@Module({ imports: [AuditLogModule], controllers: [AccountingController], providers: [AccountingService], exports: [AccountingService] })
export class AccountingModule {}