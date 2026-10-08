import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto, CreateProductDto, UpdateProductDto } from './dto/product.dto';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @RequirePermissions('products.read')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('take', new ParseIntPipe({ optional: true })) take = 30,
    @Query('skip', new ParseIntPipe({ optional: true })) skip = 0,
    @Query('stock') stock?: string,
  ) {
    return this.catalog.search(user, q, Math.min(take, 200), skip, includeInactive === 'true', stock === '1');
  }

  @Get('products/by-code/:code')
  @RequirePermissions('products.read')
  byCode(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    return this.catalog.findByBarcode(user, code);
  }

  @Get('products/:id')
  @RequirePermissions('products.read')
  one(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.findOne(user, id);
  }

  @Post('products')
  @RequirePermissions('products.write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.catalog.create(user, dto);
  }

  @Patch('products/:id')
  @RequirePermissions('products.write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.update(user, id, dto);
  }

  @Get('categories')
  @RequirePermissions('products.read')
  categories(@CurrentUser() user: AuthenticatedUser) {
    return this.catalog.categories(user.tenantId);
  }

  @Post('categories')
  @RequirePermissions('products.write')
  createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(user.tenantId, dto);
  }
}
