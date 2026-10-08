import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { alertLevel, occurrences, TaxProfileInput } from './calendar';
import { FilingDto } from './tax.dto';

type Tx = Prisma.TransactionClient;
export interface Estimate { amount: number; basis: string }

const PENALTY_NOTE = 'Retard : amende de 15 000 F par jour, plafonnée à 500 000 F ; absence de déclaration : majoration de 50 % (CGI art. 373, à verifier).';

@Injectable()
export class TaxService {
  constructor(private readonly prisma: PrismaService, private readonly auditLog: AuditLogService) {}

  private async profile(tx: Tx, tenantId: string): Promise<TaxProfileInput & { annualRent: number }> {
    const p = (await tx.companyProfile.findUnique({ where: { tenantId } })) ?? (await tx.companyProfile.create({ data: { tenantId } }));
    const employees = await tx.employee.count({ where: { isActive: true } });
    return { taxRegime: p.taxRegime, incomeTax: p.incomeTax, vatRegistered: p.vatRegistered, employeesCount: Math.max(p.employeesCount, employees), rentsPremises: p.rentsPremises, ownsProperty: p.ownsProperty, annualRent: p.annualRent };
  }

  /** Montant estime a partir des donnees de l'ERP (comptabilite, paie, profil) : une aide, jamais une declaration. */
  async estimate(tx: Tx, tenantId: string, obligation: string, period: string, prof: { annualRent: number; employeesCount: number }): Promise<Estimate | null> {
    const monthRange = (p: string) => { const [y, m] = p.split('-').map(Number); return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }; };
    const accountSum = async (prefix: string, date: { gte: Date; lt: Date }, side: 'credit' | 'debit') => {
      const r = await tx.journalLine.aggregate({ where: { accountCode: { startsWith: prefix }, entry: { date } }, _sum: { debit: true, credit: true } });
      const dbt = r._sum.debit ?? 0, cdt = r._sum.credit ?? 0;
      return side === 'credit' ? cdt - dbt : dbt - cdt;
    };
    const payroll = async (periods: string[]) => {
      const runs = await tx.payrollRun.findMany({ where: { period: { in: periods } } });
      return runs.reduce((s, r) => { const t = r.totals as Record<string, number>; for (const k of Object.keys(t)) s[k] = (s[k] ?? 0) + (t[k] ?? 0); return s; }, {} as Record<string, number>);
    };
    const yearOf = (p: string) => Number(p.slice(0, 4));
    const yearRange = (y: number) => ({ gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) });

    switch (obligation) {
      case 'TVA': {
        if (!/^\d{4}-\d{2}$/.test(period)) return null;
        const collected = await accountSum('4431', monthRange(period), 'credit');
        const deductible = await accountSum('4452', monthRange(period), 'debit');
        const net = collected - deductible;
        return { amount: Math.max(0, Math.round(net * 1.05)), basis: `TVA collectée ${collected} - TVA déductible ${deductible}${net > 0 ? ' + centimes additionnels 5 %' : ' : credit de TVA reportable'}` };
      }
      case 'ITS': case 'TUS': case 'CAMU': case 'TOL_SAL': case 'CNSS': {
        const m = /^(\d{4}-\d{2})/.exec(period); if (!m) return null;
        const months = period.includes('trimestre') ? [0, 1, 2].map((k) => { const [y, mo] = m[1].split('-').map(Number); const dt = new Date(Date.UTC(y, mo - 1 - k, 1)); return dt.toISOString().slice(0, 7); }) : [m[1]];
        const t = await payroll(months);
        if (!Object.keys(t).length) return { amount: 0, basis: 'Aucune paie validée sur la période' };
        const map: Record<string, [number, string]> = {
          ITS: [t.its ?? 0, 'ITS retenu sur les bulletins'],
          TUS: [(t.tusTax ?? 0) + (t.tusSocial ?? 0), 'TUS 2,025 % (impôts) + 5,475 % (CNSS) du brut'],
          CAMU: [(t.camuEmployee ?? 0) + (t.camuEmployer ?? 0), 'CAMU 2,27 % + 4,55 % du brut'],
          TOL_SAL: [t.tol ?? 0, 'TOL retenue par salarié'],
          CNSS: [(t.cnssEmployee ?? 0) + (t.cnssEmployer ?? 0), `CNSS salariale + patronale (${months.length} mois)`],
        };
        return { amount: map[obligation][0], basis: map[obligation][1] };
      }
      case 'TAXE_IMMO': return prof.annualRent ? { amount: Math.round(prof.annualRent / 12), basis: '1/12e du loyer annuel déclaré dans le profil' } : null;
      case 'TAXE_REG': return { amount: 2400 * prof.employeesCount, basis: `2 400 F x ${prof.employeesCount} employé(s)` };
      case 'IMF_IS': case 'IMF_IBA': case 'IGF': {
        const y = yearOf(period) - 1;
        const products = await accountSum('7', yearRange(y), 'credit');
        const sales = await accountSum('70', yearRange(y), 'credit');
        if (obligation === 'IGF') return { amount: Math.round(sales * 0.05 / 4), basis: `1/4 de 5 % du CA HT ${y} (${sales})` };
        const rate = obligation === 'IMF_IS' ? 0.01 : 0.015;
        return { amount: Math.round(products * rate / 4), basis: `1/4 de ${rate * 100} % des produits ${y} (${products})` };
      }
      case 'IS': case 'IBA': {
        const y = Number(period);
        const result = (await accountSum('7', yearRange(y), 'credit')) - (await accountSum('6', yearRange(y), 'debit'));
        const rate = obligation === 'IS' ? 0.28 : 0.3;
        const imf = await tx.taxFiling.aggregate({ where: { obligation: { startsWith: 'IMF' }, period: { startsWith: String(y) }, status: 'paid' }, _sum: { amount: true } });
        const gross = Math.max(0, Math.round(result * rate));
        return { amount: Math.max(0, gross - (imf._sum.amount ?? 0)), basis: `${rate * 100} % du résultat comptable ${y} (${result}) moins IMF payés ; résultat fiscal a établir par le comptable (réintégrations / déductions)` };
      }
      default: return null;
    }
  }

  async calendar(tenantId: string, year: number) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const prof = await this.profile(tx, tenantId);
      const occ = occurrences(prof, [year]);
      const filings = await tx.taxFiling.findMany({ where: { dueDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } });
      const today = new Date();
      return {
        profile: prof,
        items: occ.map((o) => {
          const f = filings.find((x) => x.obligation === o.obligation && x.period === o.period);
          return { ...o, status: f?.status ?? 'todo', amount: f?.amount ?? null, reference: f?.reference ?? null, filedAt: f?.filedAt ?? null, ...alertLevel(o.due, today) };
        }),
      };
    });
  }

  /** Echeances non soldees a moins d'un mois (ou en retard) : le bandeau fige en haut de l'ecran. */
  async alerts(tenantId: string, today = new Date()) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const prof = await this.profile(tx, tenantId);
      const y = today.getUTCFullYear();
      const occ = occurrences(prof, [y - 1, y, y + 1]);
      const filings = await tx.taxFiling.findMany({ where: { status: 'paid' } });
      // on ne reclame pas les echeances anterieures a l'ouverture du compte dans l'ERP (suivi a partir de cette date)
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const since = tenant.createdAt.toISOString().slice(0, 10);
      const out = [];
      for (const o of occ) {
        const lv = alertLevel(o.due, today);
        if (!lv.level || lv.daysLeft < -90 || o.due < since) continue;
        if (filings.some((f) => f.obligation === o.obligation && f.period === o.period)) continue;
        out.push({ ...o, ...lv, estimate: await this.estimate(tx, tenantId, o.obligation, o.period, prof), penaltyNote: lv.level === 'overdue' ? PENALTY_NOTE : undefined });
      }
      return out.sort((a, b) => a.daysLeft - b.daysLeft);
    });
  }

  async estimateOne(tenantId: string, obligation: string, period: string) {
    return this.prisma.forTenant(tenantId, async (tx) => this.estimate(tx, tenantId, obligation, period, await this.profile(tx, tenantId)));
  }

  async file(user: AuthenticatedUser, dto: FilingDto) {
    const f = await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.taxFiling.upsert({
        where: { tenantId_obligation_period: { tenantId: user.tenantId, obligation: dto.obligation, period: dto.period } },
        create: { tenantId: user.tenantId, obligation: dto.obligation, period: dto.period, dueDate: new Date(dto.dueDate), status: dto.status, amount: dto.amount, reference: dto.reference, filedAt: new Date(), filedById: user.userId },
        update: { status: dto.status, amount: dto.amount, reference: dto.reference, filedAt: new Date(), filedById: user.userId },
      }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: `tax.${dto.status}`, entityType: 'tax_filing', entityId: f.id, metadata: { obligation: dto.obligation, period: dto.period, amount: dto.amount ?? null, reference: dto.reference ?? null } });
    return f;
  }
}