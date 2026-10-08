import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import request from 'supertest';
import { DEFAULT_ROLES, PermissionCode } from '@erp/database';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestAppWithoutQueue as createTestApp } from './setup-app';

/**
 * P3 sur PostgreSQL reel : outbox -> ecritures SYSCOHADA equilibrees, contre-passation, facture SFEC avec mode
 * degrade (provisoire puis certifiee), webhook Mobile Money signe.
 */
describe('Comptabilite, SFEC et Mobile Money (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now();
  const password = 'AccountingTest123!';
  const http = () => request(app.getHttpServer());
  let slug: string;
  let owner: string;
  let cashier: string;
  let productId: string;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const process = () => http().post('/accounting/outbox/process').set('Authorization', `Bearer ${owner}`).expect(201);
  const balance = async () => (await http().get('/accounting/trial-balance').set('Authorization', `Bearer ${owner}`).expect(200)).body;
  const acc = (b: { rows: { account: string; balance: number }[] }, code: string) => b.rows.find((r) => r.account === code)?.balance ?? 0;

  beforeAll(async () => {
    globalThis.process.env.MOMO_WEBHOOK_SECRET = 'secret-de-test';
    const t = await createTestApp();
    app = t.app; prisma = t.moduleRef.get(PrismaService);
    slug = `compta-${suffix}`;
    const tenant = await prisma.tenant.create({ data: { name: `Compta ${suffix}`, slug, country: 'CG' } });
    const perms = await prisma.permission.findMany();
    const hash = await bcrypt.hash(password, 4);
    const tokens: Record<string, string> = {};
    for (const [key, roleName] of [['owner', 'owner'], ['cashier', 'cashier']]) {
      const codes = DEFAULT_ROLES[roleName] as PermissionCode[];
      const role = await prisma.forTenant(tenant.id, (tx) => tx.role.create({ data: { tenantId: tenant.id, name: roleName } }));
      await prisma.forTenant(tenant.id, (tx) => tx.rolePermission.createMany({ data: perms.filter((p) => codes.includes(p.code as PermissionCode)).map((p) => ({ roleId: role.id, permissionId: p.id })) }));
      const email = `${key}-${suffix}@compta.test`;
      const user = await prisma.user.create({ data: { email, fullName: key, passwordHash: hash } });
      await prisma.forTenant(tenant.id, (tx) => tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, roleId: role.id } }));
      tokens[key] = (await http().post('/auth/login').send({ email, password, tenantSlug: slug }).expect(201)).body.accessToken;
    }
    owner = tokens.owner; cashier = tokens.cashier;
    productId = (await http().post('/products').set('Authorization', `Bearer ${owner}`).send({ sku: 'P18', name: 'Produit TVA 18', salePrice: 1180, purchasePrice: 600, vatRate: 18 }).expect(201)).body.id;
  });

  afterAll(async () => { delete globalThis.process.env.SFEC_SIMULATOR_DOWN; await app.close(); });

  it('reception -> achat : stock au debit, fournisseur au credit', async () => {
    await http().post('/goods-receipts').set('Authorization', `Bearer ${owner}`).send({ lines: [{ productId, quantity: 10, unitCost: 600, lotNumber: 'L1', expiryDate: day(300) }] }).expect(201);
    await process();
    const b = await balance();
    expect(acc(b, '311')).toBe(6000);
    expect(acc(b, '401')).toBe(-6000);
    expect(b.totalDebit).toBe(b.totalCredit);
  });

  let saleId: string;
  it('vente en especes : client, ventes HT, TVA collectee, caisse, cout des ventes', async () => {
    const s = await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({ items: [{ productId, quantity: 2 }], payments: [{ method: 'cash', amount: 2360 }] }).expect(201);
    saleId = s.body.id;
    expect(s.body.vatAmount).toBe(360);
    await process();
    const b = await balance();
    expect(acc(b, '701')).toBe(-2000);
    expect(acc(b, '4431')).toBe(-360);
    expect(acc(b, '571')).toBe(2360);
    expect(acc(b, '411')).toBe(0); // facture puis encaissement
    expect(acc(b, '6031')).toBe(1200);
    expect(acc(b, '311')).toBe(6000 - 1200);
    expect(b.totalDebit).toBe(b.totalCredit);

    // un retraitement ne double jamais les ecritures (idempotence)
    await prisma.$executeRawUnsafe(`SELECT 1`);
    const r = await process();
    expect(r.body.processed).toBe(0);
  });

  it('SFEC en panne : facture provisoire, puis certifiee au retour du service ; la vente n\'a jamais attendu', async () => {
    globalThis.process.env.SFEC_SIMULATOR_DOWN = 'true';
    let r = await http().post('/sfec/process').set('Authorization', `Bearer ${owner}`).expect(201);
    expect(r.body.provisional).toBeGreaterThanOrEqual(1);
    let inv = (await http().get(`/sfec/sales/${saleId}`).set('Authorization', `Bearer ${owner}`).expect(200)).body[0];
    expect(inv.status).toBe('provisional');
    expect(inv.payload.total).toEqual({ ht: 2000, vat: 360, ttc: 2360 });

    delete globalThis.process.env.SFEC_SIMULATOR_DOWN;
    r = await http().post(`/sfec/invoices/${inv.id}/retry`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(r.body.certified).toBeGreaterThanOrEqual(1);
    inv = (await http().get(`/sfec/sales/${saleId}`).set('Authorization', `Bearer ${owner}`).expect(200)).body[0];
    expect(inv.status).toBe('certified');
    expect(inv.certificationRef).toMatch(/^SIM-/);
  });

  it('annulation : contre-passation complete et avoir SFEC', async () => {
    await http().post(`/sales/${saleId}/void`).set('Authorization', `Bearer ${owner}`).send({ reason: 'Erreur' }).expect(201);
    await process();
    const b = await balance();
    expect(acc(b, '701')).toBe(0);
    expect(acc(b, '4431')).toBe(0);
    expect(acc(b, '571')).toBe(0);
    expect(acc(b, '311')).toBe(6000);
    const docs = (await http().get(`/sfec/sales/${saleId}`).set('Authorization', `Bearer ${owner}`).expect(200)).body;
    const avoir = docs.find((d: { kind: string }) => d.kind === 'credit_note');
    expect(avoir.payload.total.ttc).toBe(-2360);
    expect(avoir.payload.originalNumber).toBe(docs[0].number);
  });

  it('les ecritures sont immuables en base (UPDATE refuse au role applicatif)', async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE journal_lines SET debit = debit + 1`)).rejects.toThrow();
  });

  it('webhook Mobile Money : signature obligatoire, montant controle, rejeu sans effet', async () => {
    const s = await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({ items: [{ productId, quantity: 1 }], payments: [{ method: 'mtn_momo', amount: 1180, reference: `MP-${suffix}` }] }).expect(201);
    expect(s.body.status).toBe('awaiting_payment');
    const send = (body: object, secret = 'secret-de-test') => {
      const raw = JSON.stringify(body);
      return http().post('/webhooks/mobile-money/mtn').set('Content-Type', 'application/json').set('x-signature', createHmac('sha256', secret).update(raw).digest('hex')).send(raw);
    };
    await send({ tenant: slug, reference: `MP-${suffix}`, status: 'SUCCESSFUL', amount: 1180 }, 'mauvais-secret').expect(403);
    await send({ tenant: slug, reference: `MP-${suffix}`, status: 'SUCCESSFUL', amount: 999 }).expect(409);
    const ok = await send({ tenant: slug, reference: `MP-${suffix}`, status: 'SUCCESSFUL', amount: 1180 }).expect(200);
    expect(ok.body.status).toBe('confirmed');
    const again = await send({ tenant: slug, reference: `MP-${suffix}`, status: 'SUCCESSFUL', amount: 1180 }).expect(200);
    expect(again.body.alreadyProcessed).toBe(true);
    const sale = await http().get(`/sales/${s.body.id}`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(sale.body.status).toBe('completed');
    await process();
    expect(acc(await balance(), '5215')).toBe(1180);
  });

  it('OD manuelle desequilibree refusee ; contre-passation unique ; reconciliation sans ecart', async () => {
    await http().post('/accounting/entries').set('Authorization', `Bearer ${owner}`).send({ date: day(0), label: 'Test', lines: [{ accountCode: '571', debit: 100 }, { accountCode: '101', credit: 90 }] }).expect(400);
    const e = await http().post('/accounting/entries').set('Authorization', `Bearer ${owner}`).send({ date: day(0), label: 'Apport', lines: [{ accountCode: '571', debit: 100 }, { accountCode: '101', credit: 100 }] }).expect(201);
    await http().post(`/accounting/entries/${e.body.id}/reverse`).set('Authorization', `Bearer ${owner}`).send({ reason: 'Erreur de saisie' }).expect(201);
    await http().post(`/accounting/entries/${e.body.id}/reverse`).set('Authorization', `Bearer ${owner}`).send({ reason: 'Encore' }).expect(409);
    await http().post('/accounting/entries').set('Authorization', `Bearer ${cashier}`).send({ date: day(0), label: 'X', lines: [] }).expect(403);
    const rec = await http().get('/accounting/reconciliation').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(rec.body.salesWithoutEntry).toHaveLength(0);
    const out = await http().get('/accounting/outbox').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(out.body.counts.failed ?? 0).toBe(0);
  });
});
