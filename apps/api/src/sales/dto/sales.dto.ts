import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

export const PAYMENT_METHODS = ['cash', 'card', 'mtn_momo', 'airtel_money', 'cheque', 'transfer', 'credit', 'insurer', 'loyalty', 'store_credit', 'other'] as const;
export type PaymentMethodInput = (typeof PAYMENT_METHODS)[number];

export class SaleLineDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
  /** Uniquement pour un produit a prix libre ; sinon le prix du catalogue s'applique. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) unitPrice?: number;
  /** Remise en FCFA sur la ligne (permission sales.discount). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) discount?: number;
  /** Derogation FEFO : vendre un lot precis (motif obligatoire, trace). */
  @IsOptional() @IsUUID() lotId?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) overrideReason?: string;
}

export class PaymentInputDto {
  @IsIn(PAYMENT_METHODS as unknown as string[]) method!: PaymentMethodInput;
  @Type(() => Number) @IsInt() @Min(1) amount!: number;
  /** Reference de transaction (Mobile Money, carte). */
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  /** Tiers payant : organisme qui prend en charge cette part. */
  @IsOptional() @IsUUID() insurerId?: string;
}

export class CreateSaleDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SaleLineDto) items!: SaleLineDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PaymentInputDto) payments?: PaymentInputDto[];
  @IsOptional() @IsUUID() customerId?: string;
  /** Ticket saisi par un vendeur et envoye a la caisse : il est solde par cette vente. */
  @IsOptional() @IsUUID() ticketId?: string;
  /** UUID genere par le poste de caisse : un rejeu hors ligne ne cree jamais de doublon (ARCHITECTURE.md section 11). */
  @IsOptional() @IsString() @MaxLength(80) idempotencyKey?: string;
}

export class AddPaymentsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PaymentInputDto) payments!: PaymentInputDto[];
}

export class ConfirmPaymentDto {
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}

export class VoidSaleDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}
