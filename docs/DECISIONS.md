# Décisions

Chaque ligne : décision, raison. Les décisions de la reconstruction du 30 octobre 2026 sont regroupées ci-dessous ; ajouter les suivantes à la fin.

## Reconstruction (30 octobre 2026)

Le projet reprend le cahier des charges du dépôt d'origine `Zampanotti/worldbuilding` (Next.js) et le réimplémente entièrement, avec liberté totale de choix donnée par le propriétaire.

| Sujet | Décision | Raison |
| --- | --- | --- |
| Serveur | `node:http` + `node:sqlite`, TypeScript exécuté sans compilation, zéro dépendance d'exécution | Démarrage instantané, rien à mettre à jour côté serveur, aucune faille de dépendance possible ; SQLite est intégré à Node 22. |
| Interface | React 19 + Vite, application d'une page, routage par fragment `#/` | Interface riche (cartes, schéma, éditeur) sans contrainte serveur ; le serveur sert simplement `dist/`. Next.js n'apportait rien pour une application locale. |
| Isolation | Le monde est dans l'URL (`/api/worlds/:wid/…`) au lieu d'un « monde actif » global côté serveur | Plusieurs onglets sur des mondes différents fonctionnent sans interférence ; l'ancienne limite « monde actif global » disparaît. Chaque identifiant reste vérifié côté serveur. |
| Texte | Markdown léger avec liens `[[id|libellé]]` au lieu du JSON Tiptap | Lisible, exportable, cherchable, sans dépendance d'éditeur ; conserve la référence par identifiant stable exigée. |
| Concurrence | Une `revision` par fiche et par section, `expectedRevision` obligatoire | Plus simple que la valeur attendue champ par champ, et protège aussi la description, le type, les dates. |
| Images | Stockées dans SQLite (BLOB) | Sauvegarde = un fichier ; suppressions et imports atomiques ; plus de fichiers orphelins. 20 Mo par image. |
| Dates des propriétés | Le genre « date » utilise le même modèle à ères que la chronologie | Cohérence : toutes les dates du monde se lisent dans son calendrier. |
| Types | Un monde neuf reçoit six types, des propriétés et six relations courantes (option « vide » disponible) ; monde d'exemple complet avec carte générée | Démarrage immédiat ; l'exemple montre toutes les fonctions. |
| Propriétés | Archivage au lieu de suppression ; valeurs conservées au changement de type | Aucune perte de données possible par erreur. |
| Pistes livrées en plus | Étiquettes, arbre généalogique, lecture publique (pages lecteur), citations aussi dans les descriptions d'autres fiches | Étaient listées comme « pistes ultérieures » ; peu coûteuses sur ce modèle. |
| Documentation | Fichiers d'origine fusionnés : `PROJECT_STATUS*.md` → `ARCHITECTURE.md` + `ROADMAP.md` ; `CLAUDE_HANDOFF.md` supprimé (spécifique à l'ancien Codespace) ; `.github/agents/*.agent.md` fusionnés dans `AGENTS.md` ; `BACKUP_RESTORE.md` → `SAUVEGARDE.md` (bien plus court, images désormais dans la base) | Moins de documents, à jour, et règles adaptées à un agent autonome. |
| Recherche | Relecture des textes à chaque requête, sans index | Suffisant pour un monde personnel (quelques milliers de fiches) ; un index FTS5 pourra être ajouté par migration si besoin. |
| Essai | Configuration `.devcontainer/` : Codespaces installe, compile et lance l'app automatiquement | Tester sans rien installer, depuis n'importe quel navigateur (30 octobre 2026). |
