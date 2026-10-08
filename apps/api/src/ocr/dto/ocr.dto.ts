import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
 } from 'class-validator';
import { ReceiptLineDto } from '../../purchases/dto/purchases.dto';

export class CreateOcrDocumentDto {
  @IsIn(['delivery_note', 'invoice', 'expiry_label']) kind!: 'delivery_note' | 'invoice' | 'expiry_label';
  /** Texte deja lu cote navigateur (OCR hors ligne) : evite d'envoyer l'image au serveur. */
  @IsOptional() @IsString() @MaxLength(60000) rawText?: string;
  /** Confiance (0..1) du moteur OCR du navigateur, quand le texte vient du client. */
  @IsOptional() @Type(() => Number) @Min(0) @Max(1) engineConfidence?: number;
}

export class ValidateOcrDocumentDto {
  // --- bon de livraison / facture : lignes verifiees par une personne ---
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() purchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(60) supplierRef?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(400) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto) lines?: ReceiptLineDto[];
  @IsOptional() @IsBoolean() updateCosts?: boolean;
  /** Depot de reception ('main' ou id d'une reserve). */
  @IsOptional() @IsString() @MaxLength(40) depotId?: string;

  // --- etiquette de peremption : lot et date confirmes ---
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MaxLength(40) lotNumber?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}

export class RejectOcrDocumentDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}
