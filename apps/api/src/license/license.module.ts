import { createHash, createPublicKey, verify } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, HttpException, Injectable, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

/** Clé publique de vérification des licences (la clé privée n'est que dans le générateur de licences). */
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxVJam9OEB7r/ATNne9wb
N1Ak63cG+IKv0TeMwzisOF5fIbQCkK9Db+AR/D9X6QTqmthS4zw69qvB7JdDEcB7
G1XgnkvwsyQ5yWw3UE6loemzs5NUXriuM2xJk3EHqKwytxcSmP/uRux2J2Kqc+fs
NobT0gVh4e9evjS5jZsWntZv+dUH4QynpgS1JdVkFUUSODcb2rqUAKPSqw2MUfcC
Xix6kEeVIrM194gJ2UBA2ihWMV3B7LnjO3EndWKjJ5pXCj5AMn7SEeCbXtQv4Cqk
KIEbtndWUfdHAdvLYC6S/okHnXQxd/r6pDipNx6rKwatVewOkxvoOAjOMMxKj5mv
3wIDAQAB
-----END PUBLIC KEY-----`;

export interface LicensePayload { v: number; n: string; o?: string; e: string; i?: string; m?: string; p?: string }
export interface LicenseStatus { enforced: boolean; valid: boolean; reason: string | null; name?: string; org?: string; edition?: string; expires?: string; daysLeft?: number; issued?: string; machineId: string; boundToMachine?: boolean }

/** Identifiant de ce poste : à communiquer pour obtenir une licence liée à l'ordinateur (facultatif). */
export function machineId(): string {
  const mac = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')?.mac ?? '';
  const h = createHash('sha256').update(`${os.hostname()}|${mac}|${os.cpus()[0]?.model ?? ''}`).digest('hex').toUpperCase().slice(0, 16);
  return h.match(/.{4}/g)!.join('-');
}

const b64u = (s: string) => Buffer.from(s, 'base64url');

/** Vérifie une clé de licence : signature RSA, date d'expiration, liaison éventuelle à l'ordinateur. */
export function checkKey(key: string, now = new Date()): { payload?: LicensePayload; reason?: string } {
  const parts = key.trim().replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== 'PCERP') return { reason: 'Clé de licence illisible.' };
  let payload: LicensePayload;
  try {
    const raw = b64u(parts[1]);
    const ok = verify('sha256', raw, createPublicKey(PUBLIC_KEY), b64u(parts[2]));
    if (!ok) return { reason: 'Clé de licence invalide (signature incorrecte).' };
    payload = JSON.parse(raw.toString('utf8')) as LicensePayload;
  } catch { return { reason: 'Clé de licence illisible.' }; }
  if (payload.m && payload.m !== machineId()) return { payload, reason: 'Cette licence est liée à un autre ordinateur.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.e) || new Date(`${payload.e}T23:59:59Z`) < now) return { payload, reason: `Licence expirée le ${payload.e}.` };
  return { payload };
}

@Injectable()
export class LicenseService {
  private readonly enforced = process.env.LICENSE_ENFORCE === '1';
  private readonly dir = process.env.LICENSE_DIR ?? path.join(process.cwd(), '.license');
  private cache: { at: number; s: LicenseStatus } | null = null;

  private file() { return path.join(this.dir, 'license.key'); }
  private stateFile() { return path.join(this.dir, 'license-state.json'); }

  /** Détecte un retour en arrière de l'horloge (contournement de l'expiration). */
  private clockOk(now: Date): boolean {
    try {
      const last = existsSync(this.stateFile()) ? new Date(JSON.parse(readFileSync(this.stateFile(), 'utf8')).lastSeen) : null;
      if (last && now.getTime() < last.getTime() - 24 * 3600_000) return false;
      mkdirSync(this.dir, { recursive: true });
      if (!last || now > last) writeFileSync(this.stateFile(), JSON.stringify({ lastSeen: now.toISOString() }));
    } catch { /* lecture seule : on ne bloque pas */ }
    return true;
  }

  status(force = false): LicenseStatus {
    const now = new Date();
    if (!force && this.cache && now.getTime() - this.cache.at < 30_000) return this.cache.s;
    const base = { enforced: this.enforced, machineId: machineId() };
    let s: LicenseStatus;
    if (!this.enforced) s = { ...base, valid: true, reason: null, edition: 'développement' };
    else if (!existsSync(this.file())) s = { ...base, valid: false, reason: 'Aucune licence : saisissez la clé fournie.' };
    else if (!this.clockOk(now)) s = { ...base, valid: false, reason: 'L’horloge de l’ordinateur a été reculée : corrigez la date et l’heure.' };
    else {
      const r = checkKey(readFileSync(this.file(), 'utf8'), now);
      const p = r.payload;
      s = { ...base, valid: !r.reason, reason: r.reason ?? null, name: p?.n, org: p?.o, edition: p?.p, expires: p?.e, issued: p?.i, boundToMachine: !!p?.m, daysLeft: p ? Math.ceil((new Date(`${p.e}T23:59:59Z`).getTime() - now.getTime()) / 86_400_000) : undefined };
    }
    this.cache = { at: now.getTime(), s };
    return s;
  }

  activate(key: string): LicenseStatus {
    const r = checkKey(key);
    if (r.reason) throw new BadRequestException(r.reason);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(), key.trim().replace(/\s+/g, ''));
    return this.status(true);
  }
}

/** Sans licence valide (installation diffusée à l'équipe), toute l'API est bloquée sauf l'état de la licence et sa saisie. */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly license: LicenseService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ method: string; path?: string; url: string }>();
    const p = req.path ?? req.url.split('?')[0];
    if (req.method === 'OPTIONS' || p === '/health' || p.startsWith('/license')) return true;
    const s = this.license.status();
    if (s.valid) return true;
    throw new HttpException({ statusCode: 402, code: 'LICENSE_REQUIRED', message: s.reason ?? 'Licence requise', machineId: s.machineId }, 402);
  }
}

@ApiTags('license')
@Controller('license')
export class LicenseController {
  constructor(private readonly s: LicenseService) {}
  @Public() @Get('status') status() { return this.s.status(true); }
  @Public() @Post('activate') activate(@Body() b: { key?: string }) { return this.s.activate(b?.key ?? ''); }
}

@Module({ controllers: [LicenseController], providers: [LicenseService, LicenseGuard], exports: [LicenseService, LicenseGuard] })
export class LicenseModule {}
