export const fcfa = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('fr-FR')} FCFA`;
export const dateFr = (s: string | Date | null | undefined) => (s ? new Date(s).toLocaleDateString('fr-FR') : '—');
export const dateTimeFr = (s: string | Date | null | undefined) => (s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const PAY_LABEL: Record<string, string> = { cash: 'Espèces', card: 'Carte', cheque: 'Chèque', transfer: 'Virement', mtn_momo: 'MTN MoMo', airtel_money: 'Airtel Money', credit: 'Crédit client', insurer: 'Tiers payant', other: 'Autre' };
export const SALE_STATUS: Record<string, string> = { completed: 'Payée', awaiting_payment: 'En attente de paiement', void: 'Annulée' };