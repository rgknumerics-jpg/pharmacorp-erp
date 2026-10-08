import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class PayItemDto {
  @IsString() @MaxLength(60) label!: string;
  @Type(() => Number) @IsNumber() @Min(0) amount!: number;
}

export class EmployeeDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsOptional() @IsString() @MaxLength(80) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(40) cnssNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) niu?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsDateString() hireDate?: string;
  @Type(() => Number) @IsNumber() @Min(0) baseSalary!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(6.5) taxParts?: number;
  @IsOptional() @IsString() @MaxLength(30) matricule?: string;
  @IsOptional() @IsString() @MaxLength(60) familySituation?: string;
  /** Anciennete en % du salaire de base. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(60) seniorityRate?: number;
  /** Primes fixes reconduites chaque mois : [{ label, amount }] (soumises). */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PayItemDto) fixedEarnings?: { label: string; amount: number }[];
  /** Indemnites fixes non soumises : allocations familiales, transport, rations. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PayItemDto) fixedAllowances?: { label: string; amount: number }[];}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(80) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(40) cnssNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) niu?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsDateString() hireDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) baseSalary?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(6.5) taxParts?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(30) matricule?: string;
  @IsOptional() @IsString() @MaxLength(60) familySituation?: string;
  /** Anciennete en % du salaire de base. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(60) seniorityRate?: number;
  /** Primes fixes reconduites chaque mois : [{ label, amount }] (soumises). */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PayItemDto) fixedEarnings?: { label: string; amount: number }[];
  /** Indemnites fixes non soumises : allocations familiales, transport, rations. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PayItemDto) fixedAllowances?: { label: string; amount: number }[];}

export class RunDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string;
  /** Primes du mois : { employeeId: montant }. */
  @IsOptional() @IsObject() bonuses?: Record<string, number>;
  /** Variables du mois par salarie : primes, indemnites, retenues (acompte, avance, pret, pharmacie, avantages en nature), conges payes. */
  @IsOptional() @IsObject() variables?: Record<string, { earnings?: { label: string; amount: number }[]; allowances?: { label: string; amount: number }[]; deductions?: { label: string; amount: number; kind?: 'acompte' | 'avance' | 'pret' | 'pharmacie' | 'nature' | 'autre' }[] }>;
}