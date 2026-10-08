import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class EntryLineDto {
  @IsString() @Matches(/^\d{2,8}$/) accountCode!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) debit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) credit?: number;
  @IsOptional() @IsString() @MaxLength(200) label?: string;
}

export class ManualEntryDto {
  @IsOptional() @IsIn(['OD', 'CA', 'BQ', 'MM', 'AC', 'VE']) journalCode?: string;
  @IsDateString() date!: string;
  @IsString() @MinLength(3) @MaxLength(200) label!: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => EntryLineDto) lines!: EntryLineDto[];
}

export class CreateAccountDto {
  @IsString() @Matches(/^\d{2,8}$/) code!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsIn(['asset', 'liability', 'equity', 'income', 'expense']) type!: string;
}

export class ReverseDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}