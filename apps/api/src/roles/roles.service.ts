import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, PERMISSION_GROUPS, PERMISSION_META } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

const CODES = new Set<string>(PERMISSIONS.map((p) => p.code));
/** Le role « owner » (titulaire) garde tous les droits : on ne le modifie pas. */
const LOCKED = new Set(['owner']);

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  findAllForTenant(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const roles = await tx.role.findMany({
        where: { tenantId },
        include: { permissions: { include: { permission: true } }, _count: { select: { memberships: true } } },
        orderBy: { name: 'asc' },
      });
      return roles.map((r) => ({ ...r, locked: LOCKED.has(r.name), members: r._count.memberships }));
    });
  }

  /** Catalogue global enrichi : rubrique + libelle francais pour l'ecran de gestion des droits. */
  async findPermissionCatalog() {
    const rows = await this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
    const items = rows.map((r) => ({ ...r, group: PERMISSION_META[r.code]?.group ?? 'Administration', label: PERMISSION_META[r.code]?.label ?? r.description ?? r.code }));
    return { groups: PERMISSION_GROUPS, items };
  }

  private cleanCodes(codes: unknown): string[] {
    if (!Array.isArray(codes)) throw new BadRequestException('Liste de droits invalide');
    const out = [...new Set(codes.map(String))];
    const bad = out.filter((c) => !CODES.has(c));
    if (bad.length) throw new BadRequestException(`Droits inconnus : ${bad.join(', ')}`);
    return out;
  }

  private cleanName(name: unknown): string {
    const n = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 40) throw new BadRequestException('Nom du rôle : 2 à 40 caractères');
    return n;
  }

  async create(user: AuthenticatedUser, body: { name: string; permissions: string[] }) {
    const name = this.cleanName(body.name);
    const codes = this.cleanCodes(body.permissions ?? []);
    const role = await this.prisma.forTenant(user.tenantId, async (tx) => {
      if (await tx.role.findUnique({ where: { tenantId_name: { tenantId: user.tenantId, name } } })) throw new ConflictException('Un rôle porte déjà ce nom');
      const perms = await tx.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
      return tx.role.create({ data: { tenantId: user.tenantId, name, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } } });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'roles.created', entityType: 'role', entityId: role.id, metadata: { name, permissions: codes.length } });
    return { id: role.id, name };
  }

  /** Nom affiché du rôle (le titulaire peut aussi être renommé : seul l'affichage change). */
  async rename(user: AuthenticatedUser, id: string, label: string) {
    const v = String(label ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (v.length < 2) throw new BadRequestException('Nom trop court');
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const role = await tx.role.findUnique({ where: { id } });
      if (!role) throw new NotFoundException('Rôle introuvable');
      await tx.role.update({ where: { id }, data: { label: v } });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'roles.renamed', entityType: 'role', entityId: id, metadata: { label: v } });
    return { id, label: v };
  }

  async update(user: AuthenticatedUser, id: string, body: { name?: string; permissions?: string[] }) {
    const result = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const role = await tx.role.findUnique({ where: { id } });
      if (!role) throw new NotFoundException('Rôle introuvable');
      if (LOCKED.has(role.name)) throw new BadRequestException('Le rôle « owner » (titulaire) garde tous les droits et ne peut pas être modifié');
      const data: { name?: string } = {};
      if (body.name !== undefined) {
        const name = this.cleanName(body.name);
        if (name !== role.name && (await tx.role.findUnique({ where: { tenantId_name: { tenantId: user.tenantId, name } } }))) throw new ConflictException('Un rôle porte déjà ce nom');
        data.name = name;
      }
      if (Object.keys(data).length) await tx.role.update({ where: { id }, data });
      let count: number | undefined;
      if (body.permissions !== undefined) {
        const codes = this.cleanCodes(body.permissions);
        const perms = await tx.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) });
        count = codes.length;
      }
      return { id, name: data.name ?? role.name, permissions: count };
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'roles.updated', entityType: 'role', entityId: id, metadata: { name: result.name, permissions: result.permissions } });
    return result;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const name = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { _count: { select: { memberships: true } } } });
      if (!role) throw new NotFoundException('Rôle introuvable');
      if (LOCKED.has(role.name)) throw new BadRequestException('Le rôle « owner » ne peut pas être supprimé');
      if (role._count.memberships) throw new ConflictException(`${role._count.memberships} agent(s) ont ce rôle : changez d’abord leur rôle`);
      await tx.role.delete({ where: { id } });
      return role.name;
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'roles.deleted', entityType: 'role', entityId: id, metadata: { name } });
    return { ok: true };
  }
}
