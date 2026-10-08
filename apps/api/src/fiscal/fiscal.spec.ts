import { buildFiscalDocument, vatIncluded } from './fiscal';

describe('moteur fiscal', () => {
  it('TVA incluse dans un prix TTC', () => {
    expect(vatIncluded(11800, 18)).toBe(1800);
    expect(vatIncluded(1000, 0)).toBe(0);
  });

  it('totaux par taux, HT + TVA = TTC', () => {
    const d = buildFiscalDocument({
      kind: 'invoice', number: 'V-1', issuedAt: new Date('2026-10-07T10:00:00Z'), seller: { tenantId: 't', name: 'Pharmacie', country: 'CG' },
      lines: [
        { name: 'A', quantity: 2, unitPrice: 5900, vatRate: 18, lineTotal: 11800 },
        { name: 'B', quantity: 1, unitPrice: 1000, vatRate: 0, lineTotal: 1000 },
      ],
    });
    expect(d.totalsByRate).toEqual([{ rate: 0, ht: 1000, vat: 0, ttc: 1000 }, { rate: 18, ht: 10000, vat: 1800, ttc: 11800 }]);
    expect(d.total).toEqual({ ht: 11000, vat: 1800, ttc: 12800 });
  });

  it("un avoir porte des montants negatifs et la reference de la facture d'origine", () => {
    const d = buildFiscalDocument({ kind: 'credit_note', number: 'V-1-AV', issuedAt: new Date(), seller: { tenantId: 't', name: 'P', country: 'CG' }, lines: [{ name: 'A', quantity: 1, unitPrice: 1180, vatRate: 18, lineTotal: 1180 }], originalNumber: 'V-1' });
    expect(d.total).toEqual({ ht: -1000, vat: -180, ttc: -1180 });
    expect(d.originalNumber).toBe('V-1');
  });
});