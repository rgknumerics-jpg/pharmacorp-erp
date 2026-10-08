import { balanceSheet, incomeStatement } from './statements';

// Balance d'une officine : apport 1 000 000, achats stockes 600 000 a credit, ventes 500 000 TTC (TVA 0), cout 300 000,
// encaissement 450 000, salaires 100 000 payes, TUS 7 500.
const rows = [
  { account: '101', name: 'Capital', debit: 0, credit: 1_000_000 },
  { account: '311', name: 'Marchandises', debit: 600_000, credit: 300_000 },
  { account: '401', name: 'Fournisseurs', debit: 0, credit: 600_000 },
  { account: '411', name: 'Clients', debit: 500_000, credit: 450_000 },
  { account: '571', name: 'Caisse', debit: 1_000_000 + 450_000, credit: 107_500 },
  { account: '6031', name: 'Variation stocks', debit: 300_000, credit: 0 },
  { account: '641', name: 'Impots et taxes', debit: 7_500, credit: 0 },
  { account: '661', name: 'Salaires', debit: 100_000, credit: 0 },
  { account: '701', name: 'Ventes', debit: 0, credit: 500_000 },
];

describe('etats financiers SYSCOHADA', () => {
  it('compte de resultat en cascade', () => {
    const r = incomeStatement(rows);
    expect(r.margeCommerciale).toBe(200_000);
    expect(r.tauxMarge).toBe(40);
    expect(r.valeurAjoutee).toBe(200_000);
    expect(r.ebe).toBe(200_000 - 7_500 - 100_000);
    expect(r.resultatNet).toBe(92_500);
  });

  it('bilan equilibre, resultat inclus dans les capitaux propres', () => {
    const b = balanceSheet(rows);
    expect(b.passif.dontResultat).toBe(92_500);
    expect(b.actif.stocks).toBe(300_000);
    expect(b.actif.creances).toBe(50_000);
    expect(b.actif.tresorerieActif).toBe(1_342_500);
    expect(b.totalActif).toBe(b.totalPassif);
    expect(b.equilibre).toBe(true);
  });
});
