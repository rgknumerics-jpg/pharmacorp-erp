import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.config';
import { QueueService } from '../src/queue/queue.service';

/**
 * Construit une instance d'application identique a celle de main.ts (memes pipes globaux),
 * pour que les tests e2e exercent reellement le comportement de production -- pas une
 * version degradee qui aurait "oublie" la validation des DTO (bug trouve et corrige le
 * 2026-09-27, voir src/app.config.ts).
 */
export async function createTestApp(): Promise<{ app: INestApplication; moduleRef: TestingModule }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  return { app, moduleRef };
}

/**
 * Variante pour les parcours metier : la file d'evenements (Redis/BullMQ) est remplacee par un no-op.
 * Les parcours metier ne dependent pas de Redis ; la sante de Redis reste couverte par app.e2e-spec.ts.
 */
export async function createTestAppWithoutQueue(): Promise<{ app: INestApplication; moduleRef: TestingModule }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(QueueService)
    .useValue({ enqueue: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  return { app, moduleRef };
}
