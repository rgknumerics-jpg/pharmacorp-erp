import { salePriceFrom } from './referentials.module';

describe('prix de vente par categorie (arrondi au multiple de 5 F superieur)', () => {
  it.each([
    [1000, 1.408, 1410], [1000, 1.58, 1580], [2068, 1.408, 2915], [999, 1.75, 1750], [4500, 1.075, 4840], [3, 1.54, 5],
  ])('achat %i x %f = %i', (a, c, v) => expect(salePriceFrom(a, c)).toBe(v));
  it('arrondi a 25 F', () => expect(salePriceFrom(1000, 1.41, 25)).toBe(1425));
});
