import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

export class SupplierContactDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(80) role?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class CreateSupplierDto {
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  /** 0 = comptant ; sinon delai de paiement en jours. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) paymentTermDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() @MaxLength(12) abbreviation?: string;
  @IsOptional() @IsBoolean() isWholesaler?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SupplierContactDto) contacts?: SupplierContactDto[];
}

export class UpdateSupplierDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) paymentTermDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(12) abbreviation?: string;
  @IsOptional() @IsBoolean() isWholesaler?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SupplierContactDto) contacts?: SupplierContactDto[];
}

export class PoItemDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) unitCost?: number;
}

export class CreatePurchaseOrderDto {
  @IsUUID() supplierId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PoItemDto) items!: PoItemDto[];
  @IsOptional() @IsDateString() expectedAt?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** true = envoye au fournisseur (statut "ordered"), sinon brouillon. */
  @IsOptional() @IsBoolean() send?: boolean;
}

export class ReceiptLineDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) unitCost?: number;
  @IsOptional() @IsString() @MaxLength(40) lotNumber?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  /** Ligne lue par OCR avec une faible confiance : le lot reste bloque a la vente jusqu'a validation par un 2e role. */
  @IsOptional() @IsBoolean() lowConfidence?: boolean;
}

export class ReceiveGoodsDto {
  @IsOptional() @IsUUID() purchaseOrderId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  /** Numero du bon de livraison / de la facture du fournisseur. */
  @IsOptional() @IsString() @MaxLength(60) supplierRef?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(400) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto) lines!: ReceiptLineDto[];
  /** Met a jour le dernier prix d'achat du produit avec le cout recu. */
  @IsOptional() @IsBoolean() updateCosts?: boolean;
  /** Depot de reception : 'main' (comptoir / rayons, defaut) ou id d'une reserve. */
  @IsOptional() @IsString() @MaxLength(40) depotId?: string;
}
