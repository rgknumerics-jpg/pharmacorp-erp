import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class FilingDto {
  @IsString() @MaxLength(30) obligation!: string;
  @IsString() @MaxLength(40) period!: string;
  @IsDateString() dueDate!: string;
  @IsIn(['todo', 'filed', 'paid']) status!: 'todo' | 'filed' | 'paid';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) amount?: number;
  /** N° de quittance, accuse de reception E-TAX / FOUTA. */
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
}