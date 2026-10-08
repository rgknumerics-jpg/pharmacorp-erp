import { parseDocument } from './parsers';

describe('BL des grossistes du Congo (photos reelles)', () => {
  it('UBIPHARM : lot et peremption sous chaque ligne, code + EAN', () => {
    const t = `UbiPharm Congo FACTURE N PNR/638217
LIGNE CODE DESIGNATION DES PRODUITS TB PRIX PUBLIC TVA ASDI QUANTITE CDEE QUANTITE LIVREE PRIX UNITAIRE MONTANT HT
1 8018353 CHONDROFLEX GEL B/30   A  1  1  13.782  13.782
3000000210338   LOT A4038   PER. 31/12/26
2 3404459 DEXERYL CR T/250G   3.813  A  4  4  2.707  10.828
3573994006046   LOT 6G062   PER. 29/02/28
10 UMIC100 UMICEF 1GR PDR INJ F/1+SOLV/1   1.595  A  9  9  1.132  10.188
LOT I250144   PER. 31/07/28
MONTANT H.T CUMULE : 94.984 BASE`;
    const d = parseDocument(t, 'delivery_note');
    expect(d.lines).toHaveLength(3);
    expect(d.lines[1]).toMatchObject({ designation: 'DEXERYL CR T/250G', supplierCode: '3404459', quantity: 4, unitCost: 2707, lineTotal: 10828, publicPrice: 3813, lotNumber: '6G062', barcode: '3573994006046' });
    expect(d.lines[1].expiry?.iso).toBe('2028-02-29');
    expect(d.lines[2]).toMatchObject({ supplierCode: 'UMIC100', quantity: 9, lotNumber: 'I250144' });
  });

  it('LABOREX : CIP et quantites avant la designation', () => {
    const t = `LABOREX CONGO  N FACTURE 00-914997-00
CIP QT CDE QT LIV DESIGNATION PUBLIC T PX UNIT MONTANT TVA PRM
8571648 3 3 BILOR CP B/10 2910 2068 6.204 05 T
8752459 1 1 CEFIDIS 200MG CP B/10 7335 5208 5.208 04 T
8797302 6 6 SAFORELLE SOIN LAV DX F100ML 1778 10.668 5 06 T`;
    const d = parseDocument(t, 'delivery_note');
    expect(d.lines.map((l) => [l.supplierCode, l.designation, l.quantity, l.unitCost, l.publicPrice])).toEqual([
      ['8571648', 'BILOR CP B/10', 3, 2068, 2910],
      ['8752459', 'CEFIDIS 200MG CP B/10', 1, 5208, 7335],
      ['8797302', 'SAFORELLE SOIN LAV DX F100ML', 6, 1778, null],
    ]);
  });
});
