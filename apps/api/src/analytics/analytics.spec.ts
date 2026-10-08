import { forecast } from './forecast';
import { basketComparison, supplierStats } from './suppliers';

describe('prevision et reapprovisionnement', () => {
  const flat = (n: number, v: number) => Array.from({ length: n }, () => v);

  it('rupture annoncee : 12 en stock, 1,5 vendus par jour -> rupture dans 8 jours', () => {
    const f = forecast({ dailySales: flat(90, 1.5), stock: 12, leadTimeDays: 3 });
    expect(f.ruptureInDays).toBe(8);
    expect(f.status).toBe('a_commander');
    expect(f.orderQty).toBe(Math.ceil(1.5 * 10 - 12)); // ecart-type nul -> securite 0
  });

  it('critique quand la rupture arrive avant la livraison', () => {
    expect(forecast({ dailySales: flat(90, 2), stock: 5, leadTimeDays: 5 }).status).toBe('critique');
  });

  it('mois de stock et surstock', () => {
    const f = forecast({ dailySales: flat(90, 1), stock: 126, leadTimeDays: 3 });
    expect(f.monthsOfStock).toBe(4.2);
    expect(f.status).toBe('surstock');
  });

  it('saisonnalite : le pic de l\'an dernier a la meme epoque augmente la prevision', () => {
    // 365 jours : 1/jour, sauf les 30 jours equivalents l'an dernier a 3/jour
    const s = flat(365, 1);
    for (let i = 0; i < 30; i++) s[i] = 3;
    const f = forecast({ dailySales: s, stock: 10, leadTimeDays: 3 });
    expect(f.seasonalFactor).toBe(2); // 3 / 1,16 = 2,58, borne a 2
    expect(f.dailyDemand).toBeGreaterThan(1.5);
  });

  it('semaine de garde : la hausse attendue augmente la quantite a commander', () => {
    const normal = forecast({ dailySales: flat(90, 2), stock: 10, leadTimeDays: 2 });
    const garde = forecast({ dailySales: flat(90, 2), stock: 10, leadTimeDays: 2, boostPct: 50, boostDays: 7 });
    expect(garde.orderQty - normal.orderQty).toBe(7);
  });

  it('produit recent : l\'historique complete de zeros ne dilue pas la demande', () => {
    const s = [...flat(390, 0), ...flat(10, 2)];
    const f = forecast({ dailySales: s, historyDays: 10, stock: 10, leadTimeDays: 3 });
    expect(f.dailyDemand).toBe(2);
    expect(f.seasonalFactor).toBe(1);
    expect(f.ruptureInDays).toBe(5);
  });

  it('produit sans vente', () => {
    expect(forecast({ dailySales: flat(90, 0), stock: 30, leadTimeDays: 3 }).status).toBe('sans_vente');
  });
});

describe('analyse fournisseurs', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const d = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);
  const lines = [
    { supplierId: 'A', productId: 'p1', date: d(10), quantity: 100, unitCost: 930 },
    { supplierId: 'B', productId: 'p1', date: d(20), quantity: 50, unitCost: 1000 },
    { supplierId: 'A', productId: 'p2', date: d(15), quantity: 10, unitCost: 5000 },
    { supplierId: 'B', productId: 'p2', date: d(25), quantity: 10, unitCost: 5400 },
    { supplierId: 'A', productId: 'p1', date: d(120), quantity: 100, unitCost: 900 },
  ];

  it('A moins cher que B sur le panier habituel', () => {
    const c = basketComparison('A', 'B', lines, now)!;
    expect(c.commonProducts).toBe(2);
    // panier : p1 x250 (930 vs 1000), p2 x20 (5000 vs 5400)
    expect(c.diffPct).toBe(Math.round(((250 * 930 + 20 * 5000 - (250 * 1000 + 20 * 5400)) / (250 * 1000 + 20 * 5400)) * 1000) / 10);
    expect(c.diffPct).toBeLessThan(0);
  });

  it('delais, livraison complete, retard, evolution des prix', () => {
    const orders = [
      ...[5, 5, 5, 5, 5].map((lt, i) => ({ supplierId: 'X', createdAt: d(200 - i * 20), expectedAt: d(200 - i * 20 - 5), firstReceiptAt: d(200 - i * 20 - lt), orderedQty: 10, receivedQty: 10, missingProducts: 0 })),
      ...[11, 11, 11].map((lt, i) => ({ supplierId: 'X', createdAt: d(60 - i * 15), expectedAt: d(60 - i * 15 - 5), firstReceiptAt: d(60 - i * 15 - lt), orderedQty: 10, receivedQty: i === 0 ? 8 : 10, missingProducts: i === 0 ? 1 : 0 })),
    ];
    const s = supplierStats('X', [], orders, now);
    expect(s.previousLeadTimeDays).toBe(5);
    expect(s.recentLeadTimeDays).toBe(11);
    expect(s.completeRate).toBe(Math.round((7 / 8) * 100));
    expect(s.lateRate).toBe(Math.round((3 / 8) * 100));
    expect(s.missingProducts).toBe(1);
    expect(supplierStats('A', lines, [], now).priceEvolutionPct).toBe(3.3);
  });
});
