import * as bcrypt from 'bcrypt';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { normalizePhone } from '../common/phone.util';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { emit } from '../accounting/outbox';
import { CreateCustomerDto, CreditRepaymentDto, UpdateCustomerDto } from './dto/customer.dto';

/** Genere un mot de passe temporaire lisible (sans caracteres ambigus 0/O/1/I) a communiquer au client. */
function tempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * `source` : par defaut ne montre que les clients "pos" (venus en pharmacie) -- un client "online"
   * (boutique en ligne) ne doit jamais se melanger a ce fichier ni etre eligible au credit (ARCHITECTURE.md
   * -- Clients) ; il reste suivi depuis Commandes en ligne. `source=online` ou `source=all` l'incluent explicitement.
   */
  async search(tenantId: string, q: string | undefined, take: number, skip: number, source: string = 'pos') {
    const term = q?.trim();
    const digits = term?.replace(/\D/g, '');
    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.customer.findMany({
        where: {
          isActive: true,
          ...(source !== 'all' ? { source } : {}),
          ...(term
            ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, ...(digits && digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] }
            : {}),
        },
        orderBy: { name: 'asc' },
        take,
        skip,
      });
      // Compte boutique en ligne (CustomerAccount n'a pas de relation Prisma vers Customer, jointure manuelle).
      const accounts = await tx.customerAccount.findMany({ where: { customerId: { in: rows.map((r) => r.id) } }, select: { customerId: true } });
      const withAccount = new Set(accounts.map((a) => a.customerId));
      return rows.map((r) => ({ ...r, hasOnlineAccount: withAccount.has(r.id) }));
    });
  }

  /** Nouvelles inscriptions boutique en ligne depuis `since` (notif sonore/visuelle cote caisse). */
  async recentOnlineSignups(tenantId: string, since: Date) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const accounts = await tx.customerAccount.findMany({ where: { createdAt: { gt: since } }, orderBy: { createdAt: 'desc' }, take: 20 });
      if (!accounts.length) return [];
      const customers = await tx.customer.findMany({ where: { id: { in: accounts.map((a) => a.customerId) } }, select: { id: true, name: true } });
      const byId = new Map(customers.map((c) => [c.id, c.name]));
      return accounts.map((a) => ({ id: a.id, customerId: a.customerId, name: byId.get(a.customerId) ?? '—', phone: a.phone, createdAt: a.createdAt }));
    });
  }

  /** Reinitialise le mot de passe du compte boutique en ligne d'un client (le titulaire communique le nouveau mot de passe). */
  async resetOnlineAccountPassword(user: AuthenticatedUser, customerId: string) {
    const password = tempPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const acc = await tx.customerAccount.findFirst({ where: { customerId } });
      if (!acc) throw new NotFoundException('Ce client n’a pas de compte sur la boutique en ligne.');
      await tx.customerAccount.update({ where: { id: acc.id }, data: { passwordHash } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'customers.online_password_reset', entityType: 'customer', entityId: customerId });
    return { password };
  }

  async findOne(tenantId: string, id: string) {
    const c = await this.prisma.forTenant(tenantId, (tx) => tx.customer.findUnique({ where: { id } }));
    if (!c) throw new NotFoundException('Client introuvable');
    return c;
  }

  async create(user: AuthenticatedUser, dto: CreateCustomerDto) {
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (dto.phone && !phone) throw new BadRequestException('Numero de telephone invalide');
    const c = await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.customer.create({ data: { ...dto, phone, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined, tenantId: user.tenantId } }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'customers.created', entityType: 'customer', entityId: c.id, metadata: { name: c.name, creditLimit: dto.creditLimit ?? 0 } });
    return c;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateCustomerDto) {
    const phone = dto.phone !== undefined ? normalizePhone(dto.phone) : undefined;
    if (dto.phone && !phone) throw new BadRequestException('Numero de telephone invalide');
    const c = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const cur = await tx.customer.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException('Client introuvable');
      if (cur.source === 'online' && dto.creditLimit !== undefined && dto.creditLimit > 0) {
        throw new BadRequestException('Un client venu de la boutique en ligne n’est pas éligible au crédit.');
      }
      return tx.customer.update({ where: { id }, data: { ...dto, ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}), ...(phone !== undefined ? { phone } : {}) } });
    });
    if (dto.creditLimit !== undefined) {
      await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'customers.credit_limit_set', entityType: 'customer', entityId: id, metadata: { creditLimit: dto.creditLimit } });
    }
    return c;
  }

  /** Remboursement d'une creance : diminue le solde du, jamais en dessous de zero. */
  async repay(user: AuthenticatedUser, id: string, dto: CreditRepaymentDto) {
    const c = await this.prisma.forTenant(user.tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${id}::uuid FOR UPDATE`;
      const cur = await tx.customer.findUnique({ where: { id } });
      if (!cur) throw new NotFoundException('Client introuvable');
      if (dto.amount > cur.creditBalance) throw new BadRequestException(`Le montant depasse la creance (${cur.creditBalance}).`);
      await emit(tx, user.tenantId, 'credit.repaid', { customerId: id, amount: dto.amount, date: new Date().toISOString() });
      return tx.customer.update({ where: { id }, data: { creditBalance: { decrement: dto.amount } } });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'customers.credit_repaid', entityType: 'customer', entityId: id, metadata: { amount: dto.amount, note: dto.note ?? null } });
    return c;
  }
}
