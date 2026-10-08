import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import { TaxModule } from '../tax/tax.module';
import { AdvisorController } from './advisor.controller';
import { AdvisorService } from './advisor.service';

@Module({ imports: [TaxModule, PharmacyModule, CompanyModule], controllers: [AdvisorController], providers: [AdvisorService] })
export class AdvisorModule {}