import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { gunzipSync, gzipSync } from 'zlib';
import { createHash, randomUUID } from 'crypto';
import { AccountingService } from '../accounting/accounting.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { normalizePhone } from '../common/phone.util';
import { OCR_ENGINE, OcrEngine } from '../ocr/ocr.engine';
import { SupplierHubService } from '../suppliers/supplier-hub.service';
import { PrismaService } from '../prisma/prisma.service';
import { detectEntity, Entity, ENTITY_LABEL, expenseAccount, FIELDS, norm, qualityReport, suggestMapping, toDate, toNumber } from './mapping';
import { readFile } from './readers';
import { readWinPharmaFolder } from './winpharma';

type Tx = Prisma.TransactionClient;
/** Nombre au format français, avec des espaces ordinaires (les espaces insécables fines ne passent pas dans toutes les bases). */
const fr = (n: number) => n.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ');
type Row = Record<string, string>;
interface Result { created: number; updated: number; skipped: number; errors: string[]; notes: string[] }

const PUBLIC = { id: true, fileName: true, format: true, tableName: true, entity: true, status: true, columns: true, mapping: true, report: true, rowsTotal: true, rowsImported: true, createdAt: true, importedAt: true } satisfies Prisma.ImportJobSelect;

/**
 * Migration depuis un autre logiciel (ARCHITECTURE.md section 20) : chaque fichier est lu, chaque tableau reconnu
 * (produits, stock, clients, fournisseurs, ventes, depenses, banque), un rapport de qualite est presente, puis
 * l'import est execute en une transaction. Les soldes repris (creances, avoirs, dettes fournisseurs, stock, banque)
 * sont passes en comptabilite au journal des a-nouveaux (AN), jamais comme des ventes nouvelles.
 */
@Injectable()
export class MigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly auditLog: AuditLogService,
    @Inject(OCR_ENGINE) private readonly ocr: OcrEngine,
    private readonly hub: SupplierHubService,
  ) {}

  async analyze(user: AuthenticatedUser, file: { buffer: Buffer; originalname: string } | undefined) {
    if (!file) throw new BadRequestException('Fichier manquant');
    let parsed;
    try { parsed = await readFile(file.buffer, file.originalname, async (img) => (await this.ocr.recognize(img)).text); }
    catch (e) { throw new BadRequestException((e as Error).message); }
    return this.createJobs(user, file.originalname, parsed);
  }

  /** Base d'un ancien logiciel (WinPharma / MySQL .MYD) installée sur cet ordinateur : lue directement depuis son dossier. */
  async analyzeFolder(user: AuthenticatedUser, folder: string, since?: string) {
    const dir = (folder ?? '').trim().replace(/^"+|"+$/g, '');
    if (!dir) throw new BadRequestException('Indiquez le dossier de la base.');
    let wp;
    try { wp = readWinPharmaFolder(dir, { since }); } catch (e) { throw new BadRequestException((e as Error).message); }
    const r = await this.createJobs(user, 'Base ' + (dir.split(/[\\/]/).filter(Boolean).pop() ?? 'WinPharma'), { format: 'winpharma', tables: wp.tables });
    return { ...r, notes: wp.notes };
  }

  private async createJobs(user: AuthenticatedUser, fileName: string, parsed: { format: string; tables: { name: string; columns: string[]; rows: Record<string, string>[] }[] }) {
    const file = { originalname: fileName };
    if (!parsed.tables.length) throw new BadRequestException('Aucun tableau exploitable trouvé dans ce fichier.');
    const jobs = [];
    for (const t of parsed.tables) {
      const { entity, confidence } = detectEntity(t.name, t.columns);
      const mapping = suggestMapping(entity, t.columns);
      const report = { ...qualityReport(entity, mapping, t.rows), detectionConfidence: confidence };
      const job = await this.prisma.forTenant(user.tenantId, (tx) => tx.importJob.create({
        data: { tenantId: user.tenantId, fileName: file.originalname, format: parsed.format, tableName: t.name, entity, columns: t.columns, mapping, report: report as unknown as Prisma.InputJsonValue, rowsTotal: t.rows.length, data: gzipSync(Buffer.from(JSON.stringify(t.rows))), createdById: user.userId },
        select: PUBLIC,
      }));
      jobs.push({ ...job, preview: t.rows.slice(0, 15) });
    }
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'migration.analyzed', entityType: 'import_job', metadata: { file: file.originalname, format: parsed.format, tables: parsed.tables.length } });
    return { format: parsed.format, jobs, entities: ENTITY_LABEL, fields: FIELDS };
  }

  private rows(job: { data: Uint8Array }): Row[] { return JSON.parse(gunzipSync(Buffer.from(job.data)).toString('utf8')); }

  list(tenantId: string) { return this.prisma.forTenant(tenantId, (tx) => tx.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: PUBLIC })); }

  async get(tenantId: string, id: string) {
    const j = await this.prisma.forTenant(tenantId, (tx) => tx.importJob.findUnique({ where: { id } }));
    if (!j) throw new NotFoundException('Import introuvable');
    const { data, ...rest } = j;
    return { ...rest, preview: this.rows({ data }).slice(0, 15), entities: ENTITY_LABEL, fields: FIELDS };
  }

  async remap(user: AuthenticatedUser, id: string, entity: Entity, mapping: Record<string, string>) {
    if (!FIELDS[entity]) throw new BadRequestException('Type de données inconnu');
    const j = await this.prisma.forTenant(user.tenantId, (tx) => tx.importJob.findUnique({ where: { id } }));
    if (!j) throw new NotFoundException('Import introuvable');
    if (j.status === 'imported') throw new ConflictException('Déjà importé');
    const cols = j.columns as string[];
    let clean: Record<string, string> = Object.fromEntries(Object.entries(mapping ?? {}).filter(([f, c]) => FIELDS[entity][f] && cols.includes(c)));
    // changement de type de contenu sans correspondance fournie : l'ERP la propose lui-même (ex. colonne « Produit » = Désignation)
    if (!Object.keys(clean).length && entity !== j.entity) clean = suggestMapping(entity, cols);
    // base produits d'un grossiste : le grossiste choisi est garde avec la correspondance
    if (entity === 'products' && mapping?.__supplier) clean.__supplier = String(mapping.__supplier);
    const report = { ...qualityReport(entity, clean, this.rows(j)), detectionConfidence: (j.report as { detectionConfidence?: number }).detectionConfidence ?? null };
    return this.prisma.forTenant(user.tenantId, (tx) => tx.importJob.update({ where: { id }, data: { entity, mapping: clean, report: report as unknown as Prisma.InputJsonValue }, select: PUBLIC }));
  }

  // =============================================================================================
  // Import
  // =============================================================================================

  async run(user: AuthenticatedUser, id: string) {
    const job = await this.prisma.forTenant(user.tenantId, (tx) => tx.importJob.findUnique({ where: { id } }));
    if (!job) throw new NotFoundException('Import introuvable');
    if (job.status === 'imported') throw new ConflictException('Ce tableau a déjà été importé (pour éviter les doublons, relancez une nouvelle analyse si nécessaire).');
    const entity = job.entity as Entity, map = job.mapping as Record<string, string>;
    const missing = Object.entries(FIELDS[entity]).filter(([k, d]) => d.required && !map[k]).map(([, d]) => d.label);
    if (missing.length) throw new BadRequestException(`Associez d'abord : ${missing.join(', ')}`);
    const rows = this.rows(job);
    const get = (r: Row, f: string) => (map[f] ? (r[map[f]] ?? '').trim() : '');
    const res: Result = { created: 0, updated: 0, skipped: 0, errors: [], notes: [] };

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${user.tenantId}, true)`;
      const ctx = { tx, t: user.tenantId, user, get, res, ref: `${job.fileName} / ${job.tableName}` };
      switch (entity) {
        case 'products': await this.importProducts({ ...ctx, supplierId: map.__supplier || null }, rows); break;
        case 'stock': await this.importStock(ctx, rows); break;
        case 'customers': await this.importCustomers(ctx, rows); break;
        case 'suppliers': await this.importSuppliers(ctx, rows); break;
        case 'sales': await this.importSales(ctx, rows); break;
        case 'expenses': await this.importExpenses(ctx, rows); break;
        case 'bank': await this.importBank(ctx, rows); break;
      }
      await tx.importJob.update({ where: { id }, data: { status: 'imported', rowsImported: entity === 'sales' ? Math.max(0, rows.length - res.skipped) : res.created + res.updated, importedAt: new Date(), report: { ...(job.report as object), result: res } as unknown as Prisma.InputJsonValue } });
    }, { timeout: 900_000, maxWait: 30_000 });

    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'migration.imported', entityType: 'import_job', entityId: id, metadata: { entity, file: job.fileName, created: res.created, updated: res.updated, skipped: res.skipped } });
    // produits importés : les CIP des grossistes (Laborex, CEP…) sont complétés automatiquement d'après le référentiel commun
    if (entity === 'products') { try { const e = await this.hub.enrich(user); res.notes.push(`CIP grossistes complétés automatiquement : ${e.filled} code(s) sur ${e.products} produit(s).`); } catch { /* non bloquant */ } }
    return { ...res, entity };
  }

  // ----- outils communs -----
  private async productIndex(tx: Tx) {
    const products = await tx.product.findMany();
    const idx = new Map<string, (typeof products)[number]>();
    for (const p of products) { idx.set(`sku:${norm(p.sku)}`, p); if (p.barcode) idx.set(`bar:${p.barcode}`, p); idx.set(`name:${norm(p.name)}`, p); }
    return { products, find: (key: string) => idx.get(`sku:${norm(key)}`) ?? idx.get(`bar:${key.replace(/\s/g, '')}`) ?? idx.get(`name:${norm(key)}`), add: (p: (typeof products)[number]) => { idx.set(`sku:${norm(p.sku)}`, p); if (p.barcode) idx.set(`bar:${p.barcode}`, p); idx.set(`name:${norm(p.name)}`, p); } };
  }
  private skuFor(name: string) { return `IMP-${createHash('sha1').update(norm(name)).digest('hex').slice(0, 8).toUpperCase()}`; }
  private async opening(ctx: { tx: Tx; t: string; user: AuthenticatedUser; ref: string }, key: string, label: string, lines: { accountCode: string; debit?: number; credit?: number }[], date = new Date()) {
    const amount = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    if (amount <= 0) return;
    await this.accounting.post(ctx.tx, ctx.t, { journalCode: 'AN', date, label: `${label} (reprise ${ctx.ref})`.slice(0, 200), sourceType: 'migration', sourceKey: `mig:${key}:${createHash('sha1').update(ctx.ref).digest('hex').slice(0, 10)}`, createdById: ctx.user.userId, lines });
  }

  private async importProducts(ctx: { tx: Tx; t: string; get: (r: Row, f: string) => string; res: Result; supplierId?: string | null }, rows: Row[]) {
    const { tx, t, get, res } = ctx;
    const idx = await this.productIndex(tx);
    // base d'un grossiste : chaque article garde son code interne, le CIP du grossiste va dans supplierCodes
    const sup = ctx.supplierId ? await tx.supplier.findUnique({ where: { id: ctx.supplierId } }) : null;
    if (ctx.supplierId && !sup) throw new BadRequestException('Grossiste introuvable');
    const byCip = new Map<string, (typeof idx.products)[number]>();
    if (sup) for (const p of idx.products) { const code = (p.supplierCodes as Record<string, string> | null)?.[sup.id]; if (code) byCip.set(code.replace(/\s/g, ''), p); }
    const cats = new Map((await tx.category.findMany()).map((c) => [norm(c.name), c.id]));
    for (const r of rows) {
      const name = get(r, 'name');
      if (!name) { res.skipped++; continue; }
      let categoryId: string | undefined;
      const cat = get(r, 'category');
      if (cat) { categoryId = cats.get(norm(cat)); if (!categoryId) { categoryId = (await tx.category.create({ data: { tenantId: t, name: cat.slice(0, 80) } })).id; cats.set(norm(cat), categoryId); } }
      const num = (f: string) => { const v = toNumber(get(r, f)); return v === null ? undefined : Math.round(v); };
      const data = {
        name: name.slice(0, 200), dci: get(r, 'dci') || undefined, form: get(r, 'form') || undefined, dosage: get(r, 'dosage') || undefined, laboratory: get(r, 'laboratory') || undefined,
        barcode: get(r, 'barcode').replace(/\s/g, '') || undefined, categoryId, salePrice: num('salePrice'), purchasePrice: num('purchasePrice'), vatRate: num('vatRate'), minStock: num('minStock'),
      };
      if (sup) {
        const cip = (get(r, 'supplierCode') || get(r, 'sku')).replace(/\s/g, '');
        const existing = (cip ? byCip.get(cip) : undefined) ?? (data.barcode ? idx.find(data.barcode) : undefined) ?? idx.find(name);
        const codes = { ...((existing?.supplierCodes as Record<string, string> | null) ?? {}), ...(cip ? { [sup.id]: cip } : {}) };
        // les prix d'une base grossiste ne remplacent pas ceux deja fixes par la pharmacie
        const keep = existing ? { salePrice: existing.salePrice || data.salePrice, purchasePrice: data.purchasePrice ?? existing.purchasePrice } : {};
        if (existing) { const p = await tx.product.update({ where: { id: existing.id }, data: { ...data, ...keep, name: existing.name, supplierCodes: codes } }); idx.add(p); if (cip) byCip.set(cip, p); res.updated++; }
        else { const p = await tx.product.create({ data: { ...data, sku: this.skuFor(name), supplierCodes: codes, tenantId: t } }); idx.add(p); if (cip) byCip.set(cip, p); res.created++; }
        continue;
      }
      const sku = get(r, 'sku') || this.skuFor(name);
      const existing = idx.find(get(r, 'sku')) ?? (data.barcode ? idx.find(data.barcode) : undefined) ?? idx.find(name);
      if (existing) { const p = await tx.product.update({ where: { id: existing.id }, data }); idx.add(p); res.updated++; }
      else { const p = await tx.product.create({ data: { ...data, sku: sku.slice(0, 40), tenantId: t } }); idx.add(p); res.created++; }
    }
  }

  private async importStock(ctx: { tx: Tx; t: string; user: AuthenticatedUser; get: (r: Row, f: string) => string; res: Result; ref: string }, rows: Row[]) {
    const { tx, t, user, get, res } = ctx;
    const idx = await this.productIndex(tx);
    let value = 0, created = 0, noExpiry = 0;
    for (const r of rows) {
      const key = get(r, 'product'), qty = Math.round(toNumber(get(r, 'quantity')) ?? NaN);
      if (!key || !Number.isFinite(qty) || qty === 0) { res.skipped++; continue; }
      let p = idx.find(key);
      if (!p) { p = await tx.product.create({ data: { tenantId: t, sku: this.skuFor(key), name: key.slice(0, 200), purchasePrice: Math.round(toNumber(get(r, 'unitCost')) ?? 0) } }); idx.add(p); created++; }
      let lotId: string | null = null;
      if (p.trackLots) {
        const lotNumber = (get(r, 'lotNumber') || 'REPRISE').toUpperCase().slice(0, 40), exp = toDate(get(r, 'expiryDate'));
        if (!exp) noExpiry++;
        const lot = await tx.lot.upsert({ where: { tenantId_productId_lotNumber: { tenantId: t, productId: p.id, lotNumber } }, create: { tenantId: t, productId: p.id, lotNumber, expiryDate: exp ? new Date(exp) : null, createdById: user.userId }, update: exp ? { expiryDate: new Date(exp) } : {} });
        lotId = lot.id;
      }
      await tx.inventoryMovement.create({ data: { tenantId: t, productId: p.id, lotId, quantity: qty, type: 'opening', reason: 'Stock initial repris d\'un autre logiciel', refType: 'migration', createdById: user.userId } });
      const cost = Math.round(toNumber(get(r, 'unitCost')) ?? p.purchasePrice);
      value += Math.max(0, qty) * cost;
      res.created++;
    }
    if (created) res.notes.push(`${created} produit(s) inconnu(s) créé(s) à partir du nom : complétez leur prix dans « Produits ».`);
    if (noExpiry) res.notes.push(`${noExpiry} lot(s) sans date de péremption : complétez-les dans « Stock » (lot REPRISE).`);
    await this.opening(ctx, 'stock', 'Stock initial', [{ accountCode: '311', debit: value }, { accountCode: '121', credit: value }]);
    if (value) res.notes.push(`Valeur du stock repris : ${fr(value)} FCFA (écriture d'à-nouveau 311 / 121).`);
  }

  private async importCustomers(ctx: { tx: Tx; t: string; user: AuthenticatedUser; get: (r: Row, f: string) => string; res: Result; ref: string }, rows: Row[]) {
    const { tx, t, get, res } = ctx;
    const all = await tx.customer.findMany();
    const byPhone = new Map(all.filter((c) => c.phone).map((c) => [c.phone!, c])), byName = new Map(all.map((c) => [norm(c.name), c]));
    let receivables = 0, credits = 0;
    for (const r of rows) {
      const name = get(r, 'name');
      if (!name) { res.skipped++; continue; }
      const phone = get(r, 'phone') ? normalizePhone(get(r, 'phone')) : null;
      const limit = toNumber(get(r, 'creditLimit')), bal = toNumber(get(r, 'balance')), avoir = toNumber(get(r, 'storeCredit')), term = toNumber(get(r, 'paymentTermDays'));
      // un solde negatif dans l'ancien logiciel = la pharmacie doit de l'argent au client : c'est un avoir
      const due = bal !== null && bal > 0 ? Math.round(bal) : 0;
      const storeCredit = Math.round((avoir ?? 0) + (bal !== null && bal < 0 ? -bal : 0));
      const data = { name: name.slice(0, 120), ...(phone ? { phone } : {}), ...(get(r, 'email') ? { email: get(r, 'email') } : {}), ...(limit !== null ? { creditLimit: Math.max(0, Math.round(limit)) } : {}), ...(term !== null ? { paymentTermDays: Math.round(term) } : {}), creditBalance: due, storeCredit };
      const existing = (phone ? byPhone.get(phone) : undefined) ?? byName.get(norm(name));
      if (existing) { await tx.customer.update({ where: { id: existing.id }, data }); res.updated++; }
      else { const c = await tx.customer.create({ data: { ...data, tenantId: t } }); byName.set(norm(name), c); if (phone) byPhone.set(phone, c); res.created++; }
      receivables += due; credits += storeCredit;
    }
    await this.opening(ctx, 'clients', 'Créances clients (soldes antérieurs)', [{ accountCode: '411', debit: receivables }, { accountCode: '121', credit: receivables }]);
    await this.opening(ctx, 'avoirs', 'Avoirs clients (soldes antérieurs)', [{ accountCode: '121', debit: credits }, { accountCode: '419', credit: credits }]);
    if (receivables) res.notes.push(`Créances reprises : ${fr(receivables)} FCFA (tracées comme « solde antérieur importé », jamais comme des ventes).`);
    if (credits) res.notes.push(`Avoirs repris : ${fr(credits)} FCFA (utilisables à la caisse).`);
  }

  private async importSuppliers(ctx: { tx: Tx; t: string; user: AuthenticatedUser; get: (r: Row, f: string) => string; res: Result; ref: string }, rows: Row[]) {
    const { tx, t, get, res } = ctx;
    const byName = new Map((await tx.supplier.findMany()).map((s) => [norm(s.name), s]));
    let debts = 0;
    for (const r of rows) {
      const name = get(r, 'name');
      if (!name) { res.skipped++; continue; }
      const term = toNumber(get(r, 'paymentTermDays')), bal = toNumber(get(r, 'balance'));
      const data = { name: name.slice(0, 160), ...(get(r, 'phone') && normalizePhone(get(r, 'phone')) ? { phone: normalizePhone(get(r, 'phone'))! } : {}), ...(get(r, 'email') ? { email: get(r, 'email') } : {}), ...(get(r, 'address') ? { address: get(r, 'address').slice(0, 300) } : {}), ...(term !== null ? { paymentTermDays: Math.max(0, Math.round(term)) } : {}) };
      let s = byName.get(norm(name));
      if (s) { s = await tx.supplier.update({ where: { id: s.id }, data }); res.updated++; } else { s = await tx.supplier.create({ data: { ...data, tenantId: t } }); byName.set(norm(name), s); res.created++; }
      if (bal && bal > 0) {
        await tx.supplierInvoice.create({ data: { tenantId: t, supplierId: s.id, number: 'SOLDE ANTERIEUR', issueDate: new Date(), dueDate: new Date(Date.now() + s.paymentTermDays * 86_400_000), amount: Math.round(bal), notes: 'Solde antérieur importé' } });
        debts += Math.round(bal);
      }
    }
    await this.opening(ctx, 'fournisseurs', 'Dettes fournisseurs (soldes antérieurs)', [{ accountCode: '121', debit: debts }, { accountCode: '401', credit: debts }]);
    if (debts) res.notes.push(`Dettes fournisseurs reprises : ${fr(debts)} FCFA (échéances créées dans « Achats intelligents »).`);
  }

  /** Historique des ventes : alimente previsions et statistiques ; ni mouvement de stock, ni ecriture (deja comptabilisees ailleurs). */
  private async importSales(ctx: { tx: Tx; t: string; get: (r: Row, f: string) => string; res: Result }, rows: Row[]) {
    const { tx, t, get, res } = ctx;
    const idx = await this.productIndex(tx);
    const customers = new Map((await tx.customer.findMany()).map((c) => [norm(c.name), c.id]));
    const groups = new Map<string, Row[]>();
    rows.forEach((r, i) => { const k = get(r, 'number') || `${get(r, 'date')}#${i}`; const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]); });
    const method = (s: string) => { const n = norm(s); return /mtn|momo/.test(n) ? 'mtn_momo' : /airtel/.test(n) ? 'airtel_money' : /carte|cb|visa|tpe/.test(n) ? 'card' : /credit|compte/.test(n) ? 'credit' : /assur|tiers|mutuel/.test(n) ? 'insurer' : 'cash'; };
    let created = 0;
    // 1) préparation en mémoire de tous les tickets
    const prepared: { number: string; id: string; date: string; total: number; customerId: string | null; pay: string; items: { productId: string; quantity: number; unitPrice: number; lineTotal: number; unitCost: number }[]; n: number }[] = [];
    for (const [k, lines] of groups) {
      const date = toDate(get(lines[0], 'date'));
      if (!date) { res.skipped += lines.length; continue; }
      const items: { productId: string; quantity: number; unitPrice: number; lineTotal: number; unitCost: number }[] = [];
      for (const r of lines) {
        const key = get(r, 'product'); if (!key) continue;
        let p = idx.find(key);
        if (!p) { p = await tx.product.create({ data: { tenantId: t, sku: this.skuFor(key), name: key.slice(0, 200) } }); idx.add(p); created++; }
        const qty = Math.max(1, Math.round(toNumber(get(r, 'quantity')) ?? 1));
        const total = toNumber(get(r, 'total')), pu = toNumber(get(r, 'unitPrice'));
        const unitPrice = Math.round(pu ?? (total !== null ? total / qty : p.salePrice));
        items.push({ productId: p.id, quantity: qty, unitPrice, lineTotal: Math.round(total ?? unitPrice * qty), unitCost: p.purchasePrice });
      }
      if (!items.length) { res.skipped += lines.length; continue; }
      const total = items.reduce((s, i) => s + i.lineTotal, 0);
      const number = `IMP-${(get(lines[0], 'number') || k).replace(/[^\w-]/g, '').slice(0, 30)}-${createHash('sha1').update(k + date).digest('hex').slice(0, 4)}`;
      prepared.push({ number, id: randomUUID(), date, total, customerId: customers.get(norm(get(lines[0], 'customer'))) ?? null, pay: method(get(lines[0], 'paymentMethod')), items, n: lines.length });
    }
    // 2) tickets déjà repris : ignorés
    const known = new Set<string>();
    for (let i = 0; i < prepared.length; i += 5000) for (const x of await tx.sale.findMany({ where: { number: { in: prepared.slice(i, i + 5000).map((p) => p.number) } }, select: { number: true } })) known.add(x.number);
    const todo = prepared.filter((p) => { if (known.has(p.number)) { res.skipped += p.n; return false; } return true; });
    // 3) insertion par lots (3 requêtes par lot de 1 500 tickets au lieu de 3 par ticket)
    for (let i = 0; i < todo.length; i += 1500) {
      const chunk = todo.slice(i, i + 1500);
      const at = (d: string) => new Date(`${d}T12:00:00Z`);
      await tx.sale.createMany({ data: chunk.map((p) => ({ id: p.id, tenantId: t, number: p.number, imported: true, status: 'completed' as const, total: p.total, subtotal: p.total, paidAmount: p.total, createdAt: at(p.date), customerId: p.customerId })) });
      await tx.saleItem.createMany({ data: chunk.flatMap((p) => p.items.map((it) => ({ ...it, tenantId: t, saleId: p.id }))) });
      await tx.payment.createMany({ data: chunk.map((p) => ({ tenantId: t, saleId: p.id, method: p.pay as never, amount: p.total, status: 'confirmed' as const, confirmedAt: at(p.date), createdAt: at(p.date) })) });
      res.created += chunk.length;
    }
    res.notes.unshift(`${todo.length} ticket(s) repris, regroupant ${todo.reduce((s, p) => s + p.n, 0)} ligne(s) de vente (un ticket peut contenir plusieurs produits).`);
    res.notes.push('Ventes reprises en historique : elles alimentent prévisions, cockpit et statistiques, sans toucher au stock ni à la comptabilité actuels.');
    if (created) res.notes.push(`${created} produit(s) inconnu(s) créé(s) depuis l'historique.`);
  }

  private async importExpenses(ctx: { tx: Tx; t: string; user: AuthenticatedUser; get: (r: Row, f: string) => string; res: Result; ref: string }, rows: Row[]) {
    const { tx, t, user, get, res } = ctx;
    let i = 0;
    for (const r of rows) {
      i++;
      const date = toDate(get(r, 'date')), amount = Math.round(toNumber(get(r, 'amount')) ?? 0), label = get(r, 'label');
      if (!date || amount <= 0 || !label) { res.skipped++; continue; }
      const account = /^\d{3,8}$/.test(get(r, 'category')) ? get(r, 'category') : expenseAccount(`${get(r, 'category')} ${label}`);
      const paid = /banq|cheq|vir/.test(norm(get(r, 'paidWith'))) ? '521' : /momo|mtn/.test(norm(get(r, 'paidWith'))) ? '5215' : /airtel/.test(norm(get(r, 'paidWith'))) ? '5216' : '571';
      try {
        await this.accounting.post(tx, t, { journalCode: 'OD', date: new Date(date), label: `Dépense reprise : ${label}`.slice(0, 200), sourceType: 'migration', sourceKey: `mig:dep:${createHash('sha1').update(ctx.ref + i + label + date + amount).digest('hex').slice(0, 16)}`, createdById: user.userId, lines: [{ accountCode: account, debit: amount }, { accountCode: paid, credit: amount }] });
        res.created++;
      } catch (e) { res.skipped++; if (res.errors.length < 50) res.errors.push(`Ligne ${i + 1} : ${(e as Error).message}`); }
    }
    res.notes.push('Dépenses comptabilisées au journal OD avec le compte de charge déduit du libellé (modifiable par contre-passation).');
  }

  private async importBank(ctx: { tx: Tx; t: string; user: AuthenticatedUser; get: (r: Row, f: string) => string; res: Result; ref: string }, rows: Row[]) {
    const { get, res } = ctx;
    const dated = rows.map((r) => ({ r, d: toDate(get(r, 'date')) })).filter((x) => x.d).sort((a, b) => a.d!.localeCompare(b.d!));
    if (!dated.length) throw new BadRequestException('Aucune date lisible dans le relevé.');
    let balance: number | null = null;
    const last = dated[dated.length - 1];
    if (get(last.r, 'balance')) balance = toNumber(get(last.r, 'balance'));
    if (balance === null) balance = dated.reduce((s, x) => s + (toNumber(get(x.r, 'credit')) ?? 0) - (toNumber(get(x.r, 'debit')) ?? 0) + (toNumber(get(x.r, 'amount')) ?? 0), 0);
    const b = Math.round(balance);
    if (b > 0) await this.opening(ctx, 'banque', `Solde bancaire au ${last.d}`, [{ accountCode: '521', debit: b }, { accountCode: '121', credit: b }], new Date(last.d!));
    else if (b < 0) await this.opening(ctx, 'banque', `Découvert bancaire au ${last.d}`, [{ accountCode: '121', debit: -b }, { accountCode: '521', credit: -b }], new Date(last.d!));
    res.created = dated.length;
    res.notes.push(`Solde bancaire repris au ${last.d} : ${fr(b)} FCFA (écriture d'à-nouveau 521 / 121). Le détail des opérations reste consultable dans le fichier d'origine.`);
  }
}
