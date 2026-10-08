import { findDate, matchProduct, parseDocument, parseExpiryLabel, parseNumber } from './parsers';

describe('findDate', () => {
  it.each([
    ['EXP 10/2027', '2027-10-31', 'month'],
    ['10/27', '2027-10-31', 'month'],
    ['31/12/2026', '2026-12-31', 'day'],
    ['2027-03-15', '2027-03-15', 'day'],
    ['OCT 2027', '2027-10-31', 'month'],
    ['févr. 2028', '2028-02-29', 'month'],
    ['08.2026', '2026-08-31', 'month'],
  ])('%s -> %s', (input, iso, precision) => {
    const d = findDate(input);
    expect(d?.iso).toBe(iso);
    expect(d?.precision).toBe(precision);
  });

  it('refuse une date impossible', () => {
    expect(findDate('31/02/2027')).toBeNull();
    expect(findDate('13/2027')).toBeNull();
  });
});

describe('parseNumber', () => {
  it.each([
    ['1 250,50', 1250.5],
    ['12.500', 12500],
    ['1,250.75', 1250.75],
    ['3,5', 3.5],
    ['48', 48],
  ])('%s', (s, n) => expect(parseNumber(s)).toBe(n));
  it('texte sans chiffre', () => expect(parseNumber('abc')).toBeNull());
});

describe('parseExpiryLabel (etiquette de boite)', () => {
  it('lit lot et date apres mot-cle', () => {
    const r = parseExpiryLabel('PARACETAMOL 500 mg\nLOT: A1234B   EXP: 10/2027\nFAB: 10/2024');
    expect(r.lotNumber).toBe('A1234B');
    expect(r.expiry?.iso).toBe('2027-10-31');
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('ignore la date de fabrication quand aucun mot-cle de peremption', () => {
    const r = parseExpiryLabel('Batch 22B771\nMFG 05/2024\n05/2026');
    expect(r.lotNumber).toBe('22B771');
    expect(r.expiry?.iso).toBe('2026-05-31');
    expect(r.confidence).toBeLessThan(0.8); // pas de mot-cle : a verifier
  });

  it('formats DLC / PER', () => {
    expect(parseExpiryLabel('L 99X2 DLC 03/2028').expiry?.iso).toBe('2028-03-31');
    expect(parseExpiryLabel('N° de lot : K7788 Per. 11-2026').expiry?.iso).toBe('2026-11-30');
  });

  it("renvoie une confiance nulle quand rien n'est lisible", () => {
    const r = parseExpiryLabel('~~ ### ~~');
    expect(r.expiry).toBeNull();
    expect(r.lotNumber).toBeNull();
    expect(r.confidence).toBe(0);
  });
});

const BL = `LABOREX CONGO
BON DE LIVRAISON N° BL-2026-0456
Date : 05/10/2026
Désignation            Qté   Lot       Péremption   PU      Total
DOLIPRANE 500 MG B/16   20   LOT A123  10/2028     850    17 000
AMOXICILLINE 1G CP B/12 10   LOT B77X  03/2027    1 500   15 000
SIROP TOUX ENFANT       5                          2 000   10 000
Total TTC : 42 000
Cachet et signature`;

describe('parseDocument (bon de livraison)', () => {
  const doc = parseDocument(BL, 'delivery_note');

  it("reconnait l'entete", () => {
    expect(doc.supplierName).toBe('LABOREX CONGO');
    expect(doc.documentNumber).toBe('BL-2026-0456');
    expect(doc.documentDate).toBe('2026-10-05');
    expect(doc.totalAmount).toBe(42000);
  });

  it('extrait les lignes de stock avec lot, peremption, quantite et prix', () => {
    expect(doc.lines).toHaveLength(3);
    const [a, b, c] = doc.lines;
    expect(a).toMatchObject({ designation: 'DOLIPRANE 500 MG B/16', quantity: 20, lotNumber: 'A123', unitCost: 850, lineTotal: 17000 });
    expect(a.expiry?.iso).toBe('2028-10-31');
    expect(b).toMatchObject({ quantity: 10, lotNumber: 'B77X', unitCost: 1500 });
    expect(b.expiry?.iso).toBe('2027-03-31');
    expect(c.quantity).toBe(5);
    expect(c.expiry).toBeNull(); // pas de date : confiance plus basse, a completer a la main
  });

  it('classe la confiance : ligne complete > ligne sans lot ni date', () => {
    expect(doc.lines[0].confidence).toBeGreaterThan(doc.lines[2].confidence);
    expect(doc.lines[0].confidence).toBeGreaterThan(0.8);
  });

  it("ignore les lignes d'entete, totaux et signatures", () => {
    expect(doc.lines.some((l) => /total|cachet|designation/i.test(l.designation))).toBe(false);
  });
});

describe('matchProduct', () => {
  const catalog = [
    { id: '1', name: 'Doliprane 500 mg boite de 16', dci: 'paracetamol' },
    { id: '2', name: 'Amoxicilline 1 g comprimes B/12', dci: 'amoxicilline' },
    { id: '3', name: 'Sirop toux enfant', dci: null, barcode: '6001234567890' },
  ];

  it('retrouve le produit malgre les abreviations', () => {
    expect(matchProduct('DOLIPRANE 500 MG B/16', null, catalog)?.id).toBe('1');
    expect(matchProduct('AMOXICILLINE 1G CP B/12', null, catalog)?.id).toBe('2');
  });

  it('le code-barres prime sur le nom', () => {
    expect(matchProduct('divers', '6001234567890', catalog)).toEqual({ id: '3', score: 1 });
  });

  it('ne force pas un rapprochement douteux', () => {
    expect(matchProduct('ARTEMETHER LUMEFANTRINE 80/480', null, catalog)).toBeNull();
  });
});
