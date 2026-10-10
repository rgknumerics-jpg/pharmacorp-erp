import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ProductHoldsController } from './product-holds.controller';
import { ProductHoldsService } from './product-holds.service';

@Module({
  imports: [AuditLogModule],
  controllers: [ProductHoldsController],
  providers: [ProductHoldsService],
})
export class ProductHoldsModule {}
