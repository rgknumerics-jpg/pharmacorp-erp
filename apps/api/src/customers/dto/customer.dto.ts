import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateCustomerDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) creditLimit?: number;
  @IsOptional() @IsIn(['particulier', 'entreprise', 'assure', 'personnel']) kind?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsUUID() insurerId?: string;
  @IsOptional() @IsString() @MaxLength(60) insuranceNumber?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermDays?: number;
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;}

export class UpdateCustomerDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) creditLimit?: number;
  @IsOptional() @IsIn(['particulier', 'entreprise', 'assure', 'personnel']) kind?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsOptional() @IsUUID() insurerId?: string;
  @IsOptional() @IsString() @MaxLength(60) insuranceNumber?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermDays?: number;
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreditRepaymentDto {
  @Type(() => Number) @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
