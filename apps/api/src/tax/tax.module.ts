import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';

@Module({ imports: [AuditLogModule], controllers: [TaxController], providers: [TaxService], exports: [TaxService] })
export class TaxModule {}