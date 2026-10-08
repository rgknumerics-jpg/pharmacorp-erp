import { alertLevel, holidays, lastWorkingDayOnOrBefore, occurrences, TaxProfileInput } from './calendar';

const pharmacy: TaxProfileInput = { taxRegime: 'reel', incomeTax: 'IS', vatRegistered: true, employeesCount: 5, rentsPremises: true, ownsProperty: false };

describe('calendrier fiscal 2026', () => {
  const occ = occurrences(pharmacy, [2026]);
  const find = (code: string, period: string) => occ.find((o) => o.obligation === code && o.period.startsWith(period))!;

  it('TVA de juillet : le 20 aout (art. 461 bis), sinon le 15', () => {
    expect(find('TVA', '2026-07').legalDue).toBe('2026-08-20');
    expect(find('TVA', '2026-02').legalDue).toBe('2026-03-15');
  });

  it('echeance un dimanche : dernier jour ouvre precedent', () => {
    // 15 mars 2026 = dimanche -> vendredi 13 mars
    expect(find('TVA', '2026-02').due).toBe('2026-03-13');
    expect(find('IMF_IS', '2026-T1').due).toBe('2026-03-13');
  });

  it('jours feries : Lundi de Paques 2026 et 15 aout', () => {
    const h = holidays(2026);
    expect(h.has('2026-04-06')).toBe(true); // Paques = 5 avril 2026
    expect(h.has('2026-08-15')).toBe(true);
    expect(lastWorkingDayOnOrBefore(new Date('2026-08-15T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-08-14');
  });

  it('echeances annuelles de la note ACPCE', () => {
    expect(find('DAS', '2025').legalDue).toBe('2026-02-15');
    expect(find('PATENTE', '2026').legalDue).toBe('2026-04-20');
    expect(find('DSF', '2025').legalDue).toBe('2026-05-15');
    expect(find('IS', '2025').legalDue).toBe('2026-05-15');
    expect(occ.filter((o) => o.obligation === 'IMF_IS').map((o) => o.legalDue)).toEqual(['2026-03-15', '2026-06-15', '2026-09-15', '2026-12-15']);
  });

  it("n'impose que les obligations applicables au profil", () => {
    expect(occ.some((o) => o.obligation === 'IGF')).toBe(false);
    expect(occ.some((o) => o.obligation === 'CFPB')).toBe(false);
    const solo = occurrences({ ...pharmacy, employeesCount: 0, taxRegime: 'forfait', incomeTax: 'IBA', vatRegistered: false, rentsPremises: false }, [2026]);
    expect(solo.some((o) => ['ITS', 'CNSS', 'TVA', 'IS', 'DSF'].includes(o.obligation))).toBe(false);
    expect(solo.filter((o) => o.obligation === 'IGF')).toHaveLength(4);
  });

  it('CNSS trimestrielle a 20 salaries ou moins, mensuelle au-dela', () => {
    expect(occ.filter((o) => o.obligation === 'CNSS')).toHaveLength(4);
    expect(occurrences({ ...pharmacy, employeesCount: 25 }, [2026]).filter((o) => o.obligation === 'CNSS')).toHaveLength(12);
  });

  it('rappels a 1 mois, 2 semaines, 1 semaine, puis retard', () => {
    const today = new Date('2026-03-01T10:00:00Z');
    expect(alertLevel('2026-03-25', today).level).toBe('j30');
    expect(alertLevel('2026-03-13', today).level).toBe('j14');
    expect(alertLevel('2026-03-06', today).level).toBe('j7');
    expect(alertLevel('2026-02-27', today).level).toBe('overdue');
    expect(alertLevel('2026-05-15', today).level).toBeNull();
  });
});
