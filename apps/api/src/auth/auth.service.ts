import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PermissionCode } from '@erp/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { QueueService } from '../queue/queue.service';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { hashToken } from './hash.util';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string };
  tenant: { id: string; name: string; slug: string };
  permissions: PermissionCode[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    private readonly queue: QueueService,
  ) {}

  async login(email: string, password: string, tenantSlug: string, ip?: string): Promise<LoginResult> {
    const invalid = () => new UnauthorizedException('Identifiants invalides');

    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant || !tenant.isActive) throw invalid();

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) throw invalid();

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) throw invalid();

    const membership = await this.prisma.forTenant(tenant.id, (tx) =>
      tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      }),
    );
    if (!membership || !membership.isActive) throw invalid();

    const permissions = membership.role.permissions.map((rp) => rp.permission.code as PermissionCode);
    const { accessToken, refreshToken } = await this.issueTokens({
      sub: user.id,
      tenantId: tenant.id,
      membershipId: membership.id,
      roleId: membership.roleId,
      permissions,
    });

    await this.auditLog.record({
      tenantId: tenant.id,
      userId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
    });
    await this.queue.enqueue('auth.login', { tenantId: tenant.id, userId: user.id });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      permissions,
    };
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    const invalid = () => new UnauthorizedException('Session invalide');
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw invalid();
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.forTenant(payload.tenantId, (tx) =>
      tx.refreshToken.findFirst({
        where: { tenantId: payload.tenantId, userId: payload.sub, tokenHash, revokedAt: null },
      }),
    );
    if (!stored || stored.expiresAt < new Date()) throw invalid();

    await this.prisma.forTenant(payload.tenantId, (tx) =>
      tx.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }),
    );

    // Permissions recalculees a chaque refresh : un role modifie prend effet au plus tard
    // a la fin du TTL de l'access token en cours (ARCHITECTURE.md section 9).
    const membership = await this.prisma.forTenant(payload.tenantId, (tx) =>
      tx.membership.findUnique({
        where: { id: payload.membershipId },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          user: true,
          tenant: true,
        },
      }),
    );
    if (!membership || !membership.isActive) throw invalid();

    const permissions = membership.role.permissions.map((rp) => rp.permission.code as PermissionCode);
    const { accessToken, refreshToken: newRefreshToken } = await this.issueTokens({
      sub: membership.userId,
      tenantId: membership.tenantId,
      membershipId: membership.id,
      roleId: membership.roleId,
      permissions,
    });

    await this.auditLog.record({
      tenantId: membership.tenantId,
      userId: membership.userId,
      action: 'auth.token_refreshed',
      entityType: 'user',
      entityId: membership.userId,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: { id: membership.user.id, email: membership.user.email, fullName: membership.user.fullName },
      tenant: { id: membership.tenant.id, name: membership.tenant.name, slug: membership.tenant.slug },
      permissions,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        ignoreExpiration: true,
      });
    } catch {
      return; // logout idempotent : un jeton invalide n'a rien a revoquer
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.forTenant(payload.tenantId, (tx) =>
      tx.refreshToken.findFirst({
        where: { tenantId: payload.tenantId, userId: payload.sub, tokenHash, revokedAt: null },
      }),
    );
    if (!stored) return;

    await this.prisma.forTenant(payload.tenantId, (tx) =>
      tx.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }),
    );
    await this.auditLog.record({
      tenantId: payload.tenantId,
      userId: payload.sub,
      action: 'auth.logout',
      entityType: 'user',
      entityId: payload.sub,
    });
  }

  // ------------------------------------------------------------------ codes personnels des postes de caisse
  private static readonly POS_NEEDS: Record<string, PermissionCode[]> = { seller: ['sales.ticket'], cashier: ['sales.create'], direct: ['sales.create', 'sales.ticket'] };
  private pinFails = new Map<string, { n: number; until: number }>();

  /** Définit le code (4 à 8 chiffres). Il doit être unique dans l'établissement, car c'est lui qui identifie la personne. */
  async setPosPin(tenantId: string, membershipId: string, pin: string, actorId: string) {
    if (!/^\d{4,8}$/.test(pin ?? '')) throw new BadRequestException('Le code doit comporter 4 à 8 chiffres.');
    await this.prisma.forTenant(tenantId, async (tx) => {
      const members = await tx.membership.findMany({ where: { isActive: true, posPinHash: { not: null } }, select: { id: true, posPinHash: true } });
      for (const m of members) if (m.id !== membershipId && (await bcrypt.compare(pin, m.posPinHash as string))) throw new ConflictException('Ce code est déjà utilisé : choisissez-en un autre.');
      const own = await tx.membership.findUnique({ where: { id: membershipId } });
      if (!own) throw new BadRequestException('Membre introuvable');
      await tx.membership.update({ where: { id: membershipId }, data: { posPinHash: await bcrypt.hash(pin, 10) } });
    });
    await this.auditLog.record({ tenantId, userId: actorId, action: 'auth.pos_pin_set', entityType: 'membership', entityId: membershipId });
    return { ok: true };
  }

  async verifyOwnPassword(userId: string, password: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !(await bcrypt.compare(password ?? '', u.passwordHash))) throw new UnauthorizedException('Mot de passe incorrect');
  }

  async hasPosPin(tenantId: string, membershipId: string) {
    const m = await this.prisma.forTenant(tenantId, (tx) => tx.membership.findUnique({ where: { id: membershipId }, select: { posPinHash: true } }));
    return !!m?.posPinHash;
  }

  /** Déverrouille un poste : le code identifie la personne ; on lui délivre ses propres jetons, avec ses propres droits. */
  /** Identifie une personne par son code personnel (pointage, déverrouillage) : limite les essais, ne délivre aucun jeton. */
  async identify(tenantId: string, pin: string, ip?: string): Promise<{ userId: string; membershipId: string; fullName: string }> {
    const key = `id:${tenantId}:${ip ?? ''}`;
    const f = this.pinFails.get(key);
    if (f && f.n >= 5 && f.until > Date.now()) throw new ForbiddenException('Trop d’essais : patientez une minute.');
    const members = await this.prisma.forTenant(tenantId, (tx) => tx.membership.findMany({ where: { isActive: true, posPinHash: { not: null } }, include: { user: true } }));
    let hit: (typeof members)[number] | undefined;
    for (const m of members) if (/^\d{4,8}$/.test(pin ?? '') && (await bcrypt.compare(pin, m.posPinHash as string))) { hit = m; break; }
    if (!hit || !hit.user.isActive) { this.pinFails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 60_000 }); throw new UnauthorizedException('Code incorrect'); }
    this.pinFails.delete(key);
    return { userId: hit.userId, membershipId: hit.id, fullName: hit.user.fullName };
  }

  async posUnlock(tenantId: string, mode: string, pin: string, ip?: string): Promise<LoginResult> {
    const tab = mode.startsWith('tab:') ? mode.slice(4, 44) : null; // ouverture d'un onglet de l'ERP : même code, même identification
    const need = tab ? [] : AuthService.POS_NEEDS[mode];
    if (!need) throw new BadRequestException('Poste inconnu');
    const key = `${tenantId}:${ip ?? ''}`;
    const f = this.pinFails.get(key);
    if (f && f.n >= 5 && f.until > Date.now()) throw new ForbiddenException('Trop d’essais : patientez une minute.');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const members = await this.prisma.forTenant(tenantId, (tx) =>
      tx.membership.findMany({ where: { isActive: true, posPinHash: { not: null } }, include: { user: true, role: { include: { permissions: { include: { permission: true } } } } } }),
    );
    let hit: (typeof members)[number] | undefined;
    for (const m of members) if (/^\d{4,8}$/.test(pin ?? '') && (await bcrypt.compare(pin, m.posPinHash as string))) { hit = m; break; }
    if (!hit || !hit.user.isActive || !tenant) {
      this.pinFails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 60_000 });
      throw new UnauthorizedException('Code incorrect');
    }
    this.pinFails.delete(key);
    const permissions = hit.role.permissions.map((rp) => rp.permission.code as PermissionCode);
    if (tab === 'admin' && !permissions.includes('tenant.manage')) throw new ForbiddenException('Le panneau d’administration est réservé au titulaire.');
    if (!need.every((p) => permissions.includes(p))) throw new ForbiddenException('Ce code n’a pas accès à ce poste.');
    const { accessToken, refreshToken } = await this.issueTokens({ sub: hit.userId, tenantId, membershipId: hit.id, roleId: hit.roleId, permissions });
    await this.auditLog.record({ tenantId, userId: hit.userId, action: tab ? 'nav.access' : 'auth.pos_unlock', entityType: 'user', entityId: hit.userId, ipAddress: ip, metadata: tab ? { tab } : { mode } });
    return { accessToken, refreshToken, user: { id: hit.user.id, email: hit.user.email, fullName: hit.user.fullName }, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }, permissions };
  }
  private async issueTokens(
    basePayload: Omit<JwtPayload, 'jti'>,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // jti unique par emission : deux jetons signes la meme seconde avec un payload par
    // ailleurs identique seraient sinon byte-identiques (HMAC est deterministe). Trouve par
    // le test e2e de rotation du refresh token (test/auth.e2e-spec.ts).
    const payload: JwtPayload = { ...basePayload, jti: randomUUID() };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_TTL'),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_TTL'),
    });

    const decoded = this.jwt.decode<{ exp: number }>(refreshToken);
    const expiresAt = new Date(decoded.exp * 1000);
    await this.prisma.forTenant(payload.tenantId, (tx) =>
      tx.refreshToken.create({
        data: {
          tenantId: payload.tenantId,
          userId: payload.sub,
          tokenHash: hashToken(refreshToken),
          expiresAt,
        },
      }),
    );

    return { accessToken, refreshToken };
  }
}
