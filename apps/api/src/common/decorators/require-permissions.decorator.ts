import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from '@erp/database';

export const PERMISSIONS_KEY = 'required_permissions';

/** Route protegee par RBAC : l'utilisateur doit avoir TOUTES les permissions listees (ARCHITECTURE.md section 9). */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
