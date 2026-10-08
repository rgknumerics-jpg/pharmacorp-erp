import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAuditLogInput {
  tenantId: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
}

/**
 * Journal d'audit (ARCHITECTURE.md section 21). Toute ecriture passe par `forTenant` :
 * la table audit_logs est protegee par Row-Level Security (packages/database/prisma/rls-policies.sql),
 * donc une insertion sans contexte tenant positionne serait rejetee par PostgreSQL.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    await this.prisma.forTenant(input.tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: input.metadata,
          ipAddress: input.ipAddress,
        },
      }),
    );
  }

  /** Recherche dans le journal : qui a cree, modifie, annule, vendu, rembourse, change un prix, modifie un stock, valide un achat. */
  async search(tenantId: string, q: { action?: string; userId?: string; entityType?: string; entityId?: string; from?: string; to?: string; take: number; skip: number }) {
    const rows = await this.prisma.forTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: {
          ...(q.action ? { action: { startsWith: q.action } } : {}),
          ...(q.userId ? { userId: q.userId } : {}),
          ...(q.entityType ? { entityType: q.entityType } : {}),
          ...(q.entityId ? { entityId: q.entityId } : {}),
          ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
        },
        orderBy: { createdAt: 'desc' }, take: q.take, skip: q.skip,
      }),
    );
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({ ...r, userName: r.userId ? users.get(r.userId) ?? '—' : 'Système' }));
  }

  async findForTenant(tenantId: string, take = 50, skip = 0) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    );
  }
}
