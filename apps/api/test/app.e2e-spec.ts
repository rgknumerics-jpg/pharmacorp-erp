import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';

/**
 * Necessite PostgreSQL et Redis demarres (docker compose up -d) et les variables
 * d'environnement de test chargees (.env.test) -- voir README.md, section "Tests".
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health repond ok quand PostgreSQL et Redis sont joignables', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
      });
  });
});
