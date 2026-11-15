# Les images de la documentation

Une case par image, numérotée dans l'ordre où elle apparaît : d'abord [README.md](../README.md),
puis [docs/UTILISATION.md](../docs/UTILISATION.md), puis [server/LISEZMOI.md](../server/LISEZMOI.md).

Ce sont de vraies captures, prises sur une installation réelle ; seule la 34 vient de la maquette
(`python3 maquette/captures.py 34`), faute de fichier à convertir. Les adresses, identifiants et noms
du fournisseur y ont été masqués. Pour en remplacer une, **gardez le même nom de fichier** :
la documentation suit toute seule.

- **TV** : capture du téléviseur, en 1920 × 1080. Une photo de l'écran convient aussi, bien droite et sans reflet.
- **PC** : capture de la page web dans un navigateur, fenêtre d'environ 1440 pixels de large,
  une section à la fois (pas la page entière déroulée).

Au moment de la capture, évitez qu'apparaissent : l'adresse du fournisseur, un identifiant, un mot de passe,
l'adresse IP réelle de la maison.

| N° | Fichier | Source | Où | Ce qu'elle doit montrer |
|---|---|---|---|---|
| 00 | `00-presentation.png` | composée | README, en tête | Le visuel de présentation (1280 × 640) : logo, slogan, trois captures. Se refait avec `python3 outils/presentation.py` une fois les captures 02, 03 et 04 remplacées |
| 01 | `01-accueil-tv.png` | TV | README | L'accueil : bandeau « Reprendre la lecture », chaînes favorites en dessous |
| 02 | `02-guide-direct.png` | TV | README, Utilisation | En direct en vignettes : image du programme ou logo de la chaîne, la chaîne choisie dans l'aperçu en haut à droite |
| 03 | `03-mosaique.png` | TV | README | La mosaïque (touche droite) : fiche de la vignette choisie en haut, la chaîne en cours dans le cadre à droite, vignettes en dessous |
| 04 | `04-bibliotheque.png` | TV | README | La rubrique Bibliothèque : catégories avec leur nombre de titres, affiches en dessous |
| 05 | `05-page-accueil-web.png` | PC | README | La page d'accueil web `http://luciole.local:8765` : abonnements, catalogue, téléviseur, Bibliothèque, chaînes favorites |
| 06 | `06-premier-lancement.png` | TV | Utilisation, Premier lancement | L'écran « Bienvenue » qui demande l'adresse du serveur |
| 07 | `07-guide-filtre-serveur.png` | TV (retouchée) | Utilisation, Plusieurs abonnements | Le guide filtré sur un seul abonnement, la ligne du filtre sélectionnée, la pastille de l'abonnement sur les vignettes. Le filtre n'apparaît qu'avec deux abonnements : ligne et pastilles ajoutées sur une vraie capture |
| 08 | `08-lecteur-direct.png` | TV | Utilisation, le lecteur | Une chaîne en direct, barre complète ouverte (OK) : Accueil, Guide, Mosaïque… |
| 09 | `09-menu-rapide.png` | TV | Utilisation, le lecteur | La liste rapide des chaînes (touche gauche) par-dessus l'image |
| 10 | `10-page-chaine.png` | TV | Utilisation, page d'une chaîne | La page d'une chaîne (touche Info) : en cours, suivant, chaînes voisines |
| 11 | `11-replay.png` | TV | Utilisation, Replay | Le replay d'une chaîne : jours en haut, programmes en dessous |
| 12 | `12-films.png` | TV | Utilisation, Films et séries | Le catalogue des films : catégories, tuiles Historique et À regarder plus tard |
| 13 | `13-fiche-film.png` | TV | Utilisation, fiche d'un film | La fiche d'un film, avec le bouton Bibliothèque qui affiche sa catégorie |
| 14 | `14-categorie-bibliotheque.png` | TV | Utilisation, Bibliothèque | Le panneau de choix de la catégorie, ouvert depuis une fiche |
| 15 | `15-fiche-serie.png` | TV | Utilisation, fiche d'une série | La fiche d'une série : reprendre, saisons, épisodes avec progression |
| 16 | `16-recherche.png` | TV | Utilisation, Recherche | Une recherche de deux lettres : chaînes, films, séries |
| 17 | `17-reglages-tv.png` | TV | Utilisation, Réglages | Les réglages : une ligne par abonnement avec ses jours restants, démarrage automatique, langue, thème |
| 18 | `18-demarrage-auto-tv.png` | TV | Utilisation, Démarrage automatique | L'écran de réglage du démarrage automatique sur le téléviseur |
| 19 | `19-theme-ambre.png` | TV | Utilisation, Thème Ambre | L'accueil (ou un autre écran) avec le thème Ambre |
| 20 | `20-anglais.png` | TV | Utilisation, En anglais | Un écran en anglais, le guide par exemple |
| 21 | `21-web-abonnements.png` | PC | Serveur, Abonnements | La section Abonnements : une fiche par abonnement, jauge, pastille |
| 22 | `22-web-bibliotheque.png` | PC | Serveur, Bibliothèque | La section Bibliothèque : catégories à gauche, titres à droite |
| 23 | `23-web-mes-bouquets.png` | PC | Serveur, Mes bouquets | Un bouquet personnel ouvert, avec ses chaînes |
| 24 | `24-web-chaines.png` | PC | Serveur, Chaînes | La liste des chaînes : pastille, logo, numéro, nom |
| 25 | `25-web-logo.png` | PC | Serveur, Logos | La fenêtre « Logo de … » d'une chaîne |
| 26 | `26-web-fiche.png` | PC | Serveur, Films et séries | La fenêtre « Modifier la fiche » : titre, résumé, jaquette, fond |
| 27 | `27-web-noms.png` | PC | Serveur, Noms | Les règles de nettoyage et l'aperçu avant / après |
| 28 | `28-web-guide.png` | PC | Serveur, Guide | Les sources du guide et l'association des chaînes |
| 29 | `29-web-bouquets-fournisseur.png` | PC | Serveur, Bouquets du fournisseur | Les catégories du fournisseur, cases à cocher |
| 30 | `30-web-televiseur.png` | PC | Serveur, Téléviseur | Démarrage automatique et autorisation |
| 31 | `31-web-mediatheque.png` | PC | Serveur, Médiathèque | Les dossiers déclarés et le contenu trouvé |
| 32 | `32-lecteur-film-resume.png` | TV | Utilisation, Pendant un film | Un film en lecture, volet du résumé ouvert (touche Bas) sous les commandes |
| 33 | `33-web-choisir-bibliotheque.png` | PC | Serveur, Médiathèque | « Choisir pour la Bibliothèque » : affiches des films des dossiers, deux cochées, barre « Ajouter à la Bibliothèque » |
| 34 | `34-web-conversion-son.png` | PC | Serveur, Médiathèque, Conversion du son | Vue « À vérifier » : fichiers au son DTS avec « Convertir le son », bloc « Conversion du son » sous les dossiers |
| 35 | `35-fiche-film-versions.png` | TV | Utilisation, Un film en plusieurs versions | La fiche d'un film de la médiathèque en trois versions : bouton « 1080p · H.264 — 3 versions » |
| 36 | `36-fiche-film-choix-version.png` | TV | Utilisation, Un film en plusieurs versions | Le panneau « Version qui démarre » : Automatique, puis chaque version (la 4K illisible grisée) |
| 37 | `37-fiche-film-logo.png` | TV | Utilisation, Bonus, bande-annonce et logo | La fiche d'un film rangé façon Kodi : logo (clearlogo) à la place du titre, bouton Bande-annonce |
| 38 | `38-fiche-film-bonus.png` | TV | Utilisation, Bonus, bande-annonce et logo | Le panneau Bonus d'un film : scènes coupées, interview |
| — | `00-presentation-en.png` | composée | README anglais | Le même visuel, en anglais (`python3 outils/presentation.py en`) |
