import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PurchasingService } from './purchasing.service';

@Module({ imports: [AuditLogModule], controllers: [AnalyticsController], providers: [AnalyticsService, PurchasingService], exports: [AnalyticsService] })
export class AnalyticsModule {}