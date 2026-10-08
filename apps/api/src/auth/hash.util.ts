import { createHash } from 'crypto';

/** Empreinte stable d'un jeton pour stockage/recherche en base sans jamais garder le jeton en clair. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
