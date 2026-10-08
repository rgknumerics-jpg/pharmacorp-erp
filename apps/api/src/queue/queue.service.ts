import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_EVENTS_QUEUE, AppEventJobData, AppEventJobName } from './queue.constants';

/**
 * Systeme de files d'attente (ARCHITECTURE.md section 22, BullMQ/Redis).
 * Les evenements publies ici sont des notifications asynchrones : une panne de Redis ne doit JAMAIS bloquer une
 * operation metier (connexion, vente...) -- principe 8 de ARCHITECTURE.md (mode d'echec explicite). On attend donc
 * au plus `ENQUEUE_TIMEOUT_MS`, puis on journalise et on continue.
 */
const ENQUEUE_TIMEOUT_MS = 2000;

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(@InjectQueue(APP_EVENTS_QUEUE) private readonly appEventsQueue: Queue) {}

  async enqueue(name: AppEventJobName, data: AppEventJobData): Promise<unknown> {
    const add = this.appEventsQueue.add(name, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    add.catch(() => undefined); // evite un rejet non gere si le delai est atteint avant l'echec
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), ENQUEUE_TIMEOUT_MS);
      timer.unref?.();
    });
    try {
      const r = await Promise.race([add, timeout]);
      if (r === 'timeout') this.logger.warn(`File d'evenements injoignable : "${name}" non publie (l'operation continue).`);
      return r === 'timeout' ? null : r;
    } catch (e) {
      this.logger.warn(`Publication de "${name}" en echec : ${(e as Error).message} (l'operation continue).`);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
