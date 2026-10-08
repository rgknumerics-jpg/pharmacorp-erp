# [NOM DU PROJET] -- Socle technique

Reference d'architecture : [ARCHITECTURE.md](./ARCHITECTURE.md). Ce depot implemente le **socle** (monorepo, auth, RBAC, multi-tenant, audit, infra) et, depuis le 2026-10-07, les
modules metier **P1/P2** (catalogue, stock par lot FEFO, clients, achats/receptions, caisse, paiements, OCR). Comptabilite,
SFEC, IA, livraison et connecteurs fournisseurs restent a construire (voir la section "Etat d'avancement").

## Arborescence

```text
apps/api        API centrale NestJS (auth, RBAC, users, roles, audit-logs, health, queue)
apps/web        Frontend React + Vite + Tailwind (ecran de demonstration login -> /users/me)
packages/database  Schema Prisma, migrations, seed, catalogue de permissions partage
infrastructure/docker  Dockerfiles multi-stage pour api et web
```

## Prerequis

- Node.js 20+
- Docker Desktop (PostgreSQL + Redis)

## Deux roles PostgreSQL -- a ne jamais confondre

| Role | Attributs | Usage |
| --- | --- | --- |
| `erp` | superuser (POSTGRES_USER du conteneur) | **Uniquement** `prisma migrate` et `npm run db:seed` |
| `erp_app` | non-superuser, non-BYPASSRLS (cree par la migration `least_privilege_app_role`) | **Uniquement** l'application qui tourne (`.env`, `.env.test`, conteneur `api`) |

Un superuser (ou tout role BYPASSRLS) contourne TOUJOURS la Row-Level Security, meme avec
`FORCE ROW LEVEL SECURITY` -- c'est un bug reel trouve et corrige pendant la verification du
2026-09-27 (voir ARCHITECTURE.md section 10 et l'historique des migrations). Si l'application se
connecte un jour avec `erp` au lieu de `erp_app`, l'isolation multi-tenant est silencieusement
desactivee sans qu'aucune erreur ne soit levee.

## Demarrage (developpement)

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis
npm run db:generate

# Migrations : role proprietaire "erp" (pas erp_app)
DATABASE_URL=postgresql://erp:erp@localhost:5442/erp_dev?schema=public npm run db:migrate:dev -w @erp/database
DATABASE_URL=postgresql://erp:erp@localhost:5442/erp_dev?schema=public npm run db:seed

# Application : role applicatif "erp_app", deja configure dans .env.example
npm run dev:api          # http://localhost:3000, docs Swagger sur /api/docs
npm run dev:web          # http://localhost:5173
```

Identifiants crees par le seed : tenant `pharmacie-pilote`, email `admin@example.com`, mot de passe
celui de `SEED_ADMIN_PASSWORD`.

Ports hote non standard (5442 pour PostgreSQL, 6389 pour Redis) : une autre infrastructure Docker
sans rapport avec ce projet occupait deja 5432/6379 sur la machine de verification -- voir
`docker-compose.yml`. Adaptez si votre machine est libre sur les ports standard.

## Migrations

4 migrations sont commitees dans `packages/database/prisma/migrations/`, appliquees et verifiees
sur une base PostgreSQL 16 reelle (`prisma migrate deploy` depuis zero, sans drift) :

1. `init` -- schema de base (tenants, users, roles, permissions, memberships, refresh_tokens, audit_logs)
2. `row_level_security` -- active RLS + policies d'isolation par tenant
3. `least_privilege_app_role` -- cree le role `erp_app` (voir section ci-dessus)
4. `fix_rls_empty_setting_cast` -- corrige un bug de cast PostgreSQL (`''::uuid` levait une
   erreur au lieu de filtrer proprement quand aucun contexte tenant n'etait positionne)

Toujours executer `prisma migrate dev/deploy` avec le role **proprietaire** `erp` (le role
applicatif `erp_app` n'a pas les droits DDL pour creer des policies ou des roles).

## Tests

- Unitaires (aucune infra requise) : `npm run test`
- End-to-end (necessitent Postgres/Redis de test) :

```bash
cp .env.test.example .env.test
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgresql://erp:erp@localhost:5433/erp_test?schema=public npm run db:migrate:deploy
DATABASE_URL=postgresql://erp:erp@localhost:5433/erp_test?schema=public npm run db:seed
npm run test:e2e   # utilise .env.test -> role erp_app, RLS reellement exercee
```

3 suites e2e : sante (Postgres/Redis joignables), auth+RBAC (login, refresh avec rotation,
logout, 401/403/400, audit_logs), isolation multi-tenant (deux tenants reels, IDOR bloque par
RLS, requete Prisma sans clause tenantId bloquee, requete sans contexte tenant = 0 ligne).

## Build

```bash
npm run build
```

## CI/CD

`.github/workflows/ci.yml` : installe, genere le client Prisma, applique les 4 migrations avec
le role proprietaire (`erp`), seed avec le role proprietaire, puis lint/build/tests unitaires et
e2e avec le role applicatif (`erp_app`) -- exactement la meme separation qu'en local, pour que la
RLS soit reellement exercee en pipeline et non silencieusement contournee.

## Etat de verification de ce socle (2026-09-27, avec Docker Desktop reellement installe)

Toutes les etapes suivantes ont ete **executees pour de vrai** (pas seulement verifiees comme
possibles) sur PostgreSQL 16 / Redis 7 en conteneurs Docker :

- ✅ Docker daemon repondant, 4 conteneurs `healthy` (postgres/redis dev + test, ports non standard)
- ✅ `npx prisma generate`, 4 migrations appliquees depuis zero (`prisma migrate deploy`), `migrate status` = *up to date* sur dev ET test (aucun drift schema.prisma / base reelle)
- ✅ `npm run db:seed` -- tenant + admin + roles + permissions verifies par requete SQL directe
- ✅ RLS activee et **verifiee** : `pg_policies` liste les 4 policies, comportement confirme par 3 suites e2e distinctes
- ✅ 13/13 tests e2e (sante, auth+RBAC, isolation multi-tenant) -- 2 tenants reels crees, IDOR cross-tenant bloque (404), requete Prisma sans clause `tenantId` bloquee par RLS, requete sans contexte tenant = 0 ligne
- ✅ 15/15 tests unitaires, `npm run lint` (0 erreur), `npm run build` (3 packages)
- ✅ Simulation complete du pipeline CI sur base fraiche (generate -> migrate deploy -> seed -> lint -> build -> tests -> e2e), role applicatif `erp_app` de bout en bout

**3 bugs reels trouves et corriges pendant cette verification** (voir ARCHITECTURE.md et
l'historique des migrations pour le detail) :

1. Le role de connexion par defaut (`erp`, POSTGRES_USER) est superuser -> contournait TOUTE la
   RLS silencieusement. Corrige par la creation du role `erp_app` + separation des usages.
2. La policy RLS plantait (erreur SQL 500) au lieu de filtrer proprement quand aucun contexte
   tenant n'etait positionne sur une connexion de pool deja utilisee. Corrige par une comparaison
   texte au lieu d'un cast `::uuid` du parametre externe.
3. Le `ValidationPipe` global (validation des DTO) n'etait configure que dans `main.ts`, jamais
   rejoue par les tests e2e qui construisent l'app via `TestingModule` -- les payloads invalides
   n'etaient donc jamais rejetes en test. Corrige par `src/app.config.ts`, partage entre
   `main.ts` et `test/setup-app.ts`.

**Non couvert par cette verification** (hors perimetre du socle, a construire plus tard) : aucun
module metier (POS, pharmacie, comptabilite, SFEC, IA, Mobile Money), tests de charge/performance,
build reel des images Docker (`docker compose build`), deploiement en environnement distant.

## Modules metier (2026-10-07)

| Domaine | Ce qui est livre | Endpoints principaux |
| --- | --- | --- |
| Catalogue | produits (DCI, forme, dosage, prix libre, TVA, seuils, tolerance de survente), categories ; le prix d'achat n'est servi qu'avec la permission `cost.read` | `/products`, `/products/by-code/:code`, `/categories` |
| Stock | journal de mouvements en ajout seul, lots + peremption, **sortie FEFO**, derogation tracee, lots perimes jamais vendus, ajustements motives, alertes de peremption, lots a valider par un 2e role | `/stock/levels`, `/stock/expiring`, `/stock/adjustments`, `/stock/lots/:id/review` |
| Achats | fournisseurs, commandes, receptions (cree les lots et le stock, met a jour le cout) | `/suppliers`, `/purchase-orders`, `/goods-receipts` |
| Ventes / caisse | vente idempotente (UUID poste), paiements a statut propre (Mobile Money "en attente de confirmation"), paiement mixte, credit client avec plafond, annulation (stock + credit extournes) | `/sales`, `/payments/:id/confirm`, `/sales/:id/void` |
| Clients | fichier clients (telephone Congo `+242 0X`, 0 conserve), creances et remboursements | `/customers` |
| OCR | bon de livraison, facture, etiquette de peremption : lecture (navigateur gratuit ou serveur Tesseract), analyse, rapprochement catalogue, **validation humaine obligatoire**, 2e valideur si fiabilite < 80 % | `/ocr/documents` |
| Rapports | tableau de bord du jour, marge (si `cost.read`), alertes | `/reports/dashboard` |

Interface : `apps/web` (caisse, produits, stock/peremptions, reception + OCR, clients, ventes), charte PHARMACORP.

### Verification (2026-10-07, PostgreSQL 16 reel, role applicatif `erp_app`, RLS active)

- 52 tests unitaires (FEFO, parseurs OCR, telephone, auth...) et 12 tests e2e du parcours metier : catalogue -> reception -> vente FEFO ->
  idempotence -> Mobile Money -> credit -> annulation -> OCR a 2e valideur -> lots douteux -> isolation entre tenants.
- Le test e2e metier remplace la file Redis par un no-op ; la sante de Redis reste couverte par `app.e2e-spec.ts` (avec Redis).
- `QueueService.enqueue` n'attend plus Redis au-dela de 2 s : une panne Redis ne bloque plus une connexion ou une vente.

### Etat d'avancement par rapport a la roadmap (ARCHITECTURE.md section 23)

- P1 (socle + produits, stock, POS, clients, achats) : **fait** (hors synchronisation hors ligne et MFA).
- P2 (pharmacie) : lots, peremptions, FEFO, ordonnance signalee **faits** ; ordonnances/delivrance tracees, interactions, tiers payant **a faire**.
- P3 (SFEC, comptabilite SYSCOHADA, webhooks Mobile Money) : **fait** (2026-10-07), voir ci-dessous. Reste : declarations fiscales, rapprochement bancaire, immobilisations, specification SFEC officielle.
- Ecarts connus : `inventory_movements` non partitionnee et solde calcule par somme (pas de vue materialisee) ; ABAC/OPA non branche ;
  moteur de synchronisation hors ligne non ecrit (les cles d'idempotence existent deja) ; jetons web en sessionStorage (cookie httpOnly a prevoir).

## Phase P3 (2026-10-07) : comptabilite, SFEC, Mobile Money

- **Outbox** (`outbox_events`) : chaque vente, encaissement, annulation, reception, remboursement de creance et ajustement ecrit son evenement
  dans la meme transaction. Un traitement (toutes les 15 s, ou `POST /accounting/outbox/process`) genere les ecritures ; idempotent
  (`source_key`), verrou `FOR UPDATE SKIP LOCKED`, 5 essais puis statut `failed` visible.
- **Comptabilite SYSCOHADA** (`/accounting`) : plan comptable cree au premier usage, journaux VE/AC/CA/BQ/MM/OD, balance, grand livre,
  OD manuelles equilibrees, **contre-passation** (le role applicatif n'a ni UPDATE ni DELETE sur les ecritures), rapprochement ventes <-> ecritures.
  Correspondances operation -> comptes centralisees dans `apps/api/src/accounting/chart.ts`.
- **Moteur fiscal** (`apps/api/src/fiscal/fiscal.ts`) : source unique de la TVA (caisse, comptabilite, SFEC).
- **SFEC** (`/sfec`) : facture normalisee par vente, avoir a l'annulation ; si l'API est indisponible -> facture **provisoire** et nouvel essai
  automatique (1, 2, 4 min... jusqu'a 6 h). Adaptateur `simulateur` par defaut ; `SFEC_MODE=http` + `SFEC_API_URL`/`SFEC_API_KEY` pour l'API reelle
  (seul `sfec.adapter.ts` changera quand la specification officielle sera fournie).
- **Webhook Mobile Money** : `POST /webhooks/mobile-money/mtn|airtel`, signature HMAC-SHA256 du corps brut (`x-signature`, secret
  `MOMO_WEBHOOK_SECRET`), montant controle, rejeu sans effet.
- Tests : 3 unitaires (moteur fiscal) + 7 e2e (`test/accounting.e2e-spec.ts`), en plus des 12 e2e metier.
- Les ventes anterieures a cette phase ne sont pas comptabilisees (signalees par le rapprochement).

## Phase P4 (2026-10-08) : pilotage

- **Profil legal facultatif** (`/company`) : NIU, RCCM, autorisation d'exercice, CNSS employeur, patente, documents (PDF/images) ; rien n'est
  exige a la creation du compte, une jauge de completude invite a completer.
- **Calendrier fiscal et social** (`/tax`, `apps/api/src/tax/calendar.ts`) : obligations 2026 de la note ACPCE du 25/02/2026 (loi de finances 2026,
  CGI art. 461 bis : le 15, le 20 en aout), filtrees selon le profil (reel/forfait, IS/IBA, salaries, loyer, immeubles) ; report au dernier jour
  ouvre (week-ends et feries congolais) ; montants estimes (TVA depuis la comptabilite, ITS/TUS/CNSS/CAMU/TOL depuis la paie, taxe immobiliere,
  IMF, IGF, IS) ; suivi declare/paye avec quittance. Alertes a J-30, J-14, J-7 puis retard (a partir de l'ouverture du compte dans l'ERP).
- **Bandeau d'alerte** fige en haut de l'ecran (permission `tax.read` : proprietaire, gerant, pharmacien, comptable), anime « ATTENTION ».
- **Paie** (`/payroll`) : salaries, bulletins, CNSS 24,28 %, CAMU 2,27 %/4,55 %, TUS 2,025 % + 5,475 %, TOL, ITS par bareme et quotient familial ;
  validation -> ecriture comptable 661/664/641/422/431/447. Repartition CNSS par branche, plafonds et bareme ITS : **valeurs par defaut a faire
  confirmer par un comptable** (parametrables, figees dans chaque bulletin).
- **Etats financiers** (`/accounting/statements`) : compte de resultat en cascade et bilan par grandes masses (Acte uniforme art. 29-31), indication SMT.
- **Pharmacie** : tiers payant (organismes, part prise en charge a la caisse, releve, reglements comptabilises), ordonnancier relie aux ventes,
  balance agee des clients a credit avec relance WhatsApp.
- **Conseiller** (`/advisor`) : recommandations calculees sur les donnees (provision des echeances, retards, credit de TVA, IMF/IS, SMT, creances,
  stock perime / dormant / a ecouler, marges faibles, paie non validee, Mobile Money en attente, especes, profil) ; optimisation legale uniquement.
- **Bibliotheque** (`apps/web/public/bibliotheque`) : Acte uniforme OHADA, calendrier ACPCE 2026, Code du travail, Code de securite sociale,
  convention collective des officines, loi 19-2005, note sur les restrictions, modele de bail.
- Tests : 14 unitaires (calendrier, paie, etats) + 7 e2e (`test/pilotage.e2e-spec.ts`) ; total e2e metier 26/26.

## Phase P5 (2026-10-08) : cockpit et pilotage avance

Voir **[CAHIER-DES-CHARGES.md](./CAHIER-DES-CHARGES.md)** (tout ce que l'ERP doit savoir faire, module par module, avec l'etat d'avancement).

- **Cockpit** (`/analytics/cockpit`, `/analytics/insights`) : sante, stock, commercial, clients + messages de pilotage en clair.
- **Risques immediats** (`/analytics/risks`) : rupture, peremption, stock negatif, ecart d'inventaire, prix < achat, marge anormale, vente sans stock,
  modification de prix > 20 %, annulations/remboursements inhabituels par utilisateur, ecart de caisse (`POST /cash/closings`), activite de nuit.
- **Reapprovisionnement** (`/analytics/reorder`, `src/analytics/forecast.ts`) : demande, saisonnalite, delai observe, stock de securite, quantite a commander,
  renfort avant les **semaines de garde** (`/garde-periods`, 4 jours avant).
- **Fournisseurs** (`/analytics/suppliers`) : prix, evolution, delais, livraison complete, retards, manquants, marge obtenue, comparaison de panier ;
  **factures et echeances** (`/supplier-invoices`, comptant ou N jours, echeance modifiable, reglements comptabilises).
- **Finances** (`/analytics/finance`) : cascade CA -> resultat, tresorerie, prevision 30/60/90 j, creances, dettes, marges par produit/famille/fournisseur/point de vente.
- **Journal d'audit** (`/audit-logs` avec filtres, prix avant/apres) : vente, annulation, prix, stock, achat, reglement, restauration...
- **Formation** (`/training`) : conseils et quiz (vente, panier, peremptions, bonnes pratiques), contenus valides par un pharmacien avant diffusion.
- **Sauvegardes** (`/backups`) : manuelle, automatique, Google Drive (OAuth, perimetre drive.file), telechargement, restauration avec sauvegarde de
  securite ; variables : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (= <API>/backups/drive/callback), `WEB_APP_URL`, `BACKUP_ENC_KEY`.
- Tests : 78 unitaires, 35 e2e (`test/cockpit.e2e-spec.ts` inclut une restauration reelle).
