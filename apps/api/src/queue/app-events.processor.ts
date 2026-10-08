import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { APP_EVENTS_QUEUE, AppEventJobData } from './queue.constants';

/**
 * Worker de demonstration : consomme les evenements applicatifs (user.created, auth.login...).
 * Remplace/complete par de vrais consommateurs (email, notifications) quand ces modules existeront --
 * hors perimetre du socle actuel (ARCHITECTURE.md, section "hors MVP").
 */
@Processor(APP_EVENTS_QUEUE)
export class AppEventsProcessor extends WorkerHost {
  constructor(@InjectPinoLogger(AppEventsProcessor.name) private readonly logger: PinoLogger) {
    super();
  }

  async process(job: Job<AppEventJobData>): Promise<void> {
    this.logger.info({ jobId: job.id, name: job.name, data: job.data }, 'Evenement traite');
  }
}
