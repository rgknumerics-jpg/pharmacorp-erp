import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DEFAULT_ROLES, PermissionCode } from '@erp/database';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestAppWithoutQueue as createTestApp } from './setup-app';

/** P5 : cockpit, risques, reapprovisionnement, garde, fournisseurs et echeances, finances, audit, formation, sauvegarde/restauration. */
describe('Cockpit et pilotage avance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string, cashier: string, tenantId: string, slug: string;
  let amox: string, cheap: string, supA: string, supB: string;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app; prisma = t.moduleRef.get(PrismaService);
    slug = `cockpit-${suffix}`;
    const tenant = await prisma.tenant.create({ data: { name: `Cockpit ${suffix}`, slug } });
    tenantId = tenant.id;
    const perms = await prisma.permission.findMany();
    const hash = await bcrypt.hash('Cockpit123!', 4);
    const tokens: Record<string, string> = {};
    for (const role of ['owner', 'cashier']) {
      const codes = DEFAULT_ROLES[role] as PermissionCode[];
      const r = await prisma.forTenant(tenant.id, (tx) => tx.role.create({ data: { tenantId: tenant.id, name: role } }));
      await prisma.forTenant(tenant.id, (tx) => tx.rolePermission.createMany({ data: perms.filter((p) => codes.includes(p.code as PermissionCode)).map((p) => ({ roleId: r.id, permissionId: p.id })) }));
      const email = `${role}-${suffix}@cockpit.test`;
      const u = await prisma.user.create({ data: { email, fullName: role === 'owner' ? 'Titulaire' : 'Auxiliaire', passwordHash: hash } });
      await prisma.forTenant(tenant.id, (tx) => tx.membership.create({ data: { tenantId: tenant.id, userId: u.id, roleId: r.id } }));
      tokens[role] = (await http().post('/auth/login').send({ email, password: 'Cockpit123!', tenantSlug: slug }).expect(201)).body.accessToken;
    }
    owner = tokens.owner; cashier = tokens.cashier;
    amox = (await http().post('/products').set(auth(owner)).send({ sku: 'AMOX500', name: 'Amoxicilline 500 mg', salePrice: 1500, purchasePrice: 1000 }).expect(201)).body.id;
    cheap = (await http().post('/products').set(auth(owner)).send({ sku: 'LOSS', name: 'Produit à perte', salePrice: 800, purchasePrice: 1000 }).expect(201)).body.id;
    supA = (await http().post('/suppliers').set(auth(owner)).send({ name: 'Grossiste A', paymentTermDays: 0 }).expect(201)).body.id;
    supB = (await http().post('/suppliers').set(auth(owner)).send({ name: 'Grossiste B', paymentTermDays: 30 }).expect(201)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('receptions -> factures fournisseurs (comptant / 30 jours), paiement comptabilise', async () => {
    await http().post('/goods-receipts').set(auth(owner)).send({ supplierId: supA, supplierRef: 'FA-1', lines: [{ productId: amox, quantity: 20, unitCost: 930, lotNumber: 'A1', expiryDate: day(300) }] }).expect(201);
    await http().post('/goods-receipts').set(auth(owner)).send({ supplierId: supB, supplierRef: 'FB-1', lines: [{ productId: amox, quantity: 10, unitCost: 1000, lotNumber: 'B1', expiryDate: day(120) }, { productId: cheap, quantity: 5, unitCost: 1000, lotNumber: 'C1', expiryDate: day(400) }] }).expect(201);
    const inv = (await http().get('/supplier-invoices').set(auth(owner)).expect(200)).body;
    const a = inv.find((i: { number: string }) => i.number === 'FA-1'), b = inv.find((i: { number: string }) => i.number === 'FB-1');
    expect(a.dueDate.slice(0, 10)).toBe(day(0)); // comptant
    expect(b.dueDate.slice(0, 10)).toBe(day(30));
    await http().patch(`/supplier-invoices/${b.id}`).set(auth(owner)).send({ dueDate: day(45) }).expect(200); // echeance saisie a la main
    await http().post(`/supplier-invoices/${a.id}/payments`).set(auth(owner)).send({ amount: 99_999 }).expect(400);
    await http().post(`/supplier-invoices/${a.id}/payments`).set(auth(owner)).send({ amount: 18_600, method: 'cash' }).expect(201);
    await http().post('/accounting/outbox/process').set(auth(owner)).expect(201);
    const tb = (await http().get('/accounting/trial-balance').set(auth(owner)).expect(200)).body;
    expect(tb.rows.find((r: { account: string }) => r.account === '401').balance).toBe(-(15_000)); // reste B : 10x1000 + 5x1000
  });

  it('ventes historiques -> prevision de rupture et quantite a commander', async () => {
    // 2 boites par jour pendant 10 jours (ventes datees dans le passe)
    for (let i = 1; i <= 10; i++) {
      const s = await http().post('/sales').set(auth(cashier)).send({ items: [{ productId: amox, quantity: 2 }], payments: [{ method: 'cash', amount: 3000 }] }).expect(201);
      await prisma.forTenant(tenantId, (tx) => tx.sale.update({ where: { id: s.body.id }, data: { createdAt: new Date(Date.now() - i * 86_400_000) } }));
    }
    const r = (await http().get('/analytics/reorder').set(auth(owner)).expect(200)).body;
    const p = r.products.find((x: { productId: string }) => x.productId === amox);
    expect(p.stock).toBe(10);
    expect(p.dailyDemand).toBeGreaterThan(0);
    expect(p.ruptureInDays).not.toBeNull();
    expect(p.orderQty).toBeGreaterThan(0);
    expect(['critique', 'a_commander']).toContain(p.status);
    expect(r.proposal.length).toBeGreaterThan(0);
  });

  it('semaine de garde dans 3 jours : renfort propose', async () => {
    await http().post('/garde-periods').set(auth(owner)).send({ startDate: day(3), endDate: day(9), upliftPct: 60 }).expect(201);
    const r = (await http().get('/analytics/reorder').set(auth(owner)).expect(200)).body;
    expect(r.garde.reinforceNow).toBe(true);
    expect(r.products.find((x: { productId: string }) => x.productId === amox).gardeBoost).toBe(true);
    const ins = (await http().get('/analytics/insights').set(auth(owner)).expect(200)).body;
    expect(ins.some((i: { text: string }) => /garde/i.test(i.text))).toBe(true);
  });

  it('risques : prix sous le cout, ecart de caisse, prix modifie de plus de 20 %', async () => {
    const c = await http().post('/cash/closings').set(auth(cashier)).send({ counted: 10_000 }).expect(201);
    expect(c.body.expected).toBe(30_000);
    expect(c.body.diff).toBe(-20_000);
    await http().patch(`/products/${amox}`).set(auth(owner)).send({ salePrice: 2500 }).expect(200);
    const risks = (await http().get('/analytics/risks').set(auth(owner)).expect(200)).body;
    const ids = risks.map((r: { id: string }) => r.id);
    expect(ids).toContain('below-cost');
    expect(ids).toContain('cash-gap');
    expect(ids).toContain('price-change');
    await http().get('/analytics/risks').set(auth(cashier)).expect(403);
  });

  it('cockpit et tableau financier', async () => {
    const c = (await http().get('/analytics/cockpit').set(auth(owner)).expect(200)).body;
    expect(c.health.stockValue).toBeGreaterThan(0);
    expect(c.health.supplierDebt).toBe(15_000);
    expect(c.commercial.bySeller[0].seller).toBe('Auxiliaire');
    expect(c.stock.toOrder).toBeGreaterThan(0);
    const f = (await http().get(`/analytics/finance?from=${day(-30)}&to=${day(1)}`).set(auth(owner)).expect(200)).body;
    expect(f.waterfall[0].label).toMatch(/Chiffre/);
    expect(f.forecast).toHaveLength(3);
    expect(f.supplierDebt.total).toBe(15_000);
    expect(f.margins.byStore).toHaveLength(1);
  });

  it('fournisseurs : comparaison de panier et indicateurs', async () => {
    const s = (await http().get('/analytics/suppliers').set(auth(owner)).expect(200)).body;
    expect(s.suppliers.find((x: { id: string }) => x.id === supA).payment).toBe('Comptant');
    expect(s.alerts.some((a: { text: string }) => /Grossiste A est actuellement 7 % moins cher que Grossiste B/.test(a.text))).toBe(true);
  });

  it('journal d\'audit : qui a vendu, change un prix, valide un achat', async () => {
    const a = (await http().get('/audit-logs?action=products.price_changed').set(auth(owner)).expect(200)).body;
    expect(a[0].userName).toBe('Titulaire');
    expect(a[0].metadata.before.salePrice).toBe(1500);
    const sales = (await http().get('/audit-logs?action=sales.created').set(auth(owner)).expect(200)).body;
    expect(sales.length).toBe(10);
    expect((await http().get('/audit-logs?action=purchases.goods_received').set(auth(owner)).expect(200)).body.length).toBe(2);
  });

  it('formation : contenus en brouillon jusqu\'a validation par le pharmacien, puis quiz', async () => {
    let t = (await http().get('/training/today').set(auth(cashier)).expect(200)).body;
    expect(t.quiz).toHaveLength(0);
    expect(t.pendingValidation).toBeGreaterThan(10);
    await http().get('/training/items').set(auth(cashier)).expect(403);
    const items = (await http().get('/training/items').set(auth(owner)).expect(200)).body;
    await http().post('/training/items/status').set(auth(owner)).send({ ids: items.map((i: { id: string }) => i.id), status: 'validated' }).expect(201);
    t = (await http().get('/training/today').set(auth(cashier)).expect(200)).body;
    expect(t.tip).not.toBeNull();
    expect(t.quiz.length).toBe(5);
    const q = items.find((i: { id: string }) => i.id === t.quiz[0].id);
    const ans = (await http().post('/training/answers').set(auth(cashier)).send({ itemId: q.id, answer: q.answerIndex }).expect(201)).body;
    expect(ans.correct).toBe(true);
    const p = (await http().get('/training/progress').set(auth(owner)).expect(200)).body;
    expect(p.team.find((x: { name: string }) => x.name === 'Auxiliaire').answered).toBe(1);
  });

  it('sauvegarde manuelle puis restauration (avec sauvegarde de securite)', async () => {
    const b = (await http().post('/backups').set(auth(owner)).expect(201)).body;
    expect(b.counts.product).toBe(2);
    await http().post('/backups').set(auth(cashier)).expect(403);
    await http().post('/products').set(auth(owner)).send({ sku: 'APRES', name: 'Créé après la sauvegarde', salePrice: 100 }).expect(201);
    await http().post(`/backups/${b.id}/restore`).set(auth(owner)).send({ confirm: 'mauvais' }).expect(400);
    const r = (await http().post(`/backups/${b.id}/restore`).set(auth(owner)).send({ confirm: slug }).expect(201)).body;
    expect(r.safetyBackupId).toBeTruthy();
    const products = (await http().get('/products?includeInactive=true').set(auth(owner)).expect(200)).body;
    expect(products.map((p: { sku: string }) => p.sku).sort()).toEqual(['AMOX500', 'LOSS']);
    const tb = (await http().get('/accounting/trial-balance').set(auth(owner)).expect(200)).body;
    expect(tb.totalDebit).toBe(tb.totalCredit);
    // toujours connecte : les comptes utilisateurs ne sont jamais ecrases par une restauration
    await http().get('/users/me').set(auth(owner)).expect(200);
    const list = (await http().get('/backups').set(auth(owner)).expect(200)).body;
    expect(list.records.some((x: { trigger: string }) => x.trigger === 'pre_restore')).toBe(true);
  });
});
