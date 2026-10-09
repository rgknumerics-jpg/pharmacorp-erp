import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));

  // Liste blanche d'origines : jamais "origin: true" avec credentials:true (n'importe quel site pourrait
  // alors appeler l'API avec les jetons d'une victime connectee). CORS_ORIGINS (variable d'environnement,
  // separee par des virgules) permet d'ajouter un domaine (Netlify, domaine propre...) sans toucher au code.
  const defaultOrigins = ['http://localhost:5173', 'http://localhost:15273', 'http://127.0.0.1:5173', 'https://demo-erp-pharmacorp.netlify.app'];
  const extraOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const allowedOrigins = [...defaultOrigins, ...extraOrigins];
  app.enableCors({
    origin: (origin, cb) => (!origin || allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('Origine non autorisee'))),
    credentials: true,
  });
  configureApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API centrale')
    .setDescription(
      'Socle technique (auth, RBAC, multi-tenant, audit) -- voir ARCHITECTURE.md a la racine du depot.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
}

bootstrap();
