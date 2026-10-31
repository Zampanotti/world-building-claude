# Sauvegarder et restaurer

Toutes les données (mondes, textes, **images comprises**) sont dans un seul fichier SQLite : `data/worldbuilding.db` (plus ses fichiers temporaires `-wal` et `-shm` pendant le fonctionnement).

## Sauvegarde complète

**Application arrêtée** : copier le dossier `data/` entier.

**Application en marche** (copie cohérente à chaud) :

```bash
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('data/worldbuilding.db').exec(\"VACUUM INTO 'sauvegarde-$(date +%F).db'\")"
```

## Copies automatiques

L'application écrit d'elle-même une copie dans `data/backups/` avant chaque migration du schéma et avant chaque suppression de monde. Ces copies ne sont jamais effacées automatiquement : faites le ménage vous-même.

## Restaurer

1. Arrêter l'application.
2. Mettre de côté le `data/worldbuilding.db` actuel (le renommer, ne pas l'effacer), ainsi que ses fichiers `-wal`/`-shm`.
3. Copier la sauvegarde à la place, sous le nom `data/worldbuilding.db`.
4. Relancer `npm start`. Une base plus ancienne est migrée automatiquement (avec copie préalable).

Pour examiner une sauvegarde sans toucher à vos données : `WB_DATA_DIR=/chemin/vers/un/dossier/copie PORT=3001 npm start`.

## Un seul monde

Page « Sauvegarde » d'un monde : export `.json` (images incluses si la case est cochée) ; l'import crée toujours un nouveau monde et ne modifie jamais les mondes existants.

## Ne jamais

- mettre `data/`, une base ou une sauvegarde dans Git (déjà exclus par `.gitignore`) ;
- remplacer la base pendant que l'application tourne.
