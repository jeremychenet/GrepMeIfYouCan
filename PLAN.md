# GrepMeIfYouCan — Plan de réalisation du MVP (v1)

Référence : [SPEC.md](./SPEC.md). Chaque jalon est livrable en une session, se termine par un commit et laisse le projet dans un état qui fonctionne.

**Conventions**
- Tout s'exécute dans Docker : aucune commande Node sur le Mac. `make <cible>` encapsule `docker compose …`.
- Tests unitaires : **Vitest**. Tests end-to-end : **Playwright**, dans l'image officielle `mcr.microsoft.com/playwright`.
- Un jalon est terminé quand **tous** ses critères de validation sont cochés.
- **Chaque jalon qui ajoute ou modifie du code livre ses tests dans le même commit** (SPEC §8.1). Seuils de couverture : ≥ 80 % sur `src/lib/` et `scripts/`, ≥ 95 % sur les modules critiques (copy, template, danger-patterns, store, schema, lint-danger).

---

## Phase A — Fondations

### - [x] J1 — Squelette Astro conteneurisé
**Objectif** : un projet Astro + TypeScript qui démarre en local avec `make up`, sans rien installer sur le Mac.
**Fichiers**
- `package.json`, `package-lock.json`, `astro.config.mjs`, `tsconfig.json`
- `src/pages/index.astro` (page « Hello »)
- `docker/web.Dockerfile` (stage `dev`)
- `compose.yaml`, `compose.dev.yaml`
- `Makefile` (`up`, `down`, `logs`, `sh`, `npm`)
- `.env.example`, `.gitignore`, `.dockerignore`, `.editorconfig`, `README.md`

**Validation**
- [x] `make up` puis `curl -s localhost:4321` renvoie la page « Hello ».
- [x] Modifier `index.astro` met la page à jour sans redémarrer le conteneur (rechargement à chaud).
- [x] `node_modules` est dans un volume nommé. Côté Mac, il ne reste qu'un dossier vide (point de montage créé par Docker, ignoré par Git).
- [x] Le conteneur tourne en non-root (`docker compose exec web id -u` ≠ 0).

### - [x] J2 — Proxy Nginx local + en-têtes de sécurité
**Objectif** : une URL unique `http://localhost:8080`, qui sert le site avec les mêmes en-têtes qu'en production.
**Fichiers**
- `docker/nginx/nginx.conf`, `docker/nginx/security-headers.conf`
- `compose.yaml`, `compose.dev.yaml` (service `proxy`, port `127.0.0.1:8080`)
- `Makefile`

**Validation**
- [x] `curl -I localhost:8080` (automatisé : `make check-headers`) renvoie 200 avec les en-têtes CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` et `frame-ancestors 'none'`.
- [x] Le rechargement à chaud d'Astro fonctionne à travers le proxy (WebSocket relayé).
- [x] Le port 8080 n'écoute que sur 127.0.0.1 (`lsof -iTCP:8080`).
- [x] La console du navigateur n'affiche aucune violation CSP.

### - [x] J3 — Schéma de contenu + validation
**Objectif** : définir le format d'une fiche et refuser automatiquement toute fiche invalide.
**Fichiers**
- `src/content/schema.ts` (Zod : id, title, description, command, tool, category, tags, danger, platforms, source)
- `src/content.config.ts` (collection Astro qui charge `content/commands/**/*.yaml`)
- `scripts/validate-content.ts`
- `content/commands/linux/*.yaml` (3 fiches écrites à la main)
- `tests/content/schema.test.ts`, `tests/fixtures/invalid/*.yaml`
- `vitest.config.ts` (couverture `v8` + seuils de la SPEC §8.1)
- `Makefile` (`test`, `coverage`, `lint-content`)

**Validation**
- [x] `make lint-content` passe sur les 3 fiches.
- [x] `make test` vérifie le rejet de chaque fixture invalide : description vide, de plus de 180 caractères, en deux phrases ou identique au titre ; id en double ; catégorie inconnue ; danger inconnu.
- [x] Le build Astro (`make npm ARGS="run build"`) échoue si une fiche est invalide.
- [x] `make coverage` génère le rapport, et baisser artificiellement la couverture de `schema.ts` sous 95 % fait échouer la commande.

### - [x] J4 — Lint de danger + Unicode suspect
**Objectif** : empêcher la publication d'une commande dangereuse mal étiquetée ou piégée.
**Fichiers**
- `scripts/lint-danger.ts`, `src/lib/danger-patterns.ts`
- `tests/content/danger.test.ts`
- `Makefile` (`lint-content` appelle aussi le lint de danger)

**Validation**
- [x] Chaque pattern de la SPEC §7.2 déclenche une erreur s'il est étiqueté `safe` (un cas de test par pattern).
- [x] Les caractères invisibles, bidi (U+202E…), à chasse nulle et les retours à la ligne dans `command` sont rejetés.
- [x] Aucun faux positif sur les 3 fiches existantes.
- [x] La sortie indique le fichier, le pattern détecté et le niveau attendu.

### - [x] J5 — CI GitHub Actions (vérifications de PR)
**Objectif** : chaque PR est vérifiée automatiquement.
**Fichiers**
- `.github/workflows/ci.yml` : lint, typecheck, test + couverture (seuils bloquants, rapport en artefact), lint-content, build Astro, build de l'image Docker sans push
- `.github/dependabot.yml` (npm, Docker, Actions)
- `.github/CODEOWNERS`
- `.github/pull_request_template.md`

**Validation**
- [x] Une PR de test avec une fiche invalide fait échouer la CI. La même PR corrigée passe au vert.
- [x] Une PR qui ajoute du code non testé dans `src/lib/` fait échouer la CI sur le seuil de couverture. Ce test a révélé que le seuil portait sur la moyenne : il est maintenant appliqué fichier par fichier.
- [x] Le workflow tourne en moins de 5 minutes (≈ 30 s).
- [x] La protection de la branche `main` est activée : PR obligatoire, CI verte. 0 approbation requise (mainteneur seul, voir SPEC §7.1).

---

## Phase B — Contenu

### - [x] J6 — Script d'import tldr-pages
**Objectif** : générer des brouillons de fiches à partir de tldr, à un commit épinglé.
**Fichiers**
- `scripts/import-tldr.ts`
- `scripts/tldr-selection.yaml` (outils retenus par catégorie + SHA tldr épinglé)
- `content/drafts/<category>/*.yaml` (sortie : `description` vide, `danger` pré-rempli par le linter)
- `tests/scripts/import-tldr.test.ts` + `tests/fixtures/tldr/*.md`
- `Makefile` (`import-tldr`)

**Validation**
- [x] Les tests vérifient, sur une page tldr de test, l'extraction titre, commande et placeholders `{{…}}`, ainsi que le champ `source` complet.
- [x] `make import-tldr` produit environ 50 brouillons par catégorie dans `content/drafts/`.
- [x] `content/drafts/` est exclu du build et de la validation stricte, mais vérifié par le lint de danger.
- [x] Relancer l'import ne crée ni doublon ni modification si le SHA est inchangé (idempotent).

### - [x] J7 — Contenu : catégories `linux` + `containers`
**Objectif** : environ 100 fiches publiables, revues une par une.
**Fichiers**
- `content/commands/linux/*.yaml`, `content/commands/containers/*.yaml` (déplacées depuis `content/drafts/`)

**Validation**
- [x] Au moins 45 fiches par catégorie, toutes avec une description rédigée et un niveau de danger relu.
- [x] `make lint-content` passe.
- [x] Revue manuelle d'un échantillon de 10 fiches : chaque commande est correcte et sa description explique ce qu'elle fait.

### - [x] J8 — Contenu : catégories `cloud-iac` + `git-ci`
**Objectif** : compléter les quatre catégories (≈ 200 fiches).
**Fichiers**
- `content/commands/cloud-iac/*.yaml`, `content/commands/git-ci/*.yaml`
- `CONTENT_LICENSE` (CC BY 4.0 + attribution tldr-pages)

**Validation**
- [x] Au moins 45 fiches par catégorie, avec les mêmes critères que J7.
- [x] `content/drafts/` est vide ou ne contient que des fiches écartées volontairement.
- [x] `CONTENT_LICENSE` est présent et cite tldr-pages.

---

## Phase C — Site

### - [x] J9 — Design system & layout
**Objectif** : identité « terminal moderne », thèmes sombre et clair, structure commune des pages.
**Fichiers**
- `src/styles/tokens.css` (couleurs, espacements, typo, couleurs de danger)
- `src/styles/global.css`
- `public/fonts/*` (polices auto-hébergées)
- `src/layouts/Base.astro`
- `src/components/Header.astro`, `Footer.astro`, `ThemeToggle.ts`

**Validation**
- [x] Sombre par défaut. Au premier chargement, `prefers-color-scheme: light` est respecté. Le choix persiste après rechargement.
- [x] Aucun flash de mauvais thème au chargement (script de thème externe, compatible CSP).
- [x] Contrastes AA vérifiés dans les deux thèmes (axe DevTools : 0 erreur de contraste).
- [x] Aucune requête vers un domaine tiers (onglet Réseau).

### - [x] J10 — Pages statiques des fiches, outils et catégories
**Objectif** : chaque fiche a sa page, indexable et partageable.
**Fichiers**
- `src/pages/c/[id].astro`, `src/pages/tools/[tool].astro`, `src/pages/categories/[category].astro`
- `src/components/CommandCard.astro` (titre, description, commande, badge danger, tags, attribution)
- `src/components/DangerBadge.astro`
- `astro.config.mjs` (sitemap, `site: PUBLIC_BASE_URL`)

**Validation**
- [x] Le build génère une page par fiche, par outil et par catégorie (nombre vérifié par un test).
- [x] Chaque page a un `<title>`, une meta description (= description de la fiche) et une URL canonique.
- [x] `sitemap-index.xml` est généré.
- [x] Les fiches `destructive` affichent le badge rouge et l'avertissement, les `caution` le badge orange.

### - [x] J11 — Recherche instantanée + filtres
**Objectif** : trouver une commande en tapant quelques mots, avec tolérance aux fautes.
**Fichiers**
- `src/pages/search-index.json.ts` (index généré au build)
- `src/lib/search.ts` (MiniSearch, pondération titre > outil > tags > commande > description)
- `src/components/SearchBox.ts`, `src/components/ResultsList.ts`, `src/components/FilterChips.ts`
- `src/pages/index.astro`
- `tests/lib/search.test.ts`

**Validation**
- [x] Les tests de pertinence placent la bonne fiche dans le top 3 : « large files », « restart service », « delete pod », « undo last commit », « terraform plan », « list open ports », et « larg fles » (faute de frappe).
- [x] Recherche en moins de 50 ms sur 1000 fiches (benchmark Vitest avec des données générées).
- [x] Les filtres catégorie et tag se combinent avec la requête. L'état est dans l'URL et survit au rechargement.
- [x] Aucun résultat : un lien « Suggest this command » apparaît.

### - [x] J12 — Variables éditables + copie sécurisée
**Objectif** : adapter la commande puis la copier sans risque.
**Fichiers**
- `src/lib/template.ts` (parsing `{{nom}}` / `{{nom:défaut}}`, rendu final)
- `src/lib/copy.ts` (copie depuis la donnée, sans `\n` final, confirmation pour `destructive`)
- `src/components/CommandTemplate.ts`, `src/components/Toast.ts`
- `tests/lib/template.test.ts`, `tests/lib/copy.test.ts`

**Validation**
- [x] Le texte copié correspond exactement à la commande rendue avec les valeurs saisies (ou les valeurs par défaut).
- [x] Le texte copié ne finit jamais par `\n` et ne contient aucun caractère invisible.
- [x] Les valeurs saisies sont traitées comme du texte : aucune injection HTML possible (test avec `<img onerror>`).
- [x] La première copie d'une fiche `destructive` dans la session demande une confirmation, les suivantes non.
- [x] Le toast « Copied » est annoncé via `aria-live`.

### - [x] J13 — Navigation clavier + tests E2E
**Objectif** : tout faire au clavier, sous la protection de tests end-to-end.
**Fichiers**
- `src/lib/keyboard.ts`
- `src/components/KeyboardNav.ts` (branchement sur la page), `src/components/ShortcutsHelp.ts` + `.astro` (aide affichée avec `?`)
- `playwright.config.ts`, `compose.yaml` (service `e2e`, profil `test`), job `e2e` de la CI
- `tests/e2e/search.spec.ts`, `tests/e2e/keyboard.spec.ts`
- `Makefile` (`e2e`)

**Validation**
- [x] `make e2e` passe : `/` place le curseur dans la recherche, saisie de « large files », `↓`, `Entrée`, et le presse-papiers contient la bonne commande.
- [x] `Tab` passe d'une variable à l'autre, `o` ouvre la fiche, `Esc` efface, `?` affiche l'aide. (`f` est déplacé au J14, qui crée les favoris.)
- [x] Rôles ARIA `listbox` / `option` présents et option active annoncée.
- [x] Raccourcis cachés sur un écran tactile (test Playwright en émulation mobile).

### - [x] J14 — Favoris & historique locaux + export/import
**Objectif** : retrouver ses commandes sans compte.
**Fichiers**
- `src/lib/store.ts` (couche unique, clés versionnées `gmiyc:v1:*`, `try/catch`, limites 500 / 100)
- `src/pages/favorites.astro`, `src/pages/history.astro`
- `src/components/FavoriteButton.ts`, `src/components/ExportImport.ts`, `src/components/SavedList.astro` + `.ts`, `src/components/LocalStore.ts`, `src/lib/backup.ts`
- `tests/lib/store.test.ts`, `tests/e2e/favorites.spec.ts`

**Validation**
- [x] Les favoris et l'historique persistent après rechargement. L'historique ne garde que les copies (FIFO 100, favoris limités à 500).
- [x] `f` ajoute / retire la fiche sélectionnée des favoris (raccourci déplacé depuis le J13, ajouté à l'aide `?`).
- [x] « Clear history » vide l'historique.
- [x] L'export JSON puis l'import dans un navigateur vierge restituent les mêmes données. Un JSON malformé est refusé avec un message clair.
- [x] Avec `localStorage` indisponible (simulé), le site fonctionne sans erreur dans la console.
- [x] Les ids de fiches supprimées sont ignorés sans planter.

### - [x] J15 — Contributions & pages légales
**Objectif** : proposer ou signaler une commande en un clic, avec une attribution conforme.
**Fichiers**
- `.github/ISSUE_TEMPLATE/suggest-command.yml`, `.github/ISSUE_TEMPLATE/report-issue.yml`, `.github/ISSUE_TEMPLATE/config.yml`
- `src/lib/github.ts` (URL d'issue préremplies ; fichier existant étendu plutôt qu'un nouveau `github-links.ts`)
- `src/pages/about.astro` (attribution tldr-pages), `src/pages/privacy.astro`
- `LICENSE` (code, MIT, validé)
- `tests/lib/github.test.ts`, `tests/e2e/contribute.spec.ts`

**Validation**
- [x] « Suggest a command » (global et sur le résultat vide) ouvre le formulaire GitHub prérempli, avec la requête dans le titre.
- [x] « Report an issue » sur une fiche ouvre le formulaire avec l'id de la fiche.
- [x] Les URL générées sont correctement encodées (test avec caractères spéciaux).
- [x] La page About cite tldr-pages (CC BY 4.0, lien). La page Privacy décrit le stockage local et Umami.

### - [ ] J16 — Passe responsive, accessibilité & performance
**Objectif** : atteindre les exigences non fonctionnelles de la SPEC §8.
**Fichiers**
- `src/styles/*` (ajustements responsive)
- `tests/e2e/responsive.spec.ts` (viewports 375, 768, 1280 px)
- `tests/e2e/a11y.spec.ts` (`@axe-core/playwright`)
- `lighthouserc.json`, `.github/workflows/ci.yml` (job `lighthouse`), cible `make lighthouse`

**Validation**
- [x] Aucun scroll horizontal de la page à 375 px, et zones cliquables ≥ 44 px (test automatisé).
- [x] axe : 0 violation sérieuse ou critique sur l'accueil, une fiche, les favoris et la recherche vide.
- [x] Lighthouse mobile ≥ 95 sur les 4 axes, LCP < 1,5 s (Lighthouse CI dans la CI ; budget simulé 1,6 s, voir SPEC §8).
- [ ] Test manuel sur un vrai téléphone (iOS Safari ou Chrome Android) : recherche, copie, favoris. *(à faire par le mainteneur, au plus tard en J20)*

---

## Phase D — Analytics & production

### - [x] J17 — Analytics Umami (local)
**Objectif** : mesurer l'usage, en particulier les recherches sans résultat, sans cookies.
**Fichiers**
- `compose.yaml` (services `db` + `umami`, profil `analytics`, réseau interne), `compose.dev.yaml` (admin sur `127.0.0.1:3001`)
- ~~`docker/db/init/*.sql`~~ : inutile, Umami crée ses tables au démarrage
- `docker/nginx/nginx.conf` + `stats-proxy.conf` (routes `/stats/script.js` et `/stats/api/send`, rate limit sur la collecte, 404 ailleurs)
- `src/lib/analytics.ts` (`search_no_result`, `copy`, `favorite`, sans effet si Umami est absent) + `src/components/Stats.ts`
- `tests/lib/analytics.test.ts`, `tests/e2e/analytics.spec.ts`
- `.env.example`
- `Makefile` (`up-analytics`)

**Validation**
- [x] `make up-analytics` : les événements `copy` et `search_no_result` (requête tronquée à 100 caractères) apparaissent dans le tableau de bord Umami.
- [x] Aucun cookie déposé et aucune violation CSP.
- [x] Avec Umami arrêté, le site fonctionne normalement, sans erreur bloquante.
- [x] L'interface d'administration Umami n'est pas accessible via le proxy public (seulement en accès direct local ou par tunnel).

### - [x] J18 — Images de production + Compose prod (testés en local)
**Objectif** : les conteneurs de production tournent à l'identique sur le Mac.
**Fichiers**
- `docker/web.Dockerfile` (stages `build` → `prod` : build Astro, puis Nginx non-root `-slim`)
- `compose.prod.yaml` (images taguées, `read_only`, `cap_drop: [ALL]` sans exception, `no-new-privileges`, limites, healthchecks, rotation des logs, sur les trois services) ; `proxy` et `e2e` passent dans `compose.dev.yaml`
- `docker/nginx/nginx.prod.conf` (TLS, redirections `www` → apex et HTTP → HTTPS, `/healthz`, `try_files $uri $uri.html =404` : le build écrit `c/<id>.html` pour servir `/c/<id>`) + `csp.prod.conf`, `headers.prod.conf` (HSTS sur le domaine public seulement)
- `src/pages/404.astro` (page 404 du site, `noindex`), vérifiée par `check-dist`
- `scripts/make-local-cert.sh` (certificat auto-signé), `scripts/check-prod.sh`
- `tests/config/compose-prod.test.ts`, `tests/config/nginx.test.ts`, `tests/e2e/not-found.spec.ts`
- `Makefile` (`prod-local`, `prod-down`, `prod-logs`, `check-prod`, `scan`, `e2e-prod`), job CI `docker` (build `prod`, `nginx -t`, taille)

**Validation**
- [x] `make prod-local` sert le site complet sur `localhost` à partir de l'image de prod, sans bind mount de code (`make e2e-prod` : 108 tests verts derrière le Nginx de prod).
- [x] `docker inspect` confirme : non-root, système de fichiers en lecture seule, capacités retirées (`make check-prod`, pour `web`, `db` et `umami`).
- [x] `/healthz` renvoie 200, et le healthcheck Compose passe à `healthy`.
- [x] Image `web` de prod < 50 Mo (23 Mo). Trivy : 0 vulnérabilité critique (`make scan`, qui échoue bien sur une image ancienne).

### - [x] J19 — Pipeline de déploiement (build → GHCR → serveur)
**Objectif** : chaque merge sur `main` déploie automatiquement.
**Fichiers**
- `.github/workflows/deploy.yml` (build, Trivy **avant** le push, push GHCR tagué au SHA, SSH, `pull` + `up -d --wait`, healthcheck ; lancé à la main avec `sha` pour un rollback)
- `deploy/deploy.sh` (script appelé par la commande forcée SSH : `deploy <sha>` ou `status`, rollback automatique si la nouvelle version n'est pas saine)
- `deploy/setup-server.sh` (préparation du serveur, relançable : utilisateur `deploy`, commande forcée, durcissement SSH, `.env`, certificat temporaire)
- `deploy/README.md` (préparation du serveur : utilisateur, clé, pare-feu de l'hébergeur, Docker, `.env`, token GHCR, rollback)
- `tests/deploy/deploy-sh.test.ts`, `tests/config/deploy-workflow.test.ts`

**Validation**
- [x] Un merge sur `main` publie `ghcr.io/<owner>/grepmeifyoucan-web:<sha>` (merges de #25 puis #24 : deux déploiements automatiques, healthcheck externe `ok`).
- [x] Une vulnérabilité critique (simulée) bloque le déploiement (branche jetable avec `nginx-unprivileged:1.20.0-alpine` : 9 failles critiques, scan en échec, push et déploiement sautés).
- [x] La clé SSH de déploiement ne peut exécuter que `deploy.sh` : un test avec une autre commande est refusé (`ls`, injection, shell, TTY, sftp, redirection de port refusés ; seul `status` passe).
- [x] Le rollback `IMAGE_TAG=<sha précédent>` est testé et documenté (workflow lancé à la main avec `sha` : retour à #25 puis à #24, image et Postgres suivent ; `deploy/README.md`).

### - [x] J20 — Mise en ligne sur grepmeifyoucan.com
**Objectif** : le site est public, en HTTPS, durci et sauvegardé.
**Fichiers**
- `compose.prod.yaml` (services `certbot`, sous l'uid de Nginx, et `backup`, `pg_dump` quotidien)
- `docker/web-prod-entrypoint.sh` (Nginx + rechargement toutes les 6 h pour les certificats renouvelés)
- `deploy/setup-server.sh` (premier certificat, bascule du `.env`, dossier des sauvegardes), `deploy/init-cert-volumes.sh`
- `deploy/backup-pull.sh` + `make backup-pull` (copie hors serveur sur le Mac + test de restauration), `make lighthouse-prod` (`lighthouserc.prod.json`)
- `.github/workflows/deploy.yml` (healthcheck par le vrai DNS, certificat vérifié), HSTS 1 an
- `deploy/README.md` (DNS A + CAA, sans AAAA ; certificat ; sauvegarde et restauration ; admin Umami)
- `tests/deploy/prod-loops.test.ts`, `tests/deploy/backup-pull.test.ts`, `tests/config/lighthouse-prod.test.ts`

**Validation**
- [x] `https://grepmeifyoucan.com` répond ; `http://` et `www` redirigent en 301 vers `https://grepmeifyoucan.com` (certificat Let's Encrypt pour l'apex et `www`, healthcheck du déploiement par le vrai DNS).
- [x] Note A sur securityheaders.com (vérifiée par le mainteneur dans un navigateur ; le site refuse les requêtes automatisées), et A sur SSL Labs.
- [x] Depuis l'extérieur, seuls les ports 22, 80 et 443 sont ouverts (`nmap` : 22, 80, 443 ouverts, 4000/9090/9100 filtrés ; les autres ports « ouverts » répondaient aussi pour 8.8.8.8 et 1.1.1.1, donc interceptés par le réseau local du test ; côté serveur, `ss` ne montre que 22, 80, 443 en écoute publique hors ports filtrés).
- [x] Le renouvellement du certificat est testé (`certbot renew --dry-run` dans le conteneur `certbot` : succès ; clé privée `600` à l'uid 101).
- [x] Une sauvegarde est produite, et sa restauration est testée sur une base vierge (`make backup-pull` : 27 tables restaurées dans un PostgreSQL jetable).
- [x] Lighthouse en production ≥ 95 sur mobile (`make lighthouse-prod` : 100 sur les 4 catégories et les 4 pages, LCP 0,8 à 1 s, CLS ≤ 0,001).

**À prévoir (relevé en J18)**
- Nginx tourne sous l'uid 101 : la clé privée écrite par certbot (root, `600`) doit lui rester lisible (groupe ou hook de déploiement).
- Premier démarrage : `nginx.prod.conf` exige un certificat. Il faut donc en obtenir un avant le premier `up` (certificat temporaire ou certbot en mode `standalone`).
- ~~Passer HSTS de `max-age=300` à 1 an une fois le site stable.~~ Fait (sans `preload`).

---

## Points à trancher en cours de route
- [ ] Licence du code (MIT proposée), avant J15.
- [x] OS et taille du serveur, avant J19 : VPS Hostinger, Ubuntu 26.04 LTS, 1 vCPU, 4 Go (SPEC §6.7).
- [ ] Action « issue acceptée → PR » automatique : à ajouter après J20 si le volume de propositions le justifie.
