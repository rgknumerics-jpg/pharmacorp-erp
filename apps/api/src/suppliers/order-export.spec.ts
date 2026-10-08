import { buildOrderFile, parseCatalogCsv, PRESETS, resolveFormat, similarity } from './order-export';

const LABOREX = 'CIP/EAN/ACL 13;Quantite;Description;DCI\n2268238;;GYNOFER SP FL/200ML;Fer,Vitamine b9\n8382633;Indisponible;B VIT FORT CP B/100;Vitamine b1\n1932571;;HALOPERIDOL TLG 5MG CP B/30;Halopéridol\n';
const SEP = '﻿"CIP";"Quantite";"Description";"DCI"\n"1416801";"Indisponible";"3HP KIT GEL/2 + CP/4 KIT/14";"TINIDAZOLE, CLARITHROMYCINE"\n"1560711";"";"A CERUMEN UNIDOSE 2ML B/10 AFR";""\n';

describe('fichiers de commande des grossistes', () => {
  it('lit le modèle Laborex (; sans guillemets, UTF-8 sans BOM) et apprend son format', () => {
    const p = parseCatalogCsv(Buffer.from(LABOREX, 'utf8'));
    expect(p.rows).toHaveLength(3);
    expect(p.rows[1]).toEqual({ cip: '8382633', designation: 'B VIT FORT CP B/100', dci: 'Vitamine b1', available: false });
    expect(p.rows[2].dci).toBe('Halopéridol');
    expect(p.format).toMatchObject({ separator: ';', quoteAll: false, bom: false, eol: 'lf', header: ['CIP/EAN/ACL 13', 'Quantite', 'Description', 'DCI'] });
  });

  it('lit le modèle SEP (tout entre guillemets, BOM)', () => {
    const p = parseCatalogCsv(Buffer.from(SEP, 'utf8'));
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0].designation).toBe('3HP KIT GEL/2 + CP/4 KIT/14');
    expect(p.rows[0].available).toBe(false);
    expect(p.format).toMatchObject({ quoteAll: true, bom: true, header: ['CIP', 'Quantite', 'Description', 'DCI'] });
  });

  it('écrit un fichier de commande identique au modèle de chaque grossiste', () => {
    const lines = [{ cip: '2268238', quantite: 3, designation: 'GYNOFER SP FL/200ML', dci: 'Fer' }, { cip: '1560711', quantite: 10, designation: 'A "CERUMEN" 2ML', dci: '' }];
    const lab = buildOrderFile(PRESETS.laborex, lines);
    expect(lab.text).toBe('CIP/EAN/ACL 13;Quantite;Description;DCI\n2268238;3;GYNOFER SP FL/200ML;Fer\n1560711;10;"A ""CERUMEN"" 2ML";\n');
    expect(lab.bytes[0]).not.toBe(0xef);
    const sep = buildOrderFile(PRESETS.sep, lines);
    expect(sep.text.split('\n')[0]).toBe('"CIP";"Quantite";"Description";"DCI"');
    expect(sep.text.split('\n')[1]).toBe('"2268238";"3";"GYNOFER SP FL/200ML";"Fer"');
    expect([...sep.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('un format appris puis relu donne le même fichier', () => {
    const learned = parseCatalogCsv(Buffer.from(SEP, 'utf8')).format;
    const out = buildOrderFile(resolveFormat(JSON.parse(JSON.stringify(learned))), [{ cip: '1', quantite: 2, designation: 'X', dci: '' }]);
    expect(out.text).toBe('"CIP";"Quantite";"Description";"DCI"\n"1";"2";"X";""\n');
  });

  it('refuse un fichier sans colonne CIP', () => {
    expect(() => parseCatalogCsv(Buffer.from('a;b\n1;2\n'))).toThrow();
  });

  it('rapproche les désignations proches mais jamais deux dosages différents', () => {
    expect(similarity('ARTEFAN 80/480 CP B/6', 'Artefan comprimé 80/480 B/6')).toBeGreaterThanOrEqual(60);
    expect(similarity('AMOXICILLINE 500MG GEL B/12', 'AMOXICILLINE 1G CP B/12')).toBe(0);
    expect(similarity('PARACETAMOL 500MG CP B/16', 'PARACETAMOL 500MG CP B/16')).toBe(100);
  });
});
