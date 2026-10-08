import { scopeOf, visibleProductIds } from '../common/vat-scope';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OutboxEvent, Prisma } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { buildFiscalDocument, FiscalLine } from '../fiscal/fiscal';
import { PrismaService } from '../prisma/prisma.service';
import { journalOfMethod, POSTING, SYSCOHADA_CHART } from './chart';
import { ManualEntryDto } from './accounting.dto';
import { balanceSheet, incomeStatement, SMT_THRESHOLD_TRADING } from './statements';

type Tx = Prisma.TransactionClient;
interface Line { accountCode: string; debit?: number; credit?: number; label?: string }

const MAX_ATTEMPTS = 5;

@Injectable()
export class AccountingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountingService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Traitement continu de l'outbox (desactive en test et via ACCOUNTING_WORKER=off). */
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.ACCOUNTING_WORKER === 'off') return;
    this.timer = setInterval(() => void this.processAllTenants().catch((e) => this.logger.error(e)), 15_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ---------------------------------------------------------------------------------------------
  // Primitives
  // ---------------------------------------------------------------------------------------------

  async ensureChart(tx: Tx, tenantId: string) {
    // complete aussi le plan des etablissements existants quand de nouveaux comptes standard sont ajoutes
    if ((await tx.account.count({ where: { code: { in: SYSCOHADA_CHART.map((a) => a.code) } } })) >= SYSCOHADA_CHART.length) return;
    await tx.account.createMany({ data: SYSCOHADA_CHART.map((a) => ({ ...a, tenantId })), skipDuplicates: true });
  }

  /** Ecriture equilibree, numerotee par journal ; idempotente sur `sourceKey`. */
  async post(
    tx: Tx,
    tenantId: string,
    e: { journalCode: string; date: Date; label: string; lines: Line[]; sourceType?: string; sourceId?: string; sourceKey?: string; reversalOfId?: string; createdById?: string },
  ) {
    if (e.sourceKey) {
      const existing = await tx.journalEntry.findUnique({ where: { tenantId_sourceKey: { tenantId, sourceKey: e.sourceKey } } });
      if (existing) return existing;
    }
    const lines = e.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
    if (lines.length < 2) throw new BadRequestException('Une ecriture comporte au moins deux lignes.');
    for (const l of lines) {
      if ((l.debit ?? 0) < 0 || (l.credit ?? 0) < 0 || ((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0)) throw new BadRequestException('Chaque ligne est soit au debit, soit au crédit, en montant positif.');
    }
    const d = lines.reduce((s, l) => s + (l.debit ?? 0), 0), c = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (d !== c) throw new BadRequestException(`Ecriture desequilibree (debit ${d}, crédit ${c}).`);
    await this.ensureChart(tx, tenantId);
    const codes = [...new Set(lines.map((l) => l.accountCode))];
    const known = await tx.account.findMany({ where: { code: { in: codes }, isActive: true }, select: { code: true } });
    const missing = codes.filter((x) => !known.some((k) => k.code === x));
    if (missing.length) throw new BadRequestException(`Compte(s) inconnu(s) : ${missing.join(', ')}`);
    const number = await nextNumber(tx, tenantId, e.journalCode);
    return tx.journalEntry.create({
      data: {
        tenantId, number, journalCode: e.journalCode, date: e.date, label: e.label.slice(0, 200), sourceType: e.sourceType, sourceId: e.sourceId,
        sourceKey: e.sourceKey, reversalOfId: e.reversalOfId, createdById: e.createdById,
        lines: { create: lines.map((l) => ({ tenantId, accountCode: l.accountCode, debit: l.debit ?? 0, credit: l.credit ?? 0, label: l.label?.slice(0, 200) })) },
      },
    });
  }

  /** Contre-passation : nouvelle ecriture inversee, l'originale reste intacte (ARCHITECTURE.md section 14). */
  private async reverseEntry(tx: Tx, tenantId: string, entryId: string, label: string, sourceKey: string, createdById?: string) {
    const orig = await tx.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true } });
    if (!orig) throw new NotFoundException('Ecriture introuvable');
    if (orig.reversalOfId) throw new ConflictException('Une contre-passation ne se contre-passe pas : saisissez une nouvelle ecriture.');
    if (await tx.journalEntry.findFirst({ where: { reversalOfId: entryId } })) throw new ConflictException('Écriture déjà contre-passée');
    return this.post(tx, tenantId, {
      journalCode: orig.journalCode, date: new Date(), label: `Contre-passation ${orig.number} : ${label}`, sourceType: orig.sourceType ?? undefined, sourceId: orig.sourceId ?? undefined,
      sourceKey, reversalOfId: orig.id, createdById,
      lines: orig.lines.map((l) => ({ accountCode: l.accountCode, debit: l.credit, credit: l.debit, label: l.label ?? undefined })),
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Evenements -> ecritures (et factures normalisees)
  // ---------------------------------------------------------------------------------------------

  private async handle(tx: Tx, ev: OutboxEvent) {
    const t = ev.tenantId, p = ev.payload as Record<string, unknown>;
    const date = new Date((p.date as string) ?? ev.createdAt);
    switch (ev.type) {
      case 'sale.created': {
        const total = p.total as number, vat = p.vat as number, cost = p.cost as number;
        if (total > 0) {
          await this.post(tx, t, {
            journalCode: 'VE', date, label: `Vente ${p.number}`, sourceType: 'sale', sourceId: p.saleId as string, sourceKey: `${ev.id}:ve`,
            lines: [{ accountCode: POSTING.customers, debit: total }, { accountCode: POSTING.sales, credit: total - vat }, { accountCode: POSTING.vatCollected, credit: vat }],
          });
        }
        if (cost > 0) {
          await this.post(tx, t, {
            journalCode: 'OD', date, label: `Sortie de stock vente ${p.number}`, sourceType: 'sale', sourceId: p.saleId as string, sourceKey: `${ev.id}:cogs`,
            lines: [{ accountCode: POSTING.stockVariation, debit: cost }, { accountCode: POSTING.stock, credit: cost }],
          });
        }
        await this.createFiscalInvoice(tx, t, p, 'invoice');
        return;
      }
      case 'payment.confirmed': {
        const method = p.method as string, amount = p.amount as number;
        if (method === 'credit' || method === 'insurer' || amount <= 0) return;
        if (method === 'loyalty' || method === 'store_credit') { // points (remise accordee) ou avoir (dette envers le client) soldant la creance
          await this.post(tx, t, { journalCode: 'OD', date, label: method === 'loyalty' ? 'Paiement en points de fidélité' : 'Paiement par avoir client', sourceType: 'sale', sourceId: p.saleId as string, sourceKey: `${ev.id}:pay`, lines: [{ accountCode: method === 'loyalty' ? '709' : '419', debit: amount }, { accountCode: POSTING.customers, credit: amount }] });
          return;
        } // la creance reste au compte client jusqu'au remboursement
        await this.post(tx, t, {
          journalCode: journalOfMethod(method), date, label: `Encaissement vente ${p.number ?? ''}`.trim(), sourceType: 'sale', sourceId: p.saleId as string, sourceKey: `${ev.id}:pay`,
          lines: [{ accountCode: POSTING.treasury[method] ?? POSTING.treasury.cash, debit: amount }, { accountCode: POSTING.customers, credit: amount }],
        });
        return;
      }
      case 'sale.voided': {
        const entries = await tx.journalEntry.findMany({ where: { sourceType: 'sale', sourceId: p.saleId as string, reversalOfId: null } });
        for (const e of entries) {
          if (await tx.journalEntry.findFirst({ where: { reversalOfId: e.id } })) continue;
          await this.reverseEntry(tx, t, e.id, `annulation vente ${p.number} (${p.reason})`, `${ev.id}:rev:${e.id}`);
        }
        const inv = await tx.fiscalInvoice.findUnique({ where: { tenantId_saleId_kind: { tenantId: t, saleId: p.saleId as string, kind: 'invoice' } } });
        if (inv) await this.createFiscalInvoice(tx, t, { ...(inv.payload as Record<string, unknown>), saleId: p.saleId, originalNumber: inv.number }, 'credit_note');
        return;
      }
      case 'goods.received': {
        const amount = p.amount as number;
        if (amount <= 0) return;
        await this.post(tx, t, {
          journalCode: 'AC', date, label: `Reception ${p.number}${p.supplierRef ? ` (BL ${p.supplierRef})` : ''}`, sourceType: 'goods_receipt', sourceId: p.receiptId as string, sourceKey: `${ev.id}:ac`,
          lines: [{ accountCode: POSTING.stock, debit: amount }, { accountCode: POSTING.suppliers, credit: amount }],
        });
        return;
      }
      case 'credit.repaid': {
        await this.post(tx, t, {
          journalCode: 'CA', date, label: `Règlement de créance client`, sourceType: 'customer', sourceId: p.customerId as string, sourceKey: `${ev.id}:repay`,
          lines: [{ accountCode: POSTING.treasury.cash, debit: p.amount as number }, { accountCode: POSTING.customers, credit: p.amount as number }],
        });
        return;
      }
      case 'stock.adjusted': {
        const value = Math.abs((p.quantity as number) * (p.unitCost as number));
        if (!value) return;
        const loss = (p.quantity as number) < 0;
        await this.post(tx, t, {
          journalCode: 'OD', date, label: `${loss ? 'Perte' : 'Regularisation'} de stock : ${p.reason ?? ''}`.trim(), sourceType: 'inventory_movement', sourceId: p.movementId as string, sourceKey: `${ev.id}:adj`,
          lines: loss
            ? [{ accountCode: POSTING.stockLoss, debit: value }, { accountCode: POSTING.stock, credit: value }]
            : [{ accountCode: POSTING.stock, debit: value }, { accountCode: POSTING.stockGain, credit: value }],
        });
        return;
      }
      case 'payroll.validated': {
        const tt = p.totals as Record<string, number>;
        if (!tt?.gross) return;
        await this.post(tx, t, {
          journalCode: 'OD', date, label: `Paie ${p.period}`, sourceType: 'payroll_run', sourceId: p.runId as string, sourceKey: `${ev.id}:paie`,
          lines: [
            { accountCode: '661', debit: tt.gross, label: 'Salaires bruts' },
            { accountCode: '664', debit: tt.cnssEmployer + tt.camuEmployer, label: 'CNSS et CAMU patronales' },
            { accountCode: '641', debit: tt.tusTax + tt.tusSocial, label: 'TUS' },
            ...(tt.allowances ? [{ accountCode: '663', debit: tt.allowances, label: 'Indemnités non soumises (allocations, transport)' }] : []),
            ...(tt.deductionsAdvances ? [{ accountCode: '421', credit: tt.deductionsAdvances, label: 'Acomptes, avances et prêts retenus' }] : []),
            ...(tt.deductionsPharmacy ? [{ accountCode: '411', credit: tt.deductionsPharmacy, label: 'Achats du personnel à la pharmacie retenus' }] : []),
            { accountCode: '422', credit: tt.netToPay ?? tt.net, label: 'Salaires nets à payer' },
            { accountCode: '431', credit: tt.cnssEmployee + tt.cnssEmployer + tt.tusSocial, label: 'CNSS (dont TUS part CNSS)' },
            { accountCode: '447', credit: tt.its + tt.tol + tt.camuEmployee + tt.camuEmployer + tt.tusTax, label: 'ITS, TOL, CAMU, TUS part impôts' },
          ],
        });
        return;
      }
      case 'cash.expense': {
        await this.post(tx, t, {
          journalCode: 'CA', date, label: p.label as string, sourceType: 'cash_expense', sourceId: p.expenseId as string, sourceKey: `${ev.id}:dep`,
          lines: [{ accountCode: p.accountCode as string, debit: p.amount as number }, { accountCode: POSTING.treasury.cash, credit: p.amount as number }],
        });
        return;
      }
      case 'insurer.paid': {
        const m = (p.method as string) ?? 'card';
        await this.post(tx, t, {
          journalCode: journalOfMethod(m), date, label: `Règlement tiers payant ${p.insurerName ?? ''}`.trim(), sourceType: 'insurer', sourceId: p.insurerId as string, sourceKey: `${ev.id}:ins`,
          lines: [{ accountCode: POSTING.treasury[m] ?? POSTING.treasury.card, debit: p.amount as number }, { accountCode: POSTING.customers, credit: p.amount as number }],
        });
        return;
      }
      case 'supplier.paid': {
        const m = (p.method as string) ?? 'cash';
        await this.post(tx, t, {
          journalCode: journalOfMethod(m), date, label: `Règlement fournisseur ${p.supplierName ?? ''} ${p.number ?? ''}`.trim(), sourceType: 'supplier_invoice', sourceId: p.invoiceId as string, sourceKey: `${ev.id}:sup`,
          lines: [{ accountCode: POSTING.suppliers, debit: p.amount as number }, { accountCode: POSTING.treasury[m] ?? POSTING.treasury.cash, credit: p.amount as number }],
        });
        return;
      }
      default:
        throw new Error(`Type d'événement inconnu : ${ev.type}`);
    }
  }

  /** Facture normalisee (ou avoir) mise en file de certification SFEC : la vente n'attend jamais. */
  private async createFiscalInvoice(tx: Tx, tenantId: string, p: Record<string, unknown>, kind: 'invoice' | 'credit_note') {
    const saleId = p.saleId as string;
    const existing = await tx.fiscalInvoice.findUnique({ where: { tenantId_saleId_kind: { tenantId, saleId, kind } } });
    if (existing) return existing;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const lines = (kind === 'invoice' ? p.lines : (p as { lines: FiscalLine[] }).lines.map((l) => ({ ...l, lineTotal: Math.abs(l.lineTotal) }))) as FiscalLine[];
    const number = kind === 'invoice' ? (p.number as string) : `${p.originalNumber as string}-AV`;
    const doc = buildFiscalDocument({
      kind, number, issuedAt: new Date(), seller: { tenantId, name: tenant.name, country: tenant.country },
      customer: (p.customer as { name: string | null; phone: string | null } | null) ?? null, lines,
      originalNumber: kind === 'credit_note' ? (p.originalNumber as string) : undefined,
    });
    return tx.fiscalInvoice.create({ data: { tenantId, saleId, kind, number, payload: doc as unknown as Prisma.InputJsonValue } });
  }

  // ---------------------------------------------------------------------------------------------
  // Traitement de la file
  // ---------------------------------------------------------------------------------------------

  async processTenant(tenantId: string, limit = 200) {
    const ids = await this.prisma.forTenant(tenantId, (tx) =>
      tx.outboxEvent.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true } }),
    );
    let processed = 0, failed = 0;
    for (const { id } of ids) {
      try {
        const done = await this.prisma.forTenant(tenantId, async (tx) => {
          // verrou : deux traitements simultanes ne prennent jamais le même evenement
          const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM outbox_events WHERE id = ${id}::uuid AND status = 'pending' FOR UPDATE SKIP LOCKED`;
          if (!locked.length) return false;
          const ev = await tx.outboxEvent.findUniqueOrThrow({ where: { id } });
          await this.handle(tx, ev);
          await tx.outboxEvent.update({ where: { id }, data: { status: 'processed', processedAt: new Date(), attempts: { increment: 1 } } });
          return true;
        });
        if (done) processed += 1;
      } catch (e) {
        failed += 1;
        const msg = (e as Error).message.slice(0, 500);
        this.logger.error(`Evenement ${id} : ${msg}`);
        await this.prisma.forTenant(tenantId, async (tx) => {
          const ev = await tx.outboxEvent.findUnique({ where: { id } });
          if (!ev) return;
          await tx.outboxEvent.update({ where: { id }, data: { attempts: { increment: 1 }, lastError: msg, status: ev.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending' } });
        });
      }
    }
    return { processed, failed };
  }

  async processAllTenants() {
    const tenants = await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
    for (const t of tenants) await this.processTenant(t.id);
  }

  async retryFailed(user: AuthenticatedUser) {
    const r = await this.prisma.forTenant(user.tenantId, (tx) => tx.outboxEvent.updateMany({ where: { status: 'failed' }, data: { status: 'pending', attempts: 0 } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'accounting.outbox_retry', entityType: 'outbox_event', metadata: { count: r.count } });
    return this.processTenant(user.tenantId);
  }

  // ---------------------------------------------------------------------------------------------
  // Consultation
  // ---------------------------------------------------------------------------------------------

  accounts(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => { await this.ensureChart(tx, tenantId); return tx.account.findMany({ orderBy: { code: 'asc' } }); });
  }

  async createAccount(user: AuthenticatedUser, dto: { code: string; name: string; type: string }) {
    try {
      return await this.prisma.forTenant(user.tenantId, async (tx) => {
        await this.ensureChart(tx, user.tenantId);
        return tx.account.create({ data: { tenantId: user.tenantId, code: dto.code, name: dto.name, type: dto.type as never } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Ce numero de compte existe déjà');
      throw e;
    }
  }

  /**
   * Ecritures hors du perimetre du role (TVA / fournisseurs regles par l'administrateur) : ventes et encaissements sans
   * article visible, receptions et factures de fournisseurs non visibles, mouvements de stock de produits masques.
   * `null` = aucune restriction. Les etats (balance, bilan) du role sont alors calcules sans ces ecritures.
   */
  private async hiddenEntries(tx: Prisma.TransactionClient, roleId?: string): Promise<string[] | null> {
    if (!roleId) return null;
    const sc = await scopeOf(tx, roleId);
    if (!sc.rates && !sc.suppliers) return null;
    const ids = (await visibleProductIds(tx, sc)) ?? [];
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM journal_entries e
      WHERE (e.source_type = 'sale' AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id::text = e.source_id AND si.product_id = ANY(${ids}::uuid[])))
         OR (e.source_type = 'inventory_movement' AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.id::text = e.source_id AND m.product_id = ANY(${ids}::uuid[])))
         OR (${sc.suppliers}::text[] IS NOT NULL AND e.source_type = 'goods_receipt' AND NOT EXISTS (SELECT 1 FROM goods_receipts g WHERE g.id::text = e.source_id AND g.supplier_id::text = ANY(${sc.suppliers}::text[])))
         OR (${sc.suppliers}::text[] IS NOT NULL AND e.source_type = 'supplier_invoice' AND NOT EXISTS (SELECT 1 FROM supplier_invoices i WHERE i.id::text = e.source_id AND i.supplier_id::text = ANY(${sc.suppliers}::text[])))`;
    return rows.map((r) => r.id);
  }

  entries(tenantId: string, q: { journal?: string; from?: string; to?: string; take: number; skip: number; roleId?: string }) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const hidden = await this.hiddenEntries(tx, q.roleId);
      return tx.journalEntry.findMany({
        where: { ...(hidden ? { id: { notIn: hidden } } : {}), ...(q.journal ? { journalCode: q.journal } : {}), ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}) },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        take: q.take, skip: q.skip,
        include: { lines: true },
      });
    });
  }

  async ledger(tenantId: string, account: string, from?: string, to?: string, roleId?: string) {
    const rows = await this.prisma.forTenant(tenantId, async (tx) => {
      const hidden = await this.hiddenEntries(tx, roleId);
      return tx.journalLine.findMany({
        where: { accountCode: account, entry: { ...(hidden ? { id: { notIn: hidden } } : {}), ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) } },
        include: { entry: { select: { number: true, date: true, label: true, journalCode: true } } },
        orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
        take: 2000,
      });
    });
    let balance = 0;
    return rows.map((r) => { balance += r.debit - r.credit; return { date: r.entry.date, number: r.entry.number, journal: r.entry.journalCode, label: r.label ?? r.entry.label, debit: r.debit, credit: r.credit, balance }; });
  }

  /** Balance generale : totaux debit / credit et solde par compte ; le total des debits egale toujours celui des credits. */
  async trialBalance(tenantId: string, from?: string, to?: string, roleId?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      await this.ensureChart(tx, tenantId);
      const hidden = await this.hiddenEntries(tx, roleId);
      const sums = await tx.journalLine.groupBy({
        by: ['accountCode'],
        where: { entry: { ...(hidden ? { id: { notIn: hidden } } : {}), ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) } },
        _sum: { debit: true, credit: true },
      });
      const names = new Map((await tx.account.findMany()).map((a) => [a.code, a.name]));
      const rows = sums.map((s) => ({ account: s.accountCode, name: names.get(s.accountCode) ?? '', debit: s._sum.debit ?? 0, credit: s._sum.credit ?? 0, balance: (s._sum.debit ?? 0) - (s._sum.credit ?? 0) }))
        .sort((a, b) => a.account.localeCompare(b.account));
      return { rows, totalDebit: rows.reduce((s, r) => s + r.debit, 0), totalCredit: rows.reduce((s, r) => s + r.credit, 0) };
    });
  }

  /** Etats financiers de l'exercice civil `year` : bilan (soldes cumules à la clôture) et compte de résultat (mouvements de l'exercice). */
  async statements(tenantId: string, year: number, roleId?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      await this.ensureChart(tx, tenantId);
      const hidden = await this.hiddenEntries(tx, roleId);
      const start = new Date(Date.UTC(year, 0, 1)), end = new Date(Date.UTC(year + 1, 0, 1));
      const group = (where: Prisma.JournalLineWhereInput) => tx.journalLine.groupBy({ by: ['accountCode'], where, _sum: { debit: true, credit: true } });
      const notHidden = hidden ? { id: { notIn: hidden } } : {};
      const bs = await group({ entry: { ...notHidden, date: { lt: end } }, accountCode: { lt: '6' } });
      const pl = await group({ entry: { ...notHidden, date: { gte: start, lt: end } }, accountCode: { gte: '6' } });
      const names = new Map((await tx.account.findMany()).map((a) => [a.code, a.name]));
      const rows = [...bs, ...pl].map((g) => ({ account: g.accountCode, name: names.get(g.accountCode) ?? '', debit: g._sum.debit ?? 0, credit: g._sum.credit ?? 0 }));
      const income = incomeStatement(rows);
      return {
        year, income, balance: balanceSheet(rows),
        system: income.chiffreAffaires < SMT_THRESHOLD_TRADING ? 'SMT possible (CA HT < 60 M FCFA, Acte uniforme art. 13) ; Système normal par défaut' : 'Système normal (Acte uniforme art. 11)',
        deadline: `États financiers à arrêter dans les 4 mois de la clôture (Acte uniforme art. 23) ; DSF au plus tard le 15 mai ${year + 1}`,
        notice: 'Présentation de pilotage simplifiée : la liasse DSF officielle est établie et signée par l\'expert-comptable.',
      };
    });
  }

  async outboxStatus(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const counts = await tx.outboxEvent.groupBy({ by: ['status'], _count: true });
      const failed = await tx.outboxEvent.findMany({ where: { status: 'failed' }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, type: true, attempts: true, lastError: true, createdAt: true } });
      return { counts: Object.fromEntries(counts.map((c) => [c.status, c._count])), failed };
    });
  }

  /** Reconciliation ventes <-> ecritures (ARCHITECTURE.md section 2) : ventes sans ecriture de vente apres traitement. */
  async reconciliation(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const missing = await tx.$queryRaw<{ id: string; number: string; total: number; created_at: Date }[]>`
        SELECT s.id, s.number, s.total, s.created_at FROM sales s
        WHERE s.total > 0 AND s.created_at < now() - interval '2 minutes'
          AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.source_type = 'sale' AND e.source_id = s.id::text AND e.journal_code = 'VE')
        ORDER BY s.created_at DESC LIMIT 200`;
      const [tot] = await tx.$queryRaw<{ sales: number; booked: number }[]>`
        SELECT (SELECT COALESCE(SUM(total),0) FROM sales WHERE status <> 'void')::int AS sales,
               (SELECT COALESCE(SUM(l.debit - l.credit),0) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.journal_code = 'VE' AND l.account_code = ${POSTING.customers})::int AS booked`;
      return { salesWithoutEntry: missing, totalSales: tot?.sales ?? 0, totalBooked: tot?.booked ?? 0, gap: (tot?.sales ?? 0) - (tot?.booked ?? 0) };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Saisie manuelle
  // ---------------------------------------------------------------------------------------------

  async manualEntry(user: AuthenticatedUser, dto: ManualEntryDto) {
    const e = await this.prisma.forTenant(user.tenantId, (tx) =>
      this.post(tx, user.tenantId, { journalCode: dto.journalCode ?? 'OD', date: new Date(dto.date), label: dto.label, lines: dto.lines, createdById: user.userId, sourceType: 'manual' }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'accounting.manual_entry', entityType: 'journal_entry', entityId: e.id, metadata: { number: e.number } });
    return e;
  }

  async reverse(user: AuthenticatedUser, entryId: string, reason: string) {
    const e = await this.prisma.forTenant(user.tenantId, (tx) => this.reverseEntry(tx, user.tenantId, entryId, reason, `manual-rev:${entryId}`, user.userId));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'accounting.reversed', entityType: 'journal_entry', entityId: entryId, metadata: { reversal: e.id, reason } });
    return e;
  }
}
