# ARCHITECTURE.md

**Statut : référence technique officielle du projet [NOM DU PROJET].**
Toute implémentation future (backend, apps, connecteurs, IA) doit respecter ce document. Une divergence doit passer par une mise à jour explicite de ce fichier avant d'être codée, pas l'inverse.

Ce document est la synthèse finale de deux étapes précédentes : le dossier d'architecture initial (40 sections) et l'audit critique qui l'a suivi. Les décisions ci-dessous intègrent les corrections issues de l'audit (marquées **[V2]**) : elles remplacent, et non complètent, les intentions initiales correspondantes.

Aucun code métier n'est produit à partir de ce document pour l'instant. Il fige les décisions structurelles avant le développement.

---

## 0. Portée du MVP

Le MVP cible **un seul pays (Congo) et un seul vertical (pharmacie)**. Le multi-vertical et le multi-pays sont des propriétés de l'architecture, pas des livrables du MVP. **[V2]** Le multi-pays simultané dès le MVP est explicitement écarté : chaque pays ajoute une charge fiscale et réglementaire réelle qui doit être absorbée une fois, en production, avant d'en ajouter un second.

Sont hors MVP (cf. audit, section « fonctionnalités prématurées ») : essayage virtuel AR, pharmacovigilance automatisée, marketing IA génératif, recommandation IA de montures, scoring fournisseurs/clients par IA, signature électronique et workflows d'approbation avancés.

---

## 1. Principes non négociables

1. Un seul backend API-first ; aucune application ne possède sa propre base métier.
2. Isolation tenant **vérifiée en base**, pas seulement en application. **[V2]**
3. L'IA n'a jamais d'accès direct à PostgreSQL, et aucun tool IA n'est générique. **[V2]**
4. Toute donnée de santé envoyée à un modèle externe est anonymisée au préalable, ou reste sur un modèle local. **[V2]**
5. Le pharmacien garde la décision finale sur toute alerte clinique ; l'IA ne bloque jamais une vente d'elle-même.
6. Un module désactivé masque son UI et bloque ses endpoints, il ne supprime jamais de données.
7. Aucune règle fiscale ou métier n'est dupliquée à deux endroits (le moteur fiscal est la source unique, consommé par la comptabilité et par le connecteur SFEC).
8. Toute intégration externe (paiement, fournisseur, SFEC) prévoit explicitement son mode d'échec, pas seulement son cas heureux. **[V2]**

---

## 2. Architecture générale

```text
CLIENTS FINAUX (app client, identité unique)
        |
   +----+----+----+
   |         |         |
APP LIVREUR  APP SANTE  APP CLIENT
   |         |         |
   +----+----+----+
        |
        v
+----------------------------------------------------+
|            BACKEND CENTRAL (API-first)              |
|  multi-tenant . multi-entreprise . multi-site        |
+----------------------------------------------------+
   |        |        |        |        |
   v        v        v        v        v
ERP WEB  AI GATEWAY  CONNECT. HUB  PAIEMENT GW  FISCAL/SFEC
   |        |        |        |        |
   +--------+--------+--------+--------+
        |
        v
+----------------------------------------------------+
|      MODULES METIERS (activables par vertical)       |
|  Pharmacie . Optique . Commerce . Stock . Ventes .   |
|  Crédit . Comptabilité                                |
+----------------------------------------------------+
        |
        v
       PostgreSQL + Redis
   (jamais accédée directement par l'IA)
```

Le backend est découpé en domaines de service (bounded contexts) : identité, catalogue, stock, ventes, achats, crédit, comptabilité, fiscalité, paiements, livraison, IA, connecteurs. Chaque domaine expose une API REST versionnée et publie des événements consommés par les autres domaines.

**[V2]** Le bus d'événements utilise un pattern **outbox** (écriture de l'événement dans la même transaction que l'opération métier, publication asynchrone garantie) plutôt qu'une livraison best-effort implicite. Une réconciliation périodique ventes ↔ écritures comptables détecte tout écart.

---

## 3. Modules (ERP)

**Socle commun (toujours actif, tous verticaux)** : Dashboard, Produits, Catalogue, Stock, Ventes, POS, Clients, CRM, Caisse, Utilisateurs, Reporting, Messagerie, Documents, Audit, Paramètres.

**Modules activables par vertical** : Inventaire avancé, Achats, Fournisseurs, Crédit, Banque, Paiements, Livraison, Comptabilité, Fiscalité, SFEC, RH, Marketing, Promotions, BI, IA, Pharmacie, Optique.

L'administrateur active/désactive chaque module par tenant. Un module désactivé masque son UI et bloque ses endpoints API côté serveur (jamais un simple masquage front-end), et ne supprime jamais les données déjà créées.

Exemple d'activation MVP (pharmacie, Congo) : socle commun + Achats, Fournisseurs, Crédit, Comptabilité, Fiscalité, SFEC, Pharmacie.

---

## 4. Backend central

- API-first : toute logique métier passe par l'API centrale, jamais par un accès direct à la base depuis une application.
- Domaines de service indépendants (identité, catalogue, stock, ventes, achats, crédit, comptabilité, fiscalité, paiements, livraison, IA, connecteurs), chacun propriétaire de ses tables.
- Communication inter-domaines : appel API synchrone pour une lecture, événement asynchrone (outbox) pour une notification de changement d'état.
- Stack : Node.js + TypeScript, NestJS.

---

## 5. Applications

| Application | Public | Techno | Rôle |
| --- | --- | --- | --- |
| ERP Web | Titulaires, gérants, employés | React + TypeScript, Tailwind | Gestion complète, mode comptoir rapide |
| App Client | Clients finaux | React Native + PWA | Achats, fidélité, carnet de soins, crédit |
| App Livreur | Livreurs | React Native | Tournées, GPS, preuve de livraison |
| App Santé | Médecins, infirmiers, cliniques | Web / PWA | Recherche produit, disponibilité, réservation — jamais de prix d'achat ni de marge exposés |
| Admin plateforme | Équipe [NOM DU PROJET] | React + TypeScript | Tenants, facturation SaaS, supervision |

**[V2]** Le choix React Native (retenu par défaut, Flutter resterait une option si l'équipe a déjà cette expertise) doit être **tranché avant le premier sprint du module offline**, pas « en phase 1 » au sens large : les bibliothèques de base locale et de synchronisation diffèrent fortement entre les deux et conditionnent l'architecture offline.

**[V2]** L'app client est construite en modules internes activables par feature flag par vertical (pharmacie, optique...), jamais comme un binaire monolithique embarquant tous les verticaux pour tous les utilisateurs — la complexité et la surface d'attaque ne doivent pas croître avec chaque vertical ajouté à la plateforme si le tenant n'en active qu'un.

---

## 6. Base de données

PostgreSQL, tenant_id partagé (voir section 10), Redis pour le cache et les sessions.

Tables principales par domaine :

| Domaine | Tables |
| --- | --- |
| Plateforme | tenants, organizations, branches, users, roles, permissions |
| Catalogue | products, product_variants, categories, brands |
| Stock | inventory_movements, lots, expiry_dates (`inventory` = vue matérialisée des mouvements, jamais un solde écrit directement) |
| Achats | suppliers, purchase_orders, supplier_connectors |
| Ventes | orders, order_items, sales, sale_items, promotions |
| Clients | customers, customer_credit_accounts |
| Pharmacie | prescriptions, patients, health_records, drug_interactions |
| Optique | glasses, frames, lenses, optical_prescriptions |
| Paiements | payments |
| Livraison | deliveries, drivers |
| Comptabilité | accounting_entries, taxes, sfec_invoices |
| Communication | messages, notifications |
| IA et audit | ai_tasks, ai_audit_logs, audit_logs |

**[V2]** `inventory_movements` est partitionné par tenant et par date dès sa création (append-only, croissance illimitée) ; le solde courant est une vue matérialisée rafraîchie, jamais une table mise à jour en place. Un archivage froid des mouvements anciens est prévu avant que les performances de lecture ne se dégradent.

---

## 7. API

API REST versionnée (`/v1/...`), regroupée par domaine ; WebSocket pour le temps réel (notifications, messagerie, statut de synchronisation).

| Domaine | Endpoints |
| --- | --- |
| Identité | `/auth`, `/users`, `/tenants`, `/organizations` |
| Catalogue | `/products`, `/catalog` |
| Stock | `/inventory` |
| Ventes | `/sales`, `/orders`, `/pos` |
| Achats | `/purchases`, `/suppliers`, `/supplier-connectors` |
| Clients | `/customers`, `/credits` |
| Pharmacie | `/pharmacy`, `/prescriptions`, `/drug-interactions` |
| Optique | `/optical`, `/frames` |
| Santé | `/health-records` |
| Finance | `/payments`, `/accounting`, `/taxes`, `/sfec` |
| Logistique | `/deliveries` |
| Communication | `/messages`, `/notifications` |
| Intelligence | `/ai`, `/reports`, `/analytics` |

**[V2]** Politique de dépréciation formelle dès la première version publique : durée de support minimale annoncée par version, en-tête de version obligatoire, tests de compatibilité descendante en CI avant toute évolution incompatible.

Tout champ sensible (prix d'achat, marge) est filtré **côté serveur** via un DTO dédié selon le rôle appelant — jamais un filtrage uniquement côté client. **[V2]**

---

## 8. Authentification

- Comptes utilisateurs uniques, valables à travers tous les tenants et applications (identité portée par le backend central).
- MFA / OTP obligatoires pour les comptes à privilège élevé (titulaire, admin plateforme).
- Tokens à durée de vie courte, révocation immédiate à la déconnexion, au changement de rôle ou de tenant. **[V2]**
- Un employé changeant d'affectation ou quittant l'entreprise perd l'accès immédiatement ; aucune session ou token émis avant le changement ne reste valide.

---

## 9. RBAC / ABAC

- RBAC pour les rôles standard (vendeur, pharmacien, gérant, comptable).
- **[V2]** ABAC implémenté via un moteur de policy dédié (OPA ou Casbin) dès la phase 1, pas développé au cas par cas — utilisé pour les décisions sensibles au contexte : données de santé, marges, crédit au-delà d'un seuil.
- Chaque tool exposé à l'IA porte son propre scope de permission, documenté et testé indépendamment ; aucun tool générique d'accès aux données n'est autorisé. **[V2]**
- Rôle dédié « professionnel de santé externe » distinct du rôle employé, sans accès aux champs financiers internes.

---

## 10. Multi-tenant

**[V2] Décision tranchée** : `tenant_id` partagé dans un schéma unique (pas de schema-per-tenant ni de base-per-tenant), avec :

- **Row-Level Security PostgreSQL** activée sur toutes les tables métier, en complément du filtre applicatif `WHERE tenant_id` — l'isolation ne repose jamais sur la seule couche applicative.
- Partitionnement par `tenant_id` sur les grosses tables (`inventory_movements`, `sales`, `sale_items`) dès leur création.
- Tests d'isolation automatisés à chaque pull request (une requête qui traverse les tenants doit faire échouer la CI).

Multi-entreprise (un utilisateur peut posséder plusieurs entreprises), multi-site, multi-devise et multi-langue sont des propriétés du même modèle, configurées par tenant.

---

## 11. Offline-first

Base locale embarquée (SQLite / IndexedDB) + file d'attente d'opérations + moteur de synchronisation + résolution de conflits.

**Stratégie anti-doublon** : chaque opération créée hors ligne reçoit un UUID généré côté client, utilisé comme clé d'idempotence à la synchronisation. Les mouvements de stock sont additifs (jamais un solde recopié), pour que deux ventes hors ligne s'additionnent sans s'écraser.

**[V2] Corrections issues de l'audit** :

- Une **tolérance de survente configurable par produit** est définie, avec alerte immédiate à la synchronisation (deux caisses vendant le dernier carton hors ligne doivent être détectées, pas silencieusement absorbées).
- Le plafond de crédit vérifié hors ligne est **plus strict** que le plafond en ligne, avec réconciliation prioritaire au retour réseau.
- Les conflits réels (même client modifié sur deux postes) suivent un **SLA de traitement défini avec responsable désigné** et une alerte si la file dépasse un seuil — jamais une file qui s'accumule sans être traitée.
- La file d'attente locale est purgée/compressée après synchronisation confirmée, avec alerte si son âge ou sa taille dépasse un seuil, pour éviter la saturation de l'appareil lors d'une coupure prolongée.

---

## 12. Paiements

Architecture Payment Gateway : chaque moyen de paiement est un provider derrière une interface commune (autoriser, capturer, rembourser, statut). Providers cibles : espèces, carte, MTN MoMo, Airtel Money, MoMoPay, paiement en ligne, paiement à la livraison, paiement mixte.

**[V2] Correction issue de l'audit** : une vente n'a pas un statut de paiement binaire. Chaque tentative de paiement porte son propre statut, incluant un état explicite **« en attente de confirmation »** pour les paiements Mobile Money asynchrones. La confirmation définitive arrive par webhook ; en son absence après un délai défini, une relance automatique est déclenchée — la marchandise n'est jamais remise sur la seule foi d'un appel initial réussi. Un paiement mixte (cash + Mobile Money) dont une partie échoue laisse la vente dans un état cohérent et corrigible, jamais bloquée globalement.

Ajouter un nouveau provider ne doit jamais exiger de modifier le POS.

---

## 13. SFEC

Pipeline : `ERP → Moteur fiscal → Adaptateur SFEC → API SFEC → Certification → Facture certifiée`, avec authentification à l'API, XML normalisé, journalisation complète et référence de certification tracée sur chaque facture.

**[V2] Correction critique issue de l'audit** : le SFEC n'est **jamais un point de blocage synchrone obligatoire**. Un mode dégradé, validé juridiquement au préalable, permet d'émettre une facture provisoire si l'API SFEC est indisponible, avec certification différée automatique dès le retour du service (retry avec backoff, file de reprise persistée). Le POS ne s'arrête jamais de vendre à cause d'une panne SFEC.

L'adaptateur SFEC est isolé du moteur fiscal et de l'ERP pour absorber une évolution future des spécifications gouvernementales sans réécriture.

---

## 14. Comptabilité

Plan comptable configurable par pays (SYSCOHADA en base), journaux, caisse, banque, Mobile Money, créances, dettes, immobilisations, rapprochement bancaire. Chaque événement métier génère automatiquement son écriture comptable via le bus d'événements — jamais de ressaisie séparée.

**[V2] Correction issue de l'audit** : un **workflow d'extourne/avoir explicite** est prévu pour corriger une écriture erronée après coup ; aucune écriture publiée n'est jamais modifiée directement.

**[V2]** Chaque pays SYSCOHADA est traité comme un **plugin fiscal versionné et testé indépendamment** (taux, exonérations, format de facture), pas comme un simple fichier de configuration — l'effort d'ajout d'un pays est budgété en conséquence dans la roadmap (section 23).

---

## 15. IA

AI Gateway central : `Application → AI Gateway → Permission Engine → Tools → Business API → Database`. L'IA n'a jamais d'accès direct à PostgreSQL.

**[V2] Corrections critiques issues de l'audit** :

- Chaque **tool IA a un périmètre de données et un scope de permission documentés et testés individuellement** ; aucun tool générique (ex. « exécuter une requête de reporting ») n'est autorisé, pour ne pas contourner de facto le principe d'absence d'accès direct à la base.
- Toute donnée de santé (carnet de soins, ordonnances, allergies) est **anonymisée avant tout appel à un modèle externe** (Anthropic, OpenAI...), ou traitée exclusivement par un modèle local si l'anonymisation n'est pas fiable pour le cas d'usage.
- Le consentement pour l'accès IA aux données de santé est **versionné et révocable**, avec effet immédiat sur les accès déjà accordés — jamais une case cochée une seule fois.
- Les opérations sensibles (envoi de message, validation de promotion, commande fournisseur) exigent une confirmation utilisateur explicite avant exécution.

Gateway multi-modèle (Anthropic, OpenAI, modèles locaux) derrière une interface commune, pour changer de fournisseur sans modifier les applications.

---

## 16. Connecteurs fournisseurs

Connector Hub : `Fournisseur → Connecteur → Normalisation → ERP`, avec une interface commune (rechercher produit, vérifier disponibilité, récupérer prix, poser commande) quelle que soit la méthode réelle (API, EDI, web service, fichier, automatisation navigateur si légalement approprié).

**[V2] Corrections issues de l'audit** :

- **Monitoring actif par connecteur** (heartbeat, alerte sur échec répété) — une automatisation navigateur cassée silencieusement par un changement de mise en page ne doit jamais passer inaperçue. Un fallback manuel (export/import) reste toujours disponible.
- Le **rapprochement catalogue** (produit fournisseur ↔ produit interne) assisté par IA est **toujours validé par un humain avant la première commande** d'une nouvelle référence, pour éviter un faux rapprochement entraînant une commande erronée.
- Retry avec backoff et circuit breaker si un fournisseur est indisponible ; file d'attente persistée pour ne jamais perdre une commande en cours de transmission.

---

## 17. Pharmacie

Catalogue par DCI et spécialité, dosage, forme, laboratoire ; gestion par lot avec date de péremption, sortie FEFO imposée par défaut.

**[V2]** FEFO par défaut, avec **dérogation tracée et justifiée** possible (un client demandant explicitement un lot précis pour un traitement long) — jamais un verrou absolu qui pousserait à un contournement non tracé.

**[V2]** Le scan OCR de date de péremption / lot déclenche une validation humaine si la confiance est insuffisante, mais un lot à confiance faible est **bloqué à la vente jusqu'à validation par un second rôle** (le pharmacien, jamais la même personne qui a scanné).

Ordonnance et délivrance tracées ligne par ligne, substitutions configurables validées par le pharmacien, tiers payant et assurances, moteur d'interactions médicamenteuses (niveau d'alerte, source, justification affichés — le pharmacien garde toujours la décision finale, jamais un blocage automatique de la vente par l'IA seule).

---

## 18. Lunetterie

Hors périmètre du MVP (voir section 0). Catalogue montures/verres/ordonnance optique prévu dans le modèle de données dès la phase 1 pour ne pas casser le schéma plus tard, mais l'essayage virtuel AR n'est pas développé avant la phase 7 de la roadmap, faute de modèles 3D fournisseurs disponibles localement aujourd'hui.

---

## 19. Livraison

Flux : `Commande → préparation → affectation livreur → livraison → preuve → paiement → clôture`. App livreur : liste des courses, navigation GPS, statut, preuve de livraison, historique.

Le paiement à la livraison (cash ou Mobile Money) suit les mêmes règles que la section 12 (statut par tentative, jamais binaire) avant de déclencher la clôture de commande et l'écriture comptable.

---

## 20. Migration

Module dédié : mapping explicite ancien champ → nouveau champ (WINPHARMA, AS PHARM, Excel, CSV). Une créance importée est tracée comme « solde antérieur importé », jamais comme une vente nouvelle.

**[V2] Corrections issues de l'audit** :

- Une **phase de nettoyage de données est obligatoire avant import** (dédoublonnage clients, normalisation des unités) — les exports réels de ces logiciels sont supposés incomplets par défaut, pas propres. Un rapport de qualité est présenté au client avant toute bascule définitive.
- Une **période de double run est documentée** (ancien logiciel conservé en lecture seule) avec un critère explicite de bascule définitive, pour éviter qu'une migration échouée en production laisse le pharmacien sans système fonctionnel.

---

## 21. Sécurité

- RBAC + ABAC (section 9), MFA/OTP pour les comptes à privilège élevé.
- Chiffrement au repos et en transit, renforcé pour les données de santé.
- Journalisation systématique des accès aux données de santé et des actions sensibles (`audit_logs`).
- **[V2] RPO/RTO chiffrés dès la phase 1** (référence : RPO 15 minutes, RTO 4 heures) avec **exercice de restauration trimestriel documenté** — une sauvegarde jamais testée en conditions réelles est considérée comme absente.
- Séparation stricte des tenants (Row-Level Security, section 10) et des données de santé vis-à-vis des données commerciales.
- Consentement explicite, versionné et révocable pour toute donnée personnelle ou de santé (section 15).

---

## 22. Infrastructure

| Couche | Choix |
| --- | --- |
| Frontend | React + TypeScript, TailwindCSS |
| Backend | Node.js + TypeScript, NestJS |
| Base de données | PostgreSQL (RLS activée, partitionnement par tenant) |
| Cache | Redis |
| File de tâches | BullMQ |
| Stockage fichiers | S3 compatible |
| Mobile | React Native (décision à confirmer avant le sprint offline, section 5) |
| Interfaces légères | PWA |
| API | REST |
| Temps réel | WebSocket |
| Conteneurisation | Docker |
| Déploiement | CI/CD |
| Observabilité | Monitoring (métriques, logs, alertes) + heartbeat par connecteur (section 16) |

**[V2]** Recommandations matérielles minimales pour le déploiement client (onduleur, tablette avec batterie) documentées dans le guide de déploiement — l'offline-first logiciel ne suffit pas seul face à une coupure électrique prolongée.

---

## 23. Roadmap

| Phase | Contenu | Dépendances | Priorité |
| --- | --- | --- | --- |
| P1 | Backend, auth, multi-tenant + RLS, produits, stock, POS, clients, achats | Aucune | Critique |
| P2 | Pharmacie : lots, péremptions, ordonnances, interactions, crédit | P1 | Critique |
| P3 | SFEC (avec mode dégradé), comptabilité, Mobile Money (avec webhook) | P1, P2 | Critique |
| P4 | Application client, livraison, professionnels de santé | P1–P3 | Élevée |
| P5 | Connecteurs fournisseurs (avec monitoring actif) | P1 | Moyenne |
| P6 | IA (AI Gateway, tools scopés, anonymisation santé) | P1–P2 | Élevée |
| P7 | Lunetterie, essayage virtuel AR | P1 | Moyenne |
| P8 | Pharmacie de garde | P1, P4 | Faible |
| P9 | Multi-commerce (boutique, grossiste, B2B, restauration) | P1–P3 | Moyenne |
| P10 | Expansion internationale (chaque pays = plugin fiscal versionné) | P1–P9 | Moyenne |

**[V2]** Le choix de la stack mobile (section 5) et les RPO/RTO (section 21) sont des prérequis de la phase P1, pas des décisions différées.

---

## 24. Application client, site web et application livreur

Trois clients légers autour du même ERP. L'ERP reste l'unique source de vérité (stock, prix, commandes) ; les applications n'ont jamais d'accès direct à la base.

| Client | Technologie | Rôle |
|---|---|---|
| **Site web client** | Application web (PWA) | Catalogue, disponibilité, inscription, commande |
| **Application client (APK)** | Même code que le site (Capacitor / PWA installable) | Idem + notifications (commande prête, livraison en route) |
| **Application livreur (APK)** | Application dédiée, accès restreint | Liste des courses, itinéraire, statut, preuve de livraison, encaissement à la livraison |

**Principes**

1. **Le catalogue est piloté depuis l'ERP.** Le super-administrateur active le catalogue en ligne (*Ma structure → Réglages → Application client*), choisit les **catégories visibles** et coche, produit par produit, « Visible dans l'application client » (fiche produit). Les produits sur ordonnance ne sont jamais exposés.
2. **Disponibilité sans fuite d'information.** L'API publique `GET /online/:slug/catalog` ne renvoie que le nom, la forme, le dosage, le prix et un indicateur « disponible / indisponible » : jamais les quantités, les lots ni les prix d'achat.
3. **Inscription des clients.** Un client s'inscrit depuis l'application de la pharmacie : il devient une fiche *Client* du tenant (numéro de téléphone au format +242 0X XXX XX XX, vérifié par code SMS/WhatsApp). Ses commandes et son historique sont visibles dans l'ERP.
4. **Commande et paiement.** Commande → préparation par le vendeur → paiement (Mobile Money confirmé par webhook, section 12, ou à la livraison) → affectation d'un livreur → livraison → preuve → clôture et écritures comptables.
5. **Notification du livreur.** Dès qu'un paiement client passe à l'état *confirmé*, un évènement `order.paid` est publié (table `outbox_events`, section 14) ; le service de notification pousse la course au livreur affecté (notification push, repli par WhatsApp). Un paiement *en attente* ou *échoué* ne déclenche rien.
6. **Authentification.** Les clients et les livreurs ont leurs propres jetons (portée `customer` / `courier`), distincts de ceux du personnel ; aucune permission ERP n'est accessible avec eux. Les points d'accès publics sont limités en débit.
7. **Hors ligne.** L'application livreur met en file les changements de statut et les rejoue à la reconnexion (clé d'idempotence, comme la caisse, section 11).

**État actuel** : en place et testé — réglages (catalogue actif, inscription, livraison, catégories visibles), catalogue public, comptes clients (téléphone + mot de passe), commandes en ligne (/online/:slug/orders), écran ERP « Commandes en ligne » (acceptation = création de la vente avec réservation FEFO du stock, validation du paiement, affectation du livreur), application livreur (/livreur/:slug, alertes par interrogation toutes les 8 s + son, vibration et notification du téléphone) et application client (/boutique/:slug). Le livreur est notifié à l'affectation et à chaque paiement validé (hook onSaleSettled). Restent : vérification du numéro par SMS/WhatsApp, notifications push en arrière-plan (Firebase / Web Push), emballage APK (Capacitor).

---

## Annexe — Traçabilité des décisions V2

Chaque correction marquée **[V2]** dans ce document provient d'un problème identifié lors de l'audit critique de l'architecture initiale (isolation tenant, offline-first, PostgreSQL, paiements, SFEC, IA/données de santé, migration, sauvegardes, multi-pays, applications mobiles). Ce document ARCHITECTURE.md remplace les intentions correspondantes du dossier initial ; il n'y a pas de version « v1 » à suivre en parallèle.
