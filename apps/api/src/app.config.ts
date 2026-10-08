import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Configuration globale de l'application (pipes de validation -- ARCHITECTURE.md section 7/21).
 * Extrait de main.ts pour etre reutilise a l'identique par les tests e2e : un test qui cree
 * l'app via `Test.createTestingModule(...).compile()` sans rejouer cette fonction n'a PAS le
 * ValidationPipe (bug trouve et corrige lors de la verification du 2026-09-27 -- voir
 * test/setup-app.ts). Les guards et le filtre d'exceptions n'ont pas ce probleme : ils sont
 * enregistres comme providers globaux dans AppModule (APP_GUARD/APP_FILTER), donc actifs
 * automatiquement, y compris dans les tests.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
