import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { normalizePhone } from '../common/phone.util';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { emit } from '../accounting/outbox';
import { CreateCustomerDto, CreditRepaymentDto, UpdateCustomerDto } from './dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  search(tenantId: string, q: string | undefined, take: number, skip: number) {
    const term = q?.trim();
    const digits = term?.replace(/\D/g, '');
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.customer.findMany({
        where: {
          isActive: true,
          ...(term
            ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, ...(digits && digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] }
            : {}),
        },
        orderBy: { name: 'asc' },
        take,
        skip,
      }),
    );
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
      if (!(await tx.customer.findUnique({ where: { id } }))) throw new NotFoundException('Client introuvable');
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
