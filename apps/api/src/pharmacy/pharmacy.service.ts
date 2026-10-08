import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { emit } from '../accounting/outbox';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { nextNumber } from '../common/numbering';
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import { InsurerDto, PrescriptionDto, SettlementDto } from './pharmacy.dto';

export const AGE_BUCKETS = [30, 60, 90] as const;

@Injectable()
export class PharmacyService {
  constructor(private readonly prisma: PrismaService, private readonly auditLog: AuditLogService) {}

  // ----- Tiers payant -----
  insurers(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.insurer.findMany({ orderBy: { name: 'asc' } }));
  }
  createInsurer(user: AuthenticatedUser, dto: InsurerDto) {
    return this.prisma.forTenant(user.tenantId, (tx) => tx.insurer.create({ data: { ...dto, phone: dto.phone ? normalizePhone(dto.phone) : null, tenantId: user.tenantId } }));
  }
  async updateInsurer(user: AuthenticatedUser, id: string, dto: Partial<InsurerDto>) {
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      if (!(await tx.insurer.findUnique({ where: { id } }))) throw new NotFoundException('Organisme introuvable');
      return tx.insurer.update({ where: { id }, data: dto });
    });
  }
  /** Reglement recu d'un organisme : diminue sa dette et passe l'ecriture de tresorerie. */
  async settle(user: AuthenticatedUser, id: string, dto: SettlementDto) {
    const ins = await this.prisma.forTenant(user.tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM insurers WHERE id = ${id}::uuid FOR UPDATE`;
      const i = await tx.insurer.findUnique({ where: { id } });
      if (!i) throw new NotFoundException('Organisme introuvable');
      if (dto.amount > i.balance) throw new BadRequestException(`Le montant dépasse le dû (${i.balance}).`);
      await emit(tx, user.tenantId, 'insurer.paid', { insurerId: id, insurerName: i.name, amount: dto.amount, method: dto.method ?? 'card', reference: dto.reference ?? null, date: new Date().toISOString() });
      return tx.insurer.update({ where: { id }, data: { balance: { decrement: dto.amount } } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'insurer.settled', entityType: 'insurer', entityId: id, metadata: { amount: dto.amount, reference: dto.reference ?? null } });
    return ins;
  }
  /** Releve d'un organisme : parts tiers payant par vente (a joindre au bordereau de facturation). */
  async insurerStatement(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const ins = await tx.insurer.findUnique({ where: { id } });
      if (!ins) throw new NotFoundException('Organisme introuvable');
      const lines = await tx.payment.findMany({ where: { insurerId: id, status: 'confirmed' }, orderBy: { createdAt: 'asc' }, include: { sale: { select: { number: true, createdAt: true, customer: { select: { name: true } } } } } });
      return { insurer: ins, lines: lines.map((l) => ({ date: l.createdAt, sale: l.sale.number, patient: l.sale.customer?.name ?? null, amount: l.amount, reference: l.reference })) };
    });
  }

  // ----- Ordonnancier -----
  async recordPrescription(user: AuthenticatedUser, dto: PrescriptionDto) {
    const p = await this.prisma.forTenant(user.tenantId, async (tx) => {
      if (dto.saleId && !(await tx.sale.findUnique({ where: { id: dto.saleId } }))) throw new NotFoundException('Vente introuvable');
      const number = await nextNumber(tx, user.tenantId, 'ORD');
      return tx.prescription.create({ data: { ...dto, patientPhone: dto.patientPhone ? normalizePhone(dto.patientPhone) : null, prescribedAt: new Date(dto.prescribedAt), number, recordedById: user.userId, tenantId: user.tenantId } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'prescription.recorded', entityType: 'prescription', entityId: p.id, metadata: { number: p.number, saleId: dto.saleId ?? null } });
    return p;
  }
  prescriptions(tenantId: string, q?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.prescription.findMany({
        where: q ? { OR: [{ patientName: { contains: q, mode: 'insensitive' } }, { prescriber: { contains: q, mode: 'insensitive' } }, { number: { contains: q, mode: 'insensitive' } }] } : {},
        orderBy: { createdAt: 'desc' }, take: 200,
      });
      const sales = await tx.sale.findMany({ where: { id: { in: rows.map((r) => r.saleId).filter((x): x is string => !!x) } }, include: { items: { include: { product: { select: { name: true } }, lot: { select: { lotNumber: true } } } } } });
      return rows.map((r) => ({ ...r, sale: sales.find((s) => s.id === r.saleId) ?? null }));
    });
  }

  // ----- Clients a credit : balance agee et relances -----
  /**
   * Balance agee des creances clients : les remboursements soldent d'abord les credits les plus anciens (FIFO).
   * Une creance est "en retard" au-delà du délai de paiement accorde au client.
   */
  async receivables(tenantId: string, today = new Date()) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const customers = await tx.customer.findMany({ where: { creditBalance: { gt: 0 } } });
      const out = [];
      for (const c of customers) {
        const credits = await tx.payment.findMany({ where: { method: 'credit', status: 'confirmed', sale: { customerId: c.id, status: { not: 'void' } } }, orderBy: { createdAt: 'desc' }, include: { sale: { select: { number: true } } } });
        // on remonte depuis la plus recente : le solde du correspond aux credits les plus recents non encore rembourses
        let remaining = c.creditBalance;
        const open: { sale: string; date: Date; amount: number; ageDays: number }[] = [];
        for (const p of credits) {
          if (remaining <= 0) break;
          const amt = Math.min(p.amount, remaining);
          remaining -= amt;
          open.push({ sale: p.sale.number, date: p.createdAt, amount: amt, ageDays: Math.floor((today.getTime() - p.createdAt.getTime()) / 86_400_000) });
        }
        const buckets = { current: 0, d31_60: 0, d61_90: 0, over90: 0 };
        for (const o of open) {
          if (o.ageDays <= 30) buckets.current += o.amount; else if (o.ageDays <= 60) buckets.d31_60 += o.amount; else if (o.ageDays <= 90) buckets.d61_90 += o.amount; else buckets.over90 += o.amount;
        }
        const overdue = open.filter((o) => o.ageDays > c.paymentTermDays).reduce((s, o) => s + o.amount, 0);
        const oldest = open.length ? Math.max(...open.map((o) => o.ageDays)) : 0;
        out.push({ customerId: c.id, name: c.name, phone: c.phone, creditLimit: c.creditLimit, balance: c.creditBalance, paymentTermDays: c.paymentTermDays, overdue, oldestDays: oldest, buckets, open: open.reverse() });
      }
      return out.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
    });
  }
}