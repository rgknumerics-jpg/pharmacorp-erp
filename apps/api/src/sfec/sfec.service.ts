import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { FiscalDocument } from '../fiscal/fiscal';
import { PrismaService } from '../prisma/prisma.service';
import { SFEC_ADAPTER, SfecAdapter, SfecRejectedError } from './sfec.adapter';

/** Delai avant le prochain essai : 1, 2, 4... minutes, plafonne a 6 heures. */
export const backoffMinutes = (attempts: number) => Math.min(360, 2 ** Math.max(0, attempts - 1));

/**
 * Certification SFEC. Jamais bloquante pour la caisse (ARCHITECTURE.md section 13) : si l'API est indisponible,
 * la facture passe en "provisoire" et la certification est reessayee automatiquement (file persistee en base).
 */
@Injectable()
export class SfecService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SfecService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    @Inject(SFEC_ADAPTER) private readonly adapter: SfecAdapter,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.SFEC_WORKER === 'off') return;
    this.timer = setInterval(() => void this.processAllTenants().catch((e) => this.logger.error(e)), 30_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async processTenant(tenantId: string, limit = 50) {
    const due = await this.prisma.forTenant(tenantId, (tx) =>
      tx.fiscalInvoice.findMany({ where: { status: { in: ['pending', 'provisional'] }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: limit }),
    );
    let certified = 0, provisional = 0, rejected = 0;
    for (const inv of due) {
      try {
        const c = await this.adapter.certify(inv.payload as unknown as FiscalDocument);
        await this.prisma.forTenant(tenantId, (tx) => tx.fiscalInvoice.update({ where: { id: inv.id }, data: { status: 'certified', certificationRef: c.reference, certificationQr: c.qr, certifiedAt: new Date(), attempts: { increment: 1 }, lastError: null } }));
        certified += 1;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        if (e instanceof SfecRejectedError) {
          await this.prisma.forTenant(tenantId, (tx) => tx.fiscalInvoice.update({ where: { id: inv.id }, data: { status: 'rejected', attempts: { increment: 1 }, lastError: msg } }));
          await this.auditLog.record({ tenantId, action: 'sfec.rejected', entityType: 'fiscal_invoice', entityId: inv.id, metadata: { number: inv.number, error: msg } });
          rejected += 1;
        } else {
          const attempts = inv.attempts + 1;
          await this.prisma.forTenant(tenantId, (tx) => tx.fiscalInvoice.update({
            where: { id: inv.id },
            data: { status: 'provisional', attempts, lastError: msg, nextAttemptAt: new Date(Date.now() + backoffMinutes(attempts) * 60_000) },
          }));
          provisional += 1;
        }
      }
    }
    return { certified, provisional, rejected, adapter: this.adapter.name };
  }

  async processAllTenants() {
    for (const t of await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } })) await this.processTenant(t.id);
  }

  list(tenantId: string, status?: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.fiscalInvoice.findMany({ where: status ? { status: status as never } : {}, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, saleId: true, kind: true, number: true, status: true, attempts: true, nextAttemptAt: true, certificationRef: true, certifiedAt: true, lastError: true, createdAt: true } }),
    );
  }

  async forSale(tenantId: string, saleId: string) {
    const rows = await this.prisma.forTenant(tenantId, (tx) => tx.fiscalInvoice.findMany({ where: { saleId }, orderBy: { createdAt: 'asc' } }));
    if (!rows.length) throw new NotFoundException('Facture normalisee pas encore generee pour cette vente');
    return rows;
  }

  /** Relance manuelle (apres correction d'un rejet, ou pour ne pas attendre le prochain essai). */
  async retryNow(user: AuthenticatedUser, id: string) {
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const inv = await tx.fiscalInvoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException('Facture introuvable');
      await tx.fiscalInvoice.update({ where: { id }, data: { status: inv.status === 'certified' ? 'certified' : 'pending', nextAttemptAt: new Date() } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'sfec.retry', entityType: 'fiscal_invoice', entityId: id });
    return this.processTenant(user.tenantId);
  }
}