/**
 * Plan comptable SYSCOHADA revise (extrait utile a une officine / un commerce). Cree automatiquement pour chaque
 * tenant au premier usage ; le comptable peut ajouter des comptes. Les correspondances operation -> comptes sont
 * centralisees dans POSTING (source unique, ARCHITECTURE.md principe 7).
 */
export const SYSCOHADA_CHART: { code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'income' | 'expense' }[] = [
  { code: '101', name: 'Capital social', type: 'equity' },
  { code: '121', name: 'Report à nouveau (reprise des soldes)', type: 'equity' },
  { code: '311', name: 'Marchandises', type: 'asset' },
  { code: '401', name: 'Fournisseurs, dettes en compte', type: 'liability' },
  { code: '411', name: 'Clients', type: 'asset' },
  { code: '421', name: 'Personnel, avances et acomptes', type: 'asset' },
  { code: '462', name: 'Compte de l\'exploitant (dépenses personnelles à régulariser)', type: 'asset' },
  { code: '663', name: 'Indemnités forfaitaires versées au personnel', type: 'expense' },
  { code: '419', name: 'Clients, avances reçues et avoirs', type: 'liability' },
  { code: '422', name: 'Personnel, remunerations dues', type: 'liability' },
  { code: '431', name: 'Securite sociale (CNSS)', type: 'liability' },
  { code: '447', name: 'Etat, impots retenus a la source (ITS, TOL, CAMU, TUS)', type: 'liability' },
  { code: '4431', name: 'Etat, TVA facturee sur ventes', type: 'liability' },
  { code: '4452', name: 'Etat, TVA recuperable sur achats', type: 'asset' },
  { code: '521', name: 'Banques locales', type: 'asset' },
  { code: '5215', name: 'Mobile Money MTN', type: 'asset' },
  { code: '5216', name: 'Mobile Money Airtel', type: 'asset' },
  { code: '571', name: 'Caisse', type: 'asset' },
  { code: '6031', name: 'Variation des stocks de marchandises', type: 'expense' },
  { code: '604', name: 'Achats stockés de fournitures', type: 'expense' },
  { code: '605', name: 'Autres achats (eau, électricité, carburant)', type: 'expense' },
  { code: '618', name: 'Autres frais de transport', type: 'expense' },
  { code: '622', name: 'Locations et charges locatives', type: 'expense' },
  { code: '624', name: 'Entretien, réparations', type: 'expense' },
  { code: '625', name: 'Primes d\'assurance', type: 'expense' },
  { code: '627', name: 'Publicité, publications', type: 'expense' },
  { code: '628', name: 'Frais de télécommunications', type: 'expense' },
  { code: '631', name: 'Frais bancaires', type: 'expense' },
  { code: '641', name: 'Impots et taxes directs (TUS)', type: 'expense' },
  { code: '661', name: 'Remunerations directes versees au personnel', type: 'expense' },
  { code: '664', name: 'Charges sociales (CNSS, CAMU patronales)', type: 'expense' },
  { code: '658', name: 'Charges diverses (pertes, casse, peremption)', type: 'expense' },
  { code: '701', name: 'Ventes de marchandises', type: 'income' },
  { code: '709', name: 'Rabais, remises et ristournes accordés (fidélité)', type: 'income' },
  { code: '758', name: 'Produits divers (regularisations de stock)', type: 'income' },
];

export const POSTING = {
  sales: '701',
  vatCollected: '4431',
  customers: '411',
  suppliers: '401',
  stock: '311',
  stockVariation: '6031',
  stockLoss: '658',
  stockGain: '758',
  treasury: { cash: '571', card: '521', mtn_momo: '5215', airtel_money: '5216', cheque: '521', transfer: '521', other: '571' } as Record<string, string>,
} as const;

export const JOURNALS: Record<string, string> = { VE: 'Ventes', AC: 'Achats', CA: 'Caisse', BQ: 'Banque', MM: 'Mobile Money', OD: 'Operations diverses' };
export const journalOfMethod = (m: string) => (m === 'cash' || m === 'other' ? 'CA' : m === 'card' ? 'BQ' : 'MM');