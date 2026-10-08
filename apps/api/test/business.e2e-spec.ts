import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DEFAULT_ROLES, PermissionCode } from '@erp/database';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestAppWithoutQueue as createTestApp } from './setup-app';

/**
 * Parcours metier complet sur PostgreSQL reel (RLS active, role applicatif non-superuser) :
 * catalogue -> reception avec lots -> vente FEFO -> paiements (Mobile Money asynchrone, credit) -> annulation -> OCR.
 */
describe('Parcours metier ERP (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now();
  const password = 'BusinessTest123!';
  const http = () => request(app.getHttpServer());

  let tenantId: string;
  let tenantSlug: string;
  let owner: string; // jeton proprietaire
  let pharmacist2: string; // second professionnel (validation des lots / OCR)
  let cashier: string;
  let otherTenantOwner: string;

  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  async function makeTenant(name: string, users: { key: string; role: string; email: string }[]) {
    const slug = `${name}-${suffix}`;
    const tenant = await prisma.tenant.create({ data: { name: `${name} ${suffix}`, slug, country: 'CG' } });
    const perms = await prisma.permission.findMany();
    const hash = await bcrypt.hash(password, 4);
    const tokens: Record<string, string> = {};
    for (const u of users) {
      const codes = DEFAULT_ROLES[u.role] as PermissionCode[];
      const role = await prisma.forTenant(tenant.id, (tx) => tx.role.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: u.role } }, update: {}, create: { tenantId: tenant.id, name: u.role },
      }));
      await prisma.forTenant(tenant.id, (tx) => tx.rolePermission.createMany({
        data: perms.filter((p) => codes.includes(p.code as PermissionCode)).map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      }));
      const user = await prisma.user.create({ data: { email: u.email, fullName: u.key, passwordHash: hash } });
      await prisma.forTenant(tenant.id, (tx) => tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, roleId: role.id } }));
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password, tenantSlug: slug }).expect(201);
      tokens[u.key] = login.body.accessToken;
    }
    return { tenant, slug, tokens };
  }

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    prisma = t.moduleRef.get(PrismaService);
    const a = await makeTenant('pharma-a', [
      { key: 'owner', role: 'owner', email: `owner-${suffix}@a.test` },
      { key: 'pharmacist2', role: 'pharmacist', email: `ph2-${suffix}@a.test` },
      { key: 'cashier', role: 'cashier', email: `cashier-${suffix}@a.test` },
    ]);
    tenantId = a.tenant.id; tenantSlug = a.slug;
    owner = a.tokens.owner; pharmacist2 = a.tokens.pharmacist2; cashier = a.tokens.cashier;
    const b = await makeTenant('pharma-b', [{ key: 'owner', role: 'owner', email: `owner-${suffix}@b.test` }]);
    otherTenantOwner = b.tokens.owner;
  });

  afterAll(async () => { await app.close(); });

  let doliId: string;
  let sirupId: string;
  let supplierId: string;

  it('cree un catalogue ; le cout d\'achat reste invisible pour un role sans cost.read', async () => {
    const doli = await http().post('/products').set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'DOLI500', name: 'Doliprane 500 mg B/16', dci: 'paracetamol', salePrice: 1000, purchasePrice: 700, minStock: 5, vatRate: 0 }).expect(201);
    doliId = doli.body.id;
    expect(doli.body.purchasePrice).toBe(700); // owner a cost.read

    const sirup = await http().post('/products').set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SIROP1', name: 'Sirop toux enfant', salePrice: 0, priceFree: true, trackLots: false, oversellTolerance: 2 }).expect(201);
    sirupId = sirup.body.id;

    const asCashier = await http().get(`/products/${doliId}`).set('Authorization', `Bearer ${cashier}`).expect(200);
    expect(asCashier.body.name).toContain('Doliprane');
    expect(asCashier.body).not.toHaveProperty('purchasePrice');

    await http().post('/products').set('Authorization', `Bearer ${cashier}`).send({ sku: 'X', name: 'Interdit' }).expect(403);
    await http().post('/products').set('Authorization', `Bearer ${owner}`).send({ sku: 'DOLI500', name: 'Doublon' }).expect(409);
  });

  it('receptionne deux lots ; les dates perimees sont refusees', async () => {
    supplierId = (await http().post('/suppliers').set('Authorization', `Bearer ${owner}`).send({ name: 'LABOREX', phone: '06 123 45 67' }).expect(201)).body.id;
    const s = await http().get('/suppliers').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(s.body[0].phone).toBe('242061234567');

    await http().post('/goods-receipts').set('Authorization', `Bearer ${owner}`).send({
      supplierId, lines: [{ productId: doliId, quantity: 5, lotNumber: 'OLD', expiryDate: day(-10) }],
    }).expect(400);

    await http().post('/goods-receipts').set('Authorization', `Bearer ${owner}`).send({
      supplierId, supplierRef: 'BL-1', updateCosts: true, lines: [
        { productId: doliId, quantity: 10, unitCost: 720, lotNumber: 'LOT-LATE', expiryDate: day(400) },
        { productId: doliId, quantity: 6, unitCost: 720, lotNumber: 'LOT-SOON', expiryDate: day(60) },
      ],
    }).expect(201);

    const lv = await http().get('/stock/levels').set('Authorization', `Bearer ${owner}`).expect(200);
    const row = lv.body.find((r: { sku: string }) => r.sku === 'DOLI500');
    expect(row).toMatchObject({ onHand: 16, sellable: 16, belowMin: false });
    const p = await http().get(`/products/${doliId}`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(p.body.purchasePrice).toBe(720); // mis a jour par la reception
  });

  it('vend en FEFO : le lot qui expire le premier part en premier ; un rejeu est idempotent', async () => {
    const key = `sale-${suffix}-1`;
    const sale = await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({
      idempotencyKey: key, items: [{ productId: doliId, quantity: 8 }], payments: [{ method: 'cash', amount: 8000 }],
    }).expect(201);
    expect(sale.body.status).toBe('completed');
    expect(sale.body.total).toBe(8000);
    // 6 du lot SOON puis 2 du lot LATE
    const byLot = Object.fromEntries(sale.body.items.map((i: { lot: { lotNumber: string }; quantity: number }) => [i.lot.lotNumber, i.quantity]));
    expect(byLot).toEqual({ 'LOT-SOON': 6, 'LOT-LATE': 2 });

    const replay = await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({
      idempotencyKey: key, items: [{ productId: doliId, quantity: 8 }], payments: [{ method: 'cash', amount: 8000 }],
    }).expect(201);
    expect(replay.body.id).toBe(sale.body.id);
    expect(replay.body.replayed).toBe(true);

    const lv = await http().get('/stock/levels').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(lv.body.find((r: { sku: string }) => r.sku === 'DOLI500').onHand).toBe(8); // une seule fois decremente
  });

  it('refuse une vente sans stock suffisant et un prix modifie hors prix libre', async () => {
    await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({ items: [{ productId: doliId, quantity: 9 }] }).expect(409);
    await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({ items: [{ productId: doliId, quantity: 1, unitPrice: 1 }] }).expect(400);
    await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({ items: [{ productId: doliId, quantity: 1, discount: 100 }] }).expect(403); // pas de sales.discount
  });

  it('prix libre + survente toleree signalee', async () => {
    await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({ items: [{ productId: sirupId, quantity: 1 }] }).expect(400); // prix requis
    const s = await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({
      items: [{ productId: sirupId, quantity: 2, unitPrice: 1500 }], payments: [{ method: 'cash', amount: 3000 }],
    }).expect(201);
    expect(s.body.warnings.join(' ')).toMatch(/Survente/); // aucun stock, tolerance 2
    expect(s.body.total).toBe(3000);
  });

  it('Mobile Money : la vente reste en attente jusqu\'a confirmation', async () => {
    const sale = await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({
      items: [{ productId: doliId, quantity: 1 }], payments: [{ method: 'mtn_momo', amount: 1000, reference: 'MP123' }],
    }).expect(201);
    expect(sale.body.status).toBe('awaiting_payment');
    expect(sale.body.payments[0].status).toBe('pending_confirmation');

    const confirmed = await http().post(`/payments/${sale.body.payments[0].id}/confirm`).set('Authorization', `Bearer ${cashier}`).send({}).expect(201);
    expect(confirmed.body.status).toBe('completed');
    expect(confirmed.body.paidAmount).toBe(1000);

    // paiement mixte dont une partie echoue : la vente reste corrigeable
    const mixed = await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({
      items: [{ productId: doliId, quantity: 2 }], payments: [{ method: 'cash', amount: 1000 }, { method: 'airtel_money', amount: 1000 }],
    }).expect(201);
    expect(mixed.body.status).toBe('awaiting_payment');
    const momo = mixed.body.payments.find((p: { method: string }) => p.method === 'airtel_money');
    await http().post(`/payments/${momo.id}/fail`).set('Authorization', `Bearer ${cashier}`).expect(201);
    const fixed = await http().post(`/sales/${mixed.body.id}/payments`).set('Authorization', `Bearer ${cashier}`).send({ payments: [{ method: 'cash', amount: 1000 }] }).expect(201);
    expect(fixed.body.status).toBe('completed');
    // trop paye : refuse
    await http().post(`/sales/${mixed.body.id}/payments`).set('Authorization', `Bearer ${cashier}`).send({ payments: [{ method: 'cash', amount: 1 }] }).expect(400);
  });

  it('credit client : plafond respecte, extourne a l\'annulation, annulation reservee a sales.void', async () => {
    const c = await http().post('/customers').set('Authorization', `Bearer ${owner}`).send({ name: 'Mme Ngoma', phone: '06 555 44 33', creditLimit: 2000 }).expect(201);
    const sale = await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({
      customerId: c.body.id, items: [{ productId: doliId, quantity: 2 }], payments: [{ method: 'credit', amount: 2000 }],
    }).expect(201);
    expect(sale.body.status).toBe('completed');
    expect((await http().get(`/customers/${c.body.id}`).set('Authorization', `Bearer ${owner}`)).body.creditBalance).toBe(2000);

    // plafond atteint
    await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({
      customerId: c.body.id, items: [{ productId: doliId, quantity: 1 }], payments: [{ method: 'credit', amount: 1000 }],
    }).expect(409);

    await http().post(`/sales/${sale.body.id}/void`).set('Authorization', `Bearer ${cashier}`).send({ reason: 'Erreur de caisse' }).expect(403);
    const before = (await http().get('/stock/levels').set('Authorization', `Bearer ${owner}`)).body.find((r: { sku: string }) => r.sku === 'DOLI500').onHand;
    const voided = await http().post(`/sales/${sale.body.id}/void`).set('Authorization', `Bearer ${owner}`).send({ reason: 'Erreur de caisse' }).expect(201);
    expect(voided.body.status).toBe('void');
    const after = (await http().get('/stock/levels').set('Authorization', `Bearer ${owner}`)).body.find((r: { sku: string }) => r.sku === 'DOLI500').onHand;
    expect(after).toBe(before + 2);
    expect((await http().get(`/customers/${c.body.id}`).set('Authorization', `Bearer ${owner}`)).body.creditBalance).toBe(0);
    await http().post(`/sales/${sale.body.id}/void`).set('Authorization', `Bearer ${owner}`).send({ reason: 'Encore' }).expect(409);
  });

  const BL = `LABOREX CONGO
BON DE LIVRAISON NÂ° BL-2026-0456
Date : 05/10/2026
DÃ©signation            QtÃ©   Lot       PÃ©remption   PU      Total
DOLIPRANE 500 MG B/16   20   LOT A123  10/2028     850    17 000
Cachet et signature`;

  it('OCR : un bon de livraison peu fiable exige un 2e valideur, puis entre en stock', async () => {
    const doc = await http().post('/ocr/documents').set('Authorization', `Bearer ${pharmacist2}`).send({ kind: 'delivery_note', rawText: BL }).expect(201);
    const line = doc.body.parsed.lines[0];
    expect(line).toMatchObject({ quantity: 20, lotNumber: 'A123', unitCost: 850, productId: doliId });
    expect(line.expiryDate).toBe('2028-10-31');

    // le texte vient du navigateur (confiance moteur 1) : on force un document peu fiable en abaissant la confiance en base
    await prisma.forTenant(tenantId, (tx) => tx.ocrDocument.update({ where: { id: doc.body.id }, data: { confidence: 0.5 } }));
    const lines = [{ productId: doliId, quantity: 20, unitCost: 850, lotNumber: 'A123', expiryDate: '2028-10-31' }];

    // la personne qui a numerise ne peut pas valider un document peu fiable
    await http().post(`/ocr/documents/${doc.body.id}/validate`).set('Authorization', `Bearer ${pharmacist2}`).send({ supplierId, lines }).expect(403);
    // un cashier n'a pas ocr.validate
    await http().post(`/ocr/documents/${doc.body.id}/validate`).set('Authorization', `Bearer ${cashier}`).send({ supplierId, lines }).expect(403);
    // le proprietaire (autre personne) valide : reception creee
    const ok = await http().post(`/ocr/documents/${doc.body.id}/validate`).set('Authorization', `Bearer ${owner}`).send({ supplierId, supplierRef: 'BL-2026-0456', lines }).expect(201);
    expect(ok.body.status).toBe('validated');
    expect(ok.body.receiptId).toBeTruthy();
    const lots = await http().get(`/stock/products/${doliId}/lots`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(lots.body.find((l: { lotNumber: string }) => l.lotNumber === 'A123')).toMatchObject({ quantity: 20, status: 'available' });
    await http().post(`/ocr/documents/${doc.body.id}/validate`).set('Authorization', `Bearer ${owner}`).send({ supplierId, lines }).expect(409); // deja traite
  });

  it('lot a faible confiance bloque a la vente jusqu\'a validation par un autre professionnel', async () => {
    await http().post('/goods-receipts').set('Authorization', `Bearer ${pharmacist2}`).send({
      supplierId, lines: [{ productId: doliId, quantity: 4, lotNumber: 'LOT-DOUTE', expiryDate: day(20), lowConfidence: true }],
    }).expect(201);
    const lots = await http().get(`/stock/products/${doliId}/lots`).set('Authorization', `Bearer ${owner}`).expect(200);
    const lot = lots.body.find((l: { lotNumber: string }) => l.lotNumber === 'LOT-DOUTE');
    expect(lot.status).toBe('pending_review');
    // meme s'il expire le premier, le lot douteux n'est pas propose a la vente
    const sale = await http().post('/sales').set('Authorization', `Bearer ${cashier}`).send({ items: [{ productId: doliId, quantity: 1 }], payments: [{ method: 'cash', amount: 1000 }] }).expect(201);
    expect(sale.body.items.every((i: { lot: { lotNumber: string } }) => i.lot.lotNumber !== 'LOT-DOUTE')).toBe(true);

    await http().post(`/stock/lots/${lot.id}/review`).set('Authorization', `Bearer ${pharmacist2}`).send({ action: 'validate' }).expect(403); // celui qui l'a saisi
    await http().post(`/stock/lots/${lot.id}/review`).set('Authorization', `Bearer ${owner}`).send({ action: 'validate' }).expect(201);
    const after = await http().get(`/stock/products/${doliId}/lots`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(after.body.find((l: { lotNumber: string }) => l.lotNumber === 'LOT-DOUTE').status).toBe('available');
  });

  it('alertes de peremption et tableau de bord', async () => {
    const exp = await http().get('/stock/expiring?days=90').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(exp.body.some((l: { lotNumber: string }) => l.lotNumber === 'LOT-DOUTE')).toBe(true);
    const dash = await http().get('/reports/dashboard').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(dash.body.today.count).toBeGreaterThan(0);
    expect(dash.body.today.margin).not.toBeNull();
    expect(dash.body.stockAlerts.expiringWithin90Days).toBeGreaterThan(0);
    const dashCashier = await http().get('/reports/dashboard').set('Authorization', `Bearer ${cashier}`);
    expect(dashCashier.status).toBe(403);
  });

  it('isolation : un autre tenant ne voit ni produits, ni ventes, ni stock', async () => {
    const products = await http().get('/products').set('Authorization', `Bearer ${otherTenantOwner}`).expect(200);
    expect(products.body).toHaveLength(0);
    await http().get(`/products/${doliId}`).set('Authorization', `Bearer ${otherTenantOwner}`).expect(404);
    const sales = await http().get('/sales').set('Authorization', `Bearer ${otherTenantOwner}`).expect(200);
    expect(sales.body).toHaveLength(0);
    // un produit d'un autre tenant ne peut pas etre vendu
    await http().post('/sales').set('Authorization', `Bearer ${otherTenantOwner}`).send({ items: [{ productId: doliId, quantity: 1 }] }).expect(400);
  });

  it('ajustement de stock : motif obligatoire, journalise', async () => {
    const lots = await http().get(`/stock/products/${doliId}/lots`).set('Authorization', `Bearer ${owner}`).expect(200);
    const lot = lots.body.find((l: { lotNumber: string }) => l.lotNumber === 'LOT-LATE');
    await http().post('/stock/adjustments').set('Authorization', `Bearer ${owner}`).send({ productId: doliId, lotId: lot.id, quantity: -1, type: 'loss', reason: '' }).expect(400);
    await http().post('/stock/adjustments').set('Authorization', `Bearer ${owner}`).send({ productId: doliId, lotId: lot.id, quantity: -1, type: 'loss', reason: 'Boite abimee' }).expect(201);
    await http().post('/stock/adjustments').set('Authorization', `Bearer ${owner}`).send({ productId: doliId, quantity: -1, type: 'loss', reason: 'Sans lot' }).expect(400);
    const audit = await http().get('/audit-logs').set('Authorization', `Bearer ${owner}`);
    void audit;
    const logs = await prisma.forTenant(tenantId, (tx) => tx.auditLog.findMany({ where: { action: 'stock.adjusted' } }));
    expect(logs.length).toBeGreaterThan(0);
    void tenantSlug;
  });
});

