import { validateEnv } from './env.validation';

const validBase = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('accepte une configuration valide et applique les valeurs par defaut', () => {
    const config = validateEnv(validBase);
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.JWT_ACCESS_TTL).toBe('15m');
  });

  it('rejette une configuration sans DATABASE_URL', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { DATABASE_URL: _omitted, ...rest } = validBase;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejette un secret JWT trop court', () => {
    expect(() => validateEnv({ ...validBase, JWT_ACCESS_SECRET: 'trop-court' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejette un NODE_ENV inconnu', () => {
    expect(() => validateEnv({ ...validBase, NODE_ENV: 'staging' })).toThrow();
  });
});
