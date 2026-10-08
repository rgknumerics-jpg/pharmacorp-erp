import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StockModule } from '../stock/stock.module';
import { SalesController } from './sales.controller';
import { SalesStatsService } from './sales-stats.service';
import { SalesService } from './sales.service';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AuditLogModule, StockModule],
  controllers: [SalesController],
  providers: [SalesService, SalesStatsService, TicketsService],
  exports: [SalesService],
})
export class SalesModule {}
