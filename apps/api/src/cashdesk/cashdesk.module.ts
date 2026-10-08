import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { emit } from '../accounting/outbox';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { CashShift, withSettings } from '../company/settings';
import { PrismaService } from '../prisma/prisma.service';

/** Coupures en circulation (FCFA, zone CEMAC). */
export const DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5] as const;
/** Rubriques de depenses payees en especes et compte SYSCOHADA associe. */
export const EXPENSE_CATEGORIES: Record<string, { label: string; account: string; group: string }> = {
  // --- Exploitation courante
  loyer: { label: 'Loyer, charges locatives', account: '622', group: 'Local et énergie' },
  energie: { label: 'Électricité, eau', account: '605', group: 'Local et énergie' },
  carburant: { label: 'Carburant, gasoil groupe électrogène', account: '605', group: 'Local et énergie' },
  entretien: { label: 'Entretien et réparations (groupe, climatisation, local)', account: '624', group: 'Local et énergie' },
  petit_materiel: { label: 'Petit matériel, mobilier, câbles et installations', account: '604', group: 'Local et énergie' },
  menage: { label: 'Produits de ménage, hygiène, nettoyage', account: '604', group: 'Local et énergie' },
  assurance: { label: 'Assurances (véhicule, local, responsabilité)', account: '625', group: 'Local et énergie' },
  // --- Fournitures de l'officine
  fournitures: { label: 'Fournitures de bureau (papier, stylos, encre, classeurs)', account: '604', group: 'Fournitures' },
  consommables_caisse: { label: 'Rouleaux de tickets, carnets de bons, pièces de caisse, étiquettes code-barres', account: '604', group: 'Fournitures' },
  emballages: { label: 'Emballages (sachets, boîtes, papier)', account: '604', group: 'Fournitures' },
  // --- Transport et banque
  transport: { label: 'Transport, fret, courses, livraison', account: '618', group: 'Transport et banque' },
  banque: { label: 'Frais bancaires, commissions de monnaie, transport banque', account: '631', group: 'Transport et banque' },
  // --- Communication
  telecom: { label: 'Téléphone, internet, abonnement TV', account: '628', group: 'Communication' },
  publicite: { label: 'Publicité, sponsoring, réseaux sociaux, supports publicitaires', account: '627', group: 'Communication' },
  // --- Personnel
  salaires: { label: 'Salaires et masse salariale', account: '661', group: 'Personnel' },
  avances: { label: 'Avances et acomptes sur salaire (à retenir)', account: '421', group: 'Personnel' },
  primes: { label: 'Primes, gratifications, rations, heures supplémentaires, gardiennage', account: '661', group: 'Personnel' },
  cnss: { label: 'Cotisations sociales (CNSS, arriérés)', account: '664', group: 'Personnel' },
  // --- Impôts et cotisations
  impots: { label: 'Impôts et taxes (TUS, acompte / tiers provisionnel, patente)', account: '641', group: 'Impôts et cotisations' },
  cotisations: { label: 'Cotisations professionnelles et sociales (Ordre, MUPHAR, décès)', account: '658', group: 'Impôts et cotisations' },
  // --- Autres
  restauration: { label: 'Restauration, réception', account: '658', group: 'Autres' },
  exploitant: { label: 'Dépenses personnelles de l’exploitant (à régulariser)', account: '462', group: 'Autres' },
  divers: { label: 'Divers', account: '658', group: 'Autres' },
};

type Detail = Record<string, number>;

/** Montant en toutes lettres (pieces de caisse). */
export function inWords(n: number): string {
  const u = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
  const t = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
  const lt100 = (x: number): string => {
    if (x < 17) return u[x];
    if (x < 20) return `dix-${u[x - 10]}`;
    if (x < 70) { const d = Math.floor(x / 10), r = x % 10; return r === 0 ? t[d] : r === 1 ? `${t[d]} et un` : `${t[d]}-${u[r]}`; }
    if (x < 80) return x === 71 ? 'soixante et onze' : `soixante-${lt100(x - 60)}`;
    return x === 80 ? 'quatre-vingts' : `quatre-vingt-${lt100(x - 80)}`;
  };
  const lt1000 = (x: number): string => { const c = Math.floor(x / 100), r = x % 100; const head = c === 0 ? '' : c === 1 ? 'cent' : `${u[c]} cent${r === 0 ? 's' : ''}`; return [head, r ? lt100(r) : ''].filter(Boolean).join(' ') || 'zéro'; };
  const v = Math.round(Math.abs(n));
  if (v === 0) return 'zéro franc CFA';
  const parts: string[] = [];
  const m = Math.floor(v / 1_000_000), k = Math.floor((v % 1_000_000) / 1000), r = v % 1000;
  if (m) parts.push(`${lt1000(m)} million${m > 1 ? 's' : ''}`);
  if (k) parts.push(k === 1 ? 'mille' : `${lt1000(k).replace(/cents$/, 'cent')} mille`);
  if (r) parts.push(lt1000(r));
  return `${parts.join(' ')} francs CFA`;
}
/** Ce que la caissière a le droit de voir : l'administrateur décide si la recette et l'attendu sont visibles (sinon comptage à l'aveugle). */
async function visibility(tx: Prisma.TransactionClient, user: AuthenticatedUser) {
  const p = await tx.companyProfile.findUnique({ where: { tenantId: user.tenantId }, select: { settings: true } });
  const pol = withSettings(p?.settings).cashPolicy;
  const manager = user.permissions.includes('reports.read');
  return { takings: manager || pol.showTakings, expected: manager || pol.showExpected };
}
function redact<T extends Record<string, any>>(s: T, v: { takings: boolean; expected: boolean }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const o: Record<string, any> = { ...s, hidden: { takings: !v.takings, expected: !v.expected } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!v.takings) { delete o.cashIn; delete o.refunds; delete o.byMethod; }
  if (!v.expected) { delete o.expected; delete o.expectedCash; delete o.diff; }
  return o as T;
}
/**
 * Caisse en service à l'instant `now` d'après les horaires paramétrés (semaine ordinaire ou de garde) : le poste de nuit
 * (ex. 19h-8h) traverse minuit et reste détecté correctement de part et d'autre. Retourne aussi le temps avant clôture,
 * pour le rappel de passation de caisse (30 min avant, puis toutes les 10 min).
 */
export function shiftAt(shifts: CashShift[], now: Date): { number: number; start: string; end: string; minutesToClose: number } | null {
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  for (const s of shifts) {
    const start = toMin(s.start), end = toMin(s.end);
    const overnight = end <= start;
    const inside = overnight ? mins >= start || mins < end : mins >= start && mins < end;
    if (!inside) continue;
    const close = overnight && mins < end ? end : overnight ? end + 1440 : end;
    return { number: s.number, start: s.start, end: s.end, minutesToClose: close - mins };
  }
  return null;
}
const total = (d: Detail) => Object.entries(d ?? {}).reduce((s, [k, n]) => s + (DENOMINATIONS.includes(Number(k) as never) ? Number(k) * Math.max(0, Math.trunc(Number(n) || 0)) : 0), 0);
const clean = (d: Detail) => Object.fromEntries(Object.entries(d ?? {}).filter(([k, n]) => DENOMINATIONS.includes(Number(k) as never) && Number(n) > 0).map(([k, n]) => [k, Math.trunc(Number(n))]));

@Injectable()
export class CashdeskService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  /** Caisse en service maintenant d'après les horaires paramétrés, avec le rappel de clôture (30 min avant, puis toutes les 10 min). */
  async currentShift(tenantId: string) {
    const p = await this.prisma.forTenant(tenantId, (tx) => tx.companyProfile.findUnique({ where: { tenantId }, select: { settings: true } }));
    const cfg = withSettings(p?.settings).cashRegisters;
    const shifts = cfg.guardActive ? cfg.guard : cfg.ordinary;
    const now = new Date();
    const s = shiftAt(shifts, now);
    if (!s) return { active: false, guardActive: cfg.guardActive, register: null, reminder: null as string | null };
    const reminder = s.minutesToClose <= 30 ? `Attention, commencez à préparer votre fonds de caisse et à mettre vos comptes à jour pour la passation dans ${Math.max(1, s.minutesToClose)} minute(s).` : null;
    return { active: true, guardActive: cfg.guardActive, register: `Caisse ${s.number}`, number: s.number, start: s.start, end: s.end, minutesToClose: s.minutesToClose, reminder };
  }

  /** Session ouverte de la caissiere connectee (une seule a la fois). */
  current(user: AuthenticatedUser) {
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      const s = await tx.cashSession.findFirst({ where: { cashierId: user.userId, status: 'open' }, include: { expenses: { orderBy: { createdAt: 'desc' } } } });
      return s ? redact({ ...s, ...(await this.position(tx, s)) }, await visibility(tx, user)) : null;
    });
  }

  /** Especes attendues dans le tiroir : fond + encaissements especes - remboursements - depenses de caisse. */
  private async position(tx: Prisma.TransactionClient, s: { id: string; openedAt: Date; openingFloat: number; closedAt?: Date | null }) {
    const until = s.closedAt ?? new Date();
    const [r] = await tx.$queryRaw<{ cash_in: number; cash_out: number }[]>`
      SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'confirmed'),0)::int AS cash_in,
             COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'),0)::int AS cash_out
      FROM payments WHERE method = 'cash' AND COALESCE(confirmed_at, created_at) BETWEEN ${s.openedAt} AND ${until}`;
    const methods = await tx.$queryRaw<{ method: string; amount: number }[]>`
      SELECT method, COALESCE(SUM(amount) FILTER (WHERE status = 'confirmed'),0)::int - COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'),0)::int AS amount
      FROM payments WHERE COALESCE(confirmed_at, created_at) BETWEEN ${s.openedAt} AND ${until} GROUP BY method`;
    const byMethod = Object.fromEntries(methods.filter((m) => m.amount !== 0).map((m) => [m.method, m.amount]));
    const exp = await tx.cashExpense.aggregate({ where: { sessionId: s.id }, _sum: { amount: true } });
    const expenses = exp._sum.amount ?? 0;
    return { byMethod, cashIn: r?.cash_in ?? 0, refunds: r?.cash_out ?? 0, expensesTotal: expenses, expected: s.openingFloat + (r?.cash_in ?? 0) - (r?.cash_out ?? 0) - expenses };
  }

  async open(user: AuthenticatedUser, body: { register?: string; detail: Detail; note?: string }) {
    const detail = clean(body.detail);
    const float = total(detail);
    const s = await this.prisma.forTenant(user.tenantId, async (tx) => {
      if (await tx.cashSession.findFirst({ where: { cashierId: user.userId, status: 'open' } })) throw new ConflictException('Vous avez déjà une caisse ouverte : clôturez-la d’abord.');
      // ecart a l'ouverture : fond declare vs fond laisse a la derniere cloture de cette caisse
      const register = (body.register ?? 'Caisse 1').slice(0, 40);
      const prev = await tx.cashSession.findFirst({ where: { register, status: 'closed' }, orderBy: { closedAt: 'desc' } });
      const count = await tx.cashSession.count();
      return tx.cashSession.create({ data: { tenantId: user.tenantId, number: `CS-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`, register, cashierId: user.userId, openingFloat: float, openingDetail: detail, note: body.note?.slice(0, 300) ?? (prev && prev.countedCash !== null && prev.countedCash !== float ? `Fond différent de la dernière clôture (${prev.countedCash} FCFA)` : null) } });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'cash.opened', entityType: 'cash_session', entityId: s.id, metadata: { float, detail } });
    return this.current(user);
  }

  async expense(user: AuthenticatedUser, body: { amount: number; category: string; label: string; beneficiary?: string }) {
    const amount = Math.round(Number(body.amount));
    const cat = EXPENSE_CATEGORIES[body.category];
    if (!cat) throw new BadRequestException('Rubrique inconnue');
    if (!(amount > 0)) throw new BadRequestException('Montant invalide');
    if (!body.label?.trim()) throw new BadRequestException('Motif obligatoire');
    const e = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const s = await tx.cashSession.findFirst({ where: { cashierId: user.userId, status: 'open' } });
      if (!s) throw new BadRequestException('Ouvrez d’abord votre caisse.');
      const pos = await this.position(tx, s);
      if (amount > pos.expected) throw new BadRequestException((await visibility(tx, user)).expected ? `Espèces insuffisantes en caisse (${pos.expected} FCFA disponibles).` : 'Espèces insuffisantes en caisse.');
      const n = await tx.cashExpense.count();
      const row = await tx.cashExpense.create({ data: { number: `PC-${new Date().getFullYear()}-${String(n + 1).padStart(5, '0')}`, tenantId: user.tenantId, sessionId: s.id, amount, category: body.category, label: body.label.trim().slice(0, 160), beneficiary: body.beneficiary?.trim().slice(0, 120) || null, accountCode: cat.account, createdById: user.userId } });
      await emit(tx, user.tenantId, 'cash.expense', { expenseId: row.id, amount, accountCode: cat.account, label: `${cat.label} — ${row.label}`, date: row.createdAt.toISOString() });
      return row;
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'cash.expense', entityType: 'cash_expense', entityId: e.id, metadata: { amount, category: body.category, label: e.label } });
    return this.voucher(user.tenantId, e.id);
  }

  /** Piece de caisse imprimable : nature de la depense, montant en lettres, signature de la caissiere deja apposee. */
  async voucher(tenantId: string, id: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const e = await tx.cashExpense.findUnique({ where: { id }, include: { session: { select: { number: true, register: true } } } });
      if (!e) throw new NotFoundException('Pièce introuvable');
      const [agent, tenant] = await Promise.all([tx.user.findUnique({ where: { id: e.createdById }, select: { fullName: true, signature: true } }), tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })]);
      return { ...e, categoryLabel: EXPENSE_CATEGORIES[e.category]?.label ?? e.category, amountInWords: inWords(e.amount), agent: agent?.fullName ?? null, agentSignature: agent?.signature ?? null, establishment: tenant?.name ?? null };
    });
  }

  async close(user: AuthenticatedUser, id: string, body: { detail: Detail; note?: string }) {
    const detail = clean(body.detail);
    const counted = total(detail);
    const s = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const s = await tx.cashSession.findUnique({ where: { id } });
      if (!s) throw new NotFoundException('Session introuvable');
      if (s.status !== 'open') throw new ConflictException('Caisse déjà clôturée');
      if (s.cashierId !== user.userId && !user.permissions.includes('sales.void')) throw new BadRequestException('Seule la caissière ou un responsable peut clôturer cette caisse');
      const pos = await this.position(tx, s);
      return tx.cashSession.update({ where: { id }, data: { status: 'closed', closedAt: new Date(), countedCash: counted, closingDetail: detail, expectedCash: pos.expected, diff: counted - pos.expected, note: body.note?.slice(0, 300) ?? s.note } });
    });
    // compatibilite : le cockpit lit les ecarts de caisse dans le journal d'audit
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'cash.closing', entityType: 'cash_session', entityId: s.id, metadata: { opening: s.openingFloat, expected: s.expectedCash, counted, diff: s.diff } });
    // ecart constate (hors comptage a l'aveugle, ou expectedCash est nul) : registre + message a la caissiere pour un deficit
    if (s.diff !== null && s.diff !== 0) await this.recordVariance(user, s);
    return this.detail(user.tenantId, s.id, user);
  }

  /** Registre des ecarts de caisse : la caissiere est avertie par message interne quand un deficit est constate. */
  private async recordVariance(actor: AuthenticatedUser, s: { id: string; register: string; cashierId: string; diff: number | null }) {
    const kind = (s.diff as number) < 0 ? 'deficit' : 'surplus';
    const amount = Math.abs(s.diff as number);
    await this.prisma.forTenant(actor.tenantId, (tx) => tx.cashVariance.create({ data: { tenantId: actor.tenantId, sessionId: s.id, cashierId: s.cashierId, kind, amount } }));
    if (kind === 'deficit' && s.cashierId !== actor.userId) {
      // espace ASCII simple comme separateur de milliers : toLocaleString('fr-FR') insere une espace fine insecable
      // (NNBSP) que l'encodage WIN1252 de la base ne peut pas stocker.
      const sum = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      await this.prisma.forTenant(actor.tenantId, (tx) =>
        tx.chatMessage.create({ data: { tenantId: actor.tenantId, senderId: actor.userId, recipientId: s.cashierId, kind: 'alerte', body: `Un déficit de ${sum} FCFA a été constaté sur votre clôture de ${s.register}. Merci de le justifier ou de le rembourser (Équipe et accès, onglet Caisses).` } }),
      );
    }
  }

  /** Fonds de roulement : solde et mouvements (reserve au manager, droit reports.read). */
  async reserve(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const moves = await tx.cashReserveMove.findMany({ orderBy: { createdAt: 'desc' }, take: 300 });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.createdById))] } }, select: { id: true, fullName: true } });
      const balance = moves.reduce((s, m) => s + (m.type === 'transfer_out' || m.type === 'bank_deposit' ? -m.amount : m.amount), 0);
      return { balance, moves: moves.map((m) => ({ ...m, createdBy: users.find((u) => u.id === m.createdById)?.fullName ?? null })) };
    });
  }

  async reserveMove(user: AuthenticatedUser, body: { type: string; amount: number; toRegister?: string; note?: string }) {
    const amount = Math.round(Number(body.amount));
    if (!(amount > 0)) throw new BadRequestException('Montant invalide');
    if (!['opening', 'deposit', 'transfer_out', 'bank_deposit'].includes(body.type)) throw new BadRequestException('Type de mouvement inconnu');
    if (body.type === 'transfer_out' && !body.toRegister?.trim()) throw new BadRequestException('Indiquez la caisse approvisionnée.');
    const row = await this.prisma.forTenant(user.tenantId, async (tx) => {
      if (body.type === 'transfer_out' || body.type === 'bank_deposit') {
        const current = await tx.cashReserveMove.findMany();
        const balance = current.reduce((s, m) => s + (m.type === 'transfer_out' || m.type === 'bank_deposit' ? -m.amount : m.amount), 0);
        if (amount > balance) throw new BadRequestException(`Fonds insuffisant (solde actuel : ${balance.toLocaleString('fr-FR')} FCFA).`);
      }
      return tx.cashReserveMove.create({ data: { tenantId: user.tenantId, type: body.type, amount, toRegister: body.toRegister?.trim().slice(0, 40) || null, note: body.note?.trim().slice(0, 300) || null, createdById: user.userId } });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'cash.reserve_move', entityType: 'cash_reserve_move', entityId: row.id, metadata: { type: body.type, amount, toRegister: body.toRegister } });
    return this.reserve(user.tenantId);
  }

  /** Registre des ecarts : par defaut les dossiers ouverts (a traiter), ou un statut precis. */
  async variances(tenantId: string, status?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.cashVariance.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 300, include: { session: { select: { number: true, register: true } } } });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.cashierId))] } }, select: { id: true, fullName: true } });
      return rows.map((r) => ({ ...r, cashierName: users.find((u) => u.id === r.cashierId)?.fullName ?? null }));
    });
  }

  async resolveVariance(user: AuthenticatedUser, id: string, body: { status: string; note?: string }) {
    if (!['justified', 'reimbursed', 'banked'].includes(body.status)) throw new BadRequestException('Statut inconnu');
    const row = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const v = await tx.cashVariance.findUnique({ where: { id } });
      if (!v) throw new NotFoundException('Écart introuvable');
      if (body.status === 'banked' && v.kind !== 'surplus') throw new BadRequestException('Seul un excédent peut être marqué « envoyé en banque ».');
      return tx.cashVariance.update({ where: { id }, data: { status: body.status, note: body.note?.trim().slice(0, 300) || v.note, resolvedById: user.userId, resolvedAt: new Date() } });
    });
    await this.audit.record({ tenantId: user.tenantId, userId: user.userId, action: 'cash.variance_resolved', entityType: 'cash_variance', entityId: row.id, metadata: { status: body.status } });
    return row;
  }

  async detail(tenantId: string, id: string, user?: AuthenticatedUser) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const s = await tx.cashSession.findUnique({ where: { id }, include: { expenses: { orderBy: { createdAt: 'desc' } } } });
      if (!s) throw new NotFoundException('Session introuvable');
      const cashier = await tx.user.findUnique({ where: { id: s.cashierId }, select: { fullName: true } });
      const full = { ...s, cashier: cashier?.fullName ?? null, ...(await this.position(tx, s)) };
      return user ? redact(full, await visibility(tx, user)) : full;
    });
  }

  list(tenantId: string, take = 60) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.cashSession.findMany({ orderBy: { openedAt: 'desc' }, take, include: { _count: { select: { expenses: true } } } });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.cashierId))] } }, select: { id: true, fullName: true } });
      return rows.map((r) => ({ ...r, cashier: users.find((u) => u.id === r.cashierId)?.fullName ?? null }));
    });
  }

  expenses(tenantId: string, from?: string, to?: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.cashExpense.findMany({ where: { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}) } }, orderBy: { createdAt: 'desc' }, take: 500 }));
  }
}

@Controller('cash')
export class CashdeskController {
  constructor(private readonly c: CashdeskService) {}
  @Get('meta') @RequirePermissions('sales.create') meta() { return { denominations: DENOMINATIONS, categories: EXPENSE_CATEGORIES }; }
  @Get('shift/current') @RequirePermissions('sales.create') shift(@CurrentUser() u: AuthenticatedUser) { return this.c.currentShift(u.tenantId); }
  @Get('sessions/current') @RequirePermissions('sales.create') current(@CurrentUser() u: AuthenticatedUser) { return this.c.current(u); }
  @Get('sessions') @RequirePermissions('reports.read') list(@CurrentUser() u: AuthenticatedUser) { return this.c.list(u.tenantId); }
  @Get('sessions/:id') @RequirePermissions('sales.create') one(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.c.detail(u.tenantId, id, u); }
  @Post('sessions/open') @RequirePermissions('sales.create') open(@CurrentUser() u: AuthenticatedUser, @Body() b: { register?: string; detail: Record<string, number>; note?: string }) { return this.c.open(u, b); }
  @Post('sessions/:id/close') @RequirePermissions('sales.create') close(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { detail: Record<string, number>; note?: string }) { return this.c.close(u, id, b); }
  @Post('expenses') @RequirePermissions('sales.create') expense(@CurrentUser() u: AuthenticatedUser, @Body() b: { amount: number; category: string; label: string; beneficiary?: string }) { return this.c.expense(u, b); }
  @Get('expenses/:id/voucher') @RequirePermissions('sales.create') voucher(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.c.voucher(u.tenantId, id); }
  @Get('reserve') @RequirePermissions('reports.read') reserve(@CurrentUser() u: AuthenticatedUser) { return this.c.reserve(u.tenantId); }
  @Post('reserve/moves') @RequirePermissions('reports.read') reserveMove(@CurrentUser() u: AuthenticatedUser, @Body() b: { type: string; amount: number; toRegister?: string; note?: string }) { return this.c.reserveMove(u, b); }
  @Get('variances') @RequirePermissions('reports.read') variances(@CurrentUser() u: AuthenticatedUser, @Query('status') status?: string) { return this.c.variances(u.tenantId, status); }
  @Post('variances/:id/resolve') @RequirePermissions('reports.read') resolveVariance(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { status: string; note?: string }) { return this.c.resolveVariance(u, id, b); }
  @Get('expenses') @RequirePermissions('reports.read') expenses(@CurrentUser() u: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) { return this.c.expenses(u.tenantId, from, to); }
}

@Module({ imports: [AuditLogModule], controllers: [CashdeskController], providers: [CashdeskService] })
export class CashdeskModule {}
