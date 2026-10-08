import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService.login', () => {
  const tenant = { id: 'tenant-1', slug: 'pharmacie-pilote', name: 'Pharmacie Pilote', isActive: true };
  let passwordHash: string;
  let user: { id: string; email: string; fullName: string; passwordHash: string; isActive: boolean };
  const membership = {
    id: 'membership-1',
    roleId: 'role-1',
    isActive: true,
    role: {
      permissions: [{ permission: { code: 'users.read' } }, { permission: { code: 'users.write' } }],
    },
  };

  let prisma: any;
  let jwt: any;
  let config: any;
  let auditLog: any;
  let queue: any;
  let service: AuthService;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('ChangeMe123!', 4);
  });

  beforeEach(() => {
    user = { id: 'user-1', email: 'admin@example.com', fullName: 'Admin', passwordHash, isActive: true };

    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      forTenant: jest.fn().mockImplementation(async (_tenantId: string, fn: any) =>
        fn({ membership: { findUnique: jest.fn().mockResolvedValue(membership) }, refreshToken: { create: jest.fn() } }),
      ),
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      verifyAsync: jest.fn(),
    };
    config = { getOrThrow: jest.fn((key: string) => `value-for-${key}`) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    queue = { enqueue: jest.fn().mockResolvedValue(undefined) };

    service = new AuthService(prisma, jwt, config, auditLog, queue);
  });

  it('retourne des jetons et les permissions pour des identifiants valides', async () => {
    const result = await service.login('admin@example.com', 'ChangeMe123!', 'pharmacie-pilote');

    expect(result.accessToken).toBe('signed-token');
    expect(result.permissions).toEqual(['users.read', 'users.write']);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', tenantId: tenant.id }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith('auth.login', { tenantId: tenant.id, userId: user.id });
  });

  it('rejette un mauvais mot de passe sans preciser lequel des deux champs est faux', async () => {
    await expect(service.login('admin@example.com', 'mauvais-mdp', 'pharmacie-pilote')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejette un tenant inconnu', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(service.login('admin@example.com', 'ChangeMe123!', 'inconnu')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejette un utilisateur desactive', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });
    await expect(service.login('admin@example.com', 'ChangeMe123!', 'pharmacie-pilote')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
