# GrepMeIfYouCan — Spécification v1

> Trouver la bonne commande Linux / Infra / DevOps en moins de 10 secondes.

## 1. Vision & utilisateurs

**Cible principale : l'ingénieur confirmé et pressé** (SysAdmin Linux, Infra, DevOps, SRE).
Il connaît déjà l'outil mais a oublié la syntaxe exacte ou les bons flags. Il veut trouver, adapter et copier une commande sans quitter son flux de travail.

Conséquences de conception :
- La vitesse prime sur la pédagogie : pas de tutoriels, des descriptions d'une ligne.
- Tout doit être faisable au clavier sur desktop, et rester fluide sur mobile (consultation en astreinte, depuis le téléphone).
- Le site est en **anglais uniquement** (contenu et interface).

### Indicateurs de succès
- Une commande pertinente apparaît dans le top 3 pour une requête courante (« large files », « restart service », « delete pod »…).
- Moins de 10 s entre l'arrivée sur le site et la commande copiée.
- Recherches sans résultat suivies via l'analytics, pour orienter l'enrichissement du contenu.

## 2. Périmètre fonctionnel v1

### 2.1 Unité de contenu : la fiche
**Une fiche = un cas d'usage = une commande.** Exemple : « Find files larger than 1 GB » → `find {{path}} -size +{{1G}}`.
Une fiche n'est pas une page outil. La page outil (`find`) regroupe les fiches qui l'utilisent.

### 2.2 Domaines (catégories) v1
| Catégorie   | Exemples d'outils |
|-------------|-------------------|
| `linux`     | find, grep, ss, lsof, du, df, systemctl, journalctl, chmod, tar |
| `unix`      | outils propres aux autres Unix (BSD…) : rcctl |
| `containers`| docker, podman, kubectl, helm |
| `cloud-iac` | terraform, ansible, aws, gcloud, az |
| `git-ci`    | git, gh |

**Volume au lancement : environ 50 fiches par catégorie (≈ 200 au total)**, issues de tldr-pages (voir §4). La catégorie `unix` (ajoutée après la mise en ligne, avec la suggestion #30) démarre avec les fiches proposées par les visiteurs.

### 2.3 Recherche
- Barre de recherche toujours visible, focus avec `/` ou `⌘K` / `Ctrl+K`.
- **Recherche fuzzy instantanée, côté client**, à chaque frappe, sans appel réseau.
  - Champs indexés et pondérés : titre > nom de l'outil > tags > commande > description.
  - Tolérance aux fautes de frappe, recherche par préfixe. Fautes admises par mot : aucune jusqu'à 3 lettres, 1 jusqu'à 6, 2 au-delà (une inversion de deux lettres compte pour 2).
  - Les fiches qui contiennent tous les mots de la requête viennent en premier, puis celles qui en contiennent au moins un (« list open ports » trouve aussi une fiche qui ne dit jamais « open »).
  - Lib : MiniSearch (de préférence) ou Fuse.js.
  - Au plus 50 résultats affichés ; la ligne de statut indique le total.
- **Filtres** par catégorie (chips, une seule à la fois) et par tag (plusieurs possibles, combinés en ET ; on ajoute un tag en cliquant sur un tag d'une fiche). Ils se combinent avec la requête.
- L'état de la recherche est reflété dans l'URL (`?q=large+files&cat=linux&tag=disk`), donc partageable. Les tags d'une fiche pointent vers `/?tag=<tag>`.
- Sans requête ni filtre, l'accueil affiche la liste des catégories.
- Un état « aucun résultat » propose un lien « Suggest this command » (formulaire d'issue prérempli avec la requête).

### 2.4 Fiche commande
Chaque fiche affiche :
- son titre (le besoin, ex. « Find files larger than a given size ») ;
- sa **description courte, obligatoire** : une phrase qui explique ce que fait la commande (ex. « Recursively lists regular files above the size threshold, starting from the given path. »). Elle est affichée directement dans la liste de résultats, sans clic, et elle est indexée par la recherche ;
- la commande en police monospace, avec les **variables éditables** ;
- un badge **niveau de danger** ;
- l'outil, la catégorie et les tags (cliquables pour filtrer) ;
- les actions : **Copier**, **Favori ★**, et **Report an issue** sur la page de la fiche ;
- la source et l'attribution (ex. « Adapted from tldr-pages, CC BY 4.0 »).

Chaque fiche a aussi sa propre page statique (`/c/<id>`) pour le SEO et le partage de lien. Les outils et les catégories ont aussi la leur (`/tools/<tool>`, `/categories/<category>`). Les URL n'ont pas de slash final (fichiers `c/<id>.html`). Chaque page a un `<title>`, une meta description (pour une fiche : sa description), une URL canonique et des balises Open Graph, et figure dans `sitemap-index.xml`. Une URL inconnue renvoie une page 404 au style du site (`404.astro`, servie par Nginx), en `noindex`, sans URL canonique et hors sitemap ; une URL avec slash final redirige en 301 vers la version sans slash. `scripts/check-dist.ts` vérifie tout cela en CI après le build.

### 2.5 Variables éditables
- Syntaxe dans les données : `{{nom}}` ou `{{nom:valeur_par_défaut}}`, compatible avec les placeholders tldr.
  - Le nom s'arrête au **premier** `:` ; la valeur par défaut peut elle-même contenir `:` (ex. `{{url:https://example.com}}`). Le nom peut contenir `/` (ex. `{{path/to/file}}`, repris de tldr).
- À l'affichage, chaque variable devient un champ inline. La commande copiée contient les valeurs saisies, ou la valeur par défaut.
- `Tab` passe d'une variable à la suivante.
- Les valeurs saisies sont injectées **telles quelles** comme texte, sans échappement shell automatique. Une info-bulle le rappelle.
- Une variable utilisée plusieurs fois dans la commande n'a qu'une valeur : modifier un champ met à jour les autres.
- **Report entre fiches** : une valeur saisie pour une variable (ex. `path`) remplit la variable de même nom des autres fiches de la page, y compris les résultats affichés ensuite. Vider le champ la retire partout. Les valeurs restent en mémoire (jamais stockées). Les fiches `destructive` ne reçoivent **jamais** une valeur reportée : leurs valeurs se saisissent dans la fiche elle-même.
- Champ vide sans valeur par défaut : la commande copiée contient le nom de la variable, sauf sur une fiche `destructive`, où la copie est bloquée tant que le champ est vide (« Fill in <name> first »).
- Les caractères invisibles et bidi saisis ou collés sont retirés ; les retours à la ligne, tabulations et caractères de contrôle deviennent une espace.

### 2.6 Copie en un clic
- Bouton Copier, et `Entrée` sur le résultat sélectionné.
- Un toast « Copied » s'affiche.
- Règles de copie sécurisée : voir §7.3.

### 2.7 Niveau de danger
| Niveau        | Exemples | Rendu |
|---------------|----------|-------|
| `safe`        | lecture seule (`ls`, `kubectl get`) | aucun badge |
| `caution`     | modifie l'état (`systemctl restart`, `git reset --soft`) | badge orange |
| `destructive` | perte de données possible (`rm -rf`, `dd`, `terraform destroy`, `git push --force`, `kubectl delete`) | badge rouge + avertissement visible + confirmation au premier copier de la session |

### 2.8 Favoris & historique (stockage local uniquement)
- **Pas de compte utilisateur en v1.** Favoris et historique sont stockés **uniquement dans le navigateur** (`localStorage`) et ne quittent jamais l'appareil.
- Il n'y a donc pas de synchronisation entre appareils : le laptop et le téléphone ont chacun leurs propres favoris.
- **Historique** : uniquement les **commandes copiées** (id de la fiche + date), au maximum 100 entrées (FIFO), avec un bouton « Clear history » (avec confirmation). Recopier une fiche la remonte en tête, sans doublon. Les requêtes de recherche ne sont jamais historisées.
- **Favoris** : maximum 500. Au-delà, l'ajout est refusé avec un message (aucun favori n'est supprimé).
- Une vue dédiée « Favorites » et « History » est accessible depuis le header.
- **Export / import JSON** des favoris et de l'historique : sauvegarde manuelle ou transfert vers un autre appareil.
  - Format : `{ "format": "grepmeifyoucan", "version": 1, "exportedAt", "favorites": [{ "id", "at" }], "history": [{ "id", "at" }] }` (`at` en millisecondes).
  - L'import **fusionne** avec les données présentes (union par id, date la plus récente gardée, tri du plus récent au plus ancien). Si la fusion dépasse les limites, les entrées les plus anciennes sont écartées et le message le signale.
  - Un fichier de plus de 1 Mo, un JSON invalide, un autre format ou une autre version sont refusés avec un message clair, sans rien modifier. Les entrées invalides d'un export valide sont ignorées.
- Robustesse :
  - lectures et écritures dans `try/catch` : le site fonctionne même si le stockage est indisponible (navigation privée, stockage plein) ;
  - format versionné (`gmiyc:v1:favorites`…) pour pouvoir migrer plus tard ;
  - les ids de fiches supprimées sont ignorés silencieusement.
- Toute la logique passe par une couche « store » unique, pour pouvoir brancher une synchronisation serveur en v2 sans toucher à l'UI.

### 2.9 Contributions
Il n'y a **aucun formulaire de soumission intégré au site**. Tout passe par GitHub :
- Lien global **« Suggest a command »** (pied de page, et message « aucun résultat » de la recherche) → formulaire d'*issue* GitHub `suggest-command.yml` reprenant les champs d'une fiche, avec un exemple dans chacun : titre, commande, description (obligatoires), catégorie, tags, plateformes (Linux, macOS, Unix), niveau de danger supposé, source. Depuis une recherche vide, la requête (nettoyée, 100 caractères max) préremplit le titre de l'issue et le titre de la fiche (champ `card-title`, car `title` est réservé au titre de l'issue).
- Les liens vers GitHub (Suggest, Report) s'ouvrent dans un **nouvel onglet** (↗, annoncé aux lecteurs d'écran) : le visiteur ne quitte pas le site.
- Lien **« Report an issue »** sur la page de chaque fiche (`/c/<id>`, pas sur les lignes des listes) → formulaire `report-issue.yml` prérempli avec l'id et l'URL de la fiche ; type de problème et détails à remplir.
- Les champs sont préremplis par les paramètres d'URL nommés d'après leur `id` dans le formulaire (`src/lib/github.ts`) ; un test vérifie que ces `id` existent. Les issues vides sont désactivées (`config.yml`). Labels : `suggestion`, `report`.
- Traitement : relecture par le mainteneur. Option : une GitHub Action convertit une issue labellisée `accepted` en PR qui contient le fichier YAML. **Aucune publication sans merge manuel.**

## 3. Design & UX

### 3.1 Direction : « Terminal sur papier »
Référence : maquette « oneliner » (fond papier, encre noire, accent orange, bandes de terminal noires).
- **Thème clair (papier) par défaut**, thème sombre disponible (même palette : fond encre, texte papier, même orange, même jaune). Le choix est mémorisé, et `prefers-color-scheme: dark` est respecté au premier chargement.
- Polices auto-hébergées en woff2 (sous-ensemble latin + flèches) : **DejaVu Sans Mono** pour les commandes et l'interface technique, **TeX Gyre Heros** pour le texte, **TeX Gyre Heros Cn** (gras) pour les titres. Licences libres (Bitstream Vera / DejaVu, GUST Font License), fournies dans `public/fonts/`. Elles sont en `font-display: optional` (utilisées si elles sont prêtes au premier affichage, jamais échangées en cours de page) ; les polices de secours de la mono sont ajustées à la même largeur (`size-adjust`), pour que le texte ne bouge jamais.
- Le thème est appliqué avant le premier affichage par un petit script externe bloquant (`/theme-init.js`), compatible CSP. Sans JavaScript, le site reste en thème clair et le bouton de thème est masqué.
- Briques communes à toutes les pages : barre de recherche noire avec prompt `$` orange, chips carrées, **lignes numérotées** (`01`, `02`…) avec titre, commande et bouton `COPY`, valeurs éditables surlignées en jaune, barre de raccourcis noire en bas. Pas de coins arrondis, d'ombres, de dégradés ni d'emojis.
- La ligne active (clavier) porte une barre orange à gauche, une commande plus grande, un rappel des touches et un bouton `COPY ↵` orange. Le bouton `COPY` d'une fiche `destructive` est rouge-orangé.
- Couleurs : l'orange vif `#ff4a12` sert de fond (bouton, prompt, position) ; un orange plus foncé sert au texte et au focus pour respecter WCAG AA. Les couleurs de danger (ambre, rouge-orangé) sont réservées au danger.

### 3.2 Navigation clavier (desktop)
| Touche | Action |
|--------|--------|
| `/` ou `⌘K` (`Ctrl K`) | Focus recherche |
| `↑` `↓` (`Début` / `Fin`) | Naviguer dans les résultats |
| `Entrée` | Copier la commande sélectionnée (ou celle de la variable en cours d'édition) |
| `Tab` | Éditer les variables de la fiche sélectionnée |
| `f` | Ajouter / retirer des favoris |
| `o` | Ouvrir la page de la fiche |
| `Esc` | Effacer / quitter le champ |
| `?` | Afficher l'aide des raccourcis |

- À l'arrivée sur l'accueil, le curseur est dans la recherche (après une requête restaurée depuis l'URL), sauf si le visiteur a déjà déplacé le focus ou si l'URL vise une ancre. Jamais sur écran tactile : le clavier virtuel masquerait la page.
- Chaque liste de fiches (résultats, pages outil et catégorie) reste une liste simple : les flèches déplacent le **vrai focus** d'une fiche à l'autre (*roving tabindex* : la fiche active est le seul arrêt `Tab` de la liste). Chaque fiche (`article`) est nommée par son titre, et la ligne active porte `aria-current`. Ses liens, valeurs et boutons restent atteignables (une `listbox` ne peut pas en contenir). Les flèches `↑` `↓` marchent aussi depuis une valeur, un lien ou un bouton d'une fiche (après `Tab`) ; hors d'une fiche, elles gardent leur effet normal (défilement). Dans la recherche, `↓` entre dans les résultats sur la première fiche. Les lettres (`o`, `f`, `?`) restent donc tapables dans la recherche et dans les variables.
- `Esc` vide la recherche (puis en sort si elle est déjà vide). Depuis une variable, il revient à sa fiche, et depuis une fiche à la recherche.
- La copie au clavier suit les mêmes règles que le bouton Copier (confirmation des commandes destructives).
- L'aide `?` est aussi ouverte par un bouton « Keyboard shortcuts » en pied de page, masqué sans JavaScript et sur écran tactile.
- Une **barre de raccourcis** noire, collée en bas de l'écran, s'affiche tant qu'une liste de fiches est visible (≥ 640 px, jamais sur écran tactile) : position de la ligne active (`01/07`) et touches principales. Elle est décorative (`aria-hidden`) : l'aide `?` contient les mêmes informations.

### 3.3 Responsive
- Conception **mobile-first**. Breakpoints : < 640 px (mobile), 640–1024 px (tablette), > 1024 px (desktop).
- Mobile : liste tactile, zones cliquables ≥ 44 px, filtres en chips défilantes horizontalement, bouton Copier toujours visible. Pour afficher plus de résultats par écran, chaque ligne met Favori et Copier en haut à droite, à côté du titre, masque les tags et limite la description à deux lignes. Aucun scroll horizontal de la page : les commandes longues défilent dans leur propre bloc.
- Les raccourcis clavier sont désactivés ou cachés sur les écrans tactiles (`(hover: none) and (pointer: coarse)`) : pas de raccourci, pas d'aide, pas de ligne active ni de rappel de touches (même si la navigation clavier a démarré, par exemple dans l'émulation mobile d'un navigateur de bureau).

### 3.4 Accessibilité
- WCAG 2.2 niveau AA : contrastes vérifiés dans les deux thèmes, focus visible, fiches nommées par leur titre et ligne active en `aria-current`, annonce du toast « Copied » via `aria-live`. Vérifié par axe (`tests/e2e/a11y.spec.ts`) : 0 violation sérieuse ou critique dans les deux thèmes.

## 4. Contenu

### 4.1 Format
Une fiche = un fichier YAML dans `content/commands/<category>/<id>.yaml` :
```yaml
id: find-files-larger-than
title: Find files larger than a given size
description: Recursively list files above a size threshold.
command: find {{path:/}} -type f -size +{{size:1G}}
tool: find
category: linux
tags: [disk, cleanup, files]
danger: safe            # safe | caution | destructive
platforms: [linux]      # optionnel : linux | macos | unix
source:
  type: tldr            # tldr | original
  page: common/find.md
  commit: <sha tldr épinglé>
  license: CC-BY-4.0
  example: 1            # optionnel : numéro de l'exemple dans la page tldr (à partir de 1)
```
- Le schéma est validé au build (Zod ou JSON Schema). Tout fichier invalide fait échouer la CI.
- `id` est unique et sert de slug d'URL.
- `description` est **obligatoire** : une seule phrase courte (≤ 180 caractères) qui explique ce que fait la commande, et pas seulement le besoin. La CI rejette une description vide, trop longue, de plus d'une phrase ou identique au titre.
  - « Une phrase » : refusée si elle contient `.`, `!` ou `?` suivi d'un espace puis d'une majuscule. Les abréviations (« e.g. ») et les versions (« v1.2 ») restent acceptées.
  - « Identique au titre » : comparaison insensible à la casse et à la ponctuation finale.
- `id` doit être égal au nom du fichier, et `category` au nom du dossier. Les champs inconnus sont refusés.
- **Règles de rédaction** (appliquées depuis J7) :
  - `title` : le besoin, ≈ 60 caractères ; `id` : court et lisible (`grep-recursive`), pas dérivé mécaniquement du titre tldr.
  - `description` : une phrase au présent, 3e personne (« Lists… », « Deletes… »), qui dit ce que fait la commande et ses effets de bord.
  - `command` : options courtes idiomatiques (`du -sh`, `grep -rn`, `tar -xzf`) car les formes longues GNU échouent sur macOS ; forme longue seulement si elle est plus claire et peu connue en court (`--dry-run`, `--tail`). `sudo` quand la commande l'exige sur un système standard.
  - Variables : noms courts en snake_case (`{{path:.}}`, `{{lines:100}}`), valeur par défaut seulement si elle est évidente et sans risque ; **jamais de valeur par défaut pour la cible d'une commande destructive**.
  - `platforms` : `[linux]` pour ce qui est propre à Linux (systemd, `ss`, options GNU), `[linux, macos]` seulement si la commande a été vérifiée sur macOS ; `[unix]` pour ce qui est propre à un autre Unix (catégorie `unix`), avec le système précis dans le titre (« (OpenBSD) ») et en tag (`openbsd`), car la plateforme n'apparaît que sur la page de la fiche ; omis pour les autres catégories.
  - Fiche adaptée d'un exemple tldr : `source.type: tldr` avec `example`. Fiche écrite sans exemple tldr : `source.type: original`.
- La validation tourne avant chaque build (`npm run build` = `lint-content` + `astro build`), et Astro revalide aussi chaque fiche avec le même schéma Zod.

### 4.2 Import initial depuis tldr-pages
- **Script d'import ponctuel** (`scripts/import-tldr.ts`) exécuté localement, pas au build :
  1. Lit tldr-pages à un **commit épinglé**, pages en anglais (`pages/common`, `pages/linux`). Seules les pages retenues sont téléchargées depuis `raw.githubusercontent.com/<repo>/<sha>/pages/…` (l'image Docker n'a pas `git`), avec un cache local `.cache/tldr/<sha>/` ignoré par git.
  2. Sélection d'une liste explicite d'outils par catégorie (voir §2.2) pour atteindre environ 50 exemples par catégorie.
  3. Chaque exemple tldr devient une fiche : texte de l'exemple tldr → `title`, ligne de code → `command`. Les placeholders `{{...}}` sont conservés. tldr ne fournit pas de phrase expliquant ce que fait la commande : la `description` est donc **rédigée pour chaque fiche importée** (brouillon possible, puis relue dans la PR d'import). Une fiche sans description valide ne passe pas la CI.
  4. Le `danger` est pré-rempli par le linter (voir §7.2), puis revu manuellement.
  5. Conversion des placeholders tldr : `{{path/to/file}}` est conservé ; `{{[-r|--recursive]}}` et `{{[ps|container ls]}}` deviennent la forme longue écrite en dur ; une URL devient `{{url:<URL>}}` ; tout autre `:` dans un placeholder devient `_` (signalé à la relecture). Les exemples avec accolades échappées (`\{\{`), accolades ambiguës (`{{{`), caractères non ASCII ou invisibles sont écartés et listés dans le rapport.
  6. Sortie : `content/drafts/<category>/<id>.yaml` (`description` vide), exclue du build et de `lint-content`, mais vérifiée par `lint-danger` en CI. L'import est idempotent : un brouillon existant n'est jamais écrasé sans `--force`, et une fiche déjà publiée (même id, ou même `source.page` + `source.example`) n'est pas recréée, même si son titre et sa commande ont été réécrits. Un exemple écarté à la relecture est aussi retiré de `scripts/tldr-selection.yaml`.
- Le résultat est commité via **une PR relue** comme n'importe quelle contribution.
- **Licence** : tldr-pages est sous CC BY 4.0. Attribution sur chaque fiche importée + page `/about` + fichier `CONTENT_LICENSE`. Le contenu original du site est publié sous CC BY 4.0, le code sous licence MIT (`LICENSE`).

## 5. Données & vie privée

- **Aucun compte, aucune donnée personnelle stockée côté serveur en v1.**
- Données conservées sur l'appareil de l'utilisateur uniquement : favoris, historique de copie, thème choisi (clé `gmiyc:v1:theme`).
- Analytics Umami sans cookies et sans données personnelles (voir §6.4). Les logs Nginx ont une rétention limitée (14 jours).
- Une page « Privacy » explique ces points simplement.
- **Comptes utilisateurs (OAuth GitHub/Google) et synchronisation multi-appareils : reportés en v2** (voir §9).

## 6. Architecture technique

### 6.1 Vue d'ensemble
```
                 ┌──────── Serveur (Docker Compose, Nginx, TLS) ──────────────┐
Navigateur ──►   │  /            → fichiers statiques Astro (build CI)        │
                                  │  /stats/*     → Umami (analytics self-hosted)              │
                 │                  └── PostgreSQL (données Umami uniquement)  │
                 └────────────────────────────────────────────────────────────┘
```
- **Site 100 % statique, pas d'API en v1.** Le seul composant dynamique est Umami (analytics).
- **Même domaine** pour le site et les stats : pas de CORS, CSP simple.
- **Domaine de production : `grepmeifyoucan.com`**. URL canonique `https://grepmeifyoucan.com` ; `www.grepmeifyoucan.com` redirige en 301 vers l'apex.
  - `PUBLIC_BASE_URL=https://grepmeifyoucan.com` : utilisé pour le sitemap, les URL canoniques et les liens de partage. Valeur par défaut si la variable est absente (en CI par exemple).
  - Certificat TLS Let's Encrypt pour l'apex et `www` ; HSTS activé progressivement (`max-age=300` jusqu'à la mise en ligne, 1 an depuis J20 ; `preload` envisagé plus tard, car difficile à annuler).
  - DNS : enregistrements A (apex et `www`) vers le serveur, CAA limité à Let's Encrypt. Pas d'AAAA en v1 : Docker ne publie 80/443 qu'en IPv4, et un AAAA sans écoute IPv6 casse le site pour les visiteurs IPv6 (et la validation Let's Encrypt, qui essaie l'IPv6 d'abord). L'IPv6 demandera un réseau Docker IPv6 et `listen [::]`.

### 6.2 Front
- **Astro + TypeScript**, génération statique : une page par fiche, par outil et par catégorie, plus l'accueil.
- Îlots interactifs (recherche, variables, favoris) en TS léger, éventuellement avec Preact ou Solid si nécessaire. Le JS de la page d'accueil reste léger.
- Index de recherche généré au build (`/search-index.json`), chargé à la première interaction ou en idle, et mis en cache.
- Les fonctions de favoris et d'historique passent par une couche « store » unique, basée sur `localStorage` (voir §2.8).

### 6.3 Backend
- **Aucune API ni base applicative en v1.** Tout le site est généré au build et servi par Nginx.
- PostgreSQL n'est présent que pour Umami.

### 6.4 Analytics
- **Umami self-hosted**, sans cookies, compatible RGPD, sans bannière.
- Événements personnalisés : `search_no_result` (requête tronquée à 100 caractères), `copy` (id de la fiche), `favorite`.
- Le script est servi depuis le même domaine (`/stats/script.js`), conforme à la CSP. Il n'est ajouté aux pages que si `PUBLIC_UMAMI_WEBSITE_ID` (UUID du site dans Umami, validé au build) est défini : sans lui (CI, Lighthouse, `make up`), aucun traceur. Chargé en `defer`, il ne bloque jamais l'affichage.
- Règles d'envoi : `copy` seulement après une copie réussie ; `favorite` seulement à l'ajout ; `search_no_result` 1,5 s après la dernière frappe, si la requête fait au moins 2 caractères et ne donne aucun résultat, une seule fois par requête et par page. La requête est nettoyée (caractères invisibles retirés, espaces regroupés, minuscules) puis tronquée à 100 caractères.
- Les pages vues n'incluent ni la query string (`data-exclude-search`, donc jamais `?q=…`) ni le hash. Do Not Track est respecté (`data-do-not-track`).
- Seules deux URLs passent par le proxy : `/stats/script.js` et `/stats/api/send` (POST uniquement, corps ≤ 8 ko, 10 req/s par IP avec rafale de 20, pas de log d'accès car le Referer contient la recherche). Tout autre chemin sous `/stats` renvoie 404 : l'interface d'administration n'est jamais publique (en dev : `http://127.0.0.1:3001` ; en prod : tunnel SSH). Le proxy retire les cookies et les en-têtes de sécurité d'Umami (plus permissifs) au profit des siens, et résout Umami à la requête : il démarre sans lui, et `/stats` répond 502 tant qu'il est arrêté.
- Le site Umami est créé une fois à la main dans le tableau de bord (Settings > Websites), et son id est reporté dans `.env`. Le compte par défaut (`admin` / `umami`) doit être changé à la première connexion.

### 6.5 CI/CD (GitHub Actions)
- **Sur PR** : lint + typecheck, tests unitaires avec **seuils de couverture** (§8.1), tests E2E (Playwright sur le site construit, `astro preview`), validation du schéma des fiches, **lint de danger**, unicité des ids, build Astro.
- **Sur PR** : build des images Docker (sans push) pour vérifier qu'elles se construisent.
- **Sur merge dans `main`** (`.github/workflows/deploy.yml`, détail dans `deploy/README.md`) :
  1. Build de l'image `web` de production à partir du **même Dockerfile** que le dev (stage `prod`) : build Astro, puis les fichiers statiques sont copiés dans une image Nginx qui sert aussi de proxy vers Umami.
  2. Scan de vulnérabilités de l'image (Trivy, même image que `make scan`), **avant tout push** : une faille critique arrête tout, rien n'est publié ni déployé.
  3. Push sur **GitHub Container Registry** (`ghcr.io`, privé), tag = SHA du commit (+ `main`).
  4. Connexion SSH au serveur : la clé ne peut lancer que `deploy/deploy.sh` avec `deploy <sha>`. Le script :
     - télécharge `compose.yaml` et `compose.prod.yaml` **à ce commit** (pas de git sur le serveur) ;
     - `docker compose pull` puis `up -d --wait` (healthchecks de tous les services) ;
     - si la nouvelle version n'est pas saine, relance la précédente et échoue.
  5. Healthcheck sur `https://grepmeifyoucan.com/healthz` depuis l'extérieur.
- **Rollback** : redéployer le SHA précédent, par le workflow lancé à la main (entrée `sha`) ou par `ssh deploy@<serveur> "deploy <sha>"`. L'image et les fichiers Compose de ce commit reviennent ensemble ; les données (volumes) ne sont pas restaurées.
- Clé SSH de déploiement dédiée, utilisateur non-root `deploy` (membre du groupe `docker`, donc équivalent root : la commande forcée est la vraie barrière). Commande forcée à la fois dans `authorized_keys` (`restrict,command=…`, fichier appartenant à root) et dans `sshd` (`ForceCommand`, sans redirection de port ni TTY). `deploy.sh` est installé par un admin (`deploy/setup-server.sh`), jamais mis à jour par la CI. Token de lecture GHCR (PAT classique `read:packages`) sur le serveur. Secrets dans l'environnement GitHub `production`, limité aux branches protégées.

### 6.6 Environnement de développement local (Docker)
**Phase actuelle : tout le développement se fait en local, sur macOS, entièrement conteneurisé.** Le domaine de production (`grepmeifyoucan.com`) n'est utilisé qu'à partir de M3 ; le serveur de production (§6.7) est alimenté par le pipeline de déploiement (§6.5). Seuls Docker Desktop (ou OrbStack) et Git sont requis sur le Mac : pas de Node installé sur l'hôte.

Les fichiers `compose.yaml` (services partagés) et `compose.dev.yaml` (services et réglages de dev) décrivent l'environnement :

| Service  | Image / build | Rôle | Port hôte |
|----------|---------------|------|-----------|
| `proxy`  | `nginx-unprivileged:<version épinglée>-slim` (dev uniquement : en prod, `web` joue ce rôle) | Point d'entrée unique : `/` → `web`, `/stats` → `umami`. Mêmes routes et en-têtes de sécurité (CSP…) qu'en production | `8080` |
| `web`    | `docker/web.Dockerfile` (Node LTS) | `astro dev` avec rechargement à chaud | interne |
| `db`     | `postgres:<version épinglée>` | Base `umami`. Profil Compose `analytics` | interne |
| `umami`  | `ghcr.io/umami-software/umami:<version épinglée>` | Analytics. Profil Compose `analytics`, optionnel en dev | `3001` (admin, dev uniquement) |

Règles :
- **Une seule URL locale** : `http://localhost:8080`. Passer par le proxy reproduit la production : mêmes routes, CSP réaliste.
- `make up` lance seulement `proxy` + `web` ; `make up-analytics` ajoute `db` + `umami`.
- **Code source monté en bind mount** pour le rechargement à chaud. `node_modules` reste dans un volume nommé, pour ne pas mélanger les binaires macOS et Linux.
- Données PostgreSQL (Umami) dans un volume nommé (`db-data`), persistantes entre redémarrages (`make clean` les supprime). `db` n'est que sur un réseau Docker interne (`analytics`) ; `umami` est sur ce réseau et sur celui du proxy. Les tables sont créées par Umami lui-même au démarrage : pas de script SQL d'initialisation.
- Les ports sont exposés sur `127.0.0.1` uniquement, jamais sur `0.0.0.0`.
- Toutes les images ont une **version épinglée** (pas de `latest`). Les conteneurs applicatifs tournent en utilisateur non-root.
- Configuration via `.env` (non commité) ; un `.env.example` documente chaque variable : `UMAMI_DB_PASSWORD` et `UMAMI_APP_SECRET` (hex, `openssl rand -hex 32`, vérifiés par `make up-analytics`), `PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_BASE_URL=http://localhost:8080`.
- Les scripts outillage (import tldr, lint de danger, validation des fiches, tests) tournent eux aussi dans un conteneur : `docker compose run --rm web npm run <script>`.
- Un `Makefile` (ou des scripts npm) fournit les raccourcis : `make up`, `make down`, `make logs`, `make import-tldr`, `make lint-content`, `make test`.

Démarrage attendu pour un nouveau contributeur :
```bash
cp .env.example .env
make up            # docker compose up -d --build
open http://localhost:8080
```

**Lien avec la production : les mêmes conteneurs tournent en local et sur le serveur.**
- Un `compose.yaml` de base est partagé, avec deux surcharges :
  - `compose.dev.yaml` : bind mounts, `astro dev`, port sur localhost ;
  - `compose.prod.yaml` : images taguées depuis GHCR, pas de bind mount de code, `restart: unless-stopped`, durcissement. Nom de projet distinct (`grepmeifyoucan-prod`) : `make prod-local` ne touche jamais aux conteneurs de dev.
- Le Dockerfile `web` a des stages `dev` et `prod` : un seul fichier, deux cibles (`--target`). Le stage `prod` construit le site (`npm run build`, donc `lint-content` aussi) puis copie `dist/` et la conf Nginx dans `nginx-unprivileged` (variante `-slim`, même image que le proxy de dev). L'image est la même partout : `PUBLIC_BASE_URL` y vaut toujours `https://grepmeifyoucan.com`, et `PUBLIC_UMAMI_WEBSITE_ID` est passé au build.
- **Production en local** (`make prod-local`) : les images de prod tournent sur `https://localhost` (ports `127.0.0.1:80` et `443`), avec un certificat auto-signé (`scripts/make-local-cert.sh`, dans `.cache/tls`, au même emplacement que celui de Let's Encrypt). `make check-prod` vérifie en-têtes, redirections, routes, durcissement des conteneurs et taille de l'image ; `make e2e-prod` lance toute la suite Playwright sur cette stack (vraie CSP) ; `make scan` passe l'image au scanner Trivy (archive `docker save`, socket Docker jamais monté).

### 6.7 Serveur de production
**Déploiement : Docker Compose sur le serveur**, avec les mêmes services qu'en local : `web` (Nginx + statique + proxy), `db` et `umami`, plus `certbot`.
- **Serveur** : VPS Hostinger, Ubuntu 26.04 LTS, 1 vCPU, 4 Go de RAM, 48 Go de disque. Préparé par `deploy/setup-server.sh` (voir `deploy/README.md`).
- **Sur l'hôte** : Docker Engine + le plugin Compose, SSH. Pas de Node, Nginx ni PostgreSQL installés pour le site (le Nginx de l'hôte est désactivé : 80/443 appartiennent au conteneur `web`). Le monitoring personnel du mainteneur (Grafana, Prometheus, node_exporter) peut y tourner, jamais exposé : accès par tunnel SSH.
- **Pare-feu** : celui de l'hébergeur, en liste blanche (TCP 22, 80, 443 seulement). Il est hors du serveur, donc Docker ne peut pas le contourner.
- **Exposition** : seul `web` publie les ports `80`/`443` (Nginx écoute sur `8080`/`8443` dans le conteneur, sans capacité). L'adresse vient de `WEB_BIND` : `127.0.0.1` par défaut, `0.0.0.0` dans le `.env` du serveur. Les hôtes inconnus ne reçoivent aucune réponse (444 en HTTP, poignée de main TLS refusée). `db` et `umami` restent sur un réseau Docker interne, sans port publié. Attention, Docker contourne `ufw` : on ne publie donc jamais d'autre port.
- **TLS** : Let's Encrypt via un conteneur `certbot` (challenge HTTP-01 en webroot, tentative de renouvellement deux fois par jour), certificats dans un volume partagé avec `web`, redirection HTTP→HTTPS. `certbot` tourne sous l'uid de Nginx (101) : la clé privée reste en `600` et lisible par `web`, sans rien ouvrir. `web` recharge sa configuration toutes les 6 h pour prendre un certificat renouvelé (le socket Docker n'est jamais monté, `certbot` ne peut donc pas le prévenir). Le premier certificat est demandé par `deploy/setup-server.sh` (essai à blanc sur l'environnement de test de Let's Encrypt d'abord), le site tournant encore avec un certificat temporaire.
- **Durcissement des conteneurs** :
  - utilisateur non-root ;
  - `read_only: true` (avec `tmpfs` si nécessaire), pour les trois services ;
  - `cap_drop: [ALL]`, sans exception (`web` écoute sur des ports non privilégiés ; `db` tourne directement sous l'utilisateur `postgres`, uid 70) ;
  - `security_opt: no-new-privileges:true` ;
  - limites mémoire, CPU et nombre de processus ;
  - healthchecks ;
  - socket Docker jamais monté dans un conteneur.
- **Secrets** : fichier `.env` de production sur le serveur (`chmod 600`, jamais commité), ou secrets Compose.
- **Données** : volumes nommés pour PostgreSQL et les certificats. `pg_dump` quotidien par le service `backup` (même image que `db`, 14 jours gardés dans `/opt/grepmeifyoucan/backups`). Copie hors serveur par `make backup-pull` depuis le Mac du mainteneur (au moins chaque semaine), qui restaure aussitôt la sauvegarde la plus récente dans un PostgreSQL vierge. Un stockage objet automatique pourra remplacer cette copie manuelle.
- **Logs** : driver `json-file` avec rotation (`max-size`, `max-file`).
- **Cache et compression** : fichiers à nom haché (`/_astro/`) en cache 1 an, polices 30 jours, pages et `search-index.json` revalidés à chaque visite (`no-cache`), pour qu'un déploiement soit visible tout de suite ; gzip sur les fichiers texte. Seul `GET` est accepté sur le site statique.
- **Mises à jour** : OS de l'hôte en mises à jour de sécurité automatiques (`unattended-upgrades`). Images de base reconstruites régulièrement (Dependabot sur les Dockerfiles).

## 7. Sécurité

### 7.1 Intégrité du contenu (risque n° 1 : une commande piégée copiée en root)
- **Revue humaine obligatoire** : branch protection sur `main`.
  - PR obligatoire pour tout le monde, admin compris.
  - CI verte (`checks` + `docker`) sur une branche à jour.
  - Conversations résolues avant fusion.
  - Ni push direct, ni force-push, ni suppression de la branche.
  - Seul le mainteneur peut fusionner. CODEOWNERS le désigne comme relecteur de chaque PR.
  - **0 approbation requise** : GitHub interdit d'approuver sa propre PR, ce qui bloquerait un mainteneur seul. Les contributeurs externes ne peuvent pas fusionner, donc la revue humaine reste garantie.
- Le dépôt GitHub est **public** : c'est nécessaire pour que les visiteurs puissent ouvrir des issues (§2.9).
- Le contenu importé de tldr suit le même processus.

### 7.2 Lint de danger en CI
- Le linter détecte des patterns à risque : `rm -rf`, `dd `, `mkfs`, `> /dev/sd*`, `chmod -R 777`, `curl|wget … | (sh|bash)`, `base64 -d | sh`, `:(){ :|:& };:`, `--force`, `terraform destroy`, `kubectl delete`, `git push --force`, `git reset --hard`…
- Chaque règle a un **niveau minimum** : `caution` ou `destructive`. Si le niveau déclaré est inférieur → **échec de la CI et du build**. Un niveau plus élevé que nécessaire est toujours accepté.
  - Les règles sont dans `src/lib/danger-patterns.ts`. Elles ajoutent à la liste ci-dessus `find -delete`, `wipefs`, `shred`, `helm uninstall`, `git clean -f`, `docker … prune`, `aws s3 rm --recursive`, `rsync --delete…`/`--remove-source-files`, `docker compose down -v`/`docker volume rm`, la suppression de ressources cloud (`aws … delete-*`/`terminate-*`, `gcloud … delete`, `az … delete`), `git push --delete`/`--prune`/`:branche`, `git branch -D` et `git stash clear` (destructive), ainsi que `rm` simple, `kill -9`/`pkill`/`killall`, tout `--force…`, `git rebase`/`commit --amend`, `git branch -d`, `git stash drop`, `terraform apply`, `ansible-playbook` hors mode `--check` et `ansible -m shell|command|raw|script`, `gh pr merge`, `gh workflow run`/`gh run rerun` (caution).
  - `terraform plan -destroy` n'est pas signalé : il affiche seulement ce que `destroy` supprimerait.
  - Le `-f` court n'est détecté que là où il est dangereux (`git push -f`, `git clean -f`, `rm -rf`), pour éviter les faux positifs sur `tail -f` ou `ls -f`.
  - Les placeholders sont analysés tels qu'ils seront copiés : `{{nom:défaut}}` est remplacé par sa valeur par défaut, `{{nom}}` par son nom, et un `|` à l'intérieur (alternatives tldr comme `{{f|d}}`) n'est pas lu comme un pipe.
  - **Aucune dérogation** : en cas de faux positif, on monte le niveau.
  - `suggestDanger()` pré-remplit le niveau des brouillons importés (§4.2).
- Caractères :
  - **`command` : ASCII imprimable uniquement, sur une seule ligne.** Cette règle bloque les homoglyphes, le tiret long `–`, les guillemets typographiques, les espaces insécables, les caractères invisibles et bidi, et les retours à la ligne.
  - `title` / `description` : caractères invisibles, de contrôle, bidi et retours à la ligne refusés. La typographie normale reste permise.
  - Ces contrôles portent sur les valeurs brutes du YAML, avant que le schéma ne retire les espaces de début et de fin.
- `make lint-danger ARGS=<dossier>` applique uniquement ces contrôles, par exemple aux brouillons `content/drafts/`, qui n'ont pas encore de description.

### 7.3 Copie sécurisée
- Le texte copié est **exactement** celui affiché, à partir de la donnée et non du DOM : pas de texte caché, pas de caractère invisible.
- Aucun `\n` final, pour que la commande ne s'exécute pas au collage dans un terminal.
- Confirmation au premier copier de **chaque** commande `destructive` dans la session (dialogue qui montre le texte exact, mémorisé dans `sessionStorage` ; si le stockage est indisponible, la confirmation est demandée à chaque fois).
- La copie passe par `navigator.clipboard.writeText` ; en cas d'échec, un toast l'indique (pas de repli qui lirait le DOM).

### 7.4 Web
- En-têtes Nginx :
  - **CSP stricte** : `default-src 'self'`, pas de script inline, `frame-ancestors 'none'` ;
  - HSTS, pour `grepmeifyoucan.com` seulement (1 an depuis la mise en ligne, sans `preload`) ;
  - `X-Content-Type-Options: nosniff` ;
  - `Referrer-Policy: strict-origin-when-cross-origin` ;
  - `Permissions-Policy` restrictive.
- Aucun script, police ou CDN tiers : tout est auto-hébergé.
- **Écarts dev / prod** (proxy local, §6.6) : les en-têtes sont les mêmes, à trois exceptions près, toutes imposées par le rechargement à chaud ou par `localhost`.
  - La CSP de dev ajoute `style-src 'unsafe-inline'` (styles injectés par Vite) et `connect-src ws://<host>` (WebSocket HMR). Les scripts inline restent interdits même en dev, et la barre d'outils de dev d'Astro est désactivée pour cette raison.
  - HSTS n'est envoyé qu'en production : en local, il forcerait HTTPS sur `localhost` pour tous les projets.
  - La CSP stricte de prod est vérifiée sur le vrai build : `make e2e-prod` (toute la suite E2E derrière le Nginx de prod) et `make check-prod`. Un test garde la CSP de dev égale à celle de prod plus ces deux assouplissements.
- Pas d'API, donc pas de surface d'authentification ni d'écriture côté serveur en v1.
- Rate limiting Nginx sur `/stats/api/send` (collecte Umami). L'interface d'administration Umami n'est pas exposée publiquement (accès via tunnel SSH, ou restreint par IP).
- Les données lues depuis `localStorage` sont validées avant usage et ne sont jamais injectées comme HTML.
- Les secrets (mot de passe DB Umami, secret Umami) sont passés en variables d'environnement, jamais commités.
- Dépendances : Dependabot + `npm audit` en CI.

## 8. Exigences non fonctionnelles
- **Performance** : Lighthouse ≥ 95 (Performance, Accessibilité, Best Practices, SEO) sur mobile ; LCP < 1,5 s ; CLS < 0,1 ; résultat de recherche < 50 ms pour environ 1000 fiches. En CI, Lighthouse simule une 4G lente sur `dist/` servi par son serveur statique : le budget y est **LCP ≤ 1,6 s** (la simulation varie de 1,36 à 1,51 s selon l'arrivée des polices) ; les 1,5 s se vérifient sur le vrai serveur à la mise en ligne (J20).
- **SEO** : pages statiques par fiche, `<title>` et meta description, sitemap.xml, données structurées si pertinent.
- **Compatibilité** : deux dernières versions de Chrome, Firefox, Safari, Edge ; iOS Safari et Chrome Android.
- **Disponibilité** : le site fonctionne même si Umami est en panne (les analytics ne bloquent jamais l'affichage).

### 8.1 Stratégie de tests
**Règle : toute nouvelle fonctionnalité ou correction de bug est livrée avec ses tests dans la même PR.** Une PR sans test pour du code nouveau ou modifié est refusée en revue, sauf pour un changement purement visuel (CSS) ou de contenu YAML. Le contenu YAML est couvert par la validation de schéma et le lint de danger.

| Type | Outil | Ce qu'on teste |
|---|---|---|
| Unitaire | **Vitest** | Logique pure de `src/lib/` et `scripts/` : recherche et pertinence, templates de variables, copie, store local, liens GitHub, import tldr, schéma, lint de danger |
| Contenu | Vitest + `make lint-content` | Chaque nouvelle règle de schéma ou pattern de danger a au moins un cas positif et un cas négatif (fixtures dans `tests/fixtures/`) |
| End-to-end | **Playwright** | Parcours utilisateur : recherche → copie, clavier, favoris/historique, export/import, mobile (375 px), accessibilité (axe) |
| Performance | Lighthouse CI | Budgets du §8 |

- **Bug** : on écrit d'abord un test qui reproduit le bug et échoue, puis on corrige.
- **Pertinence de la recherche** : chaque requête signalée comme mal classée devient un cas de test du type « la fiche X est dans le top 3 pour la requête Y ».
- **Seuils de couverture** (Vitest, provider `v8`, vérifiés en CI ; une PR qui passe sous le seuil échoue) :
  - **seuils vérifiés fichier par fichier** (`perFile`), et non sur la moyenne : un petit fichier non testé ne peut pas se cacher derrière les autres ;
  - `src/lib/**` et `scripts/**` : **≥ 80 %** lignes, fonctions et branches ;
  - modules critiques pour la sécurité, **≥ 95 %** lignes et branches : `src/lib/copy.ts`, `src/lib/template.ts`, `src/lib/danger-patterns.ts`, `src/lib/store.ts`, `src/content/schema.ts`, `scripts/lint-danger.ts`.
  - Composants `.astro` et CSS exclus de la couverture unitaire : ils sont couverts par Playwright.
- Les seuils ne baissent jamais pour faire passer une PR. Tout changement de seuil se fait par une PR dédiée, qui le justifie.
- Tests déterministes : pas de réseau (les fixtures tldr sont locales), pas de dépendance à l'heure (horloge simulée), pas de `sleep` dans Playwright (attentes sur l'état).

## 9. Hors périmètre v1
- Génération ou recherche de commandes par **IA / langage naturel**.
- **Formulaire de soumission intégré et panel admin** : les contributions passent par les issues GitHub.
- **Exécution de commandes** ou terminal web / sandbox.
- **Comptes utilisateurs** (OAuth GitHub/Google), synchronisation des favoris et de l'historique entre appareils, API et base applicative : **prévus en v2**.
- Connexion email/mot de passe, 2FA maison.
- Interface et contenu en **français** ou multilingue.
- Commentaires, votes ou notes sur les fiches.
- Applications mobiles natives, extension navigateur, CLI.
- Fiches pour Windows / PowerShell.

## 10. Jalons
0. **M0 — Environnement local** : `compose.yaml`, Dockerfile `web`, proxy Nginx local, profil analytics (PostgreSQL + Umami), `.env.example`, Makefile, CI qui build les images.
1. **M1 — Contenu** : schéma YAML, script d'import tldr, environ 200 fiches revues, lint de danger, CI de validation.
2. **M2 — Site statique** : Astro, recherche, filtres, fiches, variables, copie sécurisée, danger, favoris et historique locaux (+ export/import), thèmes, responsive, clavier, page Privacy.
3. **M3 — Mise en production** : serveur durci, Docker Compose de production, TLS sur `grepmeifyoucan.com`, pipeline build → GHCR → déploiement SSH, issue forms GitHub, Umami.
4. **v2 (hors v1) — Comptes** : API, OAuth GitHub/Google, synchronisation favoris/historique, export et suppression de compte (RGPD).

## 11. Questions ouvertes
- ~~OS et taille du serveur~~ : Ubuntu 26.04 LTS, 1 vCPU, 4 Go (J19), largement suffisant pour Nginx + PostgreSQL + Umami.
- Licence du code (MIT proposée).
- Activer ou non dès M3 l'Action de conversion issue → PR.
