import { allocateFefo, LotStock } from './fefo';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = d('2026-10-07');

const lots: LotStock[] = [
  { lotId: 'B', lotNumber: 'B', expiryDate: d('2027-06-30'), available: 10 },
  { lotId: 'A', lotNumber: 'A', expiryDate: d('2026-12-31'), available: 5 },
  { lotId: 'OLD', lotNumber: 'OLD', expiryDate: d('2026-09-30'), available: 50 }, // perime
  { lotId: 'NOEXP', lotNumber: 'N', expiryDate: null, available: 100 },
];

describe('allocateFefo', () => {
  it('sort le lot qui expire en premier, sans toucher aux lots perimes', () => {
    expect(allocateFefo(lots, 3, 0, today)).toEqual([{ lotId: 'A', quantity: 3 }]);
  });

  it('deborde sur le lot suivant quand le premier est epuise', () => {
    expect(allocateFefo(lots, 12, 0, today)).toEqual([
      { lotId: 'A', quantity: 5 },
      { lotId: 'B', quantity: 7 },
    ]);
  });

  it('les lots sans date passent en dernier', () => {
    expect(allocateFefo(lots, 20, 0, today).map((a) => a.lotId)).toEqual(['A', 'B', 'NOEXP']);
  });

  it('refuse (409) quand le stock vendable est insuffisant', () => {
    expect(() => allocateFefo([lots[0]], 11, 0, today)).toThrow(/Stock insuffisant/);
  });

  it('accepte un manque dans la limite de la tolerance de survente et le signale', () => {
    const r = allocateFefo([lots[0]], 12, 2, today);
    expect(r).toEqual([
      { lotId: 'B', quantity: 10 },
      { lotId: null, quantity: 2, oversold: true },
    ]);
  });

  it('refuse un manque superieur a la tolerance', () => {
    expect(() => allocateFefo([lots[0]], 14, 2, today)).toThrow(/Stock insuffisant/);
  });

  it("un lot qui expire aujourd'hui est encore vendable", () => {
    expect(allocateFefo([{ lotId: 'T', lotNumber: 'T', expiryDate: today, available: 4 }], 4, 0, today)).toEqual([
      { lotId: 'T', quantity: 4 },
    ]);
  });
});
