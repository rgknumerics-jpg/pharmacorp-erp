/**
 * Infrastructure de commande aux grossistes-repartiteurs (LABOREX, UBIPHARM, SEP...) via PharmaML.
 *
 * - Chaque grossiste a une passerelle : hote + port + identifiants officine fournis par le grossiste.
 * - La commande part au grossiste prioritaire avec SES codes (CIP grossiste) ; les ruptures renvoyees
 *   basculent automatiquement au grossiste suivant, dans l'ordre defini par la pharmacie.
 * - Le format XML ci-dessous suit la structure generale PharmaML (entete / officine / lignes) ; le schema
 *   exact (version, espace de noms, signature) sera ajuste sur la specification remise par chaque grossiste.
 * Fonctions pures : testables sans reseau.
 */

export interface WholesalerGateway {
  supplierId: string;
  name: string;
  /** Rang dans la cascade (1 = commande en premier). */
  priority: number;
  protocol: 'pharmaml' | 'file';
  host?: string;
  port?: number;
  /** Chemin du service sur la passerelle (ex. /pharmaml). */
  path?: string;
  useTls?: boolean;
  /** Identifiant de l'officine chez le grossiste (numero client). */
  customerCode?: string;
  /** Nom de la variable d'environnement contenant le mot de passe / la cle (jamais en base en clair). */
  secretEnv?: string;
  pharmaMlVersion?: string;
  enabled: boolean;
}

export interface OrderNeed {
  productId: string;
  name: string;
  quantity: number;
  /** Code article par grossiste : { [supplierId]: CIP } */
  codes: Record<string, string | undefined>;
  ean?: string | null;
}

export interface GatewayLineResult { productId: string; delivered: number; status: 'ok' | 'partial' | 'rupture' | 'unknown_code' }

export interface CascadeStep { gateway: WholesalerGateway; lines: { need: OrderNeed; code: string; quantity: number }[] }

/** Ordre de passage : grossistes actifs tries par priorite. */
export const cascadeOrder = (g: WholesalerGateway[]) => g.filter((x) => x.enabled).sort((a, b) => a.priority - b.priority);

/**
 * Lignes a envoyer au grossiste `gw` : on ne lui envoie que les produits dont on connait son code
 * (CIP grossiste, a defaut l'EAN). Les autres passent directement au suivant.
 */
export function planFor(gw: WholesalerGateway, needs: OrderNeed[]): { step: CascadeStep; skipped: OrderNeed[] } {
  const lines: CascadeStep['lines'] = [], skipped: OrderNeed[] = [];
  for (const n of needs) {
    const code = n.codes[gw.supplierId] ?? n.ean ?? undefined;
    if (code && n.quantity > 0) lines.push({ need: n, code, quantity: n.quantity }); else skipped.push(n);
  }
  return { step: { gateway: gw, lines }, skipped };
}

/** Reliquat apres reponse d'un grossiste : quantites non livrees (ruptures, partiels, codes inconnus). */
export function remainder(step: CascadeStep, results: GatewayLineResult[], skipped: OrderNeed[]): OrderNeed[] {
  const byId = new Map(results.map((r) => [r.productId, r]));
  const rest = step.lines.flatMap(({ need, quantity }) => {
    const r = byId.get(need.productId);
    const left = quantity - Math.min(quantity, r?.delivered ?? 0);
    return left > 0 ? [{ ...need, quantity: left }] : [];
  });
  return [...rest, ...skipped];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Message de commande PharmaML (structure generique, a caler sur la spec du grossiste). */
export function buildOrderXml(step: CascadeStep, ref: string, at = new Date()): string {
  const gw = step.gateway;
  const lines = step.lines.map((l, i) => `    <LIGNE num="${i + 1}"><CODE type="CIP">${esc(l.code)}</CODE><QTE>${l.quantity}</QTE><LIBELLE>${esc(l.need.name)}</LIBELLE></LIGNE>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<PHARMAML version="${esc(gw.pharmaMlVersion ?? '2.0')}">
  <ENTETE><EMETTEUR>PHARMACORP-ERP</EMETTEUR><DESTINATAIRE>${esc(gw.name)}</DESTINATAIRE><DATE>${at.toISOString()}</DATE></ENTETE>
  <COMMANDE ref="${esc(ref)}" client="${esc(gw.customerCode ?? '')}">
${lines}
  </COMMANDE>
</PHARMAML>`;
}

/** Lecture de la reponse (accuse de reception avec quantites livrables ligne a ligne). */
export function parseOrderResponse(xml: string, step: CascadeStep): GatewayLineResult[] {
  const out: GatewayLineResult[] = [];
  const rx = /<LIGNE[^>]*>([\s\S]*?)<\/LIGNE>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml))) {
    const code = /<CODE[^>]*>([^<]+)<\/CODE>/i.exec(m[1])?.[1]?.trim();
    const line = step.lines.find((l) => l.code === code);
    if (!line) continue;
    const delivered = Number(/<QTE_?(?:LIVREE|LIVRABLE|SERVIE)>(\d+)</i.exec(m[1])?.[1] ?? 0);
    const unknown = /INCONNU|UNKNOWN/i.test(m[1]);
    out.push({ productId: line.need.productId, delivered, status: unknown ? 'unknown_code' : delivered >= line.quantity ? 'ok' : delivered > 0 ? 'partial' : 'rupture' });
  }
  return out;
}

/** Transport : envoi HTTP(S) sur l'hote:port de la passerelle. Injectable (tests, ou futur transport TCP brut). */
export type Transport = (gw: WholesalerGateway, body: string) => Promise<string>;

export const httpTransport: Transport = async (gw, body) => {
  if (!gw.host || !gw.port) throw new Error(`Passerelle ${gw.name} non configurée (hôte et port requis).`);
  const secret = gw.secretEnv ? process.env[gw.secretEnv] ?? '' : '';
  const url = `${gw.useTls === false ? 'http' : 'https'}://${gw.host}:${gw.port}${gw.path ?? '/'}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/xml; charset=utf-8', ...(secret ? { authorization: `Basic ${Buffer.from(`${gw.customerCode ?? ''}:${secret}`).toString('base64')}` } : {}) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${gw.name} : réponse ${res.status}`);
  return res.text();
};

export interface CascadeReport {
  steps: { gateway: string; sent: number; results: GatewayLineResult[]; error?: string; xml: string }[];
  /** Produits restant non servis apres tous les grossistes. */
  unserved: OrderNeed[];
}

/** Cascade complete : grossiste 1 -> ruptures au 2 -> ruptures au 3... */
export async function runCascade(gateways: WholesalerGateway[], needs: OrderNeed[], ref: string, transport: Transport = httpTransport): Promise<CascadeReport> {
  const report: CascadeReport = { steps: [], unserved: [] };
  let todo = needs.filter((n) => n.quantity > 0);
  for (const gw of cascadeOrder(gateways)) {
    if (!todo.length) break;
    const { step, skipped } = planFor(gw, todo);
    if (!step.lines.length) { todo = skipped; continue; }
    const xml = gw.protocol === 'pharmaml' ? buildOrderXml(step, `${ref}-${gw.priority}`) : '';
    let results: GatewayLineResult[] = [];
    let error: string | undefined;
    if (gw.protocol === 'pharmaml') {
      try { results = parseOrderResponse(await transport(gw, xml), step); } catch (e) { error = (e as Error).message; }
    }
    report.steps.push({ gateway: gw.name, sent: step.lines.length, results, error, xml });
    todo = remainder(step, results, skipped);
  }
  report.unserved = todo;
  return report;
}
