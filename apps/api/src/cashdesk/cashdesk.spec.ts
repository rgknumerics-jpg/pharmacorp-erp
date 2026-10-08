import { inWords } from './cashdesk.module';

describe('montant en lettres (pieces de caisse)', () => {
  it.each([
    [15000, 'quinze mille francs CFA'],
    [81256, 'quatre-vingt-un mille deux cent cinquante-six francs CFA'],
    [200, 'deux cents francs CFA'],
    [1971, 'mille neuf cent soixante et onze francs CFA'],
    [2500000, 'deux millions cinq cent mille francs CFA'],
    [80, 'quatre-vingts francs CFA'],
  ])('%i', (n, s) => expect(inWords(n)).toBe(s));
});
