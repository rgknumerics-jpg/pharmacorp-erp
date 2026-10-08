import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

const TYPES = ['conge', 'maladie', 'permission', 'autre'];
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

/** RH : conges et absences, planning du personnel (dont les gardes), contrats a echeance. */
@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService, private readonly auditLog: AuditLogService) {}

  async leaves(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.leaveRequest.findMany({ orderBy: { startDate: 'desc' }, take: 200 });
      const emp = new Map((await tx.employee.findMany()).map((e) => [e.id, e.fullName]));
      return rows.map((r) => ({ ...r, employee: emp.get(r.employeeId) ?? '—', days: Math.round((r.endDate.getTime() - r.startDate.getTime()) / 86_400_000) + 1 }));
    });
  }

  async requestLeave(user: AuthenticatedUser, b: { employeeId: string; type: string; startDate: string; endDate: string; note?: string }) {
    if (!TYPES.includes(b.type)) throw new BadRequestException('Type d\'absence inconnu');
    if (new Date(b.endDate) < new Date(b.startDate)) throw new BadRequestException('La fin précède le début');
    return this.prisma.forTenant(user.tenantId, async (tx) => {
      if (!(await tx.employee.findUnique({ where: { id: b.employeeId } }))) throw new NotFoundException('Salarié introuvable');
      return tx.leaveRequest.create({ data: { tenantId: user.tenantId, employeeId: b.employeeId, type: b.type, startDate: new Date(b.startDate), endDate: new Date(b.endDate), note: b.note?.slice(0, 300) } });
    });
  }

  async decide(user: AuthenticatedUser, id: string, status: 'approved' | 'rejected') {
    const r = await this.prisma.forTenant(user.tenantId, (tx) => tx.leaveRequest.update({ where: { id }, data: { status, decidedById: user.userId, decidedAt: new Date() } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: `hr.leave_${status}`, entityType: 'leave_request', entityId: id });
    return r;
  }

  /** Planning d'une semaine : creneaux, absences approuvees, gardes de l'officine et alertes (garde sans personnel, conflit conge). */
  async week(tenantId: string, start: string) {
    const from = new Date(start), to = new Date(from.getTime() + 7 * 86_400_000);
    return this.prisma.forTenant(tenantId, async (tx) => {
      const [employees, shifts, leaves, gardes] = await Promise.all([
        tx.employee.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' } }),
        tx.shift.findMany({ where: { date: { gte: from, lt: to } }, orderBy: [{ date: 'asc' }, { startTime: 'asc' }] }),
        tx.leaveRequest.findMany({ where: { status: 'approved', startDate: { lt: to }, endDate: { gte: from } } }),
        tx.gardePeriod.findMany({ where: { startDate: { lt: to }, endDate: { gte: from } } }),
      ]);
      const alerts: string[] = [];
      for (const s of shifts) {
        const l = leaves.find((x) => x.employeeId === s.employeeId && x.startDate <= s.date && x.endDate >= s.date);
        if (l) alerts.push(`${employees.find((e) => e.id === s.employeeId)?.fullName} est en congé le ${s.date.toISOString().slice(0, 10)} mais planifié(e).`);
      }
      for (let d = 0; d < 7; d++) {
        const day = new Date(from.getTime() + d * 86_400_000);
        if (gardes.some((g) => g.startDate <= day && g.endDate >= day) && !shifts.some((s) => s.isGarde && s.date.getTime() === day.getTime())) alerts.push(`Garde le ${day.toISOString().slice(0, 10)} : aucune personne planifiée en garde.`);
      }
      const in60 = new Date(Date.now() + 60 * 86_400_000);
      for (const e of employees.filter((x) => x.contractEnd && x.contractEnd <= in60)) alerts.push(`Contrat ${e.contractType ?? ''} de ${e.fullName} se termine le ${e.contractEnd!.toISOString().slice(0, 10)}.`);
      return { employees: employees.map((e) => ({ id: e.id, fullName: e.fullName, jobTitle: e.jobTitle })), shifts, leaves, gardes, alerts };
    });
  }

  async addShift(user: AuthenticatedUser, b: { employeeId: string; date: string; startTime: string; endTime: string; isGarde?: boolean; note?: string }) {
    if (!hhmm.test(b.startTime) || !hhmm.test(b.endTime)) throw new BadRequestException('Heures au format HH:MM');
    return this.prisma.forTenant(user.tenantId, (tx) => tx.shift.create({ data: { tenantId: user.tenantId, employeeId: b.employeeId, date: new Date(b.date), startTime: b.startTime, endTime: b.endTime, isGarde: !!b.isGarde, note: b.note?.slice(0, 200) } }));
  }

  deleteShift(user: AuthenticatedUser, id: string) { return this.prisma.forTenant(user.tenantId, (tx) => tx.shift.delete({ where: { id } })); }

  async setContract(user: AuthenticatedUser, employeeId: string, b: { contractType?: string; contractEnd?: string | null }) {
    return this.prisma.forTenant(user.tenantId, (tx) => tx.employee.update({ where: { id: employeeId }, data: { contractType: b.contractType?.slice(0, 30), contractEnd: b.contractEnd ? new Date(b.contractEnd) : null } }));
  }
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr')
export class HrController {
  constructor(private readonly h: HrService) {}
  @Get('leaves') @RequirePermissions('payroll.read') leaves(@CurrentUser() u: AuthenticatedUser) { return this.h.leaves(u.tenantId); }
  @Post('leaves') @RequirePermissions('payroll.read') request(@CurrentUser() u: AuthenticatedUser, @Body() b: { employeeId: string; type: string; startDate: string; endDate: string; note?: string }) { return this.h.requestLeave(u, b); }
  @Post('leaves/:id/:decision') @RequirePermissions('hr.manage') decide(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string) { return this.h.decide(u, id, d === 'approve' ? 'approved' : 'rejected'); }
  @Get('planning') @RequirePermissions('payroll.read') week(@CurrentUser() u: AuthenticatedUser, @Query('start') start?: string) { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return this.h.week(u.tenantId, /^\d{4}-\d{2}-\d{2}$/.test(start ?? '') ? (start as string) : d.toISOString().slice(0, 10)); }
  @Post('shifts') @RequirePermissions('hr.manage') addShift(@CurrentUser() u: AuthenticatedUser, @Body() b: { employeeId: string; date: string; startTime: string; endTime: string; isGarde?: boolean; note?: string }) { return this.h.addShift(u, b); }
  @Delete('shifts/:id') @RequirePermissions('hr.manage') delShift(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.h.deleteShift(u, id); }
  @Post('employees/:id/contract') @RequirePermissions('hr.manage') contract(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: { contractType?: string; contractEnd?: string | null }) { return this.h.setContract(u, id, b); }
}

@Module({ imports: [AuditLogModule], controllers: [HrController], providers: [HrService] })
export class HrModule {}