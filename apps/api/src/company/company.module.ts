import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({ imports: [AuditLogModule], controllers: [CompanyController], providers: [CompanyService], exports: [CompanyService] })
export class CompanyModule {}