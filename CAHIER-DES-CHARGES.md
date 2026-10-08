# PHARMACORP ERP — Cahier des charges fonctionnel

**Objet** : décrire tout ce que l'ERP PHARMACORP doit savoir faire, pas seulement ses écrans. PHARMACORP n'est pas un logiciel de caisse : c'est un **outil de pilotage** de l'officine (et demain d'autres commerces) qui dit *quoi faire* et *pourquoi*, en s'appuyant sur les données.

Référence technique : [ARCHITECTURE.md](./ARCHITECTURE.md). État et procédure : [README.md](./README.md).

Légende d'avancement (au 08/10/2026) : **✅ fait et testé** · **🟡 partiel** · **⬜ à faire**.

---

## 0. Principes transverses

| Principe | Exigence | État |
| --- | --- | --- |
| Pilotage avant saisie | Chaque écran répond à « que dois-je faire maintenant ? » (alertes, recommandations chiffrées) | 🟡 cockpit, conseiller, risques, réappro |
| Traçabilité totale | Toute action sensible est journalisée, non modifiable : qui, quoi, quand, avant/après | ✅ |
| Isolation des pharmacies | Chaque officine ne voit jamais les données d'une autre (sécurité en base, pas seulement à l'écran) | ✅ |
| Jamais bloquer la vente | Panne Internet, SFEC, Mobile Money, Redis : la caisse continue, avec un état « en attente » corrigeable | 🟡 (hors ligne complet à faire) |
| Décision humaine | Les propositions (OCR, commandes, conseils, IA) sont validées par une personne ; les données de santé restent sous contrôle du pharmacien | ✅ |
| Conformité Congo / OHADA | SYSCOHADA, CGI (LF 2026), CNSS, CAMU, SFEC, conservation 10 ans | 🟡 |
| Montants en FCFA | Entiers, sans centimes | ✅ |
| Téléphones | Format +242 0X XXX XX XX, le 0 est conservé (WhatsApp) | ✅ |

---

## 1. Ventes et caisse

**Doit savoir faire**
- Vente rapide au comptoir : lecture code-barres, recherche nom/DCI, panier, remises autorisées par rôle. ✅
- Sortie automatique **FEFO** (premier périmé, premier sorti) ; dérogation tracée avec motif. ✅
- Lots périmés et lots « à valider » jamais vendables. ✅
- Paiements multiples par vente : espèces (rendu monnaie), carte, MTN MoMo, Airtel Money, crédit client, tiers payant. ✅
- Mobile Money **asynchrone** : vente « en attente » tant que l'opérateur n'a pas confirmé ; confirmation manuelle ou par notification signée. ✅
- Annulation et remboursement avec motif obligatoire, remise en stock dans les mêmes lots, contre-passation comptable, avoir SFEC. ✅
- Ticket imprimable ; facture normalisée SFEC. ✅ (impression A4 / ticket 80 mm personnalisable ⬜)
- **Comptage de caisse** : montant compté vs attendu, écart signalé. ✅ (clôture de caisse par session et par caissier ⬜)
- Vente **hors ligne** avec synchronisation (clé anti-doublon déjà en place). 🟡
- Ordonnance requise : signalement et saisie dans l'ordonnancier. ✅
- Promotions (voir §13). ⬜

## 2. Achats et fournisseurs — aide à l'achat

**Doit savoir faire**
- Fournisseurs avec **conditions de paiement** (0 = comptant, sinon N jours) et délai de livraison annoncé. ✅
- Commandes fournisseurs, réceptions totales ou partielles, création des lots, mise à jour du dernier prix d'achat. ✅
- **Factures fournisseurs** créées à la réception, échéance calculée (comptant / N jours) **modifiable à la main**, règlements partiels, écriture comptable. ✅
- Analyse par fournisseur : prix moyen, **évolution des prix**, **délai moyen** (et son évolution), **taux de livraison complète**, **taux de retard**, **produits manquants**, conditions de paiement, historique, **marge obtenue**, reste dû. ✅ (remises négociées par fournisseur ⬜)
- Messages d'aide à l'achat : « 🟢 Fournisseur A est 7,4 % moins cher que B sur votre panier habituel », « ⚠️ Le délai moyen de X est passé de 5 à 11 jours ». ✅
- **Proposition de commande** par fournisseur (voir §4). ✅
- Envoi de la commande au fournisseur (WhatsApp / e-mail / connecteur EDI). ⬜
- Connecteurs grossistes (catalogue, disponibilité, prix) avec surveillance. ⬜

## 3. Stock, lots, péremptions, inventaire

- Stock = somme de mouvements (jamais un solde écrit). ✅
- Lots avec date de péremption, statut (disponible, à valider, bloqué). ✅
- Alertes péremption 30/60/90/180 jours ; valeur du stock à risque. ✅
- Ajustements (casse, perte, rebut, correction) avec motif obligatoire. ✅
- **Inventaire** : tournant ou complet, saisie par scan, écarts valorisés et validés par un responsable. 🟡 (écarts via ajustements ; module d'inventaire dédié ⬜)
- Seuils d'alerte par produit, tolérance de survente. ✅
- Multi-emplacements (réserve, rayon, frigo). ⬜

## 4. Prévision et réapprovisionnement

```
VENTES HISTORIQUES + SAISONNALITÉ + STOCK ACTUEL + DÉLAI FOURNISSEUR + STOCK DE SÉCURITÉ
        → PRÉVISION → QUANTITÉ À COMMANDER
```

- Demande journalière (moyennes 30 j / 90 j sur l'historique réel du produit). ✅
- Saisonnalité (même période l'an dernier, bornée ×0,5 à ×2, dès 1 an d'historique). ✅
- Délai fournisseur **observé** (commande → réception), à défaut le délai annoncé. ✅
- Stock de sécurité (≈ 95 % de service). ✅
- Résultats parlants : « ⚠️ Amoxicilline 500 mg risque d'être en rupture dans 8 jours », « 📦 4,2 mois de stock », statut rupture / critique / à commander / surstock / sans vente. ✅
- **Semaines de garde** : périodes saisies (ou synchronisées depuis l'application Pharmacies de garde ⬜), hausse de demande paramétrable, **renfort proposé 4 jours avant**. ✅
- Validation de la proposition en commande fournisseur en un clic. ⬜

## 5. Prix et marges

- Prix de vente fixe ou **prix libre** ; TVA par produit. ✅
- Coût d'achat figé à chaque vente (marge fiable). ✅
- Marge par produit, par famille, par fournisseur, par point de vente. ✅
- Alertes : **prix de vente inférieur au prix d'achat**, **marge anormale**, **modification suspecte de prix** (> 20 %). ✅
- « Ce produit représente 8 % du CA mais seulement 2 % de la marge ». ✅
- Historique des prix d'achat par fournisseur. ✅
- Gestion des prix réglementés (base officielle des prix publics). ⬜

## 6. Clients, crédit, tiers payant

- Fichier clients, plafond de crédit, délai de paiement, encaissement de créances. ✅
- **Balance âgée** (0-30, 31-60, 61-90, > 90 j), relance WhatsApp pré-remplie. ✅
- **Tiers payant** : organismes, taux de prise en charge, part organisme à la caisse, relevé, règlements. ✅
- Statistiques : nouveaux, actifs, inactifs, fréquence, panier moyen, **segmentation** (fidèles, actifs récents, à relancer, perdus). ✅
- Fidélité (points, avantages) et historique d'achats par client consultable au comptoir. ⬜
- Consentement et confidentialité des données de santé. 🟡

## 7. Ordonnances

- Ordonnancier : n°, patient, prescripteur, établissement, date, lien vers la vente et les lots délivrés. ✅
- Renouvellements, ordonnances à délivrance fractionnée, scan de l'ordonnance (OCR). ⬜
- Interactions médicamenteuses : **uniquement à partir d'une base médicale validée** ; alerte, jamais blocage automatique. ⬜

## 8. Comptabilité (SYSCOHADA)

- Écritures générées automatiquement (ventes, encaissements, achats, règlements fournisseurs, tiers payant, paie, pertes de stock). ✅
- Écritures **non modifiables** ; correction par contre-passation uniquement. ✅
- Balance, grand livre, journaux, opérations diverses, rapprochement ventes ↔ comptabilité. ✅
- États financiers : compte de résultat en cascade, bilan (Acte uniforme art. 29-31), indication SMT. ✅ (tableau des flux de trésorerie, notes annexes ⬜)
- Rapprochement bancaire, immobilisations et amortissements, clôture d'exercice et à-nouveaux. ⬜
- Export pour l'expert-comptable (FEC/Excel). ⬜

## 9. Banque, Mobile Money, trésorerie

- Comptes caisse, banque, MTN MoMo, Airtel Money (soldes en temps réel). ✅
- Notifications opérateurs signées, rejeu sans effet, contrôle du montant. ✅
- **Prévision de trésorerie** 30 / 60 / 90 jours (ventes moyennes, créances, factures fournisseurs, salaires). ✅ (intégration des impôts estimés ⬜)
- Relevés bancaires importés et rapprochés. ⬜

## 10. Tableau de bord financier — « où va l'argent »

```
CA → coût d'achat → MARGE BRUTE → salaires → loyers → impôts et taxes → pertes → autres dépenses → RÉSULTAT
```

- Cascade du CA au résultat sur une période. ✅
- Trésorerie, prévision, dettes, créances, fournisseurs, échéances, dépenses, charges. ✅
- Marges par produit / famille / fournisseur / point de vente. ✅

## 11. Cockpit de pilotage

- 🟢 **Santé** : CA jour / semaine / mois, évolution, marge brute, taux, bénéfice estimé, trésorerie, créances, dettes fournisseurs, valeur du stock. ✅
- 📦 **Stock** : valeur, dormant (et son évolution), faible, ruptures, bientôt périmés, valeur des périmés, rotation, couverture en jours, à commander, surstock. ✅
- 💰 **Commercial** : plus vendus, plus rentables, forte / faible rotation, panier moyen, tickets, trafic, ventes par heure, par vendeur, par famille, par laboratoire. ✅
- 👥 **Clients** : nouveaux, actifs, inactifs, fréquence, segmentation. ✅
- 🔴 **Risques immédiats** : rupture, péremption, stock négatif, écart d'inventaire, prix de vente < prix d'achat, marge anormale, vente sans stock, modification suspecte de prix, annulation inhabituelle, remboursement inhabituel, caisse incohérente, activité anormale d'un utilisateur. ✅

## 12. Fiscalité et social

- Calendrier officiel 2026 (note ACPCE, LF 2026) filtré selon le profil ; report au dernier jour ouvré ; estimation des montants ; suivi déclaré / payé avec quittance. ✅
- Bandeau d'alerte animé à J-30, J-14, J-7, puis retard. ✅
- Télédéclaration E-TAX / télépaiement FOUTA. ⬜ (dépend des interfaces de l'administration)
- SFEC : facture normalisée, mode dégradé, avoirs. ✅ (branchement à l'API officielle dès publication de la spécification ⬜)

## 13. Promotions

- Remises par produit, famille, période, quantité ; offres groupées ; coupons. ⬜
- Mesure de l'effet d'une promotion sur le CA et la marge. ⬜

## 14. RH et paie

- Salariés, bulletins, CNSS 24,28 %, CAMU, TUS, TOL, ITS ; écriture de paie ; montants repris par le calendrier fiscal. ✅ (taux et barème à confirmer par un comptable)
- Contrats, congés, absences, plannings (dont gardes), primes d'ancienneté selon la convention collective des officines. ⬜
- DAS annuelle, bordereau CNSS au format de l'administration. ⬜

## 15. Formation des équipes

- Conseil du jour et quiz quotidiens (techniques de vente, panier moyen et conseil associé, contrôle des péremptions avant délivrance, bonnes pratiques officinales, accueil, rigueur de caisse). ✅
- Contenus **validés par un pharmacien** avant diffusion ; l'officine ajoute ses propres conseils associés. ✅
- Progression individuelle et d'équipe. ✅
- Parcours d'intégration des nouveaux, badges, rappels. ⬜

## 16. Utilisateurs, rôles, sécurité

- Rôles : titulaire, gérant, pharmacien, caissier / auxiliaire, comptable ; permissions fines. ✅
- Second valideur obligatoire pour les opérations sensibles (lots douteux, OCR peu fiable). ✅
- Double authentification pour les comptes à privilèges, sessions révocables, cookie sécurisé. 🟡
- Gestion des utilisateurs depuis l'interface. 🟡 (API faite, écran ⬜)

## 17. Audit et conformité

- Journal non modifiable : qui a créé, modifié, annulé, vendu, remboursé, changé un prix, modifié un stock, validé un achat, restauré une sauvegarde ; filtres par type et date ; prix avant/après. ✅
- Bibliothèque juridique et fiscale consultable à tout moment. ✅ (recherche dans le texte des documents scannés ⬜)
- Profil légal facultatif (NIU, RCCM, autorisation d'exercice, CNSS…) et documents. ✅
- Conservation 10 ans (Acte uniforme art. 24), archivage. 🟡

## 18. Sauvegardes et restauration

- Sauvegarde manuelle et **automatique** (6 h, 12 h, jour, semaine), copie sur le serveur et **Google Drive** (accès limité aux fichiers créés par l'application). ✅ (activation Drive : identifiants Google à créer)
- Téléchargement de toute sauvegarde. ✅
- **Restauration** confirmée par l'identifiant de l'officine, **sauvegarde de sécurité automatique** juste avant, comptes et journal d'audit jamais écrasés. ✅

## 19. Livraisons

- Commandes clients à livrer, affectation livreur, suivi, preuve de livraison, paiement à la livraison. ⬜ (application livreur prévue)

## 20. Multi-pharmacies

- Une même personne gère plusieurs officines (déjà possible : un compte, plusieurs établissements). ✅
- Vue consolidée groupe, transferts de stock entre officines, comparaison des points de vente. ⬜

## 21. OCR

- Bons de livraison, factures, étiquettes de péremption ; lecture dans le navigateur (gratuite) ou serveur ; rapprochement catalogue ; validation humaine. ✅

## 22. Conseiller et intelligence

- Conseiller de gestion à règles (trésorerie, fiscalité légale, stock, crédit, marges, conformité). ✅
- Assistant conversationnel s'appuyant sur la bibliothèque juridique et les données (avec citations des textes). ⬜

## 23. Notifications

- Bandeau fiscal, cockpit, risques. ✅
- Notifications push / e-mail / WhatsApp des alertes critiques (rupture, retard fiscal, écart de caisse) aux bonnes personnes. ⬜

## 24. API et intégrations

- API REST documentée (Swagger `/api/docs`), versionnée, isolée par officine. ✅
- Liens avec l'écosystème : CRM PHARMACORP, Pharmacies de garde (gardes, disponibilité), Équivalence (catalogue, équivalences). ⬜
- Webhooks sortants pour partenaires. ⬜

## 25. Versions en ligne et client-serveur

- Version en ligne (hébergée) et version client-serveur (serveur dans l'officine, postes en réseau local) à partir du même code (Docker). 🟡 (conteneurs prêts, guide d'installation officine ⬜)

---

### Priorités proposées pour la suite

1. Vente hors ligne et synchronisation (sécurité de la caisse en cas de coupure).
2. Module d'inventaire dédié et clôture de caisse par caissier.
3. Promotions et fidélité.
4. Commande fournisseur en un clic depuis la proposition + envoi WhatsApp / e-mail.
5. RH complète (congés, plannings de garde, convention collective).
6. Notifications push / WhatsApp des alertes critiques.
7. Liens avec Pharmacies de garde (synchronisation des gardes) et le CRM.
