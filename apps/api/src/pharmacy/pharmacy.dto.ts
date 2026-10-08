import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class InsurerDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) coverageRate?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermDays?: number;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SettlementDto {
  @Type(() => Number) @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsIn(['cash', 'card', 'mtn_momo', 'airtel_money', 'other']) method?: string;
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

export class PrescriptionDto {
  @IsOptional() @IsUUID() saleId?: string;
  @IsString() @MinLength(2) @MaxLength(120) patientName!: string;
  @IsOptional() @IsString() @MaxLength(30) patientPhone?: string;
  @IsString() @MinLength(2) @MaxLength(120) prescriber!: string;
  @IsOptional() @IsString() @MaxLength(60) prescriberRef?: string;
  @IsOptional() @IsString() @MaxLength(120) facility?: string;
  @IsDateString() prescribedAt!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}