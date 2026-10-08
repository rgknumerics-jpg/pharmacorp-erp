import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma, withTenant } from '@erp/database';

/**
 * Wrapper NestJS autour de PrismaClient (ARCHITECTURE.md section 6).
 * `forTenant` est le seul point d'entree recommande pour les requetes metier tenant-scopees :
 * il positionne `app.current_tenant_id` (voir @erp/database/tenant-context) avant d'executer
 * la callback, pour que la Row-Level Security (packages/database/prisma/rls-policies.sql)
 * s'applique meme si une clause `where: { tenantId }` est oubliee dans le code applicatif.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  forTenant<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return withTenant(this, tenantId, fn);
  }
}
