import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString() @MinLength(1) @MaxLength(40) sku!: string;
  @IsOptional() @IsString() @MaxLength(40) barcode?: string;
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(200) dci?: string;
  @IsOptional() @IsString() @MaxLength(60) form?: string;
  @IsOptional() @IsString() @MaxLength(60) dosage?: string;
  @IsOptional() @IsString() @MaxLength(120) laboratory?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) salePrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) purchasePrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) vatRate?: number;
  @IsOptional() @IsBoolean() priceFree?: boolean;
  @IsOptional() @IsBoolean() onlineVisible?: boolean;
  @IsOptional() @IsBoolean() trackLots?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minStock?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) oversellTolerance?: number;
  @IsOptional() @IsBoolean() prescriptionRequired?: boolean;
  @IsOptional() @IsObject() supplierCodes?: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(40) priceCategory?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) packSize?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) unitsPerBox?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) unitSalePrice?: number | null;
  @IsOptional() @IsIn(['normal', 'froid', 'stupefiant', 'psychotrope', 'photosensible', 'inflammable']) storage?: string;
  @IsOptional() @IsString() @MaxLength(60) location?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) safetyStock?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) reorderQty?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;}

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) sku?: string;
  @IsOptional() @IsString() @MaxLength(40) barcode?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(200) dci?: string;
  @IsOptional() @IsString() @MaxLength(60) form?: string;
  @IsOptional() @IsString() @MaxLength(60) dosage?: string;
  @IsOptional() @IsString() @MaxLength(120) laboratory?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) salePrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) purchasePrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) vatRate?: number;
  @IsOptional() @IsBoolean() priceFree?: boolean;
  @IsOptional() @IsBoolean() onlineVisible?: boolean;
  @IsOptional() @IsBoolean() trackLots?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minStock?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) oversellTolerance?: number;
  @IsOptional() @IsBoolean() prescriptionRequired?: boolean;
  @IsOptional() @IsObject() supplierCodes?: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(40) priceCategory?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) packSize?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) unitsPerBox?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) unitSalePrice?: number | null;
  @IsOptional() @IsIn(['normal', 'froid', 'stupefiant', 'psychotrope', 'photosensible', 'inflammable']) storage?: string;
  @IsOptional() @IsString() @MaxLength(60) location?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) safetyStock?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) reorderQty?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;}

export class CreateCategoryDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
}
