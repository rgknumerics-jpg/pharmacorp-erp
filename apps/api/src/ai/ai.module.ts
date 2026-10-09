import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, Post, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AnalyticsService } from '../analytics/analytics.service';
import { StockModule } from '../stock/stock.module';
import { StockService } from '../stock/stock.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { withSettings } from '../company/settings';

/**
 * Assistant « Pilotage » : répond en langage naturel à des questions sur les données de LA pharmacie
 * connectée, en appelant uniquement les services métier déjà existants (jamais de SQL généré, jamais
 * d'accès à un autre tenant — ARCHITECTURE.md section 15). Modèle Haiku par défaut (peu coûteux) ;
 * un plafond mensuel par pharmacie coupe l'assistant proprement avant de dépasser un budget.
 */

const MODEL = 'claude-haiku-5-5';
// Tarifs Haiku 5.5 (prompts <=100k jetons) : 0,10 $ / M jetons en entree, 0,50 $ / M en sortie.
// Stocke en milliemes de cent (1 $ = 100 000 milliemes de cent) pour eviter les flottants en base ;
// le calcul lui-meme reste en virgule flottante puis est arrondi au milliemes de cent le plus proche.
const COST_PER_INPUT_TOKEN_MC = (0.10 * 100_000) / 1_000_000; // 0.01 millicent/jeton
const COST_PER_OUTPUT_TOKEN_MC = (0.50 * 100_000) / 1_000_000; // 0.05 millicent/jeton
const DEFAULT_MONTHLY_CAP_USD = 2; // plafond par defaut, modifiable plus tard par pharmacie

const SYSTEM_PROMPT = `Tu es l'assistant Pilotage de PharmaCorp ERP, un logiciel de gestion pour pharmacies au Congo.
Tu réponds en français, de façon brève et concrète, en FCFA pour les montants.
Tu réponds UNIQUEMENT à partir des outils fournis — jamais de chiffre inventé. Si une question dépasse ce que les outils peuvent donner, dis-le clairement plutôt que de deviner.
Tu n'as accès qu'aux données commerciales et financières globales de cette pharmacie (stock, ventes, marges) — jamais aux dossiers patients, ordonnances ni données de santé individuelles.
Appelle un ou plusieurs outils avant de répondre à toute question chiffrée.`;

const TOOLS: Anthropic.Tool[] = [
  { name: 'cockpit_overview', description: "Vue d'ensemble du jour/mois en cours : chiffre d'affaires, marge, trésorerie, stock, ruptures.", input_schema: { type: 'object', properties: {} } },
  { name: 'risks', description: 'Alertes en cours (stock, péremptions, écarts de caisse, factures en retard...), avec leur montant.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'finance_period',
    description: 'Chiffre d\'affaires, achats et marge sur une période donnée (comptabilité).',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: 'Date de début, AAAA-MM-JJ' }, to: { type: 'string', description: 'Date de fin (exclue), AAAA-MM-JJ' } }, required: ['from', 'to'] },
  },
  { name: 'expiring_lots', description: 'Lots en stock qui expirent bientôt (ou déjà périmés), avec quantité et valeur.', input_schema: { type: 'object', properties: { days: { type: 'number', description: "Horizon en jours (90 par défaut)" } } } },
  { name: 'reorder_suggestions', description: 'Produits à recommander (stock bas par rapport aux ventes récentes), avec quantité suggérée.', input_schema: { type: 'object', properties: {} } },
];

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly stock: StockService,
  ) {}

  private client(): Anthropic {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new ServiceUnavailableException("L'assistant IA n'est pas configuré sur ce serveur (clé manquante).");
    return new Anthropic({ apiKey: key });
  }

  private yearMonth(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

  /** Un module désactivé bloque son endpoint, pas seulement l'onglet (ARCHITECTURE.md section 3) — vrai ici : coût réel si on l'oublie. */
  private async assertEnabled(tenantId: string) {
    const p = await this.prisma.forTenant(tenantId, (tx) => tx.companyProfile.findUnique({ where: { tenantId }, select: { settings: true } }));
    if (!withSettings(p?.settings).modules.ai) throw new ForbiddenException("L'assistant IA n'est pas activé pour cette pharmacie (Panneau d'administration → Fonctions).");
  }

  /** Dépense déjà engagée ce mois-ci pour cette pharmacie, en dollars. */
  async usageThisMonth(tenantId: string) {
    const ym = this.yearMonth();
    const row = await this.prisma.forTenant(tenantId, (tx) => tx.aiUsageMonthly.findUnique({ where: { tenantId_yearMonth: { tenantId, yearMonth: ym } } }));
    const spentUsd = row ? Number(row.costUsdMillicents) / 100_000 : 0;
    return { month: ym, spentUsd: Math.round(spentUsd * 10_000) / 10_000, capUsd: DEFAULT_MONTHLY_CAP_USD, requests: row?.requests ?? 0 };
  }

  private async recordUsage(tenantId: string, inputTokens: number, outputTokens: number) {
    const ym = this.yearMonth();
    const costMc = Math.round(inputTokens * COST_PER_INPUT_TOKEN_MC + outputTokens * COST_PER_OUTPUT_TOKEN_MC);
    await this.prisma.forTenant(tenantId, (tx) =>
      tx.aiUsageMonthly.upsert({
        where: { tenantId_yearMonth: { tenantId, yearMonth: ym } },
        create: { tenantId, yearMonth: ym, inputTokens, outputTokens, costUsdMillicents: costMc, requests: 1 },
        update: { inputTokens: { increment: inputTokens }, outputTokens: { increment: outputTokens }, costUsdMillicents: { increment: costMc }, requests: { increment: 1 } },
      }),
    );
  }

  private async runTool(user: AuthenticatedUser, name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'cockpit_overview': return this.analytics.cockpit(user.tenantId, user.roleId);
      case 'risks': return this.analytics.risks(user.tenantId);
      case 'finance_period': {
        const from = typeof input.from === 'string' ? new Date(input.from) : new Date();
        const to = typeof input.to === 'string' ? new Date(input.to) : new Date();
        return this.analytics.finance(user.tenantId, from, to);
      }
      case 'expiring_lots': return this.stock.expiring(user.tenantId, typeof input.days === 'number' ? input.days : 90);
      case 'reorder_suggestions': return this.analytics.reorder(user.tenantId);
      default: return { error: 'outil inconnu' };
    }
  }

  async ask(user: AuthenticatedUser, question: string) {
    await this.assertEnabled(user.tenantId);
    const q = (question ?? '').trim().slice(0, 600);
    if (!q) throw new BadRequestException('Question vide');

    const usage = await this.usageThisMonth(user.tenantId);
    if (usage.spentUsd >= usage.capUsd) {
      return { answer: `Le budget mensuel de l'assistant IA (${usage.capUsd} $) est atteint pour ce mois-ci. Il reprendra automatiquement le mois prochain.`, budgetReached: true };
    }

    const client = this.client();
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: q }];
    let inputTokens = 0, outputTokens = 0;
    let finalText = '';

    for (let round = 0; round < 4; round++) {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      });
      inputTokens += resp.usage.input_tokens;
      outputTokens += resp.usage.output_tokens;

      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
      if (text) finalText = text;

      if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      messages.push({ role: 'assistant', content: resp.content });
      const results = await Promise.all(toolUses.map(async (t) => ({
        type: 'tool_result' as const,
        tool_use_id: t.id,
        content: JSON.stringify(await this.runTool(user, t.name, (t.input as Record<string, unknown>) ?? {})).slice(0, 8000),
      })));
      messages.push({ role: 'user', content: results });
    }

    await this.recordUsage(user.tenantId, inputTokens, outputTokens);
    return { answer: finalText || "Je n'ai pas pu répondre à cette question.", budgetReached: false };
  }
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('ask') @RequirePermissions('analytics.read')
  ask(@CurrentUser() user: AuthenticatedUser, @Body() b: { question: string }) { return this.ai.ask(user, b?.question); }

  @Get('usage') @RequirePermissions('analytics.read')
  usage(@CurrentUser() user: AuthenticatedUser) { return this.ai.usageThisMonth(user.tenantId); }
}

@Module({ imports: [PrismaModule, AnalyticsModule, StockModule], controllers: [AiController], providers: [AiService] })
export class AiModule {}
