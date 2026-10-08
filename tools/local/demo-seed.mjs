/**
 * Donnees de demonstration realistes (officine fictive) creees PAR L'API, pour que les regles metier s'appliquent
 * (FEFO, comptabilite, factures fournisseurs...). Les ventes sont ensuite redatees sur 75 jours pour alimenter
 * prevision, cockpit et risques. Aucune donnee reelle.
 */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { PrismaClient } = createRequire(join(root, 'package.json'))('@prisma/client');
const B = process.env.API_URL ?? 'http://localhost:3000';
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let T = '';
const call = async (p, method = 'GET', body) => {
  const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${T}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const login = async (email, password) => { const r = await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, tenantSlug: 'pharmacie-pilote' }) }); return (await r.json()).accessToken; };
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

T = await login('admin@example.com', 'ChangeMe123!');

// --- equipe ---
const roles = await call('/roles');
const roleId = (n) => roles.find((r) => r.name === n)?.id;
for (const [email, fullName, role] of [['pharmacien@pharmacorp.demo', 'Dr Grâce Mabiala', 'pharmacist'], ['caissier@pharmacorp.demo', 'Junior Ngoma', 'cashier'], ['comptable@pharmacorp.demo', 'Estelle Okemba', 'accountant']]) {
  try { await call('/users', 'POST', { email, fullName, password: 'Demo2026!', roleId: roleId(role) }); } catch { /* deja cree */ }
}

// --- structure ---
await call('/company/profile', 'PUT', { legalName: 'Pharmacie Pilote SARL', city: 'Brazzaville', employeesCount: 4, annualRent: 3_600_000, zone: 'centre' });

// --- catalogue ---
const cats = {};
for (const c of ['Antalgiques', 'Antibiotiques', 'Antipaludéens', 'Vitamines', 'Hygiène', 'Bébé']) cats[c] = (await call('/categories', 'POST', { name: c }).catch(() => null))?.id;
const P = [
  ['PARA500', 'Paracétamol 500 mg B/20', 'paracetamol', 'Antalgiques', 'Denk', 500, 300, 0, 12], ['DOLI1G', 'Doliprane 1 g B/8', 'paracetamol', 'Antalgiques', 'Sanofi', 1500, 1000, 0, 6],
  ['IBU400', 'Ibuprofène 400 mg B/20', 'ibuprofene', 'Antalgiques', 'Biogaran', 1200, 750, 0, 4], ['AMOX500', 'Amoxicilline 500 mg gél. B/12', 'amoxicilline', 'Antibiotiques', 'Sandoz', 2000, 1300, 0, 5],
  ['AUGM1G', 'Amoxicilline/Ac. clav. 1 g B/8', 'amoxicilline acide clavulanique', 'Antibiotiques', 'GSK', 6500, 4800, 0, 2], ['COARTEM', 'Artéméther/Luméfantrine 20/120 B/24', 'artemether lumefantrine', 'Antipaludéens', 'Novartis', 3500, 2400, 0, 6],
  ['QUIN300', 'Quinine 300 mg B/20', 'quinine', 'Antipaludéens', 'Medis', 2500, 1700, 0, 2], ['VITC500', 'Vitamine C 500 mg B/30', 'acide ascorbique', 'Vitamines', 'Upsa', 3000, 2000, 18, 2],
  ['ZINC', 'Zinc 20 mg B/10', 'zinc', 'Vitamines', 'Medis', 1500, 1600, 18, 1], ['SAVON', 'Savon antiseptique 100 g', null, 'Hygiène', 'Dettol', 900, 600, 18, 3],
  ['GEL', 'Gel hydroalcoolique 100 ml', null, 'Hygiène', 'Local', 1000, 650, 18, 2], ['COUCHE', 'Couches bébé T3 x30', null, 'Bébé', 'Pampers', 6500, 5200, 18, 1],
  ['LAIT1', 'Lait 1er âge 400 g', null, 'Bébé', 'Nestlé', 5500, 4500, 18, 1], ['SRO', 'Sels de réhydratation orale x10', null, 'Antalgiques', 'Unicef', 1000, 600, 0, 3],
];
const ids = {};
for (const [sku, name, dci, cat, lab, sale, cost, vat] of P) {
  const r = await call('/products', 'POST', { sku, name, dci: dci ?? undefined, laboratory: lab, categoryId: cats[cat] ?? undefined, salePrice: sale, purchasePrice: cost, vatRate: vat, minStock: 5, barcode: `6001${String(Math.abs(sku.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 1e8).padStart(8, '0')}` }).catch(() => null);
  if (r) ids[sku] = r.id;
}
await call('/products', 'POST', { sku: 'CREME', name: 'Crème hydratante (prix libre)', priceFree: true, trackLots: false, salePrice: 0, purchasePrice: 2000, oversellTolerance: 5 }).catch(() => null);

// --- fournisseurs, commandes, receptions ---
const supA = await call('/suppliers', 'POST', { name: 'LABOREX CONGO', phone: '06 400 11 22', paymentTermDays: 30, leadTimeDays: 3 });
const supB = await call('/suppliers', 'POST', { name: 'COPHARCO', phone: '05 500 22 33', paymentTermDays: 0, leadTimeDays: 2 });
const po = await call('/purchase-orders', 'POST', { supplierId: supA.id, send: true, expectedAt: day(-55), items: P.map(([sku]) => ({ productId: ids[sku], quantity: 60 })) });
await call('/goods-receipts', 'POST', { purchaseOrderId: po.id, supplierId: supA.id, supplierRef: 'BL-LAB-2026-0811', updateCosts: true,
  lines: P.map(([sku, , , , , , cost], i) => ({ productId: ids[sku], quantity: sku === 'QUIN300' ? 40 : 60, unitCost: cost, lotNumber: `L${sku.slice(0, 3)}${i}A`, expiryDate: i === 6 ? day(20) : i === 9 ? day(40) : i === 2 ? day(70) : day(200 + i * 30) })) });
await call('/goods-receipts', 'POST', { supplierId: supB.id, supplierRef: 'FAC-COP-778', lines: P.slice(0, 8).map(([sku, , , , , , cost], i) => ({ productId: ids[sku], quantity: 30, unitCost: Math.round(cost * 0.95), lotNumber: `C${sku.slice(0, 3)}${i}B`, expiryDate: day(300 + i * 20) })) });

// --- clients, tiers payant ---
const clients = [];
for (const [name, phone, limit] of [['Mme Clarisse Ngoma', '06 555 44 33', 50000], ['M. Arsène Mavoungou', '05 333 21 10', 30000], ['Mme Pélagie Ibara', '06 777 88 99', 0], ['M. Rufin Okandza', '06 101 20 30', 20000]]) clients.push(await call('/customers', 'POST', { name, phone, creditLimit: limit }));
const ins = await call('/insurers', 'POST', { name: 'ASCOMA Congo', coverageRate: 80, paymentTermDays: 60 });

// --- ventes (comme une vraie journee de caisse), puis redatees ---
T = await login('caissier@pharmacorp.demo', 'Demo2026!').catch(() => T) || T;
const weights = { PARA500: 5, DOLI1G: 3, IBU400: 2, AMOX500: 3, AUGM1G: 1, COARTEM: 3, QUIN300: 1, VITC500: 2, ZINC: 1, SAVON: 2, GEL: 2, COUCHE: 1, LAIT1: 1, SRO: 2 };
const bag = Object.entries(weights).flatMap(([k, w]) => Array(w).fill(k));
const saleIds = [];
for (let i = 0; i < 160; i++) {
  const n = rnd(1, 3), items = {};
  for (let k = 0; k < n; k++) { const s = bag[rnd(0, bag.length - 1)]; items[s] = (items[s] ?? 0) + 1; }
  const lines = Object.entries(items).map(([s, q]) => ({ productId: ids[s], quantity: q }));
  const total = lines.reduce((t, l) => t + l.quantity * P.find((p) => ids[p[0]] === l.productId)[5], 0);
  const r = rnd(1, 20);
  const payments = r <= 13 ? [{ method: 'cash', amount: total }] : r <= 17 ? [{ method: 'mtn_momo', amount: total, reference: `MP${100000 + i}` }] : r <= 18 ? [{ method: 'airtel_money', amount: total, reference: `AM${100000 + i}` }] : r === 19 ? [{ method: 'insurer', amount: Math.round(total * 0.8), insurerId: ins.id }, { method: 'cash', amount: total - Math.round(total * 0.8) }] : [{ method: 'credit', amount: total }];
  const customerId = r === 20 ? clients[rnd(0, 1)].id : r === 19 ? clients[3].id : undefined;
  try {
    const s = await call('/sales', 'POST', { items: lines, payments, customerId });
    for (const p of s.payments.filter((x) => x.status === 'pending_confirmation')) await call(`/payments/${p.id}/confirm`, 'POST', {});
    saleIds.push(s.id);
  } catch { /* stock ou plafond atteint : on continue */ }
}

T = await login('admin@example.com', 'ChangeMe123!');
const db = new PrismaClient({ datasources: { db: { url: process.env.OWNER_URL } } });
for (let i = 0; i < saleIds.length; i++) {
  const ago = Math.floor((saleIds.length - i) * (75 / saleIds.length));
  const when = new Date(Date.now() - ago * 86_400_000); when.setHours(rnd(8, 20), rnd(0, 59));
  await db.$executeRaw`UPDATE sales SET created_at = ${when} WHERE id = ${saleIds[i]}::uuid`;
  await db.$executeRaw`UPDATE inventory_movements SET created_at = ${when} WHERE ref_id = ${saleIds[i]}`;
  await db.$executeRaw`UPDATE payments SET created_at = ${when}, confirmed_at = ${when} WHERE sale_id = ${saleIds[i]}::uuid`;
  await db.$executeRaw`UPDATE outbox_events SET payload = jsonb_set(payload, '{date}', to_jsonb(${when.toISOString()}::text)) WHERE payload->>'saleId' = ${saleIds[i]} AND status = 'pending'`;
}
// un lot de quinine devenu perime depuis la reception (pour illustrer les alertes)
await db.$executeRaw`UPDATE lots SET expiry_date = ${new Date(Date.now() - 5 * 86_400_000)} WHERE lot_number LIKE 'LQUI%'`;
await db.$disconnect();

// --- paie, garde, divers ---
for (const [fullName, jobTitle, baseSalary, taxParts] of [['Dr Grâce Mabiala', 'Pharmacienne adjointe', 650000, 2], ['Junior Ngoma', 'Caissier', 180000, 1], ['Chancelle Bitsindou', 'Préparatrice', 220000, 2.5], ['Roch Mouanda', 'Magasinier', 150000, 1]]) await call('/payroll/employees', 'POST', { fullName, jobTitle, baseSalary, taxParts });
const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
const run = await call('/payroll/runs', 'POST', { period: prev.toISOString().slice(0, 7) });
await call(`/payroll/runs/${run.id}/validate`, 'POST', {});
await call('/garde-periods', 'POST', { startDate: day(3), endDate: day(9), upliftPct: 60, note: 'Garde de quartier (démonstration)' });
const items = await call('/training/items');
await call('/training/items/status', 'POST', { ids: items.map((i) => i.id), status: 'validated' });
await call('/accounting/outbox/process', 'POST', {});
await call('/sfec/process', 'POST', {});
console.log(`Donnees de demonstration creees : ${Object.keys(ids).length} produits, ${saleIds.length} ventes.`);
