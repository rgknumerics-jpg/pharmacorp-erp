/**
 * Etats financiers SYSCOHADA (Acte uniforme relatif au droit comptable, art. 29 a 31) a partir des soldes de comptes.
 * Presentation simplifiee du Systeme normal : bilan par grandes masses (art. 30) et compte de resultat en cascade
 * (marge commerciale, valeur ajoutee, EBE, resultat d'exploitation, financier, HAO, net). Ce n'est pas la liasse DSF :
 * un document de pilotage, a reprendre par l'expert-comptable pour le depot.
 */
export interface AccountBalance { account: string; name: string; debit: number; credit: number }

const sum = (rows: AccountBalance[], test: (a: string) => boolean, side: 'debit' | 'credit') =>
  rows.filter((r) => test(r.account)).reduce((s, r) => s + (side === 'debit' ? r.debit - r.credit : r.credit - r.debit), 0);
const starts = (...p: string[]) => (a: string) => p.some((x) => a.startsWith(x));

export function incomeStatement(rows: AccountBalance[]) {
  const ventesMarchandises = sum(rows, starts('701'), 'credit');
  const achatsMarchandises = sum(rows, starts('601', '6031'), 'debit'); // achats + variation de stock = cout des ventes
  const margeCommerciale = ventesMarchandises - achatsMarchandises;
  const autresVentes = sum(rows, (a) => a.startsWith('70') && !a.startsWith('701'), 'credit');
  const autresProduits = sum(rows, starts('71', '72', '73', '75'), 'credit');
  const consommations = sum(rows, (a) => /^6(0[2-9]|1|2|3)/.test(a) && !a.startsWith('6031'), 'debit');
  const valeurAjoutee = margeCommerciale + autresVentes + autresProduits - consommations - sum(rows, starts('65'), 'debit');
  const impotsTaxes = sum(rows, starts('64'), 'debit');
  const chargesPersonnel = sum(rows, starts('66'), 'debit');
  const ebe = valeurAjoutee - impotsTaxes - chargesPersonnel;
  const dotations = sum(rows, starts('68', '69'), 'debit'), reprises = sum(rows, starts('78', '79'), 'credit');
  const resultatExploitation = ebe - dotations + reprises;
  const resultatFinancier = sum(rows, starts('77'), 'credit') - sum(rows, starts('67'), 'debit');
  const resultatAO = resultatExploitation + resultatFinancier;
  const resultatHAO = sum(rows, (a) => a.startsWith('8') && /^8[2468]/.test(a), 'credit') - sum(rows, (a) => /^8[1357]/.test(a), 'debit');
  const impotResultat = sum(rows, starts('89'), 'debit');
  const resultatNet = resultatAO + resultatHAO - impotResultat;
  const chiffreAffaires = ventesMarchandises + autresVentes;
  return { chiffreAffaires, ventesMarchandises, achatsMarchandises, margeCommerciale, tauxMarge: ventesMarchandises ? Math.round((margeCommerciale / ventesMarchandises) * 1000) / 10 : 0, valeurAjoutee, impotsTaxes, chargesPersonnel, ebe, dotations, reprises, resultatExploitation, resultatFinancier, resultatAO, resultatHAO, impotResultat, resultatNet };
}

export function balanceSheet(rows: AccountBalance[]) {
  const bal = (r: AccountBalance) => r.debit - r.credit;
  const pick = (cls: string) => rows.filter((r) => r.account.startsWith(cls));
  const actifImmobilise = pick('2').reduce((s, r) => s + bal(r), 0);
  const stocks = pick('3').reduce((s, r) => s + bal(r), 0);
  const tiersDebit = pick('4').filter((r) => bal(r) > 0).reduce((s, r) => s + bal(r), 0);
  const tiersCredit = pick('4').filter((r) => bal(r) < 0).reduce((s, r) => s - bal(r), 0);
  const tresoActif = pick('5').filter((r) => bal(r) > 0).reduce((s, r) => s + bal(r), 0);
  const tresoPassif = pick('5').filter((r) => bal(r) < 0).reduce((s, r) => s - bal(r), 0);
  const capitaux = -pick('1').reduce((s, r) => s + bal(r), 0);
  const resultat = -rows.filter((r) => /^[678]/.test(r.account)).reduce((s, r) => s + bal(r), 0);
  const actif = { actifImmobilise, actifCirculant: stocks + tiersDebit, stocks, creances: tiersDebit, tresorerieActif: tresoActif };
  const passif = { capitauxPropres: capitaux + resultat, dontResultat: resultat, passifCirculant: tiersCredit, tresoreriePassif: tresoPassif };
  const totalActif = actif.actifImmobilise + actif.actifCirculant + actif.tresorerieActif;
  const totalPassif = passif.capitauxPropres + passif.passifCirculant + passif.tresoreriePassif;
  return { actif, passif, totalActif, totalPassif, equilibre: totalActif === totalPassif };
}

/** Acte uniforme art. 13 : SMT possible pour une entite de negoce dont le CA HT annuel est inferieur a 60 millions. */
export const SMT_THRESHOLD_TRADING = 60_000_000;
