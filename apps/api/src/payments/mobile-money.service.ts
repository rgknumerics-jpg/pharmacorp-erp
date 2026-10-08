import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';

const PROVIDERS: Record<string, string> = { mtn: 'mtn_momo', airtel: 'airtel_money' };

@Injectable()
export class MobileMoneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly auditLog: AuditLogService,
  ) {}

  async handle(provider: string, body: Record<string, unknown>) {
    const method = PROVIDERS[provider];
    if (!method) throw new NotFoundException('Operateur inconnu');
    const slug = String(body.tenant ?? ''), reference = String(body.reference ?? ''), status = String(body.status ?? '').toUpperCase(), amount = Number(body.amount);
    if (!slug || !reference || !['SUCCESSFUL', 'FAILED'].includes(status)) throw new BadRequestException('Notification incomplete');
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException('Etablissement inconnu');
    const pay = await this.prisma.forTenant(tenant.id, (tx) => tx.payment.findFirst({ where: { reference, method: method as never }, orderBy: { createdAt: 'desc' } }));
    if (!pay) throw new NotFoundException('Paiement introuvable pour cette reference');
    if (pay.status !== 'pending_confirmation') return { ok: true, alreadyProcessed: true, status: pay.status }; // notification rejouee : sans effet
    const actor = { tenantId: tenant.id };
    if (status === 'FAILED') {
      await this.sales.failPayment(actor, pay.id);
      return { ok: true, status: 'failed' };
    }
    if (!Number.isFinite(amount) || amount !== pay.amount) {
      await this.auditLog.record({ tenantId: tenant.id, action: 'payments.webhook_amount_mismatch', entityType: 'payment', entityId: pay.id, metadata: { expected: pay.amount, received: amount, reference } });
      throw new ConflictException('Montant different du paiement attendu : verification manuelle requise');
    }
    await this.sales.confirmPayment(actor, pay.id, reference);
    return { ok: true, status: 'confirmed' };
  }
}