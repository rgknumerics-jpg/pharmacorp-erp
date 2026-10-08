import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MinLength, MaxLength, Matches } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @ApiPropertyOptional({ description: 'Change le role attribue dans ce tenant.' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ description: 'Desactive (false) ou reactive (true) l\'appartenance a ce tenant.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
  /** Signature manuscrite (PNG en data URL), apposee automatiquement sur les pieces de caisse. */
  @IsOptional() @IsString() @MaxLength(300000) @Matches(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/) signature?: string;
}
