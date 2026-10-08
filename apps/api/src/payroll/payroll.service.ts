import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { emit } from '../accounting/outbox';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import { computePayslip, DEFAULT_PAYROLL_PARAMETERS, PayDeduction, PayItem, PayrollParameters } from './payroll-calc';
import { EmployeeDto, RunDto, UpdateEmployeeDto } from './payroll.dto';

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService, private readonly auditLog: AuditLogService) {}

  employees(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.employee.findMany({ orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }] }));
  }

  createEmployee(user: AuthenticatedUser, dto: EmployeeDto) {
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    return this.prisma.forTenant(user.tenantId, (tx) => tx.employee.create({ data: { ...dto, phone, hireDate: dto.hireDate ? new Date(dto.hireDate) : null, baseSalary: Math.round(dto.baseSalary), tenantId: user.tenantId } }));
  }

  async updateEmployee(user: AuthenticatedUser, id: string, dto: UpdateEmployeeDto) {
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      if (!(await tx.employee.findUnique({ where: { id } }))) throw new NotFoundException('Salarie introuvable');
      return tx.employee.update({ where: { id }, data: { ...dto, ...(dto.phone !== undefined ? { phone: normalizePhone(dto.phone) } : {}), ...(dto.hireDate ? { hireDate: new Date(dto.hireDate) } : {}), ...(dto.baseSalary !== undefined ? { baseSalary: Math.round(dto.baseSalary) } : {}) } });
    });
  }

  async parameters(tenantId: string): Promise<PayrollParameters> {
    const p = await this.prisma.forTenant(tenantId, (tx) => tx.companyProfile.findUnique({ where: { tenantId } }));
    return (p?.payrollParameters as unknown as PayrollParameters) ?? DEFAULT_PAYROLL_PARAMETERS;
  }

  async setParameters(user: AuthenticatedUser, params: PayrollParameters) {
    const merged = { ...DEFAULT_PAYROLL_PARAMETERS, ...params, version: `etablissement-${new Date().toISOString().slice(0, 10)}` };
    const sumCnss = merged.cnss.employeePension + merged.cnss.employerPension + merged.cnss.family + merged.cnss.workAccident;
    if (sumCnss <= 0 || sumCnss > 60) throw new BadRequestException('Taux CNSS incoherents');
    await this.prisma.forTenant(user.tenantId, (tx) => tx.companyProfile.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, payrollParameters: merged as unknown as Prisma.InputJsonValue }, update: { payrollParameters: merged as unknown as Prisma.InputJsonValue } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'payroll.parameters_changed', entityType: 'company_profile', entityId: user.tenantId, metadata: merged as unknown as Prisma.InputJsonValue });
    return merged;
  }

  /** Calcul (ou recalcul) de la paie d'un mois. Une paie validee est figee. */
  async compute(user: AuthenticatedUser, dto: RunDto) {
    const params = await this.parameters(user.tenantId);
    const runId = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const existing = await tx.payrollRun.findUnique({ where: { tenantId_period: { tenantId: user.tenantId, period: dto.period } } });
      if (existing?.status === 'validated') throw new ConflictException('Paie déjà validée pour ce mois');
      const profile = await tx.companyProfile.findUnique({ where: { tenantId: user.tenantId } });
      const zone = (profile?.zone === 'peripherie' ? 'peripherie' : 'centre') as 'centre' | 'peripherie';
      const staff = await tx.employee.findMany({ where: { isActive: true } });
      if (!staff.length) throw new BadRequestException('Aucun salarié actif');
      const run = existing ?? (await tx.payrollRun.create({ data: { tenantId: user.tenantId, period: dto.period } }));
      await tx.payslip.deleteMany({ where: { runId: run.id } });
      const totals: Record<string, number> = { gross: 0, net: 0, employerCost: 0, its: 0, tol: 0, cnssEmployee: 0, cnssEmployer: 0, camuEmployee: 0, camuEmployer: 0, tusTax: 0, tusSocial: 0, allowances: 0, deductionsPharmacy: 0, deductionsAdvances: 0, netToPay: 0, headcount: staff.length };
      const items = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => ({ label: String((x as PayItem).label ?? '').slice(0, 60), amount: Math.max(0, Math.round(Number((x as PayItem).amount) || 0)), kind: (x as PayDeduction).kind }));
      for (const e of staff) {
        const bonuses = Math.max(0, Math.round(dto.bonuses?.[e.id] ?? 0));
        const v = dto.variables?.[e.id] ?? {};
        const r = computePayslip({
          baseSalary: e.baseSalary, bonuses, taxParts: e.taxParts, zone, seniorityRate: e.seniorityRate,
          earnings: [...items(e.fixedEarnings), ...items(v.earnings)],
          allowances: [...items(e.fixedAllowances), ...items(v.allowances)],
          deductions: items(v.deductions) as PayDeduction[],
        }, params);
        await tx.payslip.create({ data: { tenantId: user.tenantId, runId: run.id, employeeId: e.id, gross: r.gross, bonuses, net: r.net, detail: { ...r, variables: v } as unknown as Prisma.InputJsonValue } });
        totals.allowances += r.allowancesTotal; totals.netToPay += r.netToPay;
        for (const d of r.deductions) { if (d.kind === 'pharmacie' || d.kind === 'nature') totals.deductionsPharmacy += d.amount; else totals.deductionsAdvances += d.amount; }
        totals.gross += r.gross; totals.net += r.net; totals.employerCost += r.employerCost; totals.its += r.employee.its; totals.tol += r.employee.tol;
        totals.cnssEmployee += r.employee.cnss; totals.cnssEmployer += r.employer.cnss; totals.camuEmployee += r.employee.camu; totals.camuEmployer += r.employer.camu;
        totals.tusTax += r.employer.tusTax; totals.tusSocial += r.employer.tusSocial;
      }
      await tx.payrollRun.update({ where: { id: run.id }, data: { totals, parameters: params as unknown as Prisma.InputJsonValue } });
      return run.id;
    });
    return this.run(user.tenantId, runId);
  }

  async run(tenantId: string, id: string) {
    const r = await this.prisma.forTenant(tenantId, (tx) => tx.payrollRun.findUnique({ where: { id }, include: { payslips: { include: { employee: { select: { fullName: true, jobTitle: true, cnssNumber: true, matricule: true, category: true, familySituation: true } } } } } }));
    if (!r) throw new NotFoundException('Paie introuvable');
    return r;
  }

  runs(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) => tx.payrollRun.findMany({ orderBy: { period: 'desc' }, take: 36 }));
  }

  /** Validation : bulletins figes, ecriture comptable de paie generee (outbox), montants repris par le calendrier fiscal. */
  async validate(user: AuthenticatedUser, id: string) {
    await this.prisma.forTenant(user.tenantId, async (tx) => {
      const r = await tx.payrollRun.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Paie introuvable');
      if (r.status === 'validated') throw new ConflictException('Déjà validée');
      await tx.payrollRun.update({ where: { id }, data: { status: 'validated', validatedAt: new Date(), validatedById: user.userId } });
      await emit(tx, user.tenantId, 'payroll.validated', { runId: id, period: r.period, totals: r.totals as Prisma.InputJsonValue, date: new Date(`${r.period}-28T00:00:00Z`).toISOString() });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'payroll.validated', entityType: 'payroll_run', entityId: id });
    return this.run(user.tenantId, id);
  }
}