import { BadRequestException, Body, Controller, Get, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import { TaxModule } from '../tax/tax.module';
import { TaxService } from '../tax/tax.service';
import { GardesCity, GardesPharmacy, upcomingGardes } from './gardes';

interface Recipient { name: string; phone: string; categories: string[] }
const CATS = ['stock', 'fiscal', 'caisse', 'finances', 'garde'];
const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;
const GARDES_URL = () => (process.env.GARDES_API_URL ?? 'https://pharmacorp-gardes.netlify.app').replace(/\/$/, '');

/**
 * Alertes WhatsApp SANS abonnement payant : le message est prepare (risques, echeances fiscales, garde) et s'ouvre dans
 * WhatsApp (application ou Web) pour chaque destinataire, en un clic. Lien avec l'application Pharmacies de garde :
 * les semaines de garde de l'officine sont importees automatiquement depuis son planning public.
 */
@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly analytics: AnalyticsService, private readonly tax: TaxService, private readonly auditLog: AuditLogService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.GARDES_SYNC === 'off') return;
    this.timer = setInterval(() => void this.syncAll().catch((e) => this.logger.warn(e.message)), 6 * 3_600_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ----- destinataires et message du jour -----
  async recipients(tenantId: string) {
    const p = await this.prisma.forTenant(tenantId, (tx) => tx.companyProfile.findUnique({ where: { tenantId } }));
    return { recipients: (p?.alertRecipients as unknown as Recipient[]) ?? [], categories: CATS };
  }

  async setRecipients(user: AuthenticatedUser, list: Recipient[]) {
    const clean = (list ?? []).slice(0, 20).map((r) => ({ name: String(r.name ?? '').slice(0, 60), phone: normalizePhone(r.phone) ?? '', categories: (r.categories ?? []).filter((c) => CATS.includes(c)) }));
    if (clean.some((r) => !r.phone)) throw new BadRequestException('Numéro de téléphone invalide');
    await this.prisma.forTenant(user.tenantId, (tx) => tx.companyProfile.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, alertRecipients: clean }, update: { alertRecipients: clean } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'alerts.recipients', entityType: 'company_profile', metadata: { count: clean.length } });
    return this.recipients(user.tenantId);
  }

  async digest(tenantId: string) {
    const [risks, taxAlerts, reorder, tenant] = await Promise.all([this.analytics.risks(tenantId), this.tax.alerts(tenantId), this.analytics.reorder(tenantId), this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })]);
    const sections: Record<string, string[]> = { stock: [], fiscal: [], caisse: [], finances: [], garde: [] };
    for (const r of risks) {
      const cat = /Caisse|Annulation|Activité/.test(r.category) ? 'caisse' : /Prix|Marge/.test(r.category) ? 'finances' : 'stock';
      sections[cat].push(`${r.level === 'rouge' ? '🔴' : '🟠'} ${r.title}`);
    }
    for (const a of taxAlerts.slice(0, 8)) sections.fiscal.push(`${a.level === 'overdue' ? '🔴 EN RETARD' : '🗓️'} ${a.label} (${a.period}) — ${a.due}${a.estimate?.amount ? ` · ≈ ${fcfa(a.estimate.amount)}` : ''}`);
    if (reorder.garde?.reinforceNow) sections.garde.push(`🌙 Garde du ${new Date(reorder.garde.start).toLocaleDateString('fr-FR')} : renforcer ${reorder.products.filter((p: { gardeBoost: boolean; orderQty: number }) => p.gardeBoost && p.orderQty > 0).length} produit(s).`);
    const { recipients } = await this.recipients(tenantId);
    const head = `*PHARMACORP ERP — ${tenant.name}*\nPoints d'attention du ${new Date().toLocaleDateString('fr-FR')} :`;
    const build = (cats: string[]) => { const lines = (cats.length ? cats : CATS).flatMap((c) => sections[c] ?? []); return lines.length ? `${head}\n\n${lines.join('\n')}` : null; };
    return {
      sections,
      messages: recipients.map((r) => { const text = build(r.categories); return { name: r.name, phone: r.phone, text, waLink: text ? `https://wa.me/${r.phone}?text=${encodeURIComponent(text)}` : null }; }),
      preview: build(CATS),
    };
  }

  // ----- lien avec Pharmacies de garde -----
  private async dataset(): Promise<{ cities: Record<string, GardesCity>; pharmacies: GardesPharmacy[] }> {
    const r = await fetch(`${GARDES_URL()}/v1/guard/dataset`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new BadRequestException(`Application Pharmacies de garde injoignable (${r.status})`);
    return r.json() as Promise<{ cities: Record<string, GardesCity>; pharmacies: GardesPharmacy[] }>;
  }

  async searchPharmacies(q: string) {
    const ds = await this.dataset();
    const n = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return ds.pharmacies.filter((p) => p.active !== false && n(`${p.name} ${p.quartier ?? ''} ${p.arrondissement ?? ''}`).includes(n(q ?? ''))).slice(0, 30)
      .map((p) => ({ id: p.id, name: p.name, city: ds.cities[p.cityId]?.name ?? p.cityId, quartier: p.quartier ?? p.arrondissement ?? '', kind: p.kind, group: p.group }));
  }

  async link(user: AuthenticatedUser, pharmacyId: string | null) {
    await this.prisma.forTenant(user.tenantId, (tx) => tx.companyProfile.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, gardesPharmacyId: pharmacyId }, update: { gardesPharmacyId: pharmacyId } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'gardes.linked', entityType: 'company_profile', metadata: { pharmacyId } });
    return pharmacyId ? this.sync(user.tenantId) : { linked: null, added: 0 };
  }

  /** Importe les semaines de garde des 12 prochaines semaines (sans doublon, sans toucher aux gardes saisies a la main). */
  async sync(tenantId: string) {
    const prof = await this.prisma.forTenant(tenantId, (tx) => tx.companyProfile.findUnique({ where: { tenantId } }));
    if (!prof?.gardesPharmacyId) return { linked: null, added: 0 };
    const ds = await this.dataset();
    const ph = ds.pharmacies.find((p) => p.id === prof.gardesPharmacyId);
    if (!ph) throw new NotFoundException('Pharmacie introuvable dans Pharmacies de garde');
    const weeks = upcomingGardes(ds.cities[ph.cityId], ph, 12);
    let added = 0;
    await this.prisma.forTenant(tenantId, async (tx) => {
      for (const w of weeks) {
        const exists = await tx.gardePeriod.findFirst({ where: { startDate: new Date(w.start) } });
        if (!exists) { await tx.gardePeriod.create({ data: { tenantId, startDate: new Date(w.start), endDate: new Date(w.end), source: 'gardes', note: 'Synchronisé depuis Pharmacies de garde' } }); added++; }
      }
    });
    return { linked: { id: ph.id, name: ph.name, kind: ph.kind, group: ph.group, city: ds.cities[ph.cityId]?.name }, added, weeks, nightPharmacy: ph.kind === 'nuit' };
  }

  async syncAll() {
    for (const t of await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } })) { try { await this.sync(t.id); } catch { /* reseau : prochain essai */ } }
  }
}

@ApiTags('alerts')
@ApiBearerAuth()
@Controller()
export class AlertsController {
  constructor(private readonly a: AlertsService) {}
  @Get('alerts/recipients') @RequirePermissions('analytics.read') recipients(@CurrentUser() u: AuthenticatedUser) { return this.a.recipients(u.tenantId); }
  @Put('alerts/recipients') @RequirePermissions('tenant.manage') setRecipients(@CurrentUser() u: AuthenticatedUser, @Body() b: { recipients: Recipient[] }) { return this.a.setRecipients(u, b.recipients); }
  @Get('alerts/digest') @RequirePermissions('analytics.read') digest(@CurrentUser() u: AuthenticatedUser) { return this.a.digest(u.tenantId); }
  @Get('gardes/pharmacies') @RequirePermissions('stock.read') search(@Query('q') q: string) { return this.a.searchPharmacies(q ?? ''); }
  @Put('gardes/link') @RequirePermissions('purchases.write') link(@CurrentUser() u: AuthenticatedUser, @Body() b: { pharmacyId: string | null }) { return this.a.link(u, b.pharmacyId ?? null); }
  @Post('gardes/sync') @RequirePermissions('purchases.write') sync(@CurrentUser() u: AuthenticatedUser) { return this.a.sync(u.tenantId); }
}

@Module({ imports: [AuditLogModule, AnalyticsModule, TaxModule], controllers: [AlertsController], providers: [AlertsService] })
export class AlertsModule {}