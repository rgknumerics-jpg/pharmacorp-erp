import { buildOrderXml, planFor, runCascade, WholesalerGateway } from './pharmaml';

const gw = (supplierId: string, name: string, priority: number): WholesalerGateway => ({ supplierId, name, priority, protocol: 'pharmaml', host: `${name}.test`, port: 9443, customerCode: '4024', enabled: true });
const GW = [gw('ubi', 'UBIPHARM', 2), gw('lbx', 'LABOREX', 1), gw('sep', 'SEP', 3)];
const needs = [
  { productId: 'bilor', name: 'BILOR CP B/10', quantity: 3, codes: { lbx: '8571648', ubi: 'BIL10' } },
  { productId: 'cefidis', name: 'CEFIDIS 200MG', quantity: 2, codes: { lbx: '8752459', sep: 'C200' } },
  { productId: 'umicef', name: 'UMICEF 1G', quantity: 9, codes: { ubi: 'UMIC100' } },
];

describe('commande grossistes PharmaML en cascade', () => {
  it('chaque grossiste recoit ses propres codes CIP', () => {
    const { step, skipped } = planFor(GW[1], needs);
    expect(step.lines.map((l) => l.code)).toEqual(['8571648', '8752459']);
    expect(skipped.map((s) => s.productId)).toEqual(['umicef']);
    expect(buildOrderXml(step, 'CMD-1')).toContain('<CODE type="CIP">8571648</CODE><QTE>3</QTE>');
  });

  it('ruptures LABOREX -> UBIPHARM -> SEP dans l\'ordre de priorite', async () => {
    const calls: string[] = [];
    const responses: Record<string, string> = {
      LABOREX: '<R><LIGNE><CODE>8571648</CODE><QTE_LIVREE>1</QTE_LIVREE></LIGNE><LIGNE><CODE>8752459</CODE><QTE_LIVREE>0</QTE_LIVREE></LIGNE></R>',
      UBIPHARM: '<R><LIGNE><CODE>BIL10</CODE><QTE_LIVREE>2</QTE_LIVREE></LIGNE><LIGNE><CODE>UMIC100</CODE><QTE_LIVREE>9</QTE_LIVREE></LIGNE></R>',
      SEP: '<R><LIGNE><CODE>C200</CODE><QTE_LIVREE>0</QTE_LIVREE></LIGNE></R>',
    };
    const r = await runCascade(GW, needs, 'CMD-1', async (g, body) => { calls.push(`${g.name}:${(body.match(/<LIGNE/g) ?? []).length}`); return responses[g.name]; });
    expect(calls).toEqual(['LABOREX:2', 'UBIPHARM:2', 'SEP:1']);
    expect(r.unserved).toEqual([expect.objectContaining({ productId: 'cefidis', quantity: 2 })]);
  });

  it('passerelle en panne : on passe au suivant sans perdre la commande', async () => {
    const r = await runCascade(GW, needs.slice(0, 1), 'CMD-2', async (g) => { if (g.name === 'LABOREX') throw new Error('injoignable'); return '<R><LIGNE><CODE>BIL10</CODE><QTE_LIVREE>3</QTE_LIVREE></LIGNE></R>'; });
    expect(r.steps[0].error).toBe('injoignable');
    expect(r.unserved).toEqual([]);
  });
});
