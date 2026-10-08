import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DEFAULT_ROLES, PermissionCode } from '@erp/database';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestAppWithoutQueue as createTestApp } from './setup-app';

/** P4 : profil legal facultatif, calendrier fiscal + alertes, paie comptabilisee, tiers payant, ordonnancier, creances, etats financiers, conseiller. */
describe('Pilotage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  let owner: string, cashier: string;
  let productId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const process = () => http().post('/accounting/outbox/process').set(auth(owner)).expect(201);

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app; prisma = t.moduleRef.get(PrismaService);
    const slug = `pilotage-${suffix}`;
    const tenant = await prisma.tenant.create({ data: { name: `Pilotage ${suffix}`, slug } });
    const perms = await prisma.permission.findMany();
    const hash = await bcrypt.hash('Pilotage123!', 4);
    const tokens: Record<string, string> = {};
    for (const role of ['owner', 'cashier']) {
      const codes = DEFAULT_ROLES[role] as PermissionCode[];
      const r = await prisma.forTenant(tenant.id, (tx) => tx.role.create({ data: { tenantId: tenant.id, name: role } }));
      await prisma.forTenant(tenant.id, (tx) => tx.rolePermission.createMany({ data: perms.filter((p) => codes.includes(p.code as PermissionCode)).map((p) => ({ roleId: r.id, permissionId: p.id })) }));
      const email = `${role}-${suffix}@pilotage.test`;
      const u = await prisma.user.create({ data: { email, fullName: role, passwordHash: hash } });
      await prisma.forTenant(tenant.id, (tx) => tx.membership.create({ data: { tenantId: tenant.id, userId: u.id, roleId: r.id } }));
      tokens[role] = (await http().post('/auth/login').send({ email, password: 'Pilotage123!', tenantSlug: slug }).expect(201)).body.accessToken;
    }
    owner = tokens.owner; cashier = tokens.cashier;
    productId = (await http().post('/products').set(auth(owner)).send({ sku: 'P1', name: 'Produit', salePrice: 2000, purchasePrice: 1200 }).expect(201)).body.id;
    await http().post('/goods-receipts').set(auth(owner)).send({ lines: [{ productId, quantity: 50, unitCost: 1200, lotNumber: 'L', expiryDate: '2028-12-31' }] }).expect(201);
  });
  afterAll(async () => { await app.close(); });

  it('profil legal : rien d\'obligatoire, completude affichee, document depose a tout moment', async () => {
    const p = await http().get('/company/profile').set(auth(cashier)).expect(200);
    expect(p.body.completeness.percent).toBeLessThan(100);
    expect(p.body.completeness.missingFields).toContain('NIU');
    await http().put('/company/profile').set(auth(cashier)).send({ niu: 'X' }).expect(403);
    const u = await http().put('/company/profile').set(auth(owner)).send({ niu: 'M2026000123', rccm: 'CG-BZV-01-2026-B12-00001', employeesCount: 2, zone: 'centre', annualRent: 1_200_000 }).expect(200);
    expect(u.body.profile.niu).toBe('M2026000123');
    const up = await http().post('/company/documents/niu').set(auth(owner)).attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'niu.pdf', contentType: 'application/pdf' }).expect(201);
    expect(up.body.documents.some((d: { key: string }) => d.key === 'niu')).toBe(true);
  });

  it('calendrier fiscal 2026 et alertes ; une echeance payee disparait des alertes', async () => {
    const cal = await http().get('/tax/calendar?year=2026').set(auth(owner)).expect(200);
    const codes = new Set(cal.body.items.map((i: { obligation: string }) => i.obligation));
    for (const c of ['TVA', 'ITS', 'TUS', 'CNSS', 'CAMU', 'IMF_IS', 'PATENTE', 'DSF', 'TAXE_IMMO']) expect(codes.has(c)).toBe(true);
    const alerts = await http().get('/tax/alerts').set(auth(owner)).expect(200);
    expect(alerts.body.length).toBeGreaterThan(0);
    const first = alerts.body[0];
    expect(['overdue', 'j7', 'j14', 'j30']).toContain(first.level);
    await http().post('/tax/filings').set(auth(cashier)).send({ obligation: first.obligation, period: first.period, dueDate: first.due, status: 'paid' }).expect(403);
    await http().post('/tax/filings').set(auth(owner)).send({ obligation: first.obligation, period: first.period, dueDate: first.due, status: 'paid', amount: 1000, reference: 'Q-1' }).expect(201);
    const after = await http().get('/tax/alerts').set(auth(owner)).expect(200);
    expect(after.body.some((a: { obligation: string; period: string }) => a.obligation === first.obligation && a.period === first.period)).toBe(false);
    const immo = after.body.find((a: { obligation: string }) => a.obligation === 'TAXE_IMMO');
    if (immo) expect(immo.estimate.amount).toBe(100_000);
  });

  it('paie : calcul, validation, ecriture comptable equilibree, montants repris par le calendrier', async () => {
    await http().post('/payroll/employees').set(auth(owner)).send({ fullName: 'Agnes Moukala', jobTitle: 'Preparatrice', baseSalary: 300_000, taxParts: 2 }).expect(201);
    await http().post('/payroll/employees').set(auth(owner)).send({ fullName: 'Paul Ngoma', jobTitle: 'Caissier', baseSalary: 200_000 }).expect(201);
    const run = await http().post('/payroll/runs').set(auth(owner)).send({ period: '2026-09' }).expect(201);
    expect(run.body.payslips).toHaveLength(2);
    expect(run.body.totals.cnssEmployee + run.body.totals.cnssEmployer).toBe(Math.round(300_000 * 0.2428) + Math.round(200_000 * 0.2428));
    await http().post(`/payroll/runs/${run.body.id}/validate`).set(auth(owner)).expect(201);
    await http().post('/payroll/runs').set(auth(owner)).send({ period: '2026-09' }).expect(409); // figee
    await process();
    const tb = (await http().get('/accounting/trial-balance').set(auth(owner)).expect(200)).body;
    expect(tb.rows.find((r: { account: string }) => r.account === '661').debit).toBe(500_000);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    const its = await http().get('/tax/estimate?obligation=ITS&period=2026-09').set(auth(owner)).expect(200);
    expect(its.body.amount).toBe(run.body.totals.its);
  });

  let saleId: string;
  it('tiers payant : part organisme + part patient, releve, reglement comptabilise', async () => {
    const ins = await http().post('/insurers').set(auth(owner)).send({ name: 'Mutuelle Test', coverageRate: 80 }).expect(201);
    const sale = await http().post('/sales').set(auth(cashier)).send({ items: [{ productId, quantity: 5 }], payments: [{ method: 'insurer', amount: 8000, insurerId: ins.body.id }, { method: 'cash', amount: 2000 }] }).expect(201);
    saleId = sale.body.id;
    expect(sale.body.status).toBe('completed');
    const st = await http().get(`/insurers/${ins.body.id}/statement`).set(auth(owner)).expect(200);
    expect(st.body.insurer.balance).toBe(8000);
    await http().post(`/insurers/${ins.body.id}/settlements`).set(auth(owner)).send({ amount: 9000 }).expect(400);
    await http().post(`/insurers/${ins.body.id}/settlements`).set(auth(owner)).send({ amount: 8000, method: 'card', reference: 'VIR-1' }).expect(201);
    await process();
    const tb = (await http().get('/accounting/trial-balance').set(auth(owner)).expect(200)).body;
    expect(tb.rows.find((r: { account: string }) => r.account === '521').balance).toBe(8000);
  });

  it('ordonnancier relie a la vente', async () => {
    const p = await http().post('/prescriptions').set(auth(cashier)).send({ saleId, patientName: 'Mme Kaya', prescriber: 'Dr Bouanga', facility: 'CHU Brazzaville', prescribedAt: '2026-10-01' }).expect(201);
    expect(p.body.number).toMatch(/^ORD-/);
    const list = await http().get('/prescriptions?q=kaya').set(auth(owner)).expect(200);
    expect(list.body[0].sale.items[0].lot.lotNumber).toBe('L');
  });

  it('creances clients : balance agee', async () => {
    const c = await http().post('/customers').set(auth(owner)).send({ name: 'Client Credit', creditLimit: 50_000 }).expect(201);
    await http().post('/sales').set(auth(cashier)).send({ customerId: c.body.id, items: [{ productId, quantity: 2 }], payments: [{ method: 'credit', amount: 4000 }] }).expect(201);
    const rec = await http().get('/receivables').set(auth(owner)).expect(200);
    const row = rec.body.find((r: { customerId: string }) => r.customerId === c.body.id);
    expect(row.balance).toBe(4000);
    expect(row.buckets.current).toBe(4000);
    expect(row.overdue).toBe(0);
  });

  it('etats financiers equilibres et conseiller', async () => {
    await process();
    const s = await http().get('/accounting/statements?year=2026').set(auth(owner)).expect(200);
    expect(s.body.balance.equilibre).toBe(true);
    expect(s.body.income.ventesMarchandises).toBeGreaterThan(0);
    expect(s.body.system).toMatch(/SMT possible/);
    const adv = await http().get('/advisor/insights').set(auth(owner)).expect(200);
    expect(adv.body.disclaimer).toMatch(/expert-comptable/);
    expect(Array.isArray(adv.body.insights)).toBe(true);
    expect(adv.body.insights.some((i: { id: string }) => i.id === 'smt')).toBe(true);
    await http().get('/advisor/insights').set(auth(cashier)).expect(403);
  });
});
