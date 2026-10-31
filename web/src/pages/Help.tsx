/** Aide intégrée : contenu statique, à tenir à jour avec chaque fonctionnalité. */
const SECTIONS: [string, string, React.ReactNode][] = [
  ["mondes", "Mondes", <>
    <p>Un <strong>monde</strong> est un univers indépendant : ses fiches, relations, cartes et textes ne se mélangent jamais avec ceux d'un autre monde.</p>
    <p>Depuis l'accueil, créez un monde (avec des types et relations proposés, ou vide) ou essayez le <strong>monde d'exemple</strong>. Renommez ou supprimez-le dans « Réglages du monde » : la suppression demande de retaper le nom, et une copie de la base est faite avant.</p>
  </>],
  ["fiches", "Fiches", <>
    <p>Une <strong>fiche</strong> décrit un élément du monde : personnage, lieu, objet, organisation, événement, concept… Son <strong>type</strong> définit ses <strong>propriétés</strong> (texte, nombre, oui/non, date, lien vers une autre fiche).</p>
    <p>Créez une fiche depuis le tableau de bord, la page « Fiches », un sélecteur (« Créer la fiche… ») ou directement depuis un texte. Cliquez sur le nom pour le renommer. Les propriétés s'enregistrent quand vous quittez le champ ; la description s'enregistre automatiquement pendant la frappe.</p>
    <p>Changer le type d'une fiche ne supprime rien : les valeurs de l'ancien type sont gardées et réapparaissent si vous le remettez. Une propriété n'est jamais supprimée, seulement <em>archivée</em>.</p>
    <p><strong>Étiquettes</strong> : des mots-clés libres (« à développer », « tome 2 »…) pour filtrer la liste des fiches.</p>
  </>],
  ["texte", "Écrire et lier", <>
    <p>Dans une description ou un document, tapez <kbd>[[</kbd> puis quelques lettres pour insérer un <strong>lien vers une fiche</strong>. Vous pouvez aussi sélectionner un mot et cliquer « Lier une fiche » ou « ✚ Fiche depuis la sélection » (crée la fiche et la lie).</p>
    <p>Les liens reposent sur l'identifiant de la fiche : si vous la renommez, le texte affiche le nouveau nom. Si vous la supprimez, le texte reste intact et le lien apparaît <span className="elink broken">barré</span>.</p>
    <p>Mise en forme : <code>**gras**</code>, <code>*italique*</code>, une ligne commençant par <code># </code> pour un titre, <code>&gt; </code> pour une citation, <code>- </code> pour une liste. Le bouton « Aperçu » montre le rendu.</p>
  </>],
  ["ecriture", "Documents", <>
    <p>La page <strong>Textes</strong>, qui s'ouvre en premier quand vous entrez dans un monde, contient vos documents (roman, nouvelles, notes), découpés en <strong>sections imbriquées</strong> (parties, chapitres, scènes). Les flèches à côté de la section ouverte la déplacent ou la rangent sous la précédente. « Lecture continue » affiche tout le document d'un bloc.</p>
    <p><strong>Autosauvegarde</strong> : chaque frappe est copiée dans un brouillon local du navigateur, puis envoyée au serveur après une seconde de pause. Si le serveur est injoignable, le brouillon est gardé et proposé à la réouverture (« Restaurer le brouillon »). Si la même section a été modifiée dans un autre onglet, rien n'est écrasé.</p>
    <p>Chaque fiche affiche « Citée dans l'écriture » : les passages des documents et des autres fiches qui la lient.</p>
  </>],
  ["relations", "Relations", <>
    <p>Une <strong>relation</strong> relie deux fiches avec un type : « Haute-Cendre <em>situé dans</em> Valcrest ». Elle se lit aussi depuis l'autre fiche grâce au <strong>nom inverse</strong> : « Valcrest <em>contient</em> Haute-Cendre ». On n'enregistre le fait qu'une fois.</p>
    <p>Un type <strong>transitif</strong> permet des <strong>déductions</strong> : si Haute-Cendre est située dans Valcrest et Valcrest dans Aldémar, alors Haute-Cendre est située dans Aldémar (affiché en gris, « déduit »). Ne cochez pas « transitive » pour « ami de » ou « parent de » : l'ami d'un ami n'est pas forcément un ami.</p>
    <p>Un type <strong>symétrique</strong> vaut dans les deux sens (« allié de »). Une boucle (« A dans B dans A ») est refusée.</p>
    <p>L'onglet <strong>Schéma</strong> dessine les voisines d'une fiche (cliquez pour recentrer) ; l'onglet <strong>Arbre</strong> montre ascendants et descendants à partir d'un lien de filiation (« parent de »).</p>
  </>],
  ["images", "Images et médiathèque", <>
    <p>Ajoutez des images à une fiche depuis l'ordinateur ou le téléphone. La première est l'<strong>image principale</strong> de l'encadré (idéalement un carré de 800 à 1000 pixels). Les photos très grandes sont réduites automatiquement.</p>
    <p>La <strong>médiathèque</strong> regroupe toutes les images du monde ; une image peut servir à plusieurs fiches et cartes. Une image utilisée ne peut pas être supprimée.</p>
  </>],
  ["cartes", "Cartes", <>
    <p>Une carte est une image sur laquelle on <strong>épingle</strong> des fiches. Molette, boutons ＋/－, double-clic ou deux doigts pour zoomer ; glisser pour se déplacer.</p>
    <p>« Épingler une fiche », puis touchez la carte à l'endroit voulu. Depuis une fiche, « Situer sur une carte » fait la même chose.</p>
    <p><strong>Cartes imbriquées</strong> : rattachez une carte à une fiche (un pays, une ville). Ses épingles sur les autres cartes portent alors ▱ et proposent « Ouvrir sa carte » : on descend du continent à la ville, et le fil d'Ariane permet de remonter.</p>
  </>],
  ["chronologie", "Chronologie", <>
    <p>Le temps d'un monde est découpé en <strong>ères</strong> successives, chacune avec une durée (la dernière peut être « en cours ») et un écart éventuel avec la précédente.</p>
    <p>Une date se donne par rapport à une ère : « an 12 », « 30 ans avant », ou « durant » l'ère, avec mois et jour facultatifs et la mention « environ ». Une fiche peut avoir une date ou une période (début et fin). Les incohérences (fin avant le début, année au-delà de la durée de l'ère) sont signalées mais jamais corrigées à votre place.</p>
  </>],
  ["recherche", "Recherche", <>
    <p>La <strong>Recherche</strong> parcourt tout le monde : noms, résumés, descriptions, propriétés texte, légendes, cartes, ères, documents et sections. Majuscules et accents sont ignorés. Plusieurs mots doivent tous être présents ; mettez une expression entre guillemets pour la chercher telle quelle.</p>
  </>],
  ["publication", "Travail et publication", <>
    <p>Tout ce que vous modifiez est l'<strong>état de travail</strong>, visible de vous seul. « Publier » fige une copie de la fiche pour les lecteurs (« Lecture publique »). Les modifications suivantes ne sont pas visibles des lecteurs tant que vous ne republiez pas (la fiche indique « version antérieure »).</p>
  </>],
  ["sauvegarde", "Sauvegarde", <>
    <p>« Sauvegarde » exporte un monde dans un fichier <code>.json</code> (images comprises si vous le souhaitez) et importe un fichier dans un <strong>nouveau</strong> monde, sans jamais toucher aux mondes existants.</p>
    <p>Toutes les données sont dans le dossier <code>data/</code> de l'application : copiez-le, application arrêtée, pour une sauvegarde complète.</p>
  </>],
];

const LEXIQUE: [string, string][] = [
  ["Monde", "Univers indépendant, isolé des autres."],
  ["Fiche (entité)", "Élément du monde : personnage, lieu, objet, événement…"],
  ["Type", "Catégorie d'une fiche, qui définit ses propriétés."],
  ["Propriété", "Champ d'information d'un type (ex. « Population » pour un Lieu)."],
  ["Relation directe", "Fait enregistré d'une fiche vers une autre."],
  ["Relation inverse", "Le même fait, lu depuis l'autre fiche (« contient » pour « situé dans »)."],
  ["Transitivité", "Propriété d'une relation qui se propage le long d'une chaîne."],
  ["Relation déduite", "Relation calculée par transitivité, non enregistrée."],
  ["Ère", "Grande période du temps du monde, base des dates."],
  ["Épingle", "Position d'une fiche sur une carte."],
  ["État de travail", "Vos données en cours, privées."],
  ["Publication", "Copie figée d'une fiche, lisible par les lecteurs."],
];

export function Help() {
  return (
    <div className="hero help">
      <p><a href="#/" onClick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}>← Retour</a></p>
      <h1>Aide</h1>
      <nav className="card"><strong>Sommaire</strong>
        <ul>{SECTIONS.map(([id, t]) => <li key={id}><a href={`#/aide`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); }}>{t}</a></li>)}
          <li><a href="#/aide" onClick={(e) => { e.preventDefault(); document.getElementById("lexique")?.scrollIntoView({ behavior: "smooth" }); }}>Lexique</a></li></ul>
      </nav>
      {SECTIONS.map(([id, t, body]) => <section key={id} id={id}><h2>{t}</h2>{body}</section>)}
      <section id="lexique"><h2>Lexique</h2><dl>{LEXIQUE.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
    </div>
  );
}
