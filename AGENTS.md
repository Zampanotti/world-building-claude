# Règles de travail — World Building

Ce fichier s'applique à tout assistant IA (Claude, Codex, Copilot…) qui travaille sur ce dépôt.

## 1. Autonomie

Le propriétaire du projet a délégué les décisions : **l'agent décide seul** et ne pose pas de question, sauf pour une action irréversible sur des données réelles de l'utilisateur (voir § 5).

- Quand une demande est ambiguë, choisir l'interprétation la plus utile, la mettre en œuvre et la consigner dans `docs/DECISIONS.md` (une ligne : décision, raison, date).
- Les choix de dépendances, de structure ou de refactoring sont libres s'ils servent clairement le projet ; les justifier dans `docs/DECISIONS.md`.
- Ne pas laisser de travail à moitié fait : implémenter, tester, documenter, livrer.
- Économiser : lire une fois, planifier une fois, implémenter, vérifier, sans refaire inutilement.

## 2. Livraison Git

- Travailler sur une branche (`claude/…` ou équivalent), jamais directement sur `main`.
- Commits clairs en français ; une pull request par lot, dont la description résume le comportement obtenu, les vérifications faites et les limites.
- Ne jamais committer `data/`, une base, une sauvegarde ou un secret (voir `.gitignore`).
- Avant de pousser : `npm run check` doit passer.

## 3. Architecture (à préserver sauf raison consignée)

- Serveur : Node.js ≥ 22.13, TypeScript exécuté directement (`--experimental-strip-types`), `node:http` et `node:sqlite` (`DatabaseSync`). **Aucune dépendance d'exécution côté serveur**, aucun ORM.
- Interface : React + TypeScript, compilée par Vite dans `dist/`, servie par le serveur. Routage par fragment (`#/…`).
- Code partagé dans `shared/` (format du texte, calcul du temps). TypeScript strict, syntaxe « effaçable » uniquement (pas d'`enum`, pas de `namespace`, imports avec extension `.ts`).
- Les services (`server/services/`) contiennent les règles métier ; `server/api.ts` ne fait que router.

## 4. Invariants métier (non négociables)

1. **Isolation des mondes** : chaque route est sous `/api/worlds/:wid` ; le monde est vérifié côté serveur et tout identifiant reçu passe par `owned()` (ou `sectionOwned()`) avant usage. Aucune lecture, recherche, relation ou référence ne traverse deux mondes.
2. **Références stables** : un lien de texte s'écrit `[[<id>|<libellé>]]`. On ne référence jamais par position ou par nom. Supprimer une fiche garde le texte ; le lien s'affiche cassé.
3. **Pas d'écrasement silencieux** : fiches et sections portent une `revision` ; toute écriture fournit `expectedRevision`, sinon 409. L'autosauvegarde garde un brouillon local tant que le serveur n'a pas confirmé.
4. **Publication explicite** : seules les routes `/api/public/...` lisent la table `publication` ; elles n'exposent jamais l'état de travail. Aucune modification ne republie automatiquement.
5. **Données de l'utilisateur** : ne jamais supprimer, réaffecter ou « réparer » automatiquement une donnée incohérente ; la signaler (ex. boucles de relations, dates contradictoires). Les refus métier (type utilisé, image utilisée, ère utilisée…) se vérifient avant toute écriture.
6. **Transactions** : toute opération en plusieurs écritures passe par `tx()` (tout ou rien). L'import d'archive crée toujours un nouveau monde.

## 5. Données et migrations

- Le schéma évolue uniquement en **ajoutant** une entrée à la fin de `MIGRATIONS` dans `server/db.ts`. Ne jamais modifier une migration publiée.
- Une copie `VACUUM INTO` est faite automatiquement avant chaque migration d'une base existante et avant chaque suppression de monde (`data/backups/`).
- Seule exception à l'autonomie : ne jamais manipuler à la main la base réelle d'un utilisateur (`data/worldbuilding.db`) ; travailler sur des copies ou des bases de test.

## 6. Tests

- Toute règle métier nouvelle ou corrigée reçoit un test dans `tests/` (serveur réel sur base en mémoire, voir `tests/helpers.ts`).
- Vérifier l'interface dans un navigateur (Chromium/Playwright si disponible) à 1366 px et 412 px de large : aucune erreur console, aucun débordement horizontal.

## 7. Langue et commentaires

- Interface, documentation et commentaires en **français**. Les commentaires expliquent le *pourquoi*, les invariants et les comportements non évidents, pas chaque ligne.
- Mettre à jour l'aide intégrée (`web/src/pages/Help.tsx`), `docs/ARCHITECTURE.md` et `docs/ROADMAP.md` avec chaque fonctionnalité.
