import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({ imports: [AuditLogModule], controllers: [BackupController], providers: [BackupService] })
export class BackupModule {}