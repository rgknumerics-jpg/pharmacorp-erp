# Phase 7 — Plan validé par l'analyse PharmaSys Pro + demandes du 07/10/2026

Principe : on **ajoute** des modules et des écrans, sans changer la structure existante de l'ERP.

## Lot A — Caisse (priorité 1)
1. **Caisse au clavier** : F2 recherche produit / scan, ↑↓ + Entrée pour choisir, +/- quantité, Suppr retire la ligne,
   F4 client, F8 encaisser, Échap annuler. Focus automatique sur le champ de scan après chaque action.
2. **Encaissement simplifié** : 3 boutons/touches — `1` Espèces, `2` Règlement groupé (un seul mode : MoMo, carte, chèque, assurance…),
   `3` Règlement multiple (répartition). On saisit **seulement le montant donné par le client** → rendu monnaie calculé et affiché en grand.
   Billets rapides (500, 1 000, 2 000, 5 000, 10 000) et « montant exact ».
3. **Caisse hors ligne** : catalogue en cache, ventes mises en file (clé d'idempotence), synchronisation automatique, voyant d'état.
4. **Ouverture / clôture de caisse** (fond de caisse, écart, rapport journalier), circuit **vendeur → caissier** (paniers en attente).
5. **Retour / échange** sur n° de ticket, remboursement espèces ou avoir ; la vente d'origine reste intacte.
6. **Proposition d'équivalent à la vente** : si un produit de **même DCI / dosage / forme** a un lot à péremption proche,
   la caisse suggère « Proposer plutôt X (périme le …) ». Suggestion seulement, la décision reste au pharmacien (loi 10/2010 substitution).

## Lot B — Fiche produit (priorité 2)
- Formulaire coloré par sections (Identification, Codes, Caractéristiques, Stock & prix, TVA).
- **Code-barres** : scan direct (douchette / caméra) ou saisie manuelle.
- **DCI** : liste déroulante dès 3 lettres (référentiel DCI de l'application Équivalence).
- **Laboratoire** : liste déroulante (fichier laboratoires à fournir + annuaire DPM « Tous les laboratoires »).
- **Familles thérapeutiques** reprises des applications Gardes/Équivalence.
- **TVA paramétrable** : plusieurs taux (18 %, exonéré, autres), produit taxable oui/non, coefficients de prix de vente automatiques (HT / TTC), arrondi.
- **CIP par fournisseur** (LABOREX, UBIPHARM, SEP/CEP…) en plus de l'EAN.
- Caractéristiques : stupéfiant, psychotrope, ordonnance, froid, photosensible, inflammable, zone de stockage ; stock minimum, sécurité, QEC.
- **Colisage** : nombre d'unités par carton (réception par carton → stock en unités).
- **Lotage / délotage (déconditionnement)** : vente à l'unité après ouverture d'une boîte, prix unitaire (loi 10/2010).

## Lot C — Stock (priorité 2)
- Tableaux « zébrés » (blanc / gris alterné), couleurs par statut (périmé, proche, rupture).
- Emplacements (rayons, zone froide 2–8 °C, stupéfiants, quarantaine), quarantaine et PV de destruction.
- Vente à découvert paramétrable (interdite pour stupéfiants).

## Lot D — Commandes fournisseurs (priorité 3)
- **Ordre de priorité des grossistes** (ex. LABOREX → UBIPHARM → SEP) : la commande part au 1er avec ses CIP ;
  les ruptures retournées basculent automatiquement au suivant, puis au suivant.
- Passerelle extranet grossistes : **à confirmer** (format/accès fourni par chaque grossiste). En attendant : fichier de commande
  par grossiste (CSV/Excel aux CIP) + message WhatsApp, et import du fichier de retour des ruptures.
- Réception par **import de BL** (fichier) ou **photo du BL** → OCR → contrôle → validation. Lecture des lots/péremptions
  placés sous chaque ligne (BL UBIPHARM).

## Lot E — Annuaires et conformité (priorité 4)
- Import des annuaires DPM fournis (HTML) : délégués médicaux (273), laboratoires, agences, dépôts, districts, formations sanitaires (FOSA).
- Annuaire des médecins prescripteurs, pharmacovigilance (déclarations), registre stupéfiants avec accès par code PIN, 2FA.
- Documents fournis (CGI 2019, loi 10/2010, politique pharmaceutique 2004, bonnes pratiques DPM, interactions) → Bibliothèque ;
  tout contenu médical (interactions, équivalences) reste **soumis à validation d'un pharmacien**.
