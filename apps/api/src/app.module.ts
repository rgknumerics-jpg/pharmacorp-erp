import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { validateEnv } from './config/env.validation';

// apps/api/src (ou apps/api/dist) -> ../../.. = racine du depot. Permet de charger .env.test
// sans jamais toucher .env (ARCHITECTURE.md section 22 ; consigne : ne pas modifier les
// secrets de production pour configurer l'environnement de test).
const envFileName = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
const envFilePath = join(__dirname, '..', '..', '..', envFileName);
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { OnlineModule } from './online/online.module';
import { ChatModule } from './chat/chat.module';
import { LicenseGuard, LicenseModule } from './license/license.module';
import { TimeclockModule } from './timeclock/timeclock.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { CatalogModule } from './catalog/catalog.module';
import { StockModule } from './stock/stock.module';
import { CustomersModule } from './customers/customers.module';
import { PurchasesModule } from './purchases/purchases.module';
import { SalesModule } from './sales/sales.module';
import { OcrModule } from './ocr/ocr.module';
import { ReportsModule } from './reports/reports.module';
import { AccountingModule } from './accounting/accounting.module';
import { SfecModule } from './sfec/sfec.module';
import { PaymentsModule } from './payments/payments.module';
import { CompanyModule } from './company/company.module';
import { TaxModule } from './tax/tax.module';
import { PayrollModule } from './payroll/payroll.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { AdvisorModule } from './advisor/advisor.module';
import { PlantsModule } from './plants/plants.module';
import { SupplierHubModule } from './suppliers/supplier-hub.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AiModule } from './ai/ai.module';
import { TrainingModule } from './training/training.module';
import { BackupModule } from './backup/backup.module';
import { MigrationModule } from './migration/migration.module';
import { InventoryModule } from './inventory/inventory.module';
import { PromotionsModule } from './promotions/promotions.module';
import { HrModule } from './hr/hr.module';
import { AlertsModule } from './alerts/alerts.module';
import { ReferentialsModule } from './referentials/referentials.module';
import { CashdeskModule } from './cashdesk/cashdesk.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => req.headers['x-request-id'] ?? randomUUID(),
        transport:
          process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
        redact: ['req.headers.authorization'],
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
    PrismaModule,
    QueueModule,
    AuditLogModule,
    AuthModule,
    UsersModule,
    RolesModule, OnlineModule, ChatModule, LicenseModule, TimeclockModule,
    HealthModule,
    CatalogModule,
    StockModule,
    CustomersModule,
    PurchasesModule,
    SalesModule,
    OcrModule,
    ReportsModule,
    AccountingModule,
    SfecModule,
    PaymentsModule,
    CompanyModule,
    TaxModule,
    PayrollModule,
    PharmacyModule,
    AdvisorModule,
    PlantsModule,
    SupplierHubModule,
    AnalyticsModule,
    AiModule,
    TrainingModule,
    BackupModule,
    MigrationModule,
    InventoryModule,
    PromotionsModule,
    HrModule,
    AlertsModule,
    ReferentialsModule,
    CashdeskModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: LicenseGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

