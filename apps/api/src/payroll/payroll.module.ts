import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({ imports: [AuditLogModule], controllers: [PayrollController], providers: [PayrollService] })
export class PayrollModule {}