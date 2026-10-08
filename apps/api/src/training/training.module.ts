import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

@Module({ imports: [AuditLogModule], controllers: [TrainingController], providers: [TrainingService] })
export class TrainingModule {}