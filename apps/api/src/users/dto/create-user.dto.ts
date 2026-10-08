import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsUUID, MinLength, IsOptional, MaxLength, Matches } from 'class-validator';

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiProperty({
    description:
      'Mot de passe initial. Ignore si un utilisateur avec cet email existe deja globalement ' +
      '(identite unique, ARCHITECTURE.md section 8) : il est alors seulement rattache a ce tenant.',
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ description: 'Identifiant du role (voir GET /roles) attribue dans ce tenant.' })
  @IsUUID()
  roleId!: string;
  /** Signature manuscrite (PNG en data URL), apposee automatiquement sur les pieces de caisse. */
  @IsOptional() @IsString() @MaxLength(300000) @Matches(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/) signature?: string;
}
