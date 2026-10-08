import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

const KINDS = ['message', 'info', 'alerte'];

/** Messagerie interne : discussion d'équipe, messages privés, informations et alertes du pharmacien. */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  private async names(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const ms = await tx.membership.findMany({ where: { isActive: true }, select: { userId: true, user: { select: { fullName: true } }, role: { select: { name: true, label: true } } } });
      return new Map(ms.map((m) => [m.userId, { name: m.user.fullName, role: m.role.label ?? m.role.name }]));
    });
  }

  async conversations(u: AuthenticatedUser) {
    const people = await this.names(u.tenantId);
    return this.prisma.forTenant(u.tenantId, async (tx) => {
      const reads = new Map((await tx.chatRead.findMany({ where: { userId: u.userId } })).map((r) => [r.convKey, r.readAt]));
      const out: { key: string; name: string; role?: string; last: { body: string; at: Date; kind: string } | null; unread: number }[] = [];
      const lastAll = await tx.chatMessage.findFirst({ where: { recipientId: null }, orderBy: { createdAt: 'desc' } });
      out.push({ key: 'all', name: 'Toute l’équipe', last: lastAll ? { body: lastAll.body, at: lastAll.createdAt, kind: lastAll.kind } : null, unread: await tx.chatMessage.count({ where: { recipientId: null, senderId: { not: u.userId }, createdAt: { gt: reads.get('all') ?? new Date(0) } } }) });
      for (const [id, p] of people) {
        if (id === u.userId) continue;
        const last = await tx.chatMessage.findFirst({ where: { OR: [{ senderId: u.userId, recipientId: id }, { senderId: id, recipientId: u.userId }] }, orderBy: { createdAt: 'desc' } });
        const unread = await tx.chatMessage.count({ where: { senderId: id, recipientId: u.userId, createdAt: { gt: reads.get(id) ?? new Date(0) } } });
        out.push({ key: id, name: p.name, role: p.role, last: last ? { body: last.body, at: last.createdAt, kind: last.kind } : null, unread });
      }
      return out.sort((a, b) => (a.key === 'all' ? -1 : b.key === 'all' ? 1 : (b.last?.at.getTime() ?? 0) - (a.last?.at.getTime() ?? 0) || a.name.localeCompare(b.name)));
    });
  }

  async messages(u: AuthenticatedUser, withKey: string) {
    const people = await this.names(u.tenantId);
    return this.prisma.forTenant(u.tenantId, async (tx) => {
      const where = withKey === 'all' ? { recipientId: null } : { OR: [{ senderId: u.userId, recipientId: withKey }, { senderId: withKey, recipientId: u.userId }] };
      const rows = (await tx.chatMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })).reverse();
      await tx.chatRead.upsert({ where: { tenantId_userId_convKey: { tenantId: u.tenantId, userId: u.userId, convKey: withKey } }, create: { tenantId: u.tenantId, userId: u.userId, convKey: withKey }, update: { readAt: new Date() } });
      return rows.map((m) => ({ id: m.id, body: m.body, kind: m.kind, at: m.createdAt, mine: m.senderId === u.userId, sender: people.get(m.senderId)?.name ?? 'Ancien agent' }));
    });
  }

  async send(u: AuthenticatedUser, b: { to?: string; body?: string; kind?: string }) {
    const body = String(b.body ?? '').trim().slice(0, 2000);
    if (!body) throw new BadRequestException('Message vide');
    const kind = KINDS.includes(b.kind ?? '') ? (b.kind as string) : 'message';
    const to = !b.to || b.to === 'all' ? null : b.to;
    // informations et alertes : réservées aux responsables (droit de gérer les agents)
    if (kind !== 'message' && !u.permissions.includes('users.write')) throw new ForbiddenException('Seul le pharmacien ou l’administrateur peut envoyer une alerte ou une information.');
    if (to && !(await this.names(u.tenantId)).has(to)) throw new BadRequestException('Destinataire inconnu');
    await this.prisma.forTenant(u.tenantId, async (tx) => {
      await tx.chatMessage.create({ data: { tenantId: u.tenantId, senderId: u.userId, recipientId: to, kind, body } });
      const key = to ?? 'all';
      await tx.chatRead.upsert({ where: { tenantId_userId_convKey: { tenantId: u.tenantId, userId: u.userId, convKey: key } }, create: { tenantId: u.tenantId, userId: u.userId, convKey: key }, update: { readAt: new Date() } });
    });
    return { ok: true };
  }

  /** Nombre de messages non lus et dernière alerte non lue (pour la pastille du menu et le bandeau). */
  async unread(u: AuthenticatedUser) {
    return this.prisma.forTenant(u.tenantId, async (tx) => {
      const reads = new Map((await tx.chatRead.findMany({ where: { userId: u.userId } })).map((r) => [r.convKey, r.readAt]));
      const since = (k: string) => reads.get(k) ?? new Date(0);
      const recent = await tx.chatMessage.findMany({ where: { senderId: { not: u.userId }, OR: [{ recipientId: null }, { recipientId: u.userId }], createdAt: { gt: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { createdAt: 'desc' }, take: 300 });
      const unread = recent.filter((m) => m.createdAt > since(m.recipientId === null ? 'all' : m.senderId));
      const alert = unread.find((m) => m.kind !== 'message');
      return { total: unread.length, alert: alert ? { id: alert.id, kind: alert.kind, body: alert.body, at: alert.createdAt } : null };
    });
  }
}

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly s: ChatService) {}
  @Get('conversations') conversations(@CurrentUser() u: AuthenticatedUser) { return this.s.conversations(u); }
  @Get('messages') messages(@CurrentUser() u: AuthenticatedUser, @Query('with') w = 'all') { return this.s.messages(u, w); }
  @Post('messages') send(@CurrentUser() u: AuthenticatedUser, @Body() b: { to?: string; body?: string; kind?: string }) { return this.s.send(u, b ?? {}); }
  @Get('unread') unread(@CurrentUser() u: AuthenticatedUser) { return this.s.unread(u); }
}

@Module({ controllers: [ChatController], providers: [ChatService] })
export class ChatModule {}
