import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength, NotEquals } from 'class-validator';

export class AdjustStockDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() lotId?: string;
  /** Positif = entree (inventaire), negatif = sortie. */
  @IsInt() @NotEquals(0) quantity!: number;
  @IsIn(['adjustment', 'loss', 'expiry_writeoff']) type!: 'adjustment' | 'loss' | 'expiry_writeoff';
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
}

export class ValidateLotDto {
  @IsIn(['validate', 'block']) action!: 'validate' | 'block';
  /** Correction eventuelle de la date lue par l'OCR. */
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsString() @MaxLength(40) lotNumber?: string;
}
