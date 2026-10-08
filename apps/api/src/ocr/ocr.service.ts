import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { PurchasesService } from '../purchases/purchases.service';
import { CreateOcrDocumentDto, ValidateOcrDocumentDto } from './dto/ocr.dto';
import { OCR_ENGINE, OcrEngine } from './ocr.engine';
import { matchProduct, parseDocument, parseExpiryLabel } from './parsers';

/** En dessous de ce seuil, la personne qui a numerise le document ne peut pas le valider elle-meme (2e role requis). */
export const OCR_SECOND_REVIEWER_THRESHOLD = 0.8;

const PUBLIC = { id: true, kind: true, status: true, engine: true, rawText: true, parsed: true, confidence: true, fileName: true, createdById: true, reviewedById: true, reviewedAt: true, receiptId: true, createdAt: true } satisfies Prisma.OcrDocumentSelect;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'image/bmp'];

@Injectable()
export class OcrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchases: PurchasesService,
    private readonly auditLog: AuditLogService,
    @Inject(OCR_ENGINE) private readonly engine: OcrEngine,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateOcrDocumentDto, file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    if (!file && !dto.rawText?.trim()) throw new BadRequestException('Envoyez une image ou le texte lu.');
    if (file && !IMAGE_TYPES.includes(file.mimetype)) throw new BadRequestException('Format d\'image non pris en charge (PNG, JPEG, WebP, TIFF, BMP).');

    let text = dto.rawText?.trim() ?? '';
    let engineConfidence = text ? dto.engineConfidence ?? 1 : 1;
    let engineName = 'client';
    if (!text && file) {
      const r = await this.engine.recognize(file.buffer);
      text = r.text;
      engineConfidence = r.confidence;
      engineName = this.engine.name;
    }
    if (!text.trim()) throw new BadRequestException('Aucun texte lisible sur ce document.');

    let parsed: Prisma.InputJsonValue;
    let confidence: number;
    if (dto.kind === 'expiry_label') {
      const r = parseExpiryLabel(text);
      confidence = 0.5 * engineConfidence + 0.5 * r.confidence;
      parsed = { kind: 'expiry_label', label: { lotNumber: r.lotNumber, expiryDate: r.expiry?.iso ?? null, expiryPrecision: r.expiry?.precision ?? null, raw: r.expiry?.raw ?? null } };
    } else {
      const doc = parseDocument(text, dto.kind);
      const catalog = await this.prisma.forTenant(user.tenantId, (tx) =>
        tx.product.findMany({ where: { isActive: true }, select: { id: true, name: true, dci: true, barcode: true, sku: true }, take: 20000 }),
      );
      const names = new Map(catalog.map((p) => [p.id, p.name]));
      const lines = doc.lines.map((l) => {
        const m = matchProduct(l.designation, l.barcode, catalog);
        // une ligne dont le produit n'est pas reconnu perd de la confiance : un humain doit choisir le produit
        const confidence = m ? Math.min(1, l.confidence * 0.7 + m.score * 0.3) : l.confidence * 0.6;
        return {
          designation: l.designation, quantity: l.quantity, unitCost: l.unitCost, lineTotal: l.lineTotal, lotNumber: l.lotNumber,
          expiryDate: l.expiry?.iso ?? null, expiryPrecision: l.expiry?.precision ?? null, barcode: l.barcode,
          productId: m?.id ?? null, productName: m ? names.get(m.id) ?? null : null, matchScore: m?.score ?? 0, confidence, raw: l.raw,
        };
      });
      const avg = lines.length ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length : 0;
      confidence = 0.4 * engineConfidence + 0.6 * avg;
      parsed = {
        kind: dto.kind,
        header: { supplierName: doc.supplierName, documentNumber: doc.documentNumber, documentDate: doc.documentDate, totalAmount: doc.totalAmount },
        lines,
      } as unknown as Prisma.InputJsonValue;
    }

    const created = await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.ocrDocument.create({
        data: {
          tenantId: user.tenantId, kind: dto.kind, engine: engineName, rawText: text, parsed, confidence: Math.round(confidence * 1000) / 1000,
          fileName: file?.originalname, image: file ? file.buffer : undefined, createdById: user.userId,
        },
        select: PUBLIC,
      }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'ocr.scanned', entityType: 'ocr_document', entityId: created.id, metadata: { kind: dto.kind, confidence: created.confidence } });
    return { ...created, needsSecondReviewer: created.confidence < OCR_SECOND_REVIEWER_THRESHOLD };
  }

  list(tenantId: string, status?: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.ocrDocument.findMany({ where: status ? { status: status as never } : {}, orderBy: { createdAt: 'desc' }, take: 100, select: PUBLIC }),
    );
  }

  async get(tenantId: string, id: string) {
    const d = await this.prisma.forTenant(tenantId, (tx) => tx.ocrDocument.findUnique({ where: { id }, select: PUBLIC }));
    if (!d) throw new NotFoundException('Document introuvable');
    return { ...d, needsSecondReviewer: d.confidence < OCR_SECOND_REVIEWER_THRESHOLD };
  }

  async image(tenantId: string, id: string) {
    const d = await this.prisma.forTenant(tenantId, (tx) => tx.ocrDocument.findUnique({ where: { id }, select: { image: true, fileName: true } }));
    if (!d?.image) throw new NotFoundException('Aucune image conservee pour ce document');
    return { data: Buffer.from(d.image), fileName: d.fileName };
  }

  /**
   * Validation humaine. Aucune entree en stock avant cette etape. Si la confiance est sous le seuil, la personne
   * qui a numerise le document ne peut pas le valider seule (ARCHITECTURE.md section 17).
   */
  async validate(user: AuthenticatedUser, id: string, dto: ValidateOcrDocumentDto) {
    const doc = await this.prisma.forTenant(user.tenantId, (tx) => tx.ocrDocument.findUnique({ where: { id } }));
    if (!doc) throw new NotFoundException('Document introuvable');
    if (doc.status !== 'pending_review') throw new ConflictException('Document deja traite');
    if (doc.confidence < OCR_SECOND_REVIEWER_THRESHOLD && doc.createdById === user.userId) {
      throw new ForbiddenException('Lecture peu fiable : un autre professionnel doit valider ce document (jamais la personne qui l\'a numerise).');
    }

    let receiptId: string | null = null;
    if (doc.kind === 'expiry_label') {
      if (!dto.productId || !dto.lotNumber || !dto.expiryDate) throw new BadRequestException('Produit, lot et date de peremption confirmes sont requis.');
      await this.prisma.forTenant(user.tenantId, async (tx) => {
        const lot = await tx.lot.findUnique({ where: { tenantId_productId_lotNumber: { tenantId: user.tenantId, productId: dto.productId!, lotNumber: dto.lotNumber! } } });
        if (!lot) throw new NotFoundException('Lot inconnu : receptionnez d\'abord ce lot (bon de livraison).');
        const iso = new Date(dto.expiryDate!).toISOString().slice(0, 10);
        if (lot.expiryDate && lot.expiryDate.toISOString().slice(0, 10) !== iso) {
          throw new ConflictException(`La date saisie (${iso}) differe de celle du lot enregistre (${lot.expiryDate.toISOString().slice(0, 10)}).`);
        }
        if (!lot.expiryDate) await tx.lot.update({ where: { id: lot.id }, data: { expiryDate: new Date(dto.expiryDate!) } });
        if (lot.status === 'pending_review' && lot.createdById !== user.userId) {
          await tx.lot.update({ where: { id: lot.id }, data: { status: 'available', validatedById: user.userId } });
        }
      });
    } else {
      if (!dto.lines?.length) throw new BadRequestException('Indiquez les lignes verifiees a receptionner.');
      const receipt = await this.purchases.receive(
        user,
        { lines: dto.lines, supplierId: dto.supplierId, purchaseOrderId: dto.purchaseOrderId, supplierRef: dto.supplierRef, updateCosts: dto.updateCosts, depotId: dto.depotId },
        { ocrDocumentId: doc.id },
      );
      receiptId = receipt.id;
    }

    const updated = await this.prisma.forTenant(user.tenantId, (tx) =>
      tx.ocrDocument.update({ where: { id }, data: { status: 'validated', reviewedById: user.userId, reviewedAt: new Date(), receiptId }, select: PUBLIC }),
    );
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'ocr.validated', entityType: 'ocr_document', entityId: id, metadata: { receiptId, confidence: doc.confidence, secondReviewer: doc.createdById !== user.userId } });
    return updated;
  }

  async reject(user: AuthenticatedUser, id: string, reason: string) {
    const updated = await this.prisma.forTenant(user.tenantId, async (tx) => {
      const doc = await tx.ocrDocument.findUnique({ where: { id } });
      if (!doc) throw new NotFoundException('Document introuvable');
      if (doc.status !== 'pending_review') throw new ConflictException('Document deja traite');
      return tx.ocrDocument.update({ where: { id }, data: { status: 'rejected', reviewedById: user.userId, reviewedAt: new Date() }, select: PUBLIC });
    });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'ocr.rejected', entityType: 'ocr_document', entityId: id, metadata: { reason } });
    return updated;
  }
}
