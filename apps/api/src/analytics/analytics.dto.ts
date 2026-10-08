import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class SupplierInvoiceDto {
  @IsUUID() supplierId!: string;
  @IsString() @MaxLength(60) number!: string;
  @IsDateString() issueDate!: string;
  /** Echeance saisie manuellement ; a defaut : date de facture + conditions du fournisseur (0 = comptant). */
  @IsOptional() @IsDateString() dueDate?: string;
  @Type(() => Number) @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class UpdateInvoiceDueDto {
  @IsDateString() dueDate!: string;
}

export class PayInvoiceDto {
  @Type(() => Number) @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsIn(['cash', 'card', 'mtn_momo', 'airtel_money', 'cheque', 'transfer', 'other']) method?: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

export class GardeDto {
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(500) upliftPct?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class CashClosingDto {
  @Type(() => Number) @IsInt() @Min(0) counted!: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}