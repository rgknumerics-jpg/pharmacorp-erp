import { hashToken } from './hash.util';

describe('hashToken', () => {
  it('produit une empreinte deterministe (meme entree -> meme sortie)', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('produit une empreinte differente pour des entrees differentes', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('ne renvoie jamais le jeton en clair', () => {
    expect(hashToken('super-secret-refresh-token')).not.toContain('super-secret-refresh-token');
  });
});
