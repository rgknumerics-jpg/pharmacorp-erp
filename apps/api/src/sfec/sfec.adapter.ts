import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { FiscalDocument } from '../fiscal/fiscal';

/** L'API SFEC est indisponible (reseau, panne) : on emet une facture provisoire et on reessaie plus tard. */
export class SfecUnavailableError extends Error {}
/** L'administration refuse le document : correction humaine requise, aucun nouvel essai automatique. */
export class SfecRejectedError extends Error {}

export interface SfecCertification { reference: string; qr: string }

export interface SfecAdapter {
  readonly name: string;
  certify(doc: FiscalDocument): Promise<SfecCertification>;
}

export const SFEC_ADAPTER = Symbol('SFEC_ADAPTER');

/**
 * Simulateur (par defaut, tant que la specification officielle et les acces ne sont pas fournis) : meme contrat
 * que l'API reelle. SFEC_SIMULATOR_DOWN=true simule une panne pour verifier le mode degrade.
 */
@Injectable()
export class SimulatorSfecAdapter implements SfecAdapter {
  readonly name = 'simulateur';
  async certify(doc: FiscalDocument): Promise<SfecCertification> {
    if (process.env.SFEC_SIMULATOR_DOWN === 'true') throw new SfecUnavailableError('SFEC indisponible (simulation)');
    if (doc.lines.length === 0) throw new SfecRejectedError('Document sans ligne');
    const ref = 'SIM-' + createHash('sha256').update(`${doc.seller.tenantId}|${doc.number}|${doc.kind}`).digest('hex').slice(0, 16).toUpperCase();
    return { reference: ref, qr: `SFEC|${ref}|${doc.number}|${doc.total.ttc}` };
  }
}

/**
 * Connecteur HTTP generique (SFEC_MODE=http, SFEC_API_URL, SFEC_API_KEY). Isole du moteur fiscal (section 13) :
 * quand la specification officielle (format XML, authentification) sera publiee, seule cette classe change.
 */
@Injectable()
export class HttpSfecAdapter implements SfecAdapter {
  readonly name = 'http';
  async certify(doc: FiscalDocument): Promise<SfecCertification> {
    const url = process.env.SFEC_API_URL;
    if (!url) throw new SfecUnavailableError('SFEC_API_URL non configuree');
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SFEC_API_KEY ?? ''}` },
        body: JSON.stringify(doc),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new SfecUnavailableError((e as Error).message);
    }
    if (res.status >= 500 || res.status === 429) throw new SfecUnavailableError(`SFEC ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as { reference?: string; qr?: string; error?: string };
    if (!res.ok || !body.reference) throw new SfecRejectedError(body.error ?? `SFEC ${res.status}`);
    return { reference: body.reference, qr: body.qr ?? '' };
  }
}