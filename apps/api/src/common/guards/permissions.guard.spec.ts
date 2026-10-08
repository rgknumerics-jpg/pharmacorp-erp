import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function makeContext(user?: { permissions: string[] }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('laisse passer une route sans permission requise', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(makeContext({ permissions: [] }))).toBe(true);
  });

  it("laisse passer un utilisateur qui a toutes les permissions requises", () => {
    const reflector = {
      getAllAndOverride: () => ['users.read', 'users.write'],
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const context = makeContext({ permissions: ['users.read', 'users.write', 'audit.read'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejette un utilisateur a qui il manque une permission", () => {
    const reflector = {
      getAllAndOverride: () => ['users.write'],
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const context = makeContext({ permissions: ['users.read'] });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejette une requete sans utilisateur authentifie si une permission est requise', () => {
    const reflector = {
      getAllAndOverride: () => ['users.read'],
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
