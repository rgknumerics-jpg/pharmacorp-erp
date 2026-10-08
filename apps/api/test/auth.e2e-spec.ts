import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './setup-app';

/**
 * Authentification, RBAC et gestion des erreurs (ARCHITECTURE.md sections 8, 9, 20, 21).
 * Utilise le tenant/admin crees par `npm run db:seed` (voir .env.test : SEED_*).
 * Necessite Postgres/Redis de test demarres (docker-compose.test.yml).
 */
describe('Auth + RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const tenantName = process.env.SEED_TENANT_NAME ?? 'Pharmacie Pilote';
  // Meme slugification que packages/database/src/seed.ts -- ne PAS retrouver le tenant via
  // `membership` sans contexte : cette table est protegee par Row-Level Security (ARCHITECTURE.md
  // section 10), une requete sans tenant positionne n'y voit legitimement aucune ligne.
  const seedTenantSlug = tenantName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  let resolvedTenantSlug: string;
  let employeeEmail: string;
  const employeePassword = 'EmployeeTest123!';

  beforeAll(async () => {
    const { app: testApp, moduleRef } = await createTestApp();
    app = testApp;
    prisma = moduleRef.get(PrismaService);

    await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }); // l'admin seede existe bien
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: seedTenantSlug } });
    resolvedTenantSlug = tenant.slug;

    // Utilisateur "employee" (0 permission par defaut, voir @erp/database/permissions.ts)
    // pour prouver qu'une route protegee renvoie 403 sans la permission requise.
    const employeeRole = await prisma.forTenant(tenant.id, (tx) =>
      tx.role.findUniqueOrThrow({ where: { tenantId_name: { tenantId: tenant.id, name: 'employee' } } }),
    );
    const suffix = Date.now();
    employeeEmail = `employee-${suffix}@example.com`;
    const passwordHash = await bcrypt.hash(employeePassword, 4);
    const employeeUser = await prisma.user.create({
      data: { email: employeeEmail, fullName: 'Employee Test', passwordHash },
    });
    await prisma.forTenant(tenant.id, (tx) =>
      tx.membership.create({
        data: { tenantId: tenant.id, userId: employeeUser.id, roleId: employeeRole.id },
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuse un login avec un mauvais mot de passe (401, message generique)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'mauvais-mot-de-passe', tenantSlug: resolvedTenantSlug })
      .expect(401);
    expect(res.body.message).toBe('Identifiants invalides');
  });

  it('refuse une requete sans jeton sur une route protegee (401)', async () => {
    await request(app.getHttpServer()).get('/users').expect(401);
  });

  it('valide les identifiants et retourne un jeton + les permissions (200)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword, tenantSlug: resolvedTenantSlug })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.permissions).toEqual(
      expect.arrayContaining(['users.read', 'users.write', 'roles.read', 'roles.write', 'audit.read', 'tenant.manage']),
    );
  });

  it("rejette un payload de login invalide (validation des donnees, 400)", async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'pas-un-email', password: '123', tenantSlug: resolvedTenantSlug })
      .expect(400);
  });

  it("refuse l'acces a une route RBAC sans la permission requise (403)", async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: employeeEmail, password: employeePassword, tenantSlug: resolvedTenantSlug })
      .expect(201);
    expect(login.body.permissions).toEqual([]);

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);
  });

  it('rafraichit les jetons (rotation) et revoque immediatement l ancien refresh token', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword, tenantSlug: resolvedTenantSlug })
      .expect(201);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(201);
    expect(refreshed.body.accessToken).not.toBe(login.body.accessToken);

    // L'ancien refresh token, deja utilise, doit maintenant etre rejete (rotation stricte).
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it('le logout revoque le refresh token (idempotent, reutilisation refusee)', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword, tenantSlug: resolvedTenantSlug })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: login.body.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    // Idempotent : un second logout sur un jeton deja revoque ne doit pas planter.
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: login.body.refreshToken })
      .expect(204);
  });

  it('chaque login est journalise dans audit_logs (visible par un utilisateur autorise)', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword, tenantSlug: resolvedTenantSlug })
      .expect(201);

    const logs = await request(app.getHttpServer())
      .get('/audit-logs')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(logs.body.some((entry: { action: string }) => entry.action === 'auth.login')).toBe(true);
  });
});
