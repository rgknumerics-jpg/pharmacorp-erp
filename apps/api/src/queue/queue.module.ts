import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_EVENTS_QUEUE } from './queue.constants';
import { QueueService } from './queue.service';
import { AppEventsProcessor } from './app-events.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),
    BullModule.registerQueue({ name: APP_EVENTS_QUEUE }),
  ],
  providers: [QueueService, AppEventsProcessor],
  exports: [QueueService],
})
export class RedisQueueModule {}

/**
 * Sans Redis (poste local, demonstration) : QUEUE_MODE=off remplace la file par un service sans effet. Les evenements
 * applicatifs de la file ne sont que des notifications : aucune donnee metier n'en depend (l'outbox comptable est en base).
 */
@Global()
@Module({ providers: [{ provide: QueueService, useValue: { enqueue: async () => null } }], exports: [QueueService] })
export class NoopQueueModule {}

export const QueueModule = process.env.QUEUE_MODE === 'off' ? NoopQueueModule : RedisQueueModule;
