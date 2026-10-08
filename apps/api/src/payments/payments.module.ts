import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SalesModule } from '../sales/sales.module';
import { MobileMoneyController } from './mobile-money.controller';
import { MobileMoneyService } from './mobile-money.service';

@Module({ imports: [AuditLogModule, SalesModule], controllers: [MobileMoneyController], providers: [MobileMoneyService] })
export class PaymentsModule {}