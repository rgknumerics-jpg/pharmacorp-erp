import { createHash, randomBytes } from 'crypto';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Injectable, Ip, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { withSettings } from '../company/settings';
import { PrismaService } from '../prisma/prisma.service';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
/** Heure locale du Congo (UTC+1) : jour et minutes depuis minuit. */
const local = (d = new Date()) => { const l = new Date(d.getTime() + 3600_000); return { day: l.toISOString().slice(0, 10), minutes: l.getUTCHours() * 60 + l.getUTCMinutes() }; };
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/**
 * Contrôle des horaires : chaque agent pointe son arrivée et son départ en saisissant son code personnel sur un poste enregistré.
 * Sécurité : le poste porte un jeton secret remis une seule fois à l'administrateur (aucun pointage sans lui), le code identifie
 * la personne, les essais sont limités, et chaque pointage garde l'heure du serveur, l'adresse réseau et le poste.
 */
@Injectable()
export class TimeclockService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly audit: AuditLogService) {}

  // ---- postes (administrateur)
  async createStation(u: AuthenticatedUser, name: string) {
    const n = String(name ?? '').trim().slice(0, 60);
    if (n.length < 2) throw new BadRequestException('Donnez un nom au poste (ex. Comptoir).');
    const token = randomBytes(18).toString('base64url');
    const s = await this.prisma.forTenant(u.tenantId, (tx) => tx.clockStation.create({ data: { tenantId: u.tenantId, name: n, tokenHash: hash(token) } }));
    await this.audit.record({ tenantId: u.tenantId, userId: u.userId, action: 'timeclock.station_created', entityType: 'clock_station', entityId: s.id, metadata: { name: n } });
    return { id: s.id, name: s.name, token }; // le jeton n'est montré qu'une fois
  }
  stations(tenantId: string) { return this.prisma.forTenant(tenantId, (tx) => tx.clockStation.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, isActive: true, createdAt: true, lastUsedAt: true } })); }
  async setStation(u: AuthenticatedUser, id: string, active: boolean) {
    await this.prisma.forTenant(u.tenantId, async (tx) => { const s = await tx.clockStation.findUnique({ where: { id } }); if (!s) throw new NotFoundException('Poste introuvable'); await tx.clockStation.update({ where: { id }, data: { isActive: active } }); });
    return { ok: true };
  }

  // ---- poste de pointage (public, protégé par le jeton du poste)
  private async station(slug: string, token: string | undefined) {
    const t = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!t || !t.isActive) throw new NotFoundException('Pharmacie introuvable');
    if (!token) throw new ForbiddenException('Ce poste n’est pas enregistré pour le pointage.');
    const st = await this.prisma.forTenant(t.id, (tx) => tx.clockStation.findFirst({ where: { tokenHash: hash(token), isActive: true } }));
    if (!st) throw new ForbiddenException('Ce poste n’est pas enregistré pour le pointage.');
    return { t, st };
  }

  async today(slug: string, token: string | undefined) {
    const { t } = await this.station(slug, token);
    return this.prisma.forTenant(t.id, async (tx) => {
      const rows = await tx.timeClock.findMany({ where: { day: new Date(`${local().day}T00:00:00Z`) }, orderBy: { inAt: 'asc' } });
      const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true } });
      const name = new Map(users.map((x) => [x.id, x.fullName]));
      return rows.map((r) => ({ name: name.get(r.userId) ?? 'Agent', inAt: r.inAt, outAt: r.outAt, late: r.lateMinutes }));
    });
  }

  async punch(slug: string, token: string | undefined, pin: string, ip?: string) {
    const { t, st } = await this.station(slug, token);
    const who = await this.auth.identify(t.id, pin, ip);
    const set = withSettings((await this.prisma.forTenant(t.id, (tx) => tx.companyProfile.findUnique({ where: { tenantId: t.id }, select: { settings: true } })))?.settings).attendance;
    const now = new Date(), l = local(now);
    const res = await this.prisma.forTenant(t.id, async (tx) => {
      const day = new Date(`${l.day}T00:00:00Z`);
      const open = await tx.timeClock.findFirst({ where: { userId: who.userId, day, outAt: null }, orderBy: { inAt: 'desc' } });
      await tx.clockStation.update({ where: { id: st.id }, data: { lastUsedAt: now } });
      if (open) {
        if (now.getTime() - open.inAt.getTime() < 120_000) return { action: 'déjà', at: open.inAt, late: open.lateMinutes };
        await tx.timeClock.update({ where: { id: open.id }, data: { outAt: now } });
        return { action: 'départ', at: now, late: 0, worked: Math.round((now.getTime() - open.inAt.getTime()) / 60_000) };
      }
      const first = !(await tx.timeClock.findFirst({ where: { userId: who.userId, day } }));
      const late = first ? Math.max(0, l.minutes - hm(set.start)) : 0;
      const lateMinutes = late > set.tolerance ? late : 0;
      await tx.timeClock.create({ data: { tenantId: t.id, userId: who.userId, day, inAt: now, lateMinutes, station: st.name, ip: ip ?? null } });
      return { action: 'arrivée', at: now, late: lateMinutes };
    });
    await this.audit.record({ tenantId: t.id, userId: who.userId, action: `timeclock.${res.action}`, entityType: 'user', entityId: who.userId, ipAddress: ip, metadata: { station: st.name, late: res.late } });
    return { name: who.fullName, ...res };
  }

  // ---- rapport (administrateur)
  async report(tenantId: string, from?: string, to?: string) {
    const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : local(new Date(Date.now() - 6 * 86_400_000)).day, tt = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : local().day;
    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.timeClock.findMany({ where: { day: { gte: new Date(`${f}T00:00:00Z`), lte: new Date(`${tt}T00:00:00Z`) } }, orderBy: [{ day: 'desc' }, { inAt: 'asc' }], take: 2000 });
      const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true } });
      const name = new Map(users.map((x) => [x.id, x.fullName]));
      const set = withSettings((await tx.companyProfile.findUnique({ where: { tenantId }, select: { settings: true } }))?.settings).attendance;
      const lines = rows.map((r) => ({ id: r.id, day: r.day.toISOString().slice(0, 10), name: name.get(r.userId) ?? 'Agent', inAt: r.inAt, outAt: r.outAt, late: r.lateMinutes, worked: r.outAt ? Math.round((r.outAt.getTime() - r.inAt.getTime()) / 60_000) : null, station: r.station, ip: r.ip }));
      const byUser = new Map<string, { name: string; days: Set<string>; late: number; lateDays: number; worked: number }>();
      for (const r of lines) { const v = byUser.get(r.name) ?? { name: r.name, days: new Set<string>(), late: 0, lateDays: 0, worked: 0 }; v.days.add(r.day); v.late += r.late; if (r.late > 0) v.lateDays++; v.worked += r.worked ?? 0; byUser.set(r.name, v); }
      return { from: f, to: tt, settings: set, lines, summary: [...byUser.values()].map((v) => ({ name: v.name, days: v.days.size, lateDays: v.lateDays, lateMinutes: v.late, workedMinutes: v.worked })).sort((a, b) => a.name.localeCompare(b.name)) };
    });
  }
}

@ApiTags('timeclock')
@Controller('timeclock')
export class TimeclockController {
  constructor(private readonly s: TimeclockService) {}
  @Public() @Get(':slug/today') today(@Param('slug') slug: string, @Headers('x-station-token') tk?: string) { return this.s.today(slug, tk); }
  @Public() @Post(':slug/punch') punch(@Param('slug') slug: string, @Body() b: { pin?: string }, @Headers('x-station-token') tk: string | undefined, @Ip() ip: string) { return this.s.punch(slug, tk, b?.pin ?? '', ip); }
  @Get('stations') @RequirePermissions('users.write') stations(@CurrentUser() u: AuthenticatedUser) { return this.s.stations(u.tenantId); }
  @Post('stations') @RequirePermissions('users.write') create(@CurrentUser() u: AuthenticatedUser, @Body() b: { name: string }) { return this.s.createStation(u, b?.name); }
  @Patch('stations/:id') @RequirePermissions('users.write') set(@CurrentUser() u: AuthenticatedUser, @Param('id') id: string, @Body() b: { isActive: boolean }) { return this.s.setStation(u, id, !!b?.isActive); }
  @Get('report') @RequirePermissions('users.write') report(@CurrentUser() u: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) { return this.s.report(u.tenantId, from, to); }
}

@Module({ imports: [AuthModule, AuditLogModule], controllers: [TimeclockController], providers: [TimeclockService] })
export class TimeclockModule {}
