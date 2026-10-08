import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { HttpSfecAdapter, SFEC_ADAPTER, SimulatorSfecAdapter } from './sfec.adapter';
import { SfecController } from './sfec.controller';
import { SfecService } from './sfec.service';

@Module({
  imports: [AuditLogModule],
  controllers: [SfecController],
  providers: [
    SfecService,
    { provide: SFEC_ADAPTER, useFactory: () => (process.env.SFEC_MODE === 'http' ? new HttpSfecAdapter() : new SimulatorSfecAdapter()) },
  ],
  exports: [SfecService],
})
export class SfecModule {}