import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CLAIM_NATURES, CLAIM_STATUS, SupplierHubService } from './supplier-hub.service';

/** Onglet « Fournisseurs » : grossistes (Laborex, Ubipharm, CEP…), catalogue de CIP, réclamations, retours et avoirs. */
@ApiTags('supplier-hub')
@ApiBearerAuth()
@Controller('supplier-hub')
export class SupplierHubController {
  constructor(private readonly hub: SupplierHubService) {}

  @Get('overview') @RequirePermissions('purchases.read')
  overview(@CurrentUser() u: AuthenticatedUser) { return this.hub.overview(u.tenantId); }

  /** Référentiel CIP des grossistes : propose les codes à partir d'un libellé (fiche produit). */
  @Get('lookup') @RequirePermissions('products.read')
  lookup(@CurrentUser() u: AuthenticatedUser, @Query('q') q = '') { return this.hub.lookup(u.tenantId, q.slice(0, 120)); }

  /** Complète les CIP manquants de tous les produits d'après le référentiel commun (Laborex, CEP, Ubipharm). */
  @Post('enrich') @RequirePermissions('products.write')
  enrich(@CurrentUser() u: AuthenticatedUser) { return this.hub.enrich(u); }

  @Get('reference') @RequirePermissions('products.read')
  async reference() { const rows = await this.hub.referenceStats(); return rows; }

  /** Les trois grossistes principaux, pour la fiche produit. */
  @Get('wholesalers') @RequirePermissions('products.read')
  wholesalers(@CurrentUser() u: AuthenticatedUser) { return this.hub.wholesalers(u); }

  @Get('meta') @RequirePermissions('purchases.read')
  meta() { return { natures: CLAIM_NATURES, statuses: CLAIM_STATUS, delayDays: 7 }; }

  // ---- catalogue
  @Post(':id/catalog/import') @RequirePermissions('purchases.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  importCatalog(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) { return this.hub.importCatalog(u, id, file); }

  @Get(':id/catalog') @RequirePermissions('purchases.read')
  catalog(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query('q') q?: string, @Query('state') state?: string, @Query('take', new ParseIntPipe({ optional: true })) take = 50, @Query('skip', new ParseIntPipe({ optional: true })) skip = 0) {
    return this.hub.catalog(u.tenantId, id, q?.slice(0, 80), state, Math.min(take, 200), Math.max(skip, 0));
  }

  @Post(':id/catalog/:itemId/link') @RequirePermissions('purchases.write')
  link(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() b: { productId?: string | null }) { return this.hub.link(u, id, itemId, b?.productId ?? null); }

  @Post(':id/catalog/accept-suggestions') @RequirePermissions('purchases.write')
  accept(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { minScore?: number }) { return this.hub.acceptSuggestions(u, id, Number(b?.minScore) || 85); }

  // ---- commande : aperçu (CIP du fournisseur, disponibilité) avant d'exporter
  @Post('order/preview') @RequirePermissions('purchases.read')
  preview(@CurrentUser() u: AuthenticatedUser, @Body() b: { supplierId: string; lines: { productId: string; quantity: number }[] }) { return this.hub.previewOrder(u, b.supplierId, b.lines); }

  // ---- réclamations, retours, avoirs
  @Get('claims/summary') @RequirePermissions('purchases.read')
  summary(@CurrentUser() u: AuthenticatedUser) { return this.hub.claimsSummary(u.tenantId); }

  @Get('claims') @RequirePermissions('purchases.read')
  claims(@CurrentUser() u: AuthenticatedUser, @Query('status') status?: string, @Query('supplierId') supplierId?: string, @Query('nature') nature?: string, @Query('q') q?: string, @Query('late') late?: string) {
    return this.hub.claims(u.tenantId, { status, supplierId, nature, q: q?.slice(0, 80), late: late === '1' });
  }

  @Post('claims') @RequirePermissions('purchases.write')
  createClaim(@CurrentUser() u: AuthenticatedUser, @Body() b: any) { return this.hub.createClaim(u, b); }

  @Patch('claims/:id') @RequirePermissions('purchases.write')
  updateClaim(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: any) { return this.hub.updateClaim(u, id, b); }

  @Get('claims/:id/message') @RequirePermissions('purchases.read')
  message(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query('reminder') reminder?: string) { return this.hub.claimMessage(u.tenantId, id, reminder === '1'); }
}
