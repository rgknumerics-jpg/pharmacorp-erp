import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'ChangeMe123!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    example: 'pharmacie-pilote',
    description: 'Slug du tenant sur lequel se connecter (un utilisateur peut appartenir a plusieurs tenants).',
  })
  @IsString()
  tenantSlug!: string;
}
