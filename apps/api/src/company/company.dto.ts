import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Tout est facultatif : la structure complete son profil quand elle le souhaite (jamais bloquant). */
export class UpdateCompanyProfileDto {
  @IsOptional() @IsString() @MaxLength(160) legalName?: string;
  @IsOptional() @IsString() @MaxLength(60) legalForm?: string;
  @IsOptional() @IsString() @MaxLength(40) niu?: string;
  @IsOptional() @IsString() @MaxLength(60) rccm?: string;
  @IsOptional() @IsString() @MaxLength(80) practiceAuthorization?: string;
  @IsOptional() @IsString() @MaxLength(40) cnssEmployerNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) patenteNumber?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsIn(['reel', 'forfait']) taxRegime?: string;
  @IsOptional() @IsIn(['IS', 'IBA']) incomeTax?: string;
  @IsOptional() @IsBoolean() vatRegistered?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) employeesCount?: number;
  @IsOptional() @IsIn(['centre', 'peripherie']) zone?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) fiscalYearEndMonth?: number;
  @IsOptional() @IsBoolean() rentsPremises?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) annualRent?: number;
  @IsOptional() @IsBoolean() ownsProperty?: boolean;
}

export const DOCUMENT_KEYS: Record<string, string> = {
  niu: 'Attestation NIU',
  rccm: 'Extrait RCCM',
  practice_authorization: 'Autorisation d\'ouverture / d\'exercice (officine)',
  pharmacist_order: 'Inscription à l\'Ordre des pharmaciens',
  cnss: 'Immatriculation employeur CNSS',
  patente: 'Patente',
  lease: 'Contrat de bail',
  statutes: 'Statuts',
  tax_clearance: 'Attestation de non-redevance / quitus fiscal',
};