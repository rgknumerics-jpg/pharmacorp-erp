import { Body, Controller, ForbiddenException, HttpCode, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { MobileMoneyService } from './mobile-money.service';

/**
 * Notification de l'operateur Mobile Money (ARCHITECTURE.md section 12) : confirme ou fait echouer un paiement
 * "en attente de confirmation". Authentifiee par signature HMAC-SHA256 du corps brut (en-tete x-signature,
 * secret MOMO_WEBHOOK_SECRET) -- jamais par un simple identifiant dans l'URL.
 */
@ApiTags('webhooks')
@Controller('webhooks/mobile-money')
export class MobileMoneyController {
  constructor(private readonly momo: MobileMoneyService) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  async notify(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>) {
    const secret = process.env.MOMO_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Webhook Mobile Money non configure');
    const sig = String(req.headers['x-signature'] ?? '');
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Signature invalide');
    return this.momo.handle(provider, body);
  }
}