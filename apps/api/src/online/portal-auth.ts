import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export interface PortalToken { scope: 'customer' | 'courier'; tenantId: string; sub: string }

/** Jetons des clients et des livreurs : secret distinct de celui du personnel, donc inutilisables sur l'API de gestion. */
@Injectable()
export class PortalAuth {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  private secret() { return `${this.config.getOrThrow<string>('JWT_ACCESS_SECRET')}:portal`; }

  sign(p: PortalToken) { return this.jwt.signAsync({ ...p }, { secret: this.secret(), expiresIn: '30d' }); }

  async verify(header: string | undefined, scope: PortalToken['scope'], tenantId: string): Promise<PortalToken> {
    const token = (header ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Connexion requise');
    try {
      const p = await this.jwt.verifyAsync<PortalToken>(token, { secret: this.secret() });
      if (p.scope !== scope || p.tenantId !== tenantId) throw new ForbiddenException();
      return p;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new UnauthorizedException('Session expirée : reconnectez-vous');
    }
  }

  /** Anti-force brute : 5 échecs consécutifs bloquent une minute (par adresse IP et identifiant). */
  guard(key: string) {
    const f = this.fails.get(key);
    if (f && f.n >= 5 && f.until > Date.now()) throw new ForbiddenException('Trop d’essais : patientez une minute.');
  }
  fail(key: string) { const f = this.fails.get(key); this.fails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 60_000 }); }
  ok(key: string) { this.fails.delete(key); }
}
