import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** Sonde de sante (ARCHITECTURE.md section 22) : verifie que PostgreSQL et Redis repondent. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @ApiOkResponse({ description: 'OK si PostgreSQL et Redis repondent, 503 sinon.' })
  async check() {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const status = database.ok && redis.ok ? 'ok' : 'error';
    const body = { status, database, redis, timestamp: new Date().toISOString() };
    if (status !== 'ok') {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async checkDatabase(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private async checkRedis(): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
    // poste local sans Redis (QUEUE_MODE=off) : les traitements se font en direct, Redis n'est pas requis
    if (process.env.QUEUE_MODE === 'off') return { ok: true, skipped: true };
    const client = new Redis({
      host: this.config.getOrThrow<string>('REDIS_HOST'),
      port: this.config.getOrThrow<number>('REDIS_PORT'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    try {
      await client.connect();
      await client.ping();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    } finally {
      client.disconnect();
    }
  }
}
