import { loadPlantsEngine } from './plants.service';

describe('Conseil plantes (moteur partage)', () => {
  const engine = loadPlantsEngine();

  it('PANADEX + NIFLUGEL -> douleur inflammatoire -> curcuma en tete', () => {
    const r = engine.analyse([{ name: 'PANADEX comprimé' }, { name: 'NIFLUGEL gel' }]);
    expect((r as any).besoins[0].id).toBe('douleur_inflammatoire');
    expect(r.suggestions[0].plante.id).toBe('curcuma-longa');
  });

  it('anticoagulant au panier -> curcuma ecarte', () => {
    const r = engine.analyse([{ name: 'Diclofenac gel' }, { name: 'SINTROM 4 mg' }]);
    expect(r.suggestions.map((s) => s.plante.id)).not.toContain('curcuma-longa');
  });

  it('antiretroviral -> aucune suggestion automatique', () => {
    const r = engine.analyse([{ name: 'Ibuprofène' }, { name: 'TLD dolutegravir' }]);
    expect(r.suggestions).toHaveLength(0);
    expect((r as any).suppression).toBeTruthy();
  });

  it('recherche et plante du jour', () => {
    expect(engine.search('curcuma').total).toBeGreaterThan(0);
    expect((engine.plantOfTheDay('2026-10-08') as any).plante.id).toBeTruthy();
  });
});
