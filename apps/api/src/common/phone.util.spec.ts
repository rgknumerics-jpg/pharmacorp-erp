import { normalizePhone } from './phone.util';

describe('normalizePhone (Congo : le 0 initial est conserve)', () => {
  it('numero local avec 0', () => expect(normalizePhone('06 123 45 67')).toBe('242061234567'));
  it('numero international', () => expect(normalizePhone('+242 06 123 45 67')).toBe('242061234567'));
  it('ancien format sans 0', () => expect(normalizePhone('242 6 123 45 67')).toBe('242061234567'));
  it('autre pays conserve son prefixe', () => expect(normalizePhone('+33 6 12 34 56 78')).toBe('33612345678'));
  it('vide ou trop court', () => { expect(normalizePhone('')).toBeNull(); expect(normalizePhone('123')).toBeNull(); });
});
