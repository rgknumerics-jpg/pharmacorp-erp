import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './setup-app';

/**
 * Preuve d'isolation multi-tenant (ARCHITECTURE.md section 10) : deux tenants reels sont
 * crees, et on demontre qu'un utilisateur du tenant A ne peut JAMAIS lire ou modifier les
 * donnees du tenant B -- ni via l'API (application), ni via une requete Prisma qui aurait
 * "oublie" son filtre tenantId (Row-Level Security PostgreSQL).
 *
 * Necessite Postgres/Redis de test demarres (docker-compose.test.yml) et .env.test charge.
 */
describe('Isolation multi-tenant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const suffix = Date.now();
  const tenantASlug = `tenant-a-${suffix}`;
  const tenantBSlug = `tenant-b-${suffix}`;
  const password = 'IsolationTest123!';

  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };
  let membershipA: { id: string };
  let membershipB: { id: string };

  beforeAll(async () => {
    const { app: testApp, moduleRef } = await createTestApp();
    app = testApp;
    prisma = moduleRef.get(PrismaService);

    tenantA = await prisma.tenant.create({
      data: { name: `Tenant A ${suffix}`, slug: tenantASlug, country: 'CG' },
    });
    tenantB = await prisma.tenant.create({
      data: { name: `Tenant B ${suffix}`, slug: tenantBSlug, country: 'CG' },
    });

    // users.write est requis (pas seulement users.read) : le test IDOR ci-dessous doit passer
    // le controle RBAC pour verifier que c'est bien la Row-Level Security qui bloque l'acces
    // cross-tenant, pas un simple defaut de permission qui masquerait la vraie question.
    const permissions = await prisma.permission.findMany({
      where: { code: { in: ['users.read', 'users.write'] } },
    });
    const passwordHash = await bcrypt.hash(password, 4);

    const userA = await prisma.user.create({
      data: { email: `admin-a-${suffix}@example.com`, fullName: 'Admin A', passwordHash },
    });
    const userB = await prisma.user.create({
      data: { email: `admin-b-${suffix}@example.com`, fullName: 'Admin B', passwordHash },
    });

    const roleA = await prisma.forTenant(tenantA.id, (tx) =>
      tx.role.create({ data: { tenantId: tenantA.id, name: 'owner' } }),
    );
    await prisma.forTenant(tenantA.id, (tx) =>
      tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: roleA.id, permissionId: p.id })),
      }),
    );
    membershipA = await prisma.forTenant(tenantA.id, (tx) =>
      tx.membership.create({ data: { tenantId: tenantA.id, userId: userA.id, roleId: roleA.id } }),
    );

    const roleB = await prisma.forTenant(tenantB.id, (tx) =>
      tx.role.create({ data: { tenantId: tenantB.id, name: 'owner' } }),
    );
    await prisma.forTenant(tenantB.id, (tx) =>
      tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: roleB.id, permissionId: p.id })),
      }),
    );
    membershipB = await prisma.forTenant(tenantB.id, (tx) =>
      tx.membership.create({ data: { tenantId: tenantB.id, userId: userB.id, roleId: roleB.id } }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("le login sur le tenant A n'expose que les membres du tenant A via l'API", async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `admin-a-${suffix}@example.com`, password, tenantSlug: tenantASlug })
      .expect(201);

    expect(login.body.tenant.id).toBe(tenantA.id);
    expect(login.body.permissions).toContain('users.read');

    const users = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    const memberIds = users.body.map((m: { id: string }) => m.id);
    expect(memberIds).toContain(membershipA.id);
    expect(memberIds).not.toContain(membershipB.id);
  });

  it("un jeton du tenant A ne peut pas lire une ressource du tenant B via son id (IDOR bloque par RLS)", async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `admin-a-${suffix}@example.com`, password, tenantSlug: tenantASlug })
      .expect(201);

    // membershipB.id existe reellement en base, mais dans le tenant B : l'API doit repondre
    // 404 (jamais 200/403 qui confirmerait l'existence de la ressource dans un autre tenant).
    await request(app.getHttpServer())
      .patch(`/users/${membershipB.id}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ fullName: 'Tentative cross-tenant' })
      .expect(404);
  });

  it("Row-Level Security bloque une requete Prisma meme sans clause where tenantId", async () => {
    const rowsVisibleFromA = await prisma.forTenant(tenantA.id, (tx) => tx.membership.findMany());
    const ids = rowsVisibleFromA.map((m) => m.id);
    expect(ids).toContain(membershipA.id);
    expect(ids).not.toContain(membershipB.id);

    const rowsVisibleFromB = await prisma.forTenant(tenantB.id, (tx) => tx.membership.findMany());
    const idsB = rowsVisibleFromB.map((m) => m.id);
    expect(idsB).toContain(membershipB.id);
    expect(idsB).not.toContain(membershipA.id);
  });

  it("une requete sans contexte tenant ne voit aucune ligne des tables protegees (deny par defaut)", async () => {
    const rows = await prisma.membership.findMany({
      where: { id: { in: [membershipA.id, membershipB.id] } },
    });
    expect(rows).toHaveLength(0);
  });
});
