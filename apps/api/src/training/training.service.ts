import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { SEED, TOPICS } from './training-content';

type Tx = Prisma.TransactionClient;

export interface TrainingItemInput { kind: 'quiz' | 'tip'; topic: string; title: string; body: string; options?: string[]; answerIndex?: number; explanation?: string }

@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService, private readonly auditLog: AuditLogService) {}

  /** Les contenus PHARMACORP sont copies une fois par officine, en BROUILLON : un pharmacien les valide avant diffusion. */
  private async ensureSeed(tx: Tx, tenantId: string) {
    if ((await tx.trainingItem.count({ where: { source: 'pharmacorp' } })) > 0) return;
    await tx.trainingItem.createMany({ data: SEED.map((s) => ({ tenantId, kind: s.kind, topic: s.topic, title: s.title, body: s.body, options: s.options ?? [], answerIndex: s.answerIndex ?? null, explanation: s.explanation ?? null, status: 'draft', source: 'pharmacorp' })) });
  }

  /** Programme du jour : un conseil + jusqu'a 5 questions (jamais reussies, ou ratees, en priorite). */
  async today(user: AuthenticatedUser) {
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      await this.ensureSeed(tx, user.tenantId);
      const tips = await tx.trainingItem.findMany({ where: { status: 'validated', kind: 'tip' }, orderBy: { createdAt: 'asc' } });
      const dayIndex = Math.floor(Date.now() / 86_400_000);
      const tip = tips.length ? tips[dayIndex % tips.length] : null;
      const quizzes = await tx.trainingItem.findMany({ where: { status: 'validated', kind: 'quiz' } });
      const attempts = await tx.trainingAttempt.findMany({ where: { userId: user.userId }, orderBy: { answeredAt: 'desc' } });
      const lastResult = new Map<string, boolean>();
      for (const a of attempts) if (!lastResult.has(a.itemId)) lastResult.set(a.itemId, a.correct);
      const pick = [...quizzes].sort((a, b) => {
        const rank = (id: string) => (lastResult.has(id) ? (lastResult.get(id) ? 2 : 0) : 1); // ratees, puis nouvelles, puis reussies
        return rank(a.id) - rank(b.id) || ((a.id.charCodeAt(0) + dayIndex) % 7) - ((b.id.charCodeAt(0) + dayIndex) % 7);
      }).slice(0, 5);
      return {
        tip: tip ? { id: tip.id, topic: TOPICS[tip.topic] ?? tip.topic, title: tip.title, body: tip.body } : null,
        quiz: pick.map((q) => ({ id: q.id, topic: TOPICS[q.topic] ?? q.topic, title: q.title, question: q.body, options: q.options as string[] })),
        pendingValidation: await tx.trainingItem.count({ where: { status: 'draft' } }),
      };
    });
  }

  async answer(user: AuthenticatedUser, itemId: string, answer: number) {
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const q = await tx.trainingItem.findUnique({ where: { id: itemId } });
      if (!q || q.kind !== 'quiz' || q.status !== 'validated') throw new NotFoundException('Question introuvable');
      const correct = answer === q.answerIndex;
      await tx.trainingAttempt.create({ data: { tenantId: user.tenantId, userId: user.userId, itemId, answer, correct } });
      return { correct, answerIndex: q.answerIndex, explanation: q.explanation };
    });
  }

  /** Progression : la sienne, ou celle de toute l'equipe pour un responsable. */
  async progress(user: AuthenticatedUser) {
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ user_id: string; answered: number; correct: number; last_at: Date; days30: number }[]>`
        SELECT user_id, COUNT(*)::int AS answered, COUNT(*) FILTER (WHERE correct)::int AS correct, MAX(answered_at) AS last_at,
               COUNT(DISTINCT date_trunc('day', answered_at)) FILTER (WHERE answered_at > now() - interval '30 days')::int AS days30
        FROM training_attempts GROUP BY user_id`;
      const byTopic = await tx.$queryRaw<{ topic: string; answered: number; correct: number }[]>`
        SELECT i.topic, COUNT(*)::int AS answered, COUNT(*) FILTER (WHERE a.correct)::int AS correct FROM training_attempts a JOIN training_items i ON i.id = a.item_id
        WHERE a.user_id = ${user.userId}::uuid GROUP BY i.topic`;
      const names = new Map((await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.user_id) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const canSeeTeam = user.permissions.includes('training.manage');
      const team = rows.map((r) => ({ userId: r.user_id, name: names.get(r.user_id) ?? '—', answered: r.answered, successRate: Math.round((r.correct / Math.max(1, r.answered)) * 100), activeDays30: r.days30, lastAt: r.last_at }))
        .sort((a, b) => b.successRate * b.answered - a.successRate * a.answered);
      return {
        me: team.find((t) => t.userId === user.userId) ?? { answered: 0, successRate: 0, activeDays30: 0 },
        byTopic: byTopic.map((t) => ({ topic: TOPICS[t.topic] ?? t.topic, answered: t.answered, successRate: Math.round((t.correct / Math.max(1, t.answered)) * 100) })),
        team: canSeeTeam ? team : undefined,
      };
    });
  }

  // ----- Gestion des contenus (pharmacien) -----
  async items(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => { await this.ensureSeed(tx, tenantId); return tx.trainingItem.findMany({ where: { status: { not: 'archived' } }, orderBy: [{ status: 'asc' }, { topic: 'asc' }] }); });
  }

  private check(input: TrainingItemInput) {
    if (!TOPICS[input.topic]) throw new BadRequestException('Thème inconnu');
    if (input.kind === 'quiz') {
      if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 6) throw new BadRequestException('Un quiz comporte de 2 à 6 réponses.');
      if (input.answerIndex === undefined || input.answerIndex < 0 || input.answerIndex >= input.options.length) throw new BadRequestException('Indiquez la bonne réponse.');
    }
  }

  async create(user: AuthenticatedUser, input: TrainingItemInput) {
    this.check(input);
    return this.prisma.forTenant(user.tenantId, (tx) => tx.trainingItem.create({ data: { tenantId: user.tenantId, kind: input.kind, topic: input.topic, title: input.title.slice(0, 160), body: input.body.slice(0, 2000), options: input.options ?? [], answerIndex: input.answerIndex ?? null, explanation: input.explanation?.slice(0, 1000) ?? null, status: 'draft', source: 'officine', createdById: user.userId } }));
  }

  async update(user: AuthenticatedUser, id: string, input: TrainingItemInput) {
    this.check(input);
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      if (!(await tx.trainingItem.findUnique({ where: { id } }))) throw new NotFoundException('Contenu introuvable');
      // toute modification repasse en brouillon : elle doit etre revalidee
      return tx.trainingItem.update({ where: { id }, data: { kind: input.kind, topic: input.topic, title: input.title.slice(0, 160), body: input.body.slice(0, 2000), options: input.options ?? [], answerIndex: input.answerIndex ?? null, explanation: input.explanation ?? null, status: 'draft', validatedById: null, validatedAt: null } });
    });
  }

  /** Validation par un pharmacien (permission training.manage) : le contenu devient visible par l'equipe. */
  async setStatus(user: AuthenticatedUser, ids: string[], status: 'validated' | 'archived') {
    if (!user.permissions.includes('training.manage')) throw new ForbiddenException();
    const r = await this.prisma.forTenant(user.tenantId, (tx) => tx.trainingItem.updateMany({ where: { id: { in: ids } }, data: { status, ...(status === 'validated' ? { validatedById: user.userId, validatedAt: new Date() } : {}) } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: `training.${status}`, entityType: 'training_item', metadata: { count: r.count } });
    return { count: r.count };
  }
}