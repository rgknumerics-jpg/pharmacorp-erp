import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StockModule } from '../stock/stock.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({ imports: [AuditLogModule, StockModule], controllers: [InventoryController], providers: [InventoryService] })
export class InventoryModule {}