import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { movementWhere, scopeOf, visibleProductIds } from '../common/vat-scope';
import { PrismaService } from '../prisma/prisma.service';

/** Moteur partage (Desktop\API\plantes-medicinales, copie dans apps/api/plants-data) : voir sync-apps.cjs. */
export interface Engine {
  analyse(items: BasketItem[], opts?: { pregnant?: boolean; child?: boolean; max?: number }): Analysis;
  plantsInProduct(item: BasketItem): PlantCard[];
  interactionsFor(plantId: string, classes: string[]): { niveau: string; message: string }[];
  search(q: string, o?: { limit?: number; offset?: number }): { total: number; resultats: unknown[] };
  plantOfTheDay(date?: string): unknown;
  get(id: string): PlantCard | null;
  classesOf(items: BasketItem[]): string[];
  rules: { interactions: { plantes: string[]; classes: string[]; niveau: string; message: string }[]; meta: Record<string, unknown>; avertissement: string };
  count: number;
}
export interface BasketItem { name: string; dci?: string | null; form?: string | null }
export interface PlantCard { id: string; nom: string; nomLatin: string; famille?: string; [k: string]: unknown }
export interface Suggestion { plante: PlantCard; motsCles: string[]; [k: string]: unknown }
export interface Analysis { suggestions: Suggestion[]; [k: string]: unknown }

export function loadPlantsEngine(): Engine {
  const candidates = [process.env.PLANTS_DATA_DIR, path.join(__dirname, '..', '..', 'plants-data'), path.join(process.cwd(), 'plants-data'), path.join(process.cwd(), 'apps', 'api', 'plants-data')].filter(Boolean) as string[];
  const dir = candidates.find((d) => fs.existsSync(path.join(d, 'conseil-engine.cjs')));
  if (!dir) throw new Error('Donnees plantes introuvables (plants-data). Lancer : node ../API/plantes-medicinales/scripts/sync-apps.cjs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createEngine } = require(path.join(dir, 'conseil-engine.cjs'));
  const plants = JSON.parse(fs.readFileSync(path.join(dir, 'plantes-light.json'), 'utf8')).plantes;
  const rules = JSON.parse(fs.readFileSync(path.join(dir, 'regles-conseil.json'), 'utf8'));
  return createEngine({ plants, rules });
}

@Injectable()
export class PlantsService {
  private readonly engine = loadPlantsEngine();

  constructor(private readonly prisma: PrismaService) {}

  today(date?: string) { return this.engine.plantOfTheDay(date); }

  search(q: string, limit: number, offset: number) { return this.engine.search(q, { limit, offset }); }

  one(id: string) {
    const p = this.engine.get(id);
    if (!p) throw new NotFoundException('Plante introuvable');
    const interactions = this.engine.rules.interactions.filter((i) => i.plantes.includes(id)).map((i) => ({ niveau: i.niveau, classes: i.classes, message: i.message }));
    return { ...p, interactions, conseils: this.engine.rules.meta[id] ?? null, avertissement: this.engine.rules.avertissement };
  }

  /** Conseil complementaire pour un panier : produits du catalogue (ids) et/ou lignes libres. */
  async forBasket(user: AuthenticatedUser, dto: { productIds?: string[]; items?: BasketItem[]; pregnant?: boolean; child?: boolean }) {
    // droit « plants.read » : sans lui, la caisse n'affiche aucun conseil plantes
    if (!user.permissions.includes('plants.read')) return { avertissement: '', classes: [], besoins: [], suggestions: [], ecartees: [], suppression: null };
    const ids = (dto.productIds ?? []).slice(0, 60);
    const products = ids.length ? await this.prisma.forTenant(user.tenantId, (tx) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, dci: true, form: true } })) : [];
    const items: BasketItem[] = [...products.map((p) => ({ name: p.name, dci: p.dci, form: p.form })), ...(dto.items ?? [])];
    const analysis = this.engine.analyse(items, { pregnant: dto.pregnant, child: dto.child });
    const enRayon = await this.inStock(user, analysis.suggestions, ids);
    return { ...analysis, suggestions: analysis.suggestions.map((s) => ({ ...s, enRayon: enRayon[s.plante.id] ?? [] })) };
  }

  /** Fiche produit : besoins couverts, plantes contenues dans le produit, complements possibles. */
  async forProduct(user: AuthenticatedUser, productId: string) {
    const p = await this.prisma.forTenant(user.tenantId, (tx) => tx.product.findUnique({ where: { id: productId }, select: { id: true, name: true, dci: true, form: true } }));
    if (!p) throw new NotFoundException('Produit introuvable');
    const item = { name: p.name, dci: p.dci, form: p.form };
    const classes = this.engine.classesOf([item]);
    const contient = this.engine.plantsInProduct(item).map((pl) => ({ ...pl, interactions: this.engine.interactionsFor(pl.id, classes), conseils: this.engine.rules.meta[pl.id] ?? null }));
    const analysis = this.engine.analyse([item]);
    const enRayon = await this.inStock(user, analysis.suggestions, [productId]);
    return { produit: p, classes, contientPlantes: contient, ...analysis, suggestions: analysis.suggestions.map((s) => ({ ...s, enRayon: enRayon[s.plante.id] ?? [] })) };
  }

  /** Produits en rayon (stock comptoir > 0, hors ordonnance) dont le nom/DCI contient la plante. */
  private async inStock(user: AuthenticatedUser, suggestions: Suggestion[], excludeIds: string[]) {
    const out: Record<string, { id: string; name: string; form: string | null; dosage: string | null; salePrice: number; stock: number }[]> = {};
    if (!suggestions.length) return out;
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const scope = await scopeOf(tx, user.roleId);
      const visible = await visibleProductIds(tx, scope);
      for (const s of suggestions) {
        const kws = s.motsCles.filter((k) => k.length >= 4);
        if (!kws.length) continue;
        const rows = await tx.product.findMany({
          where: {
            isActive: true,
            prescriptionRequired: false,
            id: { notIn: excludeIds, ...(visible ? { in: visible } : {}) },
            OR: kws.flatMap((k) => [{ name: { contains: k, mode: 'insensitive' as const } }, { dci: { contains: k, mode: 'insensitive' as const } }]),
          },
          select: { id: true, name: true, form: true, dosage: true, salePrice: true },
          take: 12,
        });
        if (!rows.length) continue;
        const stock = await tx.inventoryMovement.groupBy({ by: ['productId'], where: { ...movementWhere({ ...scope, depots: ['main'] }, rows.map((r) => r.id)) }, _sum: { quantity: true } });
        const qty = new Map(stock.map((g) => [g.productId, g._sum.quantity ?? 0]));
        out[s.plante.id] = rows.map((r) => ({ ...r, stock: qty.get(r.id) ?? 0 })).filter((r) => r.stock > 0).sort((a, b) => b.stock - a.stock).slice(0, 3);
      }
    });
    return out;
  }
}
