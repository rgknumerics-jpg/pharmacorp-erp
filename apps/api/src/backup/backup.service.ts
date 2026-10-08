import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;
type Delegate = { findMany: (a?: object) => Promise<Record<string, unknown>[]>; createMany: (a: { data: unknown[] }) => Promise<unknown>; deleteMany: (a?: object) => Promise<unknown> };

/**
 * Tables metier sauvegardees, dans l'ordre d'insertion (parents d'abord). Les tables d'identite et d'acces (roles,
 * membres, jetons), le journal d'audit et les sauvegardes elles-memes ne sont JAMAIS ecrases par une restauration :
 * on ne peut pas s'enfermer dehors en restaurant une ancienne sauvegarde.
 */
const MODELS = [
  'companyProfile', 'companyDocument', 'category', 'supplier', 'customer', 'insurer', 'product', 'lot', 'purchaseOrder', 'purchaseOrderItem',
  'goodsReceipt', 'goodsReceiptItem', 'sale', 'saleItem', 'payment', 'inventoryMovement', 'tenantCounter', 'ocrDocument', 'account',
  'journalEntry', 'journalLine', 'outboxEvent', 'fiscalInvoice', 'taxFiling', 'employee', 'payrollRun', 'payslip', 'prescription',
  'supplierInvoice', 'gardePeriod', 'trainingItem', 'trainingAttempt',
] as const;

const FORMAT = 'pharmacorp-erp-backup/1';
const DRIVE_FOLDER = 'PHARMACORP ERP - Sauvegardes';

const encode = (rows: unknown) => JSON.stringify(rows, (_k, v) => (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data) ? { $bytes: Buffer.from(v.data).toString('base64') } : typeof v === 'bigint' ? Number(v) : v));
const revive = (_k: string, v: unknown) => (v && typeof v === 'object' && '$bytes' in (v as object) ? Buffer.from((v as { $bytes: string }).$bytes, 'base64') : v);

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, private readonly auditLog: AuditLogService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.BACKUP_WORKER === 'off') return;
    this.timer = setInterval(() => void this.runAutomatic().catch((e) => this.logger.error(e)), 30 * 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ----- chiffrement du jeton Google -----
  private key() { return createHash('sha256').update(process.env.BACKUP_ENC_KEY ?? process.env.JWT_REFRESH_SECRET ?? 'pharmacorp').digest(); }
  private encrypt(text: string) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', this.key(), iv); const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]); return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.'); }
  private decrypt(blob: string) { const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64')); const d = createDecipheriv('aes-256-gcm', this.key(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(enc), d.final()]).toString('utf8'); }

  // ----- export / import -----
  private delegate(tx: Tx, m: string) { return (tx as unknown as Record<string, Delegate>)[m]; }

  async exportTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const tables: Record<string, unknown[]> = {};
    await this.prisma.forTenant(tenantId, async (tx) => { for (const m of MODELS) tables[m] = await this.delegate(tx, m).findMany(); });
    const json = encode({ format: FORMAT, exportedAt: new Date().toISOString(), tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }, tables });
    const gz = gzipSync(Buffer.from(json, 'utf8'));
    const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
    return { data: gz, checksum: createHash('sha256').update(gz).digest('hex'), fileName: `pharmacorp-erp-${tenant.slug}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json.gz`, counts };
  }

  async backup(tenantId: string, trigger: 'manual' | 'auto' | 'pre_restore', userId?: string) {
    const exp = await this.exportTenant(tenantId);
    const setting = await this.prisma.forTenant(tenantId, (tx) => tx.backupSetting.findUnique({ where: { tenantId } }));
    let driveFileId: string | null = null, driveError: string | null = null;
    if (setting?.driveTokenEnc) {
      try { driveFileId = await this.uploadToDrive(tenantId, setting, exp.fileName, exp.data); } catch (e) { driveError = (e as Error).message; }
    }
    const rec = await this.prisma.forTenant(tenantId, async (tx) => {
      const r = await tx.backupRecord.create({ data: { tenantId, trigger, destination: driveFileId ? 'drive' : 'local', fileName: exp.fileName, sizeBytes: exp.data.length, checksum: exp.checksum, driveFileId, data: exp.data, status: 'ok', error: driveError, createdById: userId } });
      // on garde les 10 dernieres copies locales (la copie Drive reste dans le Drive)
      const old = await tx.backupRecord.findMany({ where: { data: { not: null } }, orderBy: { createdAt: 'desc' }, skip: 10, select: { id: true } });
      if (old.length) await tx.backupRecord.updateMany({ where: { id: { in: old.map((o) => o.id) } }, data: { data: null } });
      await tx.backupSetting.upsert({ where: { tenantId }, create: { tenantId, lastBackupAt: new Date(), lastStatus: driveError ? `local ok, Drive : ${driveError}` : 'ok' }, update: { lastBackupAt: new Date(), lastStatus: driveError ? `local ok, Drive : ${driveError}` : 'ok' } });
      return r;
    });
    await this.auditLog.record({ tenantId, userId, action: `backup.${trigger}`, entityType: 'backup', entityId: rec.id, metadata: { fileName: exp.fileName, size: exp.data.length, drive: !!driveFileId, counts: exp.counts } });
    return { id: rec.id, fileName: rec.fileName, sizeBytes: rec.sizeBytes, destination: rec.destination, driveError, counts: exp.counts };
  }

  /** Restauration : sauvegarde de securite automatique, puis remplacement complet des donnees metier en une transaction. */
  async restore(user: AuthenticatedUser, source: { recordId?: string; file?: Buffer }, confirmSlug: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    if (confirmSlug !== tenant.slug) throw new BadRequestException(`Pour confirmer, saisissez l'identifiant de l'établissement : ${tenant.slug}`);
    let gz: Buffer;
    if (source.recordId) {
      const rec = await this.prisma.forTenant(user.tenantId, (tx) => tx.backupRecord.findUnique({ where: { id: source.recordId! } }));
      if (!rec) throw new NotFoundException('Sauvegarde introuvable');
      if (rec.data) gz = Buffer.from(rec.data);
      else if (rec.driveFileId) gz = await this.downloadFromDrive(user.tenantId, rec.driveFileId);
      else throw new BadRequestException('Copie indisponible (ni locale ni sur Drive)');
    } else if (source.file) gz = source.file;
    else throw new BadRequestException('Aucune source de restauration');

    let payload: { format: string; tenant: { id: string }; tables: Record<string, Record<string, unknown>[]> };
    try { payload = JSON.parse(gunzipSync(gz).toString('utf8'), revive); } catch { throw new BadRequestException('Fichier de sauvegarde illisible'); }
    if (payload.format !== FORMAT) throw new BadRequestException('Format de sauvegarde inconnu');
    if (payload.tenant.id !== user.tenantId) throw new ForbiddenException('Cette sauvegarde appartient à un autre établissement.');

    const safety = await this.backup(user.tenantId, 'pre_restore', user.userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${user.tenantId}, true)`;
      await tx.$executeRaw`SELECT erp_purge_tenant_journal(${user.tenantId}::uuid)`; // ecritures : suppression reservee a cette fonction controlee
      for (const m of [...MODELS].reverse()) if (m !== 'journalEntry' && m !== 'journalLine') await this.delegate(tx, m).deleteMany({});
      for (const m of MODELS) {
        const rows = (payload.tables[m] ?? []).map((r) => ({ ...r, tenantId: user.tenantId }));
        for (let i = 0; i < rows.length; i += 1000) await this.delegate(tx, m).createMany({ data: rows.slice(i, i + 1000) });
      }
    }, { timeout: 600_000, maxWait: 20_000 });
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'backup.restored', entityType: 'backup', entityId: source.recordId, metadata: { safetyBackup: safety.id, counts: Object.fromEntries(Object.entries(payload.tables).map(([k, v]) => [k, v.length])) } });
    return { ok: true, safetyBackupId: safety.id };
  }

  async list(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const setting = await tx.backupSetting.findUnique({ where: { tenantId } });
      const records = await tx.backupRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, trigger: true, destination: true, fileName: true, sizeBytes: true, status: true, error: true, createdAt: true, driveFileId: true, data: false } });
      const local = new Set((await tx.backupRecord.findMany({ where: { data: { not: null } }, select: { id: true } })).map((r) => r.id));
      return {
        settings: { autoEnabled: setting?.autoEnabled ?? false, frequencyHours: setting?.frequencyHours ?? 24, driveConnected: !!setting?.driveTokenEnc, driveAccount: setting?.driveAccount ?? null, lastBackupAt: setting?.lastBackupAt ?? null, lastStatus: setting?.lastStatus ?? null, driveConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI) },
        records: records.map((r) => ({ ...r, hasLocalCopy: local.has(r.id) })),
      };
    });
  }

  async download(tenantId: string, id: string) {
    const rec = await this.prisma.forTenant(tenantId, (tx) => tx.backupRecord.findUnique({ where: { id } }));
    if (!rec) throw new NotFoundException('Sauvegarde introuvable');
    const data = rec.data ? Buffer.from(rec.data) : rec.driveFileId ? await this.downloadFromDrive(tenantId, rec.driveFileId) : null;
    if (!data) throw new NotFoundException('Copie indisponible');
    return { data, fileName: rec.fileName };
  }

  async settings(user: AuthenticatedUser, s: { autoEnabled?: boolean; frequencyHours?: number }) {
    const freq = s.frequencyHours !== undefined ? Math.min(168, Math.max(6, Math.round(s.frequencyHours))) : undefined;
    await this.prisma.forTenant(user.tenantId, (tx) => tx.backupSetting.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, autoEnabled: !!s.autoEnabled, frequencyHours: freq ?? 24 }, update: { ...(s.autoEnabled !== undefined ? { autoEnabled: s.autoEnabled } : {}), ...(freq ? { frequencyHours: freq } : {}) } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'backup.settings', entityType: 'backup', metadata: s });
    return this.list(user.tenantId);
  }

  async runAutomatic() {
    for (const t of await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } })) {
      const s = await this.prisma.forTenant(t.id, (tx) => tx.backupSetting.findUnique({ where: { tenantId: t.id } }));
      if (!s?.autoEnabled) continue;
      if (s.lastBackupAt && Date.now() - s.lastBackupAt.getTime() < s.frequencyHours * 3_600_000) continue;
      try { await this.backup(t.id, 'auto'); } catch (e) { this.logger.error(`Sauvegarde automatique ${t.id} : ${(e as Error).message}`); }
    }
  }

  // ----- Google Drive (OAuth 2, perimetre drive.file : l'application ne voit que les fichiers qu'elle a crees) -----
  private oauth() {
    const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET, redirect = process.env.GOOGLE_REDIRECT_URI;
    if (!id || !secret || !redirect) throw new ServiceUnavailableException('Google Drive non configuré sur ce serveur (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI).');
    return { id, secret, redirect };
  }
  private sign(v: string) { return createHmac('sha256', this.key()).update(v).digest('hex'); }

  driveAuthUrl(user: AuthenticatedUser) {
    const o = this.oauth();
    const state = `${user.tenantId}.${Date.now()}`;
    const params = new URLSearchParams({ client_id: o.id, redirect_uri: o.redirect, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email', state: `${state}.${this.sign(state)}` });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  }

  async driveCallback(code: string, state: string) {
    const o = this.oauth();
    const [tenantId, ts, sig] = state.split('.');
    const expected = this.sign(`${tenantId}.${ts}`);
    if (!sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) || Date.now() - Number(ts) > 15 * 60_000) throw new ForbiddenException('Lien de connexion expiré ou invalide');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: o.id, client_secret: o.secret, redirect_uri: o.redirect, grant_type: 'authorization_code' }) });
    const tok = (await r.json()) as { refresh_token?: string; access_token?: string; error?: string };
    if (!tok.refresh_token) throw new BadRequestException(`Google n'a pas renvoyé d'autorisation durable (${tok.error ?? 'refresh_token manquant'})`);
    let email: string | null = null;
    try { email = ((await (await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } })).json()) as { email?: string }).email ?? null; } catch { /* facultatif */ }
    await this.prisma.forTenant(tenantId, (tx) => tx.backupSetting.upsert({ where: { tenantId }, create: { tenantId, driveTokenEnc: this.encrypt(tok.refresh_token!), driveAccount: email }, update: { driveTokenEnc: this.encrypt(tok.refresh_token!), driveAccount: email, driveFolderId: null } }));
    await this.auditLog.record({ tenantId, action: 'backup.drive_connected', entityType: 'backup', metadata: { account: email } });
    return { ok: true };
  }

  async disconnectDrive(user: AuthenticatedUser) {
    await this.prisma.forTenant(user.tenantId, (tx) => tx.backupSetting.updateMany({ where: { tenantId: user.tenantId }, data: { driveTokenEnc: null, driveFolderId: null, driveAccount: null } }));
    await this.auditLog.record({ tenantId: user.tenantId, userId: user.userId, action: 'backup.drive_disconnected', entityType: 'backup' });
    return this.list(user.tenantId);
  }

  private async accessToken(tokenEnc: string) {
    const o = this.oauth();
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: this.decrypt(tokenEnc), client_id: o.id, client_secret: o.secret, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20000) });
    const j = (await r.json()) as { access_token?: string; error?: string };
    if (!j.access_token) throw new Error(`Accès Google refusé (${j.error ?? r.status}) : reconnectez Google Drive`);
    return j.access_token;
  }

  private async uploadToDrive(tenantId: string, s: { driveTokenEnc: string | null; driveFolderId: string | null }, fileName: string, data: Buffer) {
    const token = await this.accessToken(s.driveTokenEnc!);
    let folder = s.driveFolderId;
    if (!folder) {
      const f = await fetch('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }) });
      folder = ((await f.json()) as { id?: string }).id ?? null;
      if (folder) await this.prisma.forTenant(tenantId, (tx) => tx.backupSetting.update({ where: { tenantId }, data: { driveFolderId: folder } }));
    }
    const boundary = `pc${randomBytes(8).toString('hex')}`;
    const meta = JSON.stringify({ name: fileName, ...(folder ? { parents: [folder] } : {}) });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`),
      data, Buffer.from(`\r\n--${boundary}--`),
    ]);
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(120000) });
    const j = (await r.json()) as { id?: string; error?: { message?: string } };
    if (!j.id) throw new Error(`Envoi vers Google Drive refusé : ${j.error?.message ?? r.status}`);
    return j.id;
  }

  private async downloadFromDrive(tenantId: string, fileId: string) {
    const s = await this.prisma.forTenant(tenantId, (tx) => tx.backupSetting.findUnique({ where: { tenantId } }));
    if (!s?.driveTokenEnc) throw new BadRequestException('Google Drive non connecté');
    const token = await this.accessToken(s.driveTokenEnc);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new BadRequestException(`Téléchargement Google Drive impossible (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
}
