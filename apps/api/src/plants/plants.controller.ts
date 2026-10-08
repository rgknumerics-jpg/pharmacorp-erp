import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PlantsService } from './plants.service';

class FreeItemDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(200) dci?: string;
  @IsOptional() @IsString() @MaxLength(100) form?: string;
}

export class BasketAdviceDto {
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsUUID('all', { each: true }) productIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => FreeItemDto) items?: FreeItemDto[];
  @IsOptional() @IsBoolean() pregnant?: boolean;
  @IsOptional() @IsBoolean() child?: boolean;
}

/** Conseil plantes & complements alimentaires (donnees ouvertes, non validees cliniquement). */
@ApiTags('plants')
@ApiBearerAuth()
@Controller('plants')
export class PlantsController {
  constructor(private readonly plants: PlantsService) {}

  @Get('today') @RequirePermissions('plants.read')
  today(@Query('date') date?: string) { return this.plants.today(/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : undefined); }

  @Get('search') @RequirePermissions('plants.read')
  search(@Query('q') q = '', @Query('limit', new ParseIntPipe({ optional: true })) limit = 30, @Query('offset', new ParseIntPipe({ optional: true })) offset = 0) {
    return this.plants.search(q.slice(0, 100), Math.min(limit, 100), Math.max(offset, 0));
  }

  /** Caisse : le vendeur n'a pas besoin de products.read, seulement de pouvoir vendre. */
  @Post('basket') @RequirePermissions('sales.create')
  basket(@CurrentUser() u: AuthenticatedUser, @Body() dto: BasketAdviceDto) { return this.plants.forBasket(u, dto); }

  @Get('product/:id') @RequirePermissions('plants.read')
  product(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.plants.forProduct(u, id); }

  @Get(':id') @RequirePermissions('plants.read')
  one(@Param('id') id: string) { return this.plants.one(id); }
}
