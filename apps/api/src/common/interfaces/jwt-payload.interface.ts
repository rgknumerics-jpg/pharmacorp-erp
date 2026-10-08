import { PermissionCode } from '@erp/database';

/**
 * Contenu du JWT d'acces. Les permissions sont embarquees dans le token (resolues au
 * login/refresh) pour eviter une requete DB a chaque appel : elles ne se mettent a jour
 * qu'a la prochaine connexion/rafraichissement, ce qui est un choix deliberement simple
 * pour ce socle (ARCHITECTURE.md section 9).
 */
export interface JwtPayload {
  sub: string; // userId
  tenantId: string;
  membershipId: string;
  roleId: string;
  permissions: PermissionCode[];
  // Identifiant unique par emission : sans lui, deux jetons emis dans la meme seconde avec
  // le meme payload sont byte-identiques (JWT/HMAC est deterministe). Trouve par les tests
  // e2e de rotation du refresh token (2026-09-27) -- voir test/auth.e2e-spec.ts.
  jti: string;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  membershipId: string;
  roleId: string;
  permissions: PermissionCode[];
}
