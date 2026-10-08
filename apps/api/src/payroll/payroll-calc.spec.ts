import { computePayslip, DEFAULT_PAYROLL_PARAMETERS, progressiveTax } from './payroll-calc';

describe('calcul de paie', () => {
  it('CNSS : 24,28 % du brut sous les plafonds (4 % salarie + 20,28 % employeur)', () => {
    const r = computePayslip({ baseSalary: 300_000, taxParts: 1, zone: 'centre' });
    expect(r.employee.cnss).toBe(12_000);
    expect(r.employer.cnss).toBe(24_000 + 30_090 + 6_750);
    expect(r.employee.cnss + r.employer.cnss).toBe(Math.round(300_000 * 0.2428));
  });

  it('CAMU, TUS et TOL', () => {
    const r = computePayslip({ baseSalary: 300_000, taxParts: 1, zone: 'peripherie' });
    expect(r.employee.camu).toBe(6_810);
    expect(r.employer.camu).toBe(13_650);
    expect(r.employer.tusTax).toBe(6_075);
    expect(r.employer.tusSocial).toBe(16_425);
    expect(r.employee.tol).toBe(1_000);
  });

  it('plafonds CNSS appliques', () => {
    const r = computePayslip({ baseSalary: 2_000_000, taxParts: 1, zone: 'centre' });
    expect(r.bases.pensionBase).toBe(1_200_000);
    expect(r.employee.cnss).toBe(48_000);
  });

  it('bareme progressif et quotient familial : plus de parts, moins d\'impot', () => {
    expect(progressiveTax(464_000, DEFAULT_PAYROLL_PARAMETERS.its.brackets)).toBe(4_640);
    expect(progressiveTax(1_000_000, DEFAULT_PAYROLL_PARAMETERS.its.brackets)).toBe(4_640 + 53_600);
    const one = computePayslip({ baseSalary: 500_000, taxParts: 1, zone: 'centre' });
    const three = computePayslip({ baseSalary: 500_000, taxParts: 3, zone: 'centre' });
    expect(three.employee.its).toBeLessThan(one.employee.its);
  });

  it('net = brut - retenues salariales ; cout employeur = brut + charges patronales', () => {
    const r = computePayslip({ baseSalary: 250_000, bonuses: 50_000, taxParts: 2, zone: 'centre' });
    expect(r.gross).toBe(300_000);
    expect(r.net).toBe(r.gross - r.employee.cnss - r.employee.camu - r.employee.its - r.employee.tol);
    expect(r.employerCost).toBe(r.gross + r.employer.total);
  });
});

describe('bulletin modele PHARMACIE GLORIA (juillet 2025)', () => {
  it('MASSALA Chancel, gardien de nuit 3e cat. : brut 84 642, net a payer 90 606', () => {
    const params = { ...DEFAULT_PAYROLL_PARAMETERS, camu: { employee: 0, employer: 0 }, tol: { centre: 0, peripherie: 0 } };
    const r = computePayslip({
      baseSalary: 65_700, seniorityRate: 6, taxParts: 2, zone: 'centre',
      earnings: [{ label: 'Prime de risque', amount: 15_000 }],
      allowances: [{ label: 'Allocations familiales / transport', amount: 25_000 }],
      deductions: [{ label: 'Pharmacie', amount: 15_000, kind: 'pharmacie' }],
    }, params);
    expect(r.lines.seniority).toBe(3_942);
    expect(r.gross).toBe(84_642);
    expect(r.employee.cnss).toBe(3_386);
    expect(r.lines.afterSocial).toBe(81_256);
    expect(r.lines.taxBaseMonthly).toBe(65_005);
    expect(r.employee.its).toBe(650);
    expect(r.net).toBe(80_606);
    expect(r.dueTotal).toBe(105_606);
    expect(r.netToPay).toBe(90_606);
  });
});
