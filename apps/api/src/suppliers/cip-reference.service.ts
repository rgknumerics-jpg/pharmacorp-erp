import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { nameTokens, similarity } from './order-export';

export interface RefRow { cip: string; designation: string; dci: string; providers: string[] }

/** Clé de référentiel d'un fournisseur d'après son nom ou son abréviation (laborex, cep, ubipharm). */
export function providerKey(name?: string | null, abbreviation?: string | null): string | null {
  const s = `${name ?? ''} ${abbreviation ?? ''}`.toLowerCase();
  if (/laborex|\blbx\b/.test(s)) return 'laborex';
  if (/\bubi/.test(s)) return 'ubipharm';
  if (/\bcep\b|\bsep\b|\bcopharco\b/.test(s)) return /copharco/.test(s) && !/\b(cep|sep)\b/.test(s) ? null : 'cep';
  return null;
}

/**
 * Référentiel CIP commun : réunit les catalogues des grossistes (Laborex, CEP/SEP, Ubipharm) pour retrouver, à partir d'un libellé,
 * le code de chaque fournisseur. Données chargées depuis data/cip-reference.json (construit par Desktop\API\cip-referentiel\build.mjs).
 */
@Injectable()
export class CipReferenceService implements OnModuleInit {
  private readonly log = new Logger('CipReference');
  private cache: RefRow[] | null = null;
  private index: Map<string, RefRow[]> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const file = path.resolve(__dirname, '../../data/cip-reference.json');
      if (!existsSync(file)) return;
      const data = JSON.parse(readFileSync(file, 'utf8')) as { c: string; d: string; i: string; p: string[] }[];
      const count = await this.prisma.cipReference.count();
      if (count === data.length) return;
      await this.prisma.cipReference.deleteMany();
      for (let k = 0; k < data.length; k += 1000) {
        await this.prisma.cipReference.createMany({ data: data.slice(k, k + 1000).map((x) => ({ cip: x.c, designation: x.d, dci: x.i, providers: x.p })), skipDuplicates: true });
      }
      this.cache = null;
      this.log.log(`Référentiel CIP chargé : ${data.length} codes`);
    } catch (e) {
      this.log.warn(`Référentiel CIP non chargé : ${(e as Error).message}`);
    }
  }

  async all(): Promise<RefRow[]> {
    if (!this.cache) {
      this.cache = await this.prisma.cipReference.findMany();
      this.index = new Map();
      for (const r of this.cache) for (const t of new Set(nameTokens(r.designation))) { const a = this.index.get(t) ?? []; a.push(r); this.index.set(t, a); }
    }
    return this.cache;
  }

  /** Meilleures correspondances (score ≥ min) pour un libellé ; un CIP saisi tel quel est retrouvé directement. */
  async search(q: string, min = 60, limit = 5): Promise<(RefRow & { score: number })[]> {
    await this.all();
    const digits = q.replace(/\s/g, '');
    if (/^\d{6,13}$/.test(digits)) {
      const hit = this.cache!.filter((r) => r.cip === digits || r.cip.endsWith(digits) || digits.endsWith(r.cip)).slice(0, limit);
      return hit.map((r) => ({ ...r, score: 100 }));
    }
    const toks = nameTokens(q);
    if (!toks.length) return [];
    // candidats : lignes qui partagent le mot le plus rare de la recherche
    let cands: RefRow[] = [];
    for (const t of toks) { const a = this.index!.get(t); if (a && (!cands.length || a.length < cands.length)) cands = a; }
    return cands.map((r) => ({ ...r, score: similarity(q, r.designation) })).filter((x) => x.score >= min).sort((a, b) => b.score - a.score || a.cip.length - b.cip.length).slice(0, limit);
  }
}
