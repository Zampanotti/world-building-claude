# Feuille de route

## Livré (version 1, 30 octobre 2026)

Tout le périmètre de l'application d'origine (phases 1 à 4 et gestion des mondes) : mondes, fiches et types personnalisés, propriétés, explorateur, relations (inverses, transitivité, boucles), schéma des relations, export/import, chronologie à ères, images et médiathèque, fiche façon Wikipédia, cartes imbriquées, recherche plein texte, écriture avec liens stables et autosauvegarde, « Citée dans l'écriture », publication, aide intégrée, affichage sur téléphone.

En plus : étiquettes, arbre généalogique, pages de lecture publique, monde d'exemple, intégration continue GitHub.

## Prochaines étapes (par ordre de valeur)

1. **Historique des modifications** : table `entity_history` (révision, date, champs modifiés) alimentée par `updateEntity`, avec vue « Historique » et restauration d'une version.
2. **Publication étendue** : publier relations, documents et sections ; index lecteur par type ; export HTML statique d'un monde publié.
3. **Calendriers personnalisés** : noms des mois et nombre de jours par ère.
4. **Vérifications de cohérence** : page listant boucles, dates contradictoires, liens cassés, fiches orphelines, valeurs d'anciens types.
5. **Recherche indexée (FTS5)** si les mondes deviennent très grands.
6. **Assistance IA** (facultative, clé fournie par l'utilisateur) : résumés, suggestions de relations, détection de fiches non liées dans les textes ; ses propositions doivent rester distinguées des données de l'auteur.

Chaque étape : modèle de données et invariants d'abord, migration additive, tests, interface, aide mise à jour.
