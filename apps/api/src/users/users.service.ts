import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { QueueService } from '../queue/queue.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/** Champs utilisateur exposes par l'API : jamais l'empreinte du mot de passe. */
const USER_PUBLIC = { id: true, email: true, fullName: true, signature: true, createdAt: true } as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly queue: QueueService,
  ) {}

  async findAllForTenant(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.membership.findMany({
        where: { tenantId },
        include: { user: { select: USER_PUBLIC }, role: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async findMe(actingUser: AuthenticatedUser) {
    const membership = await this.prisma.forTenant(actingUser.tenantId, (tx) =>
      tx.membership.findUnique({
        where: { id: actingUser.membershipId },
        include: { user: { select: USER_PUBLIC }, role: true, tenant: true },
      }),
    );
    if (!membership) throw new NotFoundException('Utilisateur introuvable');
    return membership;
  }

  async create(tenantId: string, dto: CreateUserDto, actingUser: AuthenticatedUser) {
    let user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user) {
      const passwordHash = await bcrypt.hash(dto.password, 12);
      user = await this.prisma.user.create({
        data: { email: dto.email, fullName: dto.fullName, passwordHash, signature: dto.signature ?? null },
      });
    }

    const existingMembership = await this.prisma.forTenant(tenantId, (tx) =>
      tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user!.id } } }),
    );
    if (existingMembership) {
      throw new ConflictException('Cet utilisateur appartient deja a ce tenant');
    }

    const membership = await this.prisma.forTenant(tenantId, (tx) =>
      tx.membership.create({
        data: { tenantId, userId: user!.id, roleId: dto.roleId },
        include: { user: { select: USER_PUBLIC }, role: true },
      }),
    );

    await this.auditLog.record({
      tenantId,
      userId: actingUser.userId,
      action: 'users.created',
      entityType: 'membership',
      entityId: membership.id,
      metadata: { targetUserId: user.id, roleId: dto.roleId },
    });
    await this.queue.enqueue('user.created', { tenantId, userId: user.id });

    return membership;
  }

  async update(tenantId: string, membershipId: string, dto: UpdateUserDto, actingUser: AuthenticatedUser) {
    const membership = await this.prisma.forTenant(tenantId, (tx) =>
      tx.membership.findUnique({ where: { id: membershipId } }),
    );
    if (!membership || membership.tenantId !== tenantId) {
      throw new NotFoundException('Utilisateur introuvable dans ce tenant');
    }

    const updated = await this.prisma.forTenant(tenantId, (tx) =>
      tx.membership.update({
        where: { id: membershipId },
        data: { roleId: dto.roleId, isActive: dto.isActive },
        include: { user: { select: USER_PUBLIC }, role: true },
      }),
    );

    if (dto.fullName || dto.signature) {
      await this.prisma.user.update({
        where: { id: updated.userId },
        data: { ...(dto.fullName ? { fullName: dto.fullName } : {}), ...(dto.signature ? { signature: dto.signature } : {}) },
      });
    }

    await this.auditLog.record({
      tenantId,
      userId: actingUser.userId,
      action: 'users.updated',
      entityType: 'membership',
      entityId: membershipId,
      metadata: { ...dto },
    });

    return updated;
  }
}
