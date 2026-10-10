import { Module } from '@nestjs/common';
import { StockoutsController } from './stockouts.controller';
import { StockoutsService } from './stockouts.service';

@Module({
  controllers: [StockoutsController],
  providers: [StockoutsService],
  exports: [StockoutsService],
})
export class StockoutsModule {}
