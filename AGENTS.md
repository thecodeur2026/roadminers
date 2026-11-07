# ROAD MINERS — Guide de continuité (AGENTS.md)

> Document de reprise de contrôle. Si le contexte de l'agent est réinitialisé,
> lire ce fichier EN PREMIER pour retrouver tout l'état du projet.

## Qu'est-ce que c'est

PWA (Progressive Web App) d'évaluation d'articles pour une entreprise d'achat
d'or/monnaies/articles usagés. Zéro framework, zéro build : HTML/CSS/JS vanilla.

**Fonctionnalités :**
- Recherche instantanée dès l'ouverture (fr/en, synonymes : morgan→liberty head,
  quarter→25¢...) : taper le nom de la pièce → prix, paliers, photos (pièce 3D
  pile/face) et caractéristiques. **Plus de caméra** (retirée nov. 2025) : tout
  passe par la recherche texte.
- 8 paliers de prix : 5 %, 10 %, 15 %, 25 %, 35 %, 50 %, 75 %, 100 %
- Calculateur de fonte : matériau + grammes → prix d'achat max (Kitco) + paliers
  (sur la page d'accueil, sous les cours en direct)
- Cours en direct or/argent/platine/palladium (USD + CAD), rafraîchi 5 min
- Tableau de référence des titrages d'or (8K→24K : poinçon, % d'or, usage)
  sur la page d'accueil, sous le calculateur de fonte
- Montant payé → pourcentage réel : par ligne de fonte et sur le total
  (saisir le prix payé affiche le % du 100 % Kitco que ça représente)
- Calculateur de valeur faciale : poids total (g) ÷ 23,32 g = valeur faciale
  des pièces d'argent canadiennes (page d'accueil)
- Calculateur argent « lots de pièces » : quantité par type (50 ¢ CAN/US,
  dollars commémoratifs, olympiques, Kennedy 40 %...) → valeur 100 % Kitco,
  8 paliers et % réel du montant payé (app.js AGC_TYPES)
- Onglet « Guide » : manuel de formation (or/argent/platine, argenterie,
  monnaie canadienne et américaine, montres, billets, cartes, sécurité,
  fiche d'évaluation) en sections dépliables — contenu statique dans index.html
- Historique local des évaluations (localStorage)
- Badge vert « ON PREND » (prix d'achat du guide) / badge or « VALEUR CATALOGUE »
- Hors-ligne via service worker

## URLs en production

| Ressource | Emplacement |
|---|---|
| **App en ligne** | https://www.roadminers.com (domaine officiel) |
| URL Vercel | https://roadminers.vercel.app |
| Dépôt GitHub | https://github.com/thecodeur2026/roadminers (branche `main`) |
| Base Supabase | projet `okznxgssfvgkidymwwhx` |
| Cours en direct | https://okznxgssfvgkidymwwhx.supabase.co/functions/v1/spot |

Vercel redéploie automatiquement à chaque push sur `main`.

## Secrets

Tous les jetons sont dans `.env` (gitignoré, chmod 600). Voir `.env.example`
pour la liste. **Ne jamais** mettre `sb_secret_` ou `sbp_` dans du code client.
La clé `sb_publishable_...` dans `config.js` est publique par design (OK).
Les jetons fournis par le propriétaire devaient être révoqués/régénérés après
l'installation initiale — vérifier leur validité avant usage.

## Développement local

```bash
cd "ROAD MINER"
python3 server.py 8734        # ← OBLIGATOIRE (pas http.server) :
                              # sert le statique + /api/spot.json (cours live)
# → http://localhost:8734
```

`server.py` scrape : Kitco refining CAD (prix/gramme par matériau, cache 5 min)
+ api.gold-api.com (spot XAU/XAG/XPT/XPD) + open.er-api.com (USD→CAD).
Sans `server.py`, l'app bascule sur l'Edge Function Supabase (config.js).

## Structure des fichiers

```
index.html / styles.css / app.js / config.js / sw.js / manifest.webmanifest
server.py                  ← serveur local + proxy cours (obligatoire en local)
data/coins.json            ← base fusionnée (8 361 entrées) — GÉNÉRÉ, voir pipeline
data/spot-fallback.json    ← secours hors-ligne des cours
data/raw/pages-*.json      ← transcription Ancan.pdf (guide d'achat, 112 p.)
data/raw2/pages2-*.json    ← transcription Ancan2.pdf (catalogue, 556 p.)
data/numista_map.json      ← correspondances entrées → Numista (4 371 clés)
data/numista_details.json  ← caractéristiques Numista /types/{id} (agents 1-3)
data/mint_map.json         ← correspondances entrées → mint.ca (536 clés, agent 4)
data/mint_products.json    ← crawl brut des 4 308 pages produits mint.ca
supabase/mint_crawl.py     ← crawler mint.ca (reprend où il en était)
supabase/mint_match.py     ← matching anti-faux-positifs → data/mint_map.json
pages/  pages2/            ← scans rendus en images (gitignorés, ~1 Go)
Ancan.pdf  Ancan2.pdf      ← sources scannées (gitignorés, ~500 Mo)
supabase/schema.sql        ← tables entries + spot_cache (déjà exécuté)
supabase/import_data.py    ← import coins.json → Supabase (déjà exécuté)
supabase/functions/spot/index.ts  ← Edge Function (déjà déployée, ACTIVE)
icons/                     ← générés par Pillow
```

## Pipeline des données (comment coins.json est construit)

Les deux PDF sont des scans sans texte → rendus en images (PyMuPDF, 120-150 dpi),
transcrits page par page (agents + manuel) vers `data/raw*/`. Fusion :

```python
# source="guide" pour data/raw/ (prix d'ACHAT) — badge ON PREND
# source="catalogue" pour data/raw2/ (valeur marchande) — badge VALEUR CATALOGUE
# dédoublonnage sur (source, page, section, category, series, date, description, price)
```

Schéma d'entrée : `{source, page, section, category, series, date, description,
price, uncertain?, contentTable?}`. `price` = prix d'achat (guide) ou VALEUR
(catalogue). Tirage/prix d'émission/autres grades sont dans `description`
(format "Clé: valeur; ..."). ~68 entrées `uncertain: true` (scans flous).

**Trous connus** (pages absentes du scan Ancan2, pas de données possibles) :
pages catalogue 72-73, 76-77, 284-285, 293. Le reste des « trous » = pages photos
sans tableau (normal).

## Enrichissement externe (Numista + mint.ca)

- `data/numista_map.json` : 4 371 entrées liées à un type Numista (id, titre,
  photos obv/rev). Clé = `source|page|section|category|series|date|description|price`
  (price formaté Python : None→"None", entiers→"X.0").
- `data/mint_map.json` : 536 entrées canadiennes NON couvertes par Numista liées
  à une page produit officielle mint.ca (titre, url, photos `_obv`/`_rev`,
  specs : composition/poids/diamètre/tirage). Régénérer :
  `python3 supabase/mint_crawl.py` puis `python3 supabase/mint_match.py`.
  mint.ca ne couvre que ~2010+ (produits encore en ligne) : les pièces de
  circulation plus anciennes n'y ont pas de page. Matching strict : année +
  dénomination (Face Value) + métal cohérent + mot-clé distinctif unique ;
  tout doute → pas de lien.

## Supabase — état

- Table `entries` : 8 361 lignes, RLS lecture publique
- Table `spot_cache` : créée, non utilisée (les cours sont scrapés à la demande)
- Edge Function `spot` : ACTIVE, `verify_jwt=false`, CORS ouvert
- Ré-import : `SUPABASE_URL=... SUPABASE_KEY=... python3 supabase/import_data.py`
- Redéployer la fonction sans Docker : POST le code source à
  `https://api.supabase.com/v1/projects/{ref}/functions`
  (Bearer = SUPABASE_ACCESS_TOKEN) — body : `{slug, name, body, verify_jwt:false}`

## Conventions de l'app

- Langue UI : français. Thème or/noir (`--gold: #d4af37`).
- `app.js` : `loadData()` lit Supabase REST si `SUPABASE_ANON_KEY` (config.js),
  sinon `data/coins.json`. `loadSpot()` : Edge Function → `/api/spot.json` →
  localStorage → `data/spot-fallback.json`.
- `sw.js` : bumper `CACHE` (roadminer-vN) à chaque déploiement modifiant les
  assets ; ne jamais cacher `/api/*`.
- Recherche : `normalize()` (minuscules, sans accents) + groupes de synonymes.

## Problèmes connus / améliorations possibles

- Le lien « Voir la référence » de la fiche détail pointe vers Numista ou
  mint.ca. Les scans `pages/`/`pages2/` ne sont PAS déployés sur Vercel (trop
  lourds) — amélioration possible : héberger des versions JPEG compressées dans
  Supabase Storage et les utiliser comme image de secours.
- ~3 700 entrées (sur 8 361) n'ont aucune correspondance Numista ni mint.ca :
  pour celles-là, pas de vraie photo ni de caractéristiques — la pièce 3D
  affiche des faces dorées génériques. Élargir la couverture demanderait un
  nouvel enrichissement.
- 2 types Numista (ids 484323, 603607) et 39 fiches mint.ca n'ont pas de photo
  côté source — rien à afficher de plus.
- La reconnaissance photo automatique des pièces n'existe pas (par design) ;
  la caméra elle-même a été retirée (nov. 2025) — tout passe par la recherche.
- Les ~68 entrées `uncertain` mériteraient une re-vérification sur les PDF.

## Reprendre après une réinitialisation

1. Lire ce fichier.
2. `python3 server.py 8734` → vérifier http://localhost:8734.
3. Tester Supabase : GET `…/rest/v1/entries?select=id&limit=1` avec la clé
   publishable de `config.js` → doit répondre 200/206.
4. Tester les cours : GET `…/functions/v1/spot` → JSON avec `materials[21]`.
5. Modifier → commit → push `main` → Vercel déploie tout seul.
