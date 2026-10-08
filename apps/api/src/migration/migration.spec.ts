import { detectEntity, expenseAccount, qualityReport, suggestMapping, toDate, toNumber } from './mapping';
import { parseDbf, parseDelimited, parseSqlDump, readFile } from './readers';
import { upcomingGardes } from '../alerts/gardes';

/** Construit un petit fichier dBase III (format des anciens logiciels d'officine). */
function makeDbf(fields: [string, string, number][], rows: string[][]) {
  const headerLen = 32 + fields.length * 32 + 1, recordLen = 1 + fields.reduce((s, f) => s + f[2], 0);
  const buf = Buffer.alloc(headerLen + rows.length * recordLen + 1, 0x20);
  buf[0] = 0x03; buf.writeUInt32LE(rows.length, 4); buf.writeUInt16LE(headerLen, 8); buf.writeUInt16LE(recordLen, 10);
  for (let i = 4 + 4 + 4; i < 32; i++) buf[i] = 0;
  fields.forEach(([name, type, len], i) => { const off = 32 + i * 32; buf.fill(0, off, off + 32); buf.write(name, off, 'latin1'); buf[off + 11] = type.charCodeAt(0); buf[off + 16] = len; });
  buf[headerLen - 1] = 0x0d;
  rows.forEach((r, k) => { let pos = headerLen + k * recordLen; buf[pos++] = 0x20; fields.forEach(([, , len], i) => { buf.write((r[i] ?? '').padEnd(len).slice(0, len), pos, 'latin1'); pos += len; }); });
  buf[buf.length - 1] = 0x1a;
  return buf;
}

describe('lecture des fichiers d\'autres logiciels', () => {
  it('CSV point-virgule, guillemets, en-tete apres un titre', () => {
    const t = parseDelimited('Export clients - 2026\n\nNom;Téléphone;Plafond;Solde\n"Ngoma; Clarisse";06 555 44 33;50 000;12 500\nIbara;05 333 21 10;0;-3000\n')!;
    expect(t.columns).toEqual(['Nom', 'Téléphone', 'Plafond', 'Solde']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].Nom).toBe('Ngoma; Clarisse');
  });

  it('dBase (.dbf) : champs texte, numeriques, dates', () => {
    const dbf = makeDbf([['CODE', 'C', 8], ['DESIGNATIO', 'C', 30], ['PRIXVTE', 'N', 8], ['DATEPER', 'D', 8]], [['DOLI1G', 'DOLIPRANE 1G', '1500', '20280131'], ['AMOX', 'AMOXICILLINE 500', '2000', '20271015']]);
    const t = parseDbf(dbf, 'produits');
    expect(t.columns).toEqual(['CODE', 'DESIGNATIO', 'PRIXVTE', 'DATEPER']);
    expect(t.rows[1]).toEqual({ CODE: 'AMOX', DESIGNATIO: 'AMOXICILLINE 500', PRIXVTE: '2000', DATEPER: '2027-10-15' });
  });

  it('export SQL (INSERT INTO) avec CREATE TABLE', () => {
    const sql = "CREATE TABLE `clients` (\n `id` int,\n `nom` varchar(80),\n `solde` int,\n PRIMARY KEY (`id`)\n) ENGINE=InnoDB;\nINSERT INTO `clients` VALUES (1,'Ngoma Clarisse',12500),(2,'O''Brien',NULL);";
    const [t] = parseSqlDump(sql);
    expect(t.name).toBe('clients');
    expect(t.rows).toEqual([{ id: '1', nom: 'Ngoma Clarisse', solde: '12500' }, { id: '2', nom: "O'Brien", solde: '' }]);
  });

  it('Excel (.xlsx) multi-feuilles et SQLite', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Désignation', 'PV TTC', 'Prix achat', 'Famille'], ['Paracétamol 500', 500, 300, 'Antalgiques']]), 'Articles');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fournisseur', 'Téléphone', 'Délai paiement'], ['LABOREX', '06 400 11 22', 30]]), 'Fournisseurs');
    const x = await readFile(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'export.xlsx');
    expect(x.tables.map((t) => t.name)).toEqual(['Articles', 'Fournisseurs']);
    expect(x.tables[0].rows[0]['PV TTC']).toBe('500');

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE stock (code TEXT, qte INTEGER, lot TEXT, peremption TEXT); INSERT INTO stock VALUES (\'DOLI1G\', 24, \'L123\', \'31/01/2028\');');
    const s = await readFile(Buffer.from(db.export()), 'officine.db');
    expect(s.tables[0]).toMatchObject({ name: 'stock', rows: [{ code: 'DOLI1G', qte: '24', lot: 'L123', peremption: '31/01/2028' }] });
  });
});

describe('reconnaissance et correspondance des colonnes', () => {
  it.each([
    ['articles', ['Désignation', 'PV TTC', 'Prix achat', 'Famille', 'Code barre'], 'products'],
    ['stock', ['Code', 'Qté', 'Lot', 'Péremption'], 'stock'],
    ['clients', ['Nom', 'Téléphone', 'Plafond', 'Solde', 'Avoir'], 'customers'],
    ['fournisseurs', ['Fournisseur', 'Téléphone', 'Délai paiement'], 'suppliers'],
    ['ventes', ['Date', 'N° ticket', 'Produit', 'Qté', 'Montant'], 'sales'],
    ['depenses', ['Date', 'Libellé', 'Montant', 'Rubrique'], 'expenses'],
    ['releve', ['Date opération', 'Libellé', 'Débit', 'Crédit', 'Solde'], 'bank'],
  ])('%s -> %s', (name, cols, entity) => {
    expect(detectEntity(name, cols).entity).toBe(entity);
  });

  it('correspondance des champs', () => {
    expect(suggestMapping('customers', ['Nom', 'Téléphone', 'Plafond', 'Solde', 'Avoir'])).toEqual({ name: 'Nom', phone: 'Téléphone', creditLimit: 'Plafond', balance: 'Solde', storeCredit: 'Avoir' });
    expect(suggestMapping('stock', ['CODE', 'QTE', 'LOT', 'DLC'])).toMatchObject({ product: 'CODE', quantity: 'QTE', lotNumber: 'LOT', expiryDate: 'DLC' });
  });

  it('nombres, dates (Excel, JJ/MM/AAAA, MM/AAAA) et comptes de charges', () => {
    expect(toNumber('12 500 FCFA')).toBe(12500);
    expect(toNumber('1.250,50')).toBe(1250.5);
    expect(toDate('31/01/2028')).toBe('2028-01-31');
    expect(toDate('02/2027')).toBe('2027-02-28');
    expect(toDate('46000')).toBe('2025-12-09');
    expect(expenseAccount('Loyer octobre')).toBe('622');
    expect(expenseAccount('Facture E2C électricité')).toBe('605');
    expect(expenseAccount('Achat divers')).toBe('658');
  });

  it('rapport de qualite : obligatoires, doublons, peremptions manquantes', () => {
    const r = qualityReport('stock', { product: 'code', quantity: 'qte', expiryDate: 'exp' }, [{ code: 'A', qte: '3', exp: '' }, { code: 'A', qte: 'abc', exp: '01/2028' }, { code: '', qte: '1', exp: '' }]);
    expect(r.usable).toBe(2);
    expect(r.duplicates).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/sans date de péremption/);
    expect(r.issues.some((i) => /illisible/.test(i.message))).toBe(true);
  });
});

describe('lien Pharmacies de garde', () => {
  it('semaines de garde du groupe de la pharmacie (rotation en cycle)', () => {
    const city = { id: 'bzv', name: 'Brazzaville', rotation: { type: 'cycle' as const, anchor: '2026-10-05', anchorGroup: 1, groups: 4, weekStart: 1 } };
    const weeks = upcomingGardes(city, { id: 'p', cityId: 'bzv', name: 'P', kind: 'garde', group: 2 }, 8, new Date('2026-10-07T10:00:00Z'));
    expect(weeks).toEqual([{ start: '2026-10-12', end: '2026-10-18' }, { start: '2026-11-09', end: '2026-11-15' }]);
    expect(upcomingGardes(city, { id: 'n', cityId: 'bzv', name: 'N', kind: 'nuit', group: null }, 8)).toEqual([]);
  });
});
