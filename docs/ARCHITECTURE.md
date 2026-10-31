# Architecture

## Vue d'ensemble

```
web/        Interface React (Vite) → compilée dans dist/
  src/main.tsx        routage (#/…) et mise en page du monde
  src/pages/*.tsx     une page par domaine
  src/richtext.tsx    rendu et éditeur du texte (liens [[id|libellé]])
  src/ui.tsx          composants communs (chargement anti-réponses périmées, sélecteur de fiche, dates…)
shared/     Code commun serveur + interface
  richtext.ts         format des liens, extraction de texte, normalisation de recherche
  time.ts             ères, dates relatives, contradictions
server/
  main.ts             serveur HTTP (API + fichiers de dist/)
  api.ts              table des routes → services
  db.ts               ouverture SQLite, migrations, transactions
  errors.ts           erreurs HTTP et validation des champs
  services/*.ts       règles métier par domaine
tests/      Tests de bout en bout de l'API (node:test)
```

Une seule base SQLite : `data/worldbuilding.db` (mode WAL). Les images sont stockées **dans la base** (table `media`, colonne `data`), ce qui rend sauvegardes, suppressions et imports atomiques.

## Modèle de données

| Table | Rôle | Clés notables |
| --- | --- | --- |
| `world` | Monde | nom unique (sans casse) |
| `entity_type` | Type de fiche (nom, couleur) | `world_id` |
| `property_def` | Propriété d'un type : `text`, `longtext`, `number`, `boolean`, `date`, `entity` ; `archived` au lieu de supprimer | `type_id` |
| `entity` | Fiche : nom, résumé, description (texte riche), `revision` | `world_id`, `type_id` (NULL = sans type) |
| `property_value` | Valeur JSON d'une propriété pour une fiche (conservée si la fiche change de type) | (fiche, propriété) |
| `tag`, `entity_tag` | Étiquettes | `world_id` |
| `relation_type` | Nom, nom inverse, transitive, symétrique | `world_id` |
| `relation` | Fait direct source → cible | unique (type, source, cible) ; jamais une fiche vers elle-même |
| `era` | Ère : position, durée (NULL = en cours, dernière seulement), écart avant | `world_id` |
| `time_span` | Date ou période d'une fiche (JSON `{start, end}`) | une par fiche |
| `media` | Image : format, dimensions, empreinte SHA-256, contenu | dédoublonnée par empreinte dans un monde |
| `entity_media` | Galerie d'une fiche : position (0 = image principale), légende | |
| `map`, `map_pin` | Carte (image + fiche rattachée facultative, unique) ; épingle x/y ∈ [0, 1] | une épingle par fiche et par carte |
| `document`, `section` | Écriture : sections imbriquées (`parent_id`), contenu, `revision` | |
| `publication` | Instantané JSON d'une fiche publiée | une par fiche |

Toutes les tables descendent d'un monde par cascade (suppression d'un monde). Les refus métier sont faits dans les services, avant écriture.

### Format du texte

Markdown léger : `# titre`, `## sous-titre`, `> citation`, `- liste`, `**gras**`, `*italique*`. Liens vers les fiches : `[[42|Nom au moment de l'écriture]]`. L'affichage utilise le nom actuel de la fiche 42 ; si elle n'existe plus, le libellé est affiché barré.

### Temps

Une date est `{eraId, year, month, day, approx}` : `year > 0` = an N de l'ère (l'an 1 est la première année), `year < 0` = N ans avant le début de l'ère, `null` = durant l'ère. L'année absolue est recalculée à chaque lecture depuis les ères (`shared/time.ts`), jamais stockée.

## API

Toutes les réponses sont en JSON (`{error, details}` en cas d'échec). Statuts : 400 entrée invalide, 404 introuvable dans ce monde, 409 conflit (révision, doublon, boucle, élément utilisé), 413 trop volumineux.

| Route | Usage |
| --- | --- |
| `GET/POST /api/worlds`, `POST /api/worlds/example`, `POST /api/worlds/import` | Mondes, exemple, import (nouveau monde) |
| `GET/PATCH/DELETE /api/worlds/:wid` | Vue d'ensemble, renommer (`expectedName`), supprimer (`confirmName`) |
| `GET /api/worlds/:wid/export?images=0|1` | Archive `.json` |
| `…/types`, `…/types/:id/properties`, `…/properties/:id`, `…/tags` | Types, propriétés, étiquettes |
| `GET …/entities?q=&type=&tag=&cursor=` | Explorateur paginé par curseur |
| `GET …/entities/suggest?q=` | 20 suggestions par nom |
| `GET/PATCH/DELETE …/entities/:id` | Fiche complète ; PATCH avec `expectedRevision` (nom, résumé, description, type, propriétés, étiquettes, dates) |
| `GET …/entities/:id/relations`, `…/family?type=&reverse=`, `…/mentions` | Relations (directes, inverses, déduites, boucles), généalogie, citations |
| `POST/PUT …/entities/:id/images`, `PATCH/DELETE …/images/:mid` | Galerie (attacher, ordonner, légende, retirer) |
| `POST/DELETE …/entities/:id/publish` | Publier / dépublier |
| `…/relation-types`, `POST …/relations`, `DELETE …/relations/:id` | Relations |
| `GET/POST …/media`, `GET/DELETE …/media/:id` | Médiathèque (envoi en binaire brut, 20 Mo max) |
| `…/maps`, `…/maps/:id`, `…/maps/:id/pins/:pid` | Cartes et épingles |
| `GET/PUT …/eras`, `GET …/chronology?type=` | Ères (liste complète remplacée), frise |
| `…/documents`, `…/documents/:id/sections`, `…/sections/:id`, `POST …/sections/:id/move` | Écriture |
| `GET …/search?q=&scope=all|world|writing&offset=` | Recherche plein texte |
| `GET /api/public/:wid`, `…/entities/:id`, `…/media/:id` | Lecture publique (instantanés uniquement) |

## Comportements délicats

- **Réponses périmées** : `useLoad`, l'explorateur, la recherche et les sélecteurs numérotent leurs requêtes et ignorent toute réponse qui n'est pas la dernière.
- **File d'écriture d'une fiche** : la page fiche enchaîne ses PATCH, chacun avec la révision renvoyée par le précédent ; un 409 n'apparaît donc que si la fiche a changé ailleurs.
- **Autosauvegarde des sections** : brouillon local à chaque frappe, envoi après 1 s de pause, envoi forcé en quittant la section ; en cas de conflit, l'envoi automatique est suspendu et le brouillon proposé à la réouverture.
- **Boucles** : pour un type transitif non symétrique, la création cherche un chemin cible → source dans la même transaction et refuse avec la chaîne.
- **Déductions** : parcours en largeur depuis la fiche, dans les deux sens pour les types transitifs ; le chemin (« via ») est renvoyé.
