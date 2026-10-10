import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NetworkController } from './network.controller';
import { NetworkService } from './network.service';

@Module({
  imports: [AuditLogModule],
  controllers: [NetworkController],
  providers: [NetworkService],
})
export class NetworkModule {}
