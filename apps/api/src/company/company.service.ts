import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';
import { Branding, mergeBranding, withDefaults } from './branding';
import { DOCUMENT_KEYS, UpdateCompanyProfileDto } from './company.dto';
import { mergeSettings, withSettings } from './settings';

const FIELDS: [keyof UpdateCompanyProfileDto, string][] = [
  ['legalName', 'Raison sociale'], ['niu', 'NIU'], ['rccm', 'RCCM'], ['practiceAuthorization', 'Autorisation d\'exercice'],
  ['cnssEmployerNumber', 'N° employeur CNSS'], ['patenteNumber', 'N° de patente'], ['address', 'Adresse'],
];

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService, private readonly auditLog: AuditLogService) {}

  async profile(tenantId: string) {
    const p = await this.prisma.forTenant(tenantId, async (tx) =>
      (await tx.companyProfile.findUnique({ where: { tenantId } })) ?? tx.companyProfile.create({ data: { tenantId } }),
    );
    const docs = await this.prisma.forTenant(tenantId, (tx) => tx.companyDocument.findMany({ select: { key: true, label: true, fileName: true, createdAt: true }, orderBy: { createdAt: 'asc' } }));
    const missingFields = FIELDS.filter(([k]) => !(p as Record<string, unknown>)[k]).map(([, l]) => l);
    const missingDocs = Object.entries(DOCUMENT_KEYS).filter(([k]) => !docs.some((d) => d.key === k)).map(([, l]) => l);
    const total = FIELDS.length + Object.keys(DOCUMENT_KEYS).length;
    return { profile: { ...p, payrollParameters: undefined, branding: undefined }, documents: docs, documentTypes: DOCUMENT_KEYS, completeness: { percent: Math.round(((total - missingFields.length - missingDocs.length) / total) * 100), missingFields, missingDocs } };
  }

  async update(user: AuthenticatedUser, dto: UpdateCompanyProfileDto) {
    const phone = dto.phone !== undefined ? normalizePhone(dto.phone) : undefined;
    if (dto.phone && !phone) throw new BadRequestException('Telephone invalide');
    await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.companyProfile.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, ...dto, ...(phone !== undefined ? { phone } : {}) }, update: { ...dto, ...(phone !== undefined ? { phone } : {}) } }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'company.profile_updated', entityType: 'company_profile', entityId: user.tenantId, metadata: Object.keys(dto) });
    return this.profile(user.tenantId);
  }

  async upload(user: AuthenticatedUser, key: string, file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    if (!DOCUMENT_KEYS[key]) throw new BadRequestException('Type de document inconnu');
    if (!file) throw new BadRequestException('Fichier manquant');
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('PDF ou image uniquement');
    await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.companyDocument.upsert({
        where: { tenantId_key: { tenantId: user.tenantId, key } },
        create: { tenantId: user.tenantId, key, fileName: file.originalname, mimeType: file.mimetype, data: file.buffer, uploadedById: user.userId },
        update: { fileName: file.originalname, mimeType: file.mimetype, data: file.buffer, uploadedById: user.userId },
      }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'company.document_uploaded', entityType: 'company_document', entityId: key });
    return this.profile(user.tenantId);
  }

  /** Identité et modèles imprimés (ticket, bon, étiquette) : lus par la caisse, donc sans droit « structure ». */
  async branding(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const [p, t] = await Promise.all([tx.companyProfile.findUnique({ where: { tenantId } }), tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })]);
      return {
        branding: withDefaults(p?.branding),
        identity: { name: p?.legalName || t?.name || '', address: p?.address ?? null, city: p?.city ?? null, phone: p?.phone ?? null, email: p?.email ?? null, niu: p?.niu ?? null, rccm: p?.rccm ?? null, authorization: p?.practiceAuthorization ?? null, patente: p?.patenteNumber ?? null },
        ticket: { fields: withSettings(p?.settings).ticketFields, bankName: withSettings(p?.settings).legal.bankName, bankAccount: withSettings(p?.settings).legal.bankAccount },
      };
    });
  }

  async updateBranding(user: AuthenticatedUser, input: Record<string, unknown>) {
    const cur = await this.prisma.forTenant(user.tenantId, async (tx) => (await tx.companyProfile.findUnique({ where: { tenantId: user.tenantId }, select: { branding: true } }))?.branding);
    const merged = mergeBranding(cur as Partial<Branding>, input);
    await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.companyProfile.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, branding: merged as unknown as object }, update: { branding: merged as unknown as object } }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'company.branding_updated', entityType: 'company_profile', entityId: user.tenantId, metadata: Object.keys(input) });
    return this.branding(user.tenantId);
  }


  /** Réglages généraux (politique de caisse, verrouillage des postes, listes, mentions du ticket, catalogue en ligne). */
  async settings(tenantId: string) {
    const p = await this.prisma.forTenant(tenantId, (tx) => tx.companyProfile.findUnique({ where: { tenantId }, select: { settings: true } }));
    return withSettings(p?.settings);
  }

  async updateSettings(user: AuthenticatedUser, input: Record<string, unknown>) {
    const cur = await this.settings(user.tenantId);
    const merged = mergeSettings(cur, input);
    await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.companyProfile.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, settings: merged as unknown as object }, update: { settings: merged as unknown as object } }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'company.settings_updated', entityType: 'company_profile', entityId: user.tenantId, metadata: Object.keys(input) });
    return merged;
  }
  /** Document libre (ajouté progressivement) : clé `custom_xxxxxxxx` + libellé. */
  /** Crée une valeur dans une liste de la fiche produit (formes, emplacements) sans droit « structure ». */
  async addToList(user: AuthenticatedUser, kind: string, value: string) {
    if (kind !== 'forms' && kind !== 'locations') throw new BadRequestException('Liste inconnue');
    const v = String(value ?? '').trim().slice(0, 60);
    if (v.length < 2) throw new BadRequestException('Valeur trop courte');
    const cur = await this.settings(user.tenantId);
    if (cur.lists[kind].some((x) => x.toLowerCase() === v.toLowerCase())) return cur.lists;
    const merged = mergeSettings(cur, { lists: { [kind]: [...cur.lists[kind], v] } });
    await this.prisma.forTenant(user.tenantId, (tx) => tx.companyProfile.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, settings: merged as unknown as object }, update: { settings: merged as unknown as object } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'company.list_added', entityType: 'company_profile', entityId: user.tenantId, metadata: { kind, value: v } });
    return merged.lists;
  }
  async uploadCustom(user: AuthenticatedUser, label: string, file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    const lab = (label ?? '').trim().slice(0, 80);
    if (lab.length < 2) throw new BadRequestException('Donnez un nom au document');
    if (!file) throw new BadRequestException('Fichier manquant');
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('PDF ou image uniquement');
    const key = `custom_${randomBytes(4).toString('hex')}`;
    await this.prisma.forTenant(user.tenantId, (tx) => tx.companyDocument.create({ data: { tenantId: user.tenantId, key, label: lab, fileName: file.originalname, mimeType: file.mimetype, data: file.buffer, uploadedById: user.userId } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'company.document_uploaded', entityType: 'company_document', entityId: key, metadata: { label: lab } });
    return this.profile(user.tenantId);
  }

  async removeCustom(user: AuthenticatedUser, key: string) {
    if (!key.startsWith('custom_')) throw new BadRequestException('Seuls les documents ajoutés librement peuvent être supprimés');
    await this.prisma.forTenant(user.tenantId, (tx) => tx.companyDocument.deleteMany({ where: { tenantId: user.tenantId, key } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'company.document_removed', entityType: 'company_document', entityId: key });
    return this.profile(user.tenantId);
  }

  async file(tenantId: string, key: string) {
    const d = await this.prisma.forTenant(tenantId, (tx) => tx.companyDocument.findUnique({ where: { tenantId_key: { tenantId, key } } }));
    if (!d) throw new NotFoundException('Document non depose');
    return d;
  }
}