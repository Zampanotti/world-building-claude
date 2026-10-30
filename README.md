# World Building

Atelier **local** de construction de mondes et d'écriture : des mondes isolés, des fiches personnalisables, des relations qui se déduisent, des cartes imbriquées, une chronologie à ères, et des textes qui citent les fiches par des liens stables. Tout tourne sur votre ordinateur, les données restent dans le dossier `data/`.

## Démarrer

Prérequis : **Node.js 22.13 ou plus récent** (SQLite est intégré à Node, aucune base à installer).

```bash
npm ci          # installe React et l'outillage de compilation
npm run build   # compile l'interface dans dist/
npm start       # http://127.0.0.1:3000
```

Au premier lancement, cliquez « ✨ Monde d'exemple » pour découvrir l'application sur un monde déjà rempli.

Développement avec rechargement automatique : `npm run dev` (interface sur http://localhost:5173, API sur le port 3000).

Variables facultatives : `PORT` (3000), `HOST` (`127.0.0.1` ; mettre `0.0.0.0` pour y accéder depuis un téléphone du même réseau), `WB_DATA_DIR` (dossier des données, `data` par défaut).

## Ce que fait l'application

| Domaine | Fonctions |
| --- | --- |
| Mondes | Créer (avec types proposés ou vide), monde d'exemple, renommer, supprimer (nom à retaper, copie de sécurité préalable). Isolation stricte entre mondes. |
| Fiches | Types personnalisés avec couleur ; propriétés texte court/long, nombre, oui/non, date (selon les ères), lien vers une fiche ; propriétés archivées sans perte ; étiquettes ; résumé et description en texte riche ; enregistrement protégé contre les écrasements (révision). |
| Explorateur | Toutes les fiches, filtre par nom, type, « sans type » et étiquette, pagination stable par curseur. |
| Relations | Types avec nom inverse, transitifs, symétriques ; vues directes, inverses et déduites (avec le chemin) ; boucles refusées ou signalées ; schéma SVG recentrable ; arbre généalogique. |
| Écriture | Documents en sections imbriquées (déplacer, indenter), lecture continue, liens `[[` vers les fiches, création d'une fiche depuis une sélection, autosauvegarde avec brouillon local et détection de conflit, « Citée dans l'écriture » sur chaque fiche. |
| Images | Galerie par fiche, image principale dans un encadré façon Wikipédia, médiathèque partagée, réduction automatique des photos trop grandes, format reconnu par le contenu. |
| Cartes | Zoom/déplacement (souris, molette, doigts), épingles vers les fiches, cartes rattachées à une fiche pour descendre du continent à la ville, fil d'Ariane. |
| Chronologie | Ères ordonnées (durée, écart, ère en cours), dates relatives (an N, N ans avant, durant), mois/jour, « environ », périodes, frise filtrable, contradictions signalées. |
| Recherche | Plein texte dans tout le monde (fiches, propriétés, légendes, cartes, ères, documents), sans accents ni casse, expressions entre guillemets, extraits surlignés, onglets. |
| Publication | Publication explicite d'une fiche (instantané figé), vue « Lecture publique » qui n'expose jamais l'état de travail. |
| Sauvegarde | Export `.json` d'un monde (images comprises au choix), import toujours dans un nouveau monde, tout ou rien. |
| Aide | Guide intégré (`#/aide`) et lexique. |

## Vérifications

```bash
npm run check   # typage strict + tests + compilation
```

Les tests (`tests/`) démarrent un vrai serveur HTTP sur une base en mémoire : ils ne touchent jamais `data/`.

## Documentation

- [AGENTS.md](AGENTS.md) : règles de travail des assistants IA sur ce dépôt.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : modèle de données, API, invariants.
- [docs/DECISIONS.md](docs/DECISIONS.md) : choix techniques et fonctionnels, et leurs raisons.
- [docs/ROADMAP.md](docs/ROADMAP.md) : ce qui est livré et les prochaines étapes.
- [docs/SAUVEGARDE.md](docs/SAUVEGARDE.md) : sauvegarder et restaurer les données.
