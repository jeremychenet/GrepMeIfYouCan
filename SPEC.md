# GrepMeIfYouCan — Spécification

> Trouver la bonne commande Linux / Infra / DevOps en moins de 5 secondes.

Ce document décrit le site tel qu'il est livré (v1, en ligne sur `grepmeifyoucan.com` depuis le 2026-10-29). Les évolutions prévues sont au §10 et dans `PLAN.md` ; l'exploitation du serveur est détaillée dans `deploy/README.md`.

## 1. Vision & utilisateurs

**Cible principale : l'ingénieur confirmé et pressé** (SysAdmin Linux, Infra, DevOps, SRE).
Il connaît déjà l'outil mais a oublié la syntaxe exacte ou les bons flags. Il veut trouver, adapter et copier une commande sans quitter son flux de travail.

Conséquences de conception :
- La vitesse prime sur la pédagogie : pas de tutoriels, des descriptions d'une ligne.
- Tout doit être faisable au clavier sur desktop, et rester fluide sur mobile (consultation en astreinte, depuis le téléphone).
- Le site est en **anglais uniquement** (contenu et interface).

### Indicateurs de succès
- Une commande pertinente apparaît dans le top 3 pour une requête courante (« large files », « restart service », « delete pod »…).
- Moins de 5 s entre l'arrivée sur le site et la commande copiée.
- Recherches sans résultat suivies via l'analytics, pour orienter l'enrichissement du contenu.

## 2. Périmètre fonctionnel

### 2.1 Unité de contenu : la fiche
**Une fiche = un cas d'usage = une commande.** Exemple : « Find files larger than 1 GB » → `find {{path}} -size +{{1G}}`.
Une fiche n'est pas une page outil. La page outil (`find`) regroupe les fiches qui l'utilisent.

### 2.2 Domaines (catégories)
| Catégorie   | Exemples d'outils |
|-------------|-------------------|
| `linux`     | find, grep, ss, lsof, du, df, systemctl, journalctl, chmod, tar |
| `unix`      | outils propres aux autres Unix (BSD…) : rcctl |
| `containers`| docker, podman, kubectl, helm |
| `cloud-iac` | terraform, ansible, aws, gcloud, az |
| `git-ci`    | git, gh |

Volume à la mise en ligne : 231 fiches (linux 67, containers 64, git-ci 51, cloud-iac 48, unix 1), surtout adaptées de tldr-pages (§4). La catégorie `unix` s'enrichit des suggestions des visiteurs.

### 2.3 Recherche
- Barre de recherche toujours visible, focus avec `/` ou `⌘K` / `Ctrl+K`.
- **Recherche fuzzy instantanée, côté client**, à chaque frappe, sans appel réseau.
  - Champs indexés et pondérés : titre > nom de l'outil > tags > commande > description.
  - Tolérance aux fautes de frappe, recherche par préfixe. Fautes admises par mot : aucune jusqu'à 3 lettres, 1 jusqu'à 6, 2 au-delà (une inversion de deux lettres compte pour 2).
  - Les fiches qui contiennent tous les mots de la requête viennent en premier, puis celles qui en contiennent au moins un (« list open ports » trouve aussi une fiche qui ne dit jamais « open »).
  - Moteur : MiniSearch.
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

Chaque fiche a aussi sa propre page statique (`/c/<id>`) pour le SEO et le partage de lien. Les outils et les catégories ont aussi la leur (`/tools/<tool>`, `/categories/<category>`). Les URL n'ont pas de slash final (une URL avec slash redirige en 301). Chaque page a un `<title>`, une meta description (pour une fiche : sa description), une URL canonique, des balises Open Graph, et figure dans le sitemap. Une URL inconnue renvoie une page 404 au style du site, en `noindex`. `scripts/check-dist.ts` vérifie tout cela en CI.

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
- Lien global **« Suggest a command »** (en-tête, pied de page, et message « aucun résultat » de la recherche) → formulaire d'*issue* GitHub `suggest-command.yml` reprenant les champs d'une fiche, avec un exemple dans chacun : titre, commande, description (obligatoires), catégorie, tags, plateformes (Linux, macOS, Unix), niveau de danger supposé, source. Depuis une recherche vide, la requête (nettoyée, 100 caractères max) préremplit le titre de l'issue et le titre de la fiche (champ `card-title`, car `title` est réservé au titre de l'issue).
- Les liens vers GitHub (Suggest, Report) s'ouvrent dans un **nouvel onglet** (petite flèche en SVG, annoncée aux lecteurs d'écran) : le visiteur ne quitte pas le site.
- Lien **« Report an issue »** sur la page de chaque fiche (`/c/<id>`, pas sur les lignes des listes) → formulaire `report-issue.yml` prérempli avec l'id et l'URL de la fiche ; type de problème et détails à remplir.
- Les champs sont préremplis par des paramètres d'URL (`src/lib/github.ts`). Les issues vides sont désactivées. Labels : `suggestion`, `report`.
- Traitement : relecture par le mainteneur, qui écrit la fiche dans une PR. **Aucune publication sans merge manuel.** (Automatisation prévue en v2 : §10.)

## 3. Design & UX

### 3.1 Direction : « Terminal sur papier »
Référence : maquette « oneliner » (fond papier, encre noire, accent orange, bandes de terminal noires).
- **Thème sombre par défaut** pour tous les visiteurs (la préférence du système n'est pas suivie), thème clair (papier) disponible avec le bouton soleil/lune (même palette : fond papier, texte encre, même orange, même jaune). Le choix est mémorisé.
- **En-tête** : le logo `grepmeifyoucan` à gauche (`me` et `you` en gris, pour faire ressortir `grep`, `if`, `can`), qui ramène à la recherche ; à droite « Suggest a command » (nouvel onglet), « Favorites », « History », puis le bouton de thème. Sur téléphone (< 480 px) : logo plus petit et « Suggest » au lieu de « Suggest a command », sur une seule ligne.
- **Accueil** : l'accroche, au-dessus de la recherche, montre deux exécutions chronométrées comme par `time` : `$ time ask-llm "check if a service runs"` barrée et grisée, `real 0m20.0s`, puis `$ time grepmeifyoucan` en gras, `$` et `real 0m04.2s` en orange (l'argument est masqué sur téléphone). Ce bloc est décoratif (`aria-hidden`) ; le titre `h1`, masqué visuellement, donne la phrase aux lecteurs d'écran : « Faster than asking your LLM: type a few words, copy the command you had in mind in under 5 seconds. » La page tient dans l'écran, pied de page visible sans défiler, sur ordinateur (dès 1280×720) et sur un téléphone récent (390×664 visibles dans Safari : au moins la ligne de liens du pied de page) ; sur téléphone, une ligne par catégorie. Une URL avec recherche (`?q`, `?cat`, `?tag`) réserve au contraire la hauteur de l'écran pour les résultats, qui arrivent après le premier affichage (CLS).
- Le texte d'exemple de la recherche (« find big files ») est plus pâle que le texte saisi (`--color-term-placeholder`, contraste 4,6:1, juste au-dessus du minimum AA), pour ne jamais passer pour une requête déjà tapée.
- Polices auto-hébergées en woff2 (sous-ensemble latin + flèches) : **DejaVu Sans Mono** pour les commandes et l'interface technique, **TeX Gyre Heros** pour le texte, **TeX Gyre Heros Cn** (gras) pour les titres. Licences libres (Bitstream Vera / DejaVu, GUST Font License), fournies dans `public/fonts/`. Elles sont en `font-display: optional` (utilisées si elles sont prêtes au premier affichage, jamais échangées en cours de page) ; les polices de secours de la mono sont ajustées à la même largeur (`size-adjust`), pour que le texte ne bouge jamais.
- Le thème est appliqué avant le premier affichage par un petit script externe bloquant (`/theme-init.js`), compatible CSP ; il marque aussi une URL avec recherche (`data-initial-search`). Sans JavaScript, le site reste en thème sombre et le bouton de thème est masqué.
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
- Le schéma (Zod) est validé avant chaque build. Tout fichier invalide fait échouer la CI.
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

### 4.2 Import depuis tldr-pages
- `scripts/import-tldr.ts`, lancé à la main (`make import-tldr`), jamais au build : il lit tldr-pages (anglais, `pages/common` et `pages/linux`) à un **commit épinglé**, pour la liste explicite d'exemples de `scripts/tldr-selection.yaml`, et écrit un brouillon par exemple dans `content/drafts/<category>/` (hors build).
- Placeholders : `{{path/to/file}}` conservé ; `{{[-r|--recursive]}}` → forme longue en dur ; URL → `{{url:<URL>}}` ; autre `:` → `_`. Les exemples ambigus (accolades échappées, non-ASCII) sont écartés et listés.
- Le `danger` est pré-rempli par le linter (§7.2) ; la `description` est rédigée à la main. L'import est idempotent : il n'écrase pas un brouillon sans `--force` et ne recrée jamais une fiche publiée.
- Le résultat est commité via **une PR relue** comme n'importe quelle contribution.
- **Licence** : tldr-pages est sous CC BY 4.0. Attribution sur chaque fiche importée + page `/about` + fichier `CONTENT_LICENSE`. Le contenu original du site est publié sous CC BY 4.0, le code sous licence MIT (`LICENSE`).

## 5. Données & vie privée

- **Aucun compte, aucune donnée personnelle stockée côté serveur.**
- Données conservées sur l'appareil de l'utilisateur uniquement : favoris, historique de copie, thème choisi (clé `gmiyc:v1:theme`).
- Analytics Umami sans cookies et sans données personnelles (voir §6.4). Les logs Nginx ont une rétention limitée (14 jours).
- Une page « Privacy » explique ces points simplement.
- Comptes utilisateurs et synchronisation multi-appareils : hors périmètre actuel (§9).

## 6. Architecture technique

### 6.1 Vue d'ensemble
```
                ┌──────── Serveur (Docker Compose, Nginx, TLS) ───────────┐
Navigateur ──►  │  /          → fichiers statiques Astro (build CI)       │
                │  /stats/*   → Umami (analytics auto-hébergé)            │
                │                └── PostgreSQL (données Umami seulement) │
                └─────────────────────────────────────────────────────────┘
```
- **Site 100 % statique, pas d'API.** Le seul composant dynamique est Umami (analytics).
- **Même domaine** pour le site et les stats : pas de CORS, CSP simple.
- **Domaine de production : `grepmeifyoucan.com`**. URL canonique `https://grepmeifyoucan.com` ; `www.grepmeifyoucan.com` redirige en 301 vers l'apex.
  - `PUBLIC_BASE_URL=https://grepmeifyoucan.com` : utilisé pour le sitemap, les URL canoniques et les liens de partage. Valeur par défaut si la variable est absente (en CI par exemple).
  - Certificat TLS Let's Encrypt pour l'apex et `www` ; HSTS 1 an, sans `preload` (difficile à annuler).
  - DNS : enregistrements A (apex et `www`) vers le serveur, CAA limité à Let's Encrypt. Pas d'AAAA : Docker ne publie 80/443 qu'en IPv4, et un AAAA sans écoute IPv6 casse le site pour les visiteurs IPv6 (et la validation Let's Encrypt, qui essaie l'IPv6 d'abord). L'IPv6 demandera un réseau Docker IPv6 et `listen [::]`.

### 6.2 Front
- **Astro + TypeScript**, génération statique : une page par fiche, par outil et par catégorie, plus l'accueil.
- Îlots interactifs (recherche, variables, favoris) en TS léger, éventuellement avec Preact ou Solid si nécessaire. Le JS de la page d'accueil reste léger.
- Index de recherche généré au build (`/search-index.json`), chargé au premier focus ou à la première frappe, sinon quand le navigateur est inactif, et revalidé à chaque visite.
- Les fonctions de favoris et d'historique passent par une couche « store » unique, basée sur `localStorage` (voir §2.8).

### 6.3 Backend
- **Aucune API ni base applicative.** Tout le site est généré au build et servi par Nginx.
- PostgreSQL n'est présent que pour Umami.

### 6.4 Analytics
- **Umami self-hosted**, sans cookies, compatible RGPD, sans bannière.
- Événements personnalisés : `search_no_result` (requête tronquée à 100 caractères), `copy` (id de la fiche), `favorite`.
- Le script est servi depuis le même domaine (`/stats/script.js`), conforme à la CSP. Il n'est ajouté aux pages que si `PUBLIC_UMAMI_WEBSITE_ID` (UUID du site dans Umami, validé au build) est défini : sans lui (CI, Lighthouse, `make up`), aucun traceur. Chargé en `defer`, il ne bloque jamais l'affichage.
- Règles d'envoi : `copy` seulement après une copie réussie ; `favorite` seulement à l'ajout ; `search_no_result` 1,5 s après la dernière frappe, si la requête fait au moins 2 caractères et ne donne aucun résultat, une seule fois par requête et par page. La requête est nettoyée (caractères invisibles retirés, espaces regroupés, minuscules) puis tronquée à 100 caractères.
- Les pages vues n'incluent ni la query string (`data-exclude-search`, donc jamais `?q=…`) ni le hash. Do Not Track n'est pas suivi (choix du mainteneur, 2026-10-30) : la mesure est sans cookie, anonyme et agrégée, et la page Privacy le dit.
- Seules deux URLs passent par le proxy : `/stats/script.js` et `/stats/api/send` (POST uniquement, corps ≤ 8 ko, limité en débit par IP, sans log d'accès car le Referer contient la recherche). Tout autre chemin sous `/stats` renvoie 404 : l'administration n'est jamais publique (en dev : `http://127.0.0.1:3001` ; en prod : tunnel SSH). Le proxy remplace les cookies et en-têtes d'Umami par les siens, et démarre même si Umami est arrêté.
- Le site Umami est créé une fois à la main dans le tableau de bord (Settings > Websites) ; son id va dans `.env` en local et dans la variable GitHub `PUBLIC_UMAMI_WEBSITE_ID` pour les builds de production. Le mot de passe par défaut (`admin` / `umami`) est changé à la première connexion (fait en production le 2026-10-30).

### 6.5 CI/CD (GitHub Actions)
- **Sur PR** : typecheck, tests unitaires avec **seuils de couverture** (§8.1), tests E2E (Playwright sur le site construit), validation des fiches et **lint de danger**, build, Lighthouse, build des images Docker (sans push).
- **Sur merge dans `main`** : build de l'image de production (même Dockerfile que le dev), **scan Trivy avant tout push** (une faille critique arrête tout), push sur GHCR (privé, tag = SHA), déploiement par SSH, puis healthcheck `https://grepmeifyoucan.com/healthz` depuis l'extérieur.
- Sur le serveur, la clé de déploiement ne peut lancer qu'une commande forcée (`deploy <sha>`) : elle récupère les fichiers Compose de ce commit, démarre la nouvelle version et relance la précédente si elle n'est pas saine. Cette commande est installée par un admin, jamais par la CI.
- **Rollback** : redéployer un SHA précédent (workflow lancé à la main avec l'entrée `sha`). Les données (volumes) ne sont pas restaurées.
- Détails (clés, secrets de l'environnement GitHub `production`, mise en place) : `deploy/README.md`.

### 6.6 Environnement de développement local (Docker)
Tout tourne en conteneurs sur le Mac : seuls Docker Desktop (ou OrbStack), `make` et Git sont requis, pas de Node sur l'hôte. Les commandes sont dans le `README.md`.
- `compose.yaml` (services partagés `web`, `db`, `umami`) + `compose.dev.yaml` (proxy Nginx local, `astro dev` avec rechargement à chaud, code en bind mount, `node_modules` en volume nommé) + `compose.prod.yaml` (images GHCR, durcissement, `certbot`, `backup`, nom de projet distinct `grepmeifyoucan-prod`).
- **Une seule URL locale** : `http://localhost:8080`, par le proxy, avec les mêmes routes et en-têtes (CSP…) qu'en production. Ports publiés sur `127.0.0.1` uniquement.
- Umami et PostgreSQL sont optionnels en dev (profil Compose `analytics`) ; `db` n'est que sur un réseau Docker interne.
- Toutes les images ont une **version épinglée** (pas de `latest`) ; les conteneurs tournent en non-root. Secrets dans `.env` (non commité, documenté par `.env.example`).
- Un seul Dockerfile `web`, stages `dev` et `prod` : la même image de production tourne en local (`make prod-local`, certificat auto-signé, vérifiée par `make check-prod`, `make e2e-prod` et `make scan`) et sur le serveur.

### 6.7 Serveur de production
Docker Compose sur un VPS Hostinger (Ubuntu 26.04 LTS, 1 vCPU, 4 Go), avec les mêmes services qu'en local plus `certbot` et `backup`. Mise en place et exploitation : `deploy/README.md`.
- **Pare-feu** de l'hébergeur en liste blanche (TCP 22, 80, 443). Seul `web` publie 80/443 ; `db` et `umami` n'ont aucun port publié. Les hôtes inconnus ne reçoivent aucune réponse.
- **TLS** Let's Encrypt (challenge HTTP-01, renouvellement automatique), redirection HTTP → HTTPS.
- **Durcissement de chaque conteneur** : non-root, système de fichiers en lecture seule, aucune capacité Linux, `no-new-privileges`, limites mémoire/CPU/processus, healthcheck, rotation des logs. Le socket Docker n'est jamais monté.
- **Sauvegardes** : `pg_dump` quotidien de la base Umami (14 jours sur le serveur) ; copie hors serveur au moins chaque semaine (`make backup-pull`), avec restauration testée à chaque copie.
- **Cache** : fichiers à nom haché en cache 1 an, polices 30 jours, pages et index revalidés à chaque visite ; gzip.
- **Mises à jour** : sécurité de l'OS automatique ; images suivies par Dependabot.

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
  - Les règles sont dans `src/lib/danger-patterns.ts` (chacune avec ses exemples testés). En plus de la liste ci-dessus, elles couvrent notamment les suppressions récursives ou forcées (`find -delete`, `git clean -f`, `docker … prune`, `aws s3 rm --recursive`, `rsync --delete`), la suppression de ressources cloud ou Kubernetes (`destructive`), et les commandes qui modifient l'état ou l'historique (`rm`, `kill -9`, `--force…`, `git rebase`, `terraform apply`, `ansible-playbook` hors `--check`… : `caution`).
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
- **Écarts dev / prod** (proxy local, §6.6) : les en-têtes sont les mêmes, à quelques exceptions près, imposées par le rechargement à chaud ou par `localhost`.
  - La CSP de dev ajoute `style-src 'unsafe-inline'` (styles injectés par Vite) et `connect-src ws://<host>` (WebSocket HMR). Les scripts inline restent interdits même en dev, et la barre d'outils de dev d'Astro est désactivée pour cette raison.
  - HSTS n'est envoyé qu'en production : en local, il forcerait HTTPS sur `localhost` pour tous les projets.
  - La CSP stricte de prod est vérifiée sur le vrai build : `make e2e-prod` (toute la suite E2E derrière le Nginx de prod) et `make check-prod`. Un test garde la CSP de dev égale à celle de prod plus ces deux assouplissements.
- Pas d'API, donc pas de surface d'authentification ni d'écriture côté serveur.
- Rate limiting Nginx sur `/stats/api/send` (collecte Umami). L'interface d'administration Umami n'est pas exposée publiquement (tunnel SSH).
- Les données lues depuis `localStorage` sont validées avant usage et ne sont jamais injectées comme HTML.
- Les secrets (mot de passe DB Umami, secret Umami) sont passés en variables d'environnement, jamais commités.
- Dépendances : Dependabot + `npm audit` en CI.

## 8. Exigences non fonctionnelles
- **Performance** : Lighthouse ≥ 95 (Performance, Accessibilité, Best Practices, SEO) sur mobile ; LCP < 1,5 s (URL de recherche : < 1,8 s) ; CLS < 0,1 ; résultat de recherche < 50 ms pour environ 1000 fiches. Une URL de recherche a un budget plus large, car ses résultats attendent les scripts et l'index.

  | Budget LCP | Pages | URL de recherche (`/?q=`) |
  |---|---|---|
  | CI (`make lighthouse`, 4G lente simulée sur `dist/`) | ≤ 1,6 s | ≤ 2,0 s |
  | Production (`make lighthouse-prod`) | ≤ 1,5 s | ≤ 1,8 s |
- **SEO** : pages statiques par fiche, `<title>` et meta description, sitemap.xml, données structurées si pertinent.
- **Compatibilité** : deux dernières versions de Chrome, Firefox, Safari, Edge ; iOS Safari et Chrome Android.
- **Disponibilité** : le site fonctionne même si Umami est en panne (les analytics ne bloquent jamais l'affichage).

### 8.1 Stratégie de tests
**Règle : toute nouvelle fonctionnalité ou correction de bug est livrée avec ses tests dans la même PR.** Une PR sans test pour du code nouveau ou modifié est refusée en revue, sauf pour un changement purement visuel (CSS) ou de contenu YAML. Le contenu YAML est couvert par la validation de schéma et le lint de danger.

| Type | Outil | Ce qu'on teste |
|---|---|---|
| Unitaire | **Vitest** | Logique pure de `src/lib/` et `scripts/` : recherche et pertinence, templates de variables, copie, store local, liens GitHub, import tldr, schéma, lint de danger |
| Contenu | Vitest + `make lint-content` | Chaque nouvelle règle de schéma ou pattern de danger a au moins un cas positif et un cas négatif (fixtures dans `tests/fixtures/`) |
| End-to-end | **Playwright** | Parcours utilisateur : recherche → copie, clavier, favoris/historique, export/import, mobile, accueil sans défilement, accessibilité (axe) |
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

## 9. Hors périmètre
- Génération ou recherche de commandes par **IA / langage naturel**.
- **Formulaire de soumission intégré et panel admin** : les contributions passent par les issues GitHub.
- **Exécution de commandes** ou terminal web / sandbox.
- **Comptes utilisateurs** (OAuth GitHub/Google), synchronisation des favoris et de l'historique entre appareils, API et base applicative (candidats pour la v2, à décider avec le mainteneur).
- Connexion email/mot de passe, 2FA maison.
- Interface et contenu en **français** ou multilingue.
- Commentaires, votes ou notes sur les fiches.
- Applications mobiles natives, extension navigateur, CLI.
- Fiches pour Windows / PowerShell.

## 10. Évolutions (v2)
La v1 (jalons J1 → J20, plan archivé dans `docs/archive/PLAN-v1.md`) est livrée. La v2 est planifiée dans `PLAN.md` à partir de la liste du mainteneur. Déjà retenu :
- une GitHub Action qui convertit une issue de suggestion labellisée `accepted` en PR contenant le fichier YAML de la fiche, toujours relue et fusionnée à la main.
