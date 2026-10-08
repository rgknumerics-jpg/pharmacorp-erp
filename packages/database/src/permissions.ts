/**
 * Catalogue de permissions (RBAC, ARCHITECTURE.md section 9).
 * Source unique partagee entre le seed et l'API (@erp/api importe ce module via @erp/database).
 */
export const PERMISSIONS = [
  { code: 'users.read', description: 'Consulter les utilisateurs du tenant' },
  { code: 'users.write', description: 'Creer/modifier/desactiver un utilisateur du tenant' },
  { code: 'roles.read', description: 'Consulter les roles et permissions' },
  { code: 'roles.write', description: 'Creer/modifier les roles et leurs permissions' },
  { code: 'audit.read', description: "Consulter le journal d'audit du tenant" },
  { code: 'tenant.manage', description: 'Modifier les parametres du tenant' },

  // --- P1 : catalogue, stock, clients, achats, ventes ---
  { code: 'products.read', description: 'Consulter le catalogue produits' },
  { code: 'products.write', description: 'Creer/modifier les produits et categories' },
  { code: 'cost.read', description: "Voir les prix d'achat, couts et marges (donnee sensible)" },
  { code: 'stock.read', description: 'Consulter le stock, les lots et les peremptions' },
  { code: 'stock.write', description: 'Saisir des ajustements, pertes et sorties de stock' },
  { code: 'stock.validate_lot', description: 'Valider un lot a faible confiance (2e role, jamais celui qui a scanne)' },
  { code: 'customers.read', description: 'Consulter les clients' },
  { code: 'customers.write', description: 'Creer/modifier les clients et leur plafond de credit' },
  { code: 'purchases.read', description: 'Consulter fournisseurs, commandes et receptions' },
  { code: 'purchases.write', description: 'Creer des commandes fournisseurs et enregistrer des receptions' },
  { code: 'sales.read', description: 'Consulter les ventes et paiements' },
  { code: 'sales.create', description: 'Encaisser une vente (POS)' },
  { code: 'sales.discount', description: 'Accorder une remise à la caisse' },
  { code: 'sales.void', description: 'Annuler une vente (remise en stock, extourne du credit)' },
  { code: 'reports.read', description: 'Consulter le tableau de bord et les rapports' },

  // --- OCR (bons de livraison, factures, dates de peremption) ---
  { code: 'ocr.use', description: 'Numeriser un document et lancer son analyse OCR' },
  { code: 'ocr.validate', description: 'Valider ou rejeter le resultat d\'une analyse OCR' },

  // --- P3 : comptabilite et facturation normalisee ---
  { code: 'accounting.read', description: 'Consulter journaux, grand livre et balance' },
  { code: 'accounting.write', description: 'Saisir des operations diverses, contre-passer, traiter la file comptable' },
  { code: 'sfec.read', description: 'Consulter les factures normalisees (SFEC)' },
  { code: 'sfec.manage', description: 'Relancer la certification SFEC' },

  // --- P4 : pilotage ---
  { code: 'company.manage', description: 'Completer le profil legal et deposer les documents de la structure' },
  { code: 'tax.read', description: 'Voir le calendrier fiscal et social et les alertes d echeance' },
  { code: 'tax.manage', description: 'Marquer une echeance comme declaree / payee' },
  { code: 'payroll.read', description: 'Consulter la paie et les bulletins' },
  { code: 'payroll.write', description: 'Gerer les salaries, calculer et valider la paie' },
  { code: 'advisor.read', description: 'Consulter le conseiller de gestion et d optimisation' },

  // --- P5 : cockpit, achats, formation, sauvegardes ---
  { code: 'analytics.read', description: 'Cockpit de pilotage : finances, marges, previsions, risques' },
  { code: 'training.use', description: 'Suivre les formations (quiz et conseils)' },
  { code: 'training.manage', description: 'Rediger et valider les contenus de formation (pharmacien)' },
  { code: 'migration.run', description: 'Importer les données d un autre logiciel (fichiers, bases)' },
  { code: 'inventory.manage', description: 'Ouvrir, compter et valider un inventaire' },
  { code: 'promotions.manage', description: 'Créer les promotions et régler la fidélité' },
  { code: 'hr.manage', description: 'Congés, plannings et contrats du personnel' },
  { code: 'backup.manage', description: 'Sauvegarder et restaurer les donnees (Google Drive)' },

  // --- Droits fins par onglet (gestion des roles) ---
  { code: 'plants.read', description: 'Voir les conseils plantes et complements (fiche produit, caisse, conseil du jour)' },
  { code: 'finance.read', description: 'Consulter les finances (cascade de tresorerie, previsions)' },
  { code: 'directory.read', description: 'Consulter les annuaires sante' },
  { code: 'library.read', description: 'Consulter la bibliotheque juridique et reglementaire' },
  { code: 'company.view', description: 'Consulter la structure (profil, documents, parametres des tickets)' },
  { code: 'customers.collect', description: 'Encaisser les reglements des clients (credit, bons de pharmacie)' },
  { code: 'sales.credit', description: 'Vendre a credit / delivrer un bon de pharmacie' },
  { code: 'sales.ticket', description: 'Vendeur : saisir la vente (ticket) et l envoyer a la caisse' },
  { code: 'online.manage', description: 'Choisir les produits visibles sur le site et l application client' },
] as const;

/** Présentation des droits dans l'écran « Équipe et accès » : rubrique + libellé français. */
export const PERMISSION_META: Record<string, { group: string; label: string }> = {
  'reports.read': { group: 'Pilotage', label: 'Tableau de bord' },
  'analytics.read': { group: 'Pilotage', label: 'Cockpit de pilotage (marges, prévisions, risques)' },
  'advisor.read': { group: 'Pilotage', label: 'Conseiller de gestion' },
  'plants.read': { group: 'Pilotage', label: 'Conseil plantes et compléments' },
  'sales.create': { group: 'Caisse et ventes', label: 'Caisse : encaisser les tickets, ouvrir et fermer la caisse (POS)' },
  'sales.ticket': { group: 'Caisse et ventes', label: 'Vendeur : saisir la vente et l’envoyer à la caisse' },
  'online.manage': { group: 'Produits et stock', label: 'Boutique en ligne : choisir les produits visibles' },
  'sales.discount': { group: 'Caisse et ventes', label: 'Accorder une remise à la caisse' },
  'sales.credit': { group: 'Caisse et ventes', label: 'Vendre à crédit / bon de pharmacie' },
  'sales.void': { group: 'Caisse et ventes', label: 'Annuler une vente' },
  'sales.read': { group: 'Caisse et ventes', label: 'Consulter les ventes' },
  'products.read': { group: 'Produits et stock', label: 'Voir les produits' },
  'products.write': { group: 'Produits et stock', label: 'Créer / modifier les produits' },
  'cost.read': { group: 'Produits et stock', label: 'Voir les prix d\'achat et les marges' },
  'stock.read': { group: 'Produits et stock', label: 'Voir le stock et les péremptions' },
  'stock.write': { group: 'Produits et stock', label: 'Ajuster le stock (pertes, sorties, transferts)' },
  'stock.validate_lot': { group: 'Produits et stock', label: 'Valider un lot (2e contrôle)' },
  'inventory.manage': { group: 'Produits et stock', label: 'Inventaires' },
  'promotions.manage': { group: 'Produits et stock', label: 'Promotions et fidelite' },
  'purchases.read': { group: 'Achats et réception', label: 'Achats intelligents : voir fournisseurs et commandes' },
  'purchases.write': { group: 'Achats et réception', label: 'Passer des commandes et enregistrer des réceptions' },
  'ocr.use': { group: 'Achats et réception', label: 'Réception / OCR : numeriser un document' },
  'ocr.validate': { group: 'Achats et réception', label: 'Réception / OCR : valider le resultat' },
  'customers.read': { group: 'Clients', label: 'Voir les clients' },
  'customers.write': { group: 'Clients', label: 'Créer / modifier les clients et plafonds de credit' },
  'customers.collect': { group: 'Clients', label: 'Encaisser les règlements des clients' },
  'finance.read': { group: 'Finances et comptabilité', label: 'Finances (trésorerie, prévisions)' },
  'accounting.read': { group: 'Finances et comptabilité', label: 'Comptabilité : consulter' },
  'accounting.write': { group: 'Finances et comptabilité', label: 'Comptabilité : saisir et contre-passer' },
  'sfec.read': { group: 'Finances et comptabilité', label: 'Factures normalisées : consulter' },
  'sfec.manage': { group: 'Finances et comptabilité', label: 'Factures normalisées : gérer' },
  'tax.read': { group: 'Finances et comptabilité', label: 'Calendrier fiscal : consulter' },
  'tax.manage': { group: 'Finances et comptabilité', label: 'Calendrier fiscal : déclarer / payer' },
  'payroll.read': { group: 'Personnel', label: 'Paie : consulter' },
  'payroll.write': { group: 'Personnel', label: 'Paie : gérer et valider' },
  'hr.manage': { group: 'Personnel', label: 'Congés, plannings, contrats' },
  'training.use': { group: 'Formation', label: 'Suivre les formations' },
  'training.manage': { group: 'Formation', label: 'Rédiger et valider les formations' },
  'audit.read': { group: 'Administration', label: 'Journal d\'audit' },
  'migration.run': { group: 'Administration', label: 'Reprise des données' },
  'backup.manage': { group: 'Administration', label: 'Sauvegardes' },
  'users.read': { group: 'Administration', label: 'Équipe et accès : voir' },
  'users.write': { group: 'Administration', label: 'Équipe et accès : créer / modifier les agents' },
  'roles.read': { group: 'Administration', label: 'Rôles : voir' },
  'roles.write': { group: 'Administration', label: 'Rôles : créer / modifier les droits' },
  'directory.read': { group: 'Administration', label: 'Annuaires santé' },
  'company.view': { group: 'Administration', label: 'Ma structure : consulter' },
  'company.manage': { group: 'Administration', label: 'Ma structure : modifier (logo, tickets, documents)' },
  'library.read': { group: 'Administration', label: 'Bibliothèque' },
  'tenant.manage': { group: 'Administration', label: 'Paramètres de l\'établissement (TVA, prix)' },
};
export const PERMISSION_GROUPS = ['Pilotage', 'Caisse et ventes', 'Produits et stock', 'Achats et réception', 'Clients', 'Finances et comptabilité', 'Personnel', 'Formation', 'Administration'];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

const ALL = PERMISSIONS.map((p) => p.code) as PermissionCode[];

/** Roles standard crees pour chaque nouveau tenant, avec leur jeu de permissions par defaut. */
export const DEFAULT_ROLES: Record<string, PermissionCode[]> = {
  owner: ALL,
  manager: ALL.filter((c) => c !== 'tenant.manage' && c !== 'roles.write' && c !== 'users.write'),
  pharmacist: [
    'products.read', 'products.write', 'stock.read', 'stock.write', 'stock.validate_lot',
    'customers.read', 'customers.write', 'purchases.read', 'purchases.write',
    'sales.read', 'sales.create', 'sales.discount', 'reports.read', 'ocr.use', 'ocr.validate', 'tax.read', 'advisor.read', 'analytics.read', 'training.use', 'training.manage', 'audit.read', 'inventory.manage', 'promotions.manage',
    'plants.read', 'finance.read', 'directory.read', 'library.read', 'company.view', 'customers.collect', 'sales.credit', 'sales.ticket', 'online.manage',
  ],
  seller: ['products.read', 'stock.read', 'customers.read', 'customers.write', 'sales.read', 'sales.ticket', 'plants.read', 'training.use', 'library.read'],
  cashier: ['products.read', 'stock.read', 'customers.read', 'customers.write', 'sales.read', 'sales.create', 'training.use', 'plants.read', 'sales.credit', 'customers.collect', 'library.read'],
  accountant: ['products.read', 'cost.read', 'purchases.read', 'sales.read', 'reports.read', 'audit.read', 'accounting.read', 'accounting.write', 'sfec.read', 'sfec.manage', 'tax.read', 'tax.manage', 'payroll.read', 'payroll.write', 'advisor.read', 'analytics.read', 'migration.run', 'hr.manage', 'finance.read', 'library.read', 'company.view'],
  employee: ['training.use', 'library.read'],
};
