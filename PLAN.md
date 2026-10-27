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

### - [ ] J11 — Recherche instantanée + filtres
**Objectif** : trouver une commande en tapant quelques mots, avec tolérance aux fautes.
**Fichiers**
- `src/pages/search-index.json.ts` (index généré au build)
- `src/lib/search.ts` (MiniSearch, pondération titre > outil > tags > commande > description)
- `src/components/SearchBox.ts`, `src/components/ResultsList.ts`, `src/components/FilterChips.ts`
- `src/pages/index.astro`
- `tests/lib/search.test.ts`

**Validation**
- [ ] Les tests de pertinence placent la bonne fiche dans le top 3 : « large files », « restart service », « delete pod », « undo last commit », « terraform plan », « list open ports », et « larg fles » (faute de frappe).
- [ ] Recherche en moins de 50 ms sur 1000 fiches (benchmark Vitest avec des données générées).
- [ ] Les filtres catégorie et tag se combinent avec la requête. L'état est dans l'URL et survit au rechargement.
- [ ] Aucun résultat : un lien « Suggest this command » apparaît.

### - [ ] J12 — Variables éditables + copie sécurisée
**Objectif** : adapter la commande puis la copier sans risque.
**Fichiers**
- `src/lib/template.ts` (parsing `{{nom}}` / `{{nom:défaut}}`, rendu final)
- `src/lib/copy.ts` (copie depuis la donnée, sans `\n` final, confirmation pour `destructive`)
- `src/components/CommandTemplate.ts`, `src/components/Toast.ts`
- `tests/lib/template.test.ts`, `tests/lib/copy.test.ts`

**Validation**
- [ ] Le texte copié correspond exactement à la commande rendue avec les valeurs saisies (ou les valeurs par défaut).
- [ ] Le texte copié ne finit jamais par `\n` et ne contient aucun caractère invisible.
- [ ] Les valeurs saisies sont traitées comme du texte : aucune injection HTML possible (test avec `<img onerror>`).
- [ ] La première copie d'une fiche `destructive` dans la session demande une confirmation, les suivantes non.
- [ ] Le toast « Copied » est annoncé via `aria-live`.

### - [ ] J13 — Navigation clavier + tests E2E
**Objectif** : tout faire au clavier, sous la protection de tests end-to-end.
**Fichiers**
- `src/lib/keyboard.ts`
- `src/components/ShortcutsHelp.ts` (aide affichée avec `?`)
- `playwright.config.ts`, `compose.yaml` (service `e2e`, profil `test`)
- `tests/e2e/search.spec.ts`, `tests/e2e/keyboard.spec.ts`
- `Makefile` (`e2e`)

**Validation**
- [ ] `make e2e` passe : `/` place le curseur dans la recherche, saisie de « large files », `↓`, `Entrée`, et le presse-papiers contient la bonne commande.
- [ ] `Tab` passe d'une variable à l'autre, `f` ajoute aux favoris, `o` ouvre la fiche, `Esc` efface, `?` affiche l'aide.
- [ ] Rôles ARIA `listbox` / `option` présents et option active annoncée.
- [ ] Raccourcis cachés sur un écran tactile (test Playwright en émulation mobile).

### - [ ] J14 — Favoris & historique locaux + export/import
**Objectif** : retrouver ses commandes sans compte.
**Fichiers**
- `src/lib/store.ts` (couche unique, clés versionnées `gmiyc:v1:*`, `try/catch`, limites 1000 / 200)
- `src/pages/favorites.astro`, `src/pages/history.astro`
- `src/components/FavoriteButton.ts`, `src/components/ExportImport.ts`
- `tests/lib/store.test.ts`, `tests/e2e/favorites.spec.ts`

**Validation**
- [ ] Les favoris et l'historique persistent après rechargement. L'historique ne garde que les copies (FIFO 200).
- [ ] « Clear history » vide l'historique.
- [ ] L'export JSON puis l'import dans un navigateur vierge restituent les mêmes données. Un JSON malformé est refusé avec un message clair.
- [ ] Avec `localStorage` indisponible (simulé), le site fonctionne sans erreur dans la console.
- [ ] Les ids de fiches supprimées sont ignorés sans planter.

### - [ ] J15 — Contributions & pages légales
**Objectif** : proposer ou signaler une commande en un clic, avec une attribution conforme.
**Fichiers**
- `.github/ISSUE_TEMPLATE/suggest-command.yml`, `.github/ISSUE_TEMPLATE/report-issue.yml`, `.github/ISSUE_TEMPLATE/config.yml`
- `src/lib/github-links.ts` (URL d'issue préremplies)
- `src/pages/about.astro` (attribution tldr-pages), `src/pages/privacy.astro`
- `LICENSE` (code, MIT sous réserve de validation)
- `tests/lib/github-links.test.ts`

**Validation**
- [ ] « Suggest a command » (global et sur le résultat vide) ouvre le formulaire GitHub prérempli, avec la requête dans le titre.
- [ ] « Report an issue » sur une fiche ouvre le formulaire avec l'id de la fiche.
- [ ] Les URL générées sont correctement encodées (test avec caractères spéciaux).
- [ ] La page About cite tldr-pages (CC BY 4.0, lien). La page Privacy décrit le stockage local et Umami.

### - [ ] J16 — Passe responsive, accessibilité & performance
**Objectif** : atteindre les exigences non fonctionnelles de la SPEC §8.
**Fichiers**
- `src/styles/*` (ajustements responsive)
- `tests/e2e/responsive.spec.ts` (viewports 375, 768, 1280 px)
- `tests/e2e/a11y.spec.ts` (`@axe-core/playwright`)
- `lighthouserc.json`, `.github/workflows/ci.yml` (étapes E2E + Lighthouse CI)

**Validation**
- [ ] Aucun scroll horizontal de la page à 375 px, et zones cliquables ≥ 44 px (test automatisé).
- [ ] axe : 0 violation sérieuse ou critique sur l'accueil, une fiche, les favoris et la recherche vide.
- [ ] Lighthouse mobile ≥ 95 sur les 4 axes, LCP < 1,5 s (Lighthouse CI dans la CI).
- [ ] Test manuel sur un vrai téléphone (iOS Safari ou Chrome Android) : recherche, copie, favoris.

---

## Phase D — Analytics & production

### - [ ] J17 — Analytics Umami (local)
**Objectif** : mesurer l'usage, en particulier les recherches sans résultat, sans cookies.
**Fichiers**
- `compose.yaml` (services `db` + `umami`, profil `analytics`)
- `docker/db/init/*.sql`
- `docker/nginx/nginx.conf` (routes `/stats/*`, rate limit sur la collecte)
- `src/lib/analytics.ts` (`search_no_result`, `copy`, `favorite`, sans effet si Umami est absent)
- `.env.example`
- `Makefile` (`up-analytics`)

**Validation**
- [ ] `make up-analytics` : les événements `copy` et `search_no_result` (requête tronquée à 100 caractères) apparaissent dans le tableau de bord Umami.
- [ ] Aucun cookie déposé et aucune violation CSP.
- [ ] Avec Umami arrêté, le site fonctionne normalement, sans erreur bloquante.
- [ ] L'interface d'administration Umami n'est pas accessible via le proxy public (seulement en accès direct local ou par tunnel).

### - [ ] J18 — Images de production + Compose prod (testés en local)
**Objectif** : les conteneurs de production tournent à l'identique sur le Mac.
**Fichiers**
- `docker/web.Dockerfile` (stage `prod` : build Astro → Nginx non-root)
- `compose.prod.yaml` (images taguées, `read_only`, `cap_drop`, `no-new-privileges`, limites, healthchecks, rotation des logs)
- `docker/nginx/nginx.prod.conf` (TLS, redirections `www` → apex et HTTP → HTTPS, `/healthz`, `try_files $uri $uri.html =404` : le build écrit `c/<id>.html` pour servir `/c/<id>`)
- `Makefile` (`prod-local`)

**Validation**
- [ ] `make prod-local` sert le site complet sur `localhost` à partir de l'image de prod, sans bind mount de code.
- [ ] `docker inspect` confirme : non-root, système de fichiers en lecture seule, capacités retirées.
- [ ] `/healthz` renvoie 200, et le healthcheck Compose passe à `healthy`.
- [ ] Image `web` de prod < 50 Mo. Trivy : 0 vulnérabilité critique.

### - [ ] J19 — Pipeline de déploiement (build → GHCR → serveur)
**Objectif** : chaque merge sur `main` déploie automatiquement.
**Fichiers**
- `.github/workflows/deploy.yml` (build, push GHCR tagué au SHA, Trivy, SSH, `pull` + `up -d`, healthcheck)
- `deploy/deploy.sh` (script appelé par la commande forcée SSH)
- `deploy/README.md` (préparation du serveur : utilisateur, clé, pare-feu, Docker, `.env`)

**Validation**
- [ ] Un merge sur `main` publie `ghcr.io/<owner>/grepmeifyoucan-web:<sha>`.
- [ ] Une vulnérabilité critique (simulée) bloque le déploiement.
- [ ] La clé SSH de déploiement ne peut exécuter que `deploy.sh` : un test avec une autre commande est refusé.
- [ ] Le rollback `IMAGE_TAG=<sha précédent>` est testé et documenté.

### - [ ] J20 — Mise en ligne sur grepmeifyoucan.com
**Objectif** : le site est public, en HTTPS, durci et sauvegardé.
**Fichiers**
- `compose.prod.yaml` (service `certbot`)
- `deploy/backup.sh` (`pg_dump` Umami, copie hors serveur)
- `deploy/README.md` (DNS A/AAAA + CAA, restauration)

**Validation**
- [ ] `https://grepmeifyoucan.com` répond ; `http://` et `www` redirigent en 301 vers `https://grepmeifyoucan.com`.
- [ ] Note A ou plus sur securityheaders.com, et A sur SSL Labs.
- [ ] Depuis l'extérieur, seuls les ports 22, 80 et 443 sont ouverts (`nmap`).
- [ ] Le renouvellement du certificat est testé (`certbot renew --dry-run`).
- [ ] Une sauvegarde est produite, et sa restauration est testée sur une base vierge.
- [ ] Lighthouse en production ≥ 95 sur mobile.

---

## Points à trancher en cours de route
- [ ] Licence du code (MIT proposée), avant J15.
- [ ] OS et taille du serveur, avant J19.
- [ ] Action « issue acceptée → PR » automatique : à ajouter après J20 si le volume de propositions le justifie.
