# Changements

## 1.0.1 — 21 novembre 2026

- Lecteur : un **titre ou une ligne d'infos trop longs défilent** lentement au lieu d'être coupés.
- Fiches : **réalisation et distribution** aussi sur les séries (« Création : … · Avec : … ») ; quand le fournisseur
  ne donne aucun nom, TMDB complète (films et séries).
- Direct : la barre du lecteur montre le **numéro de la chaîne à gauche et son logo en grand à droite**, sans répéter le nom
  (le nom reste quand la chaîne n'a pas de logo).
- **Logo du titre** sur les fiches des films et des séries (abonnements et médiathèque) : celui choisi à la main,
  sinon le `clearlogo.png` posé à côté, sinon celui de TMDB (langue de l'interface, puis anglais). Il se choisit
  dans la page web parmi tous les logos TMDB, par adresse web ou depuis le PC.
- **Bande-annonce à la main** : un lien YouTube dans la fiche (page web) remplace celle du fournisseur ou de TMDB.
- Direct : après une coupure, la chaîne est **relancée tout de suite** (avant les essais espacés), et une image figée
  est repérée plus vite (10 s plus la durée du tampon, au lieu de 20 s).
- Direct : la **liste des chaînes** affiche les programmes à jour dès l'ouverture (plus seulement ceux des chaînes
  déjà regardées) et se ferme seule après 10 secondes sans appui ; la **mosaïque** se ferme seule après 30 secondes.
- Médiathèque, **versions d'un film** mieux distinguées : le nom de l'édition est lu aussi entre parenthèses ou crochets
  (« (The Remus Cut) », « [Version 35 MM] ») et dans `{edition-…}`, la durée de chaque version est affichée,
  et **Nommer la version** (page web, Médiathèque) permet de lui donner un nom à la main.
- Accueil : le grand bandeau ne montre plus que **les nouveautés des abonnements** : quatre films et quatre séries,
  pris dans le bouquet « Nouveautés » du fournisseur s'il en a un, sinon les derniers ajoutés (la médiathèque
  n'y figure pas). La reprise reste dans la rangée « Reprendre la lecture » juste en dessous.
- **Ajouter une chaîne à la main** depuis la page web (onglet Chaînes) : un lien de flux, ou une liste M3U
  (adresse ou contenu collé). Elles arrivent dans le bouquet « Mes liens » et peuvent aller directement
  dans un de vos bouquets ; nom, numéro, logo et guide se règlent comme pour les autres.
- Lecteur, séries : l'image à côté du titre est celle de l'épisode ; à défaut l'affiche de la série si elle est bien en hauteur, sinon rien (plus d'image mal rognée).
- Le cache d'images se vide tout seul : une image qui n'a pas été affichée depuis 30 jours est effacée
  à la synchronisation (vignettes de programmes passés surtout). Les images choisies à la main ne sont jamais touchées.
- **Code parental** : depuis la page web, choisissez un code et verrouillez des bouquets (chaînes, films ou séries).
  Sur la TV, ils gardent un cadenas ; leurs titres n'apparaissent nulle part (recherche, accueil, reprise, favoris)
  et ne se lisent pas sans le code. Une fois tapé, tout reste ouvert jusqu'à la fermeture de l'appli.
- **Langue audio et sous-titres choisis d'avance**, séparément pour le direct, les films et les séries
  (Réglages › Langue audio et sous-titres). Dans une série, un changement fait pendant un épisode
  est gardé pour les épisodes suivants.
- **Format de l'image** dans le lecteur : entière avec bandes noires, plein écran (étirée), ou d'après la vidéo.
  Retenu chaîne par chaîne en direct, une fois pour toutes en films et séries.
- **Mémoire tampon du direct** réglable (3, 8, 15 ou 30 secondes) : moins de coupures sur un flux irrégulier.
- **Taille des sous-titres** réglable : petite, moyenne, grande, très grande.
- Accueil : le fond est un vrai fond de film en HD (1920 px), demandé au fournisseur en arrière-plan
  la première fois ; la petite jaquette étirée n'est plus qu'un dernier recours.
- Pendant le direct, **changer de bouquet** sans quitter la lecture : en tête de la liste rapide (Gauche),
  ou touche bleue dans la mosaïque. Haut et Bas suivent ensuite le nouveau bouquet.
- Accueil : le bouton « Voir la fiche » est de nouveau atteignable avec la flèche droite.
- Abonnements : la dernière erreur porte sa date et son heure, pour savoir si elle est plus récente que la dernière synchronisation réussie.

## 1.0 — Luciole

Première version publique.

### Fonctions

- **Plusieurs abonnements IPTV** dans une seule installation : un bloc `[[xtream]]` par abonnement.
  Le direct mélange toutes les chaînes dans une liste, avec une pastille de provenance (lettre sur couleur)
  et un filtre par abonnement. Option `decalage` pour séparer les numéros de chaînes.
- **État des abonnements** : statut, date d'expiration, jours restants, connexions utilisées sur autorisées.
  Sur la page web et dans les réglages du téléviseur.
- **Bibliothèque** : une sélection personnelle de films et de séries, dans des catégories que vous créez,
  pré-remplies d'après le genre TMDB (ou celui du fournisseur), traduit, puis corrigeable.
- **Mosaïque** en direct, sur la touche droite : toutes les chaînes en vignettes, programme en cours et suivant,
  la chaîne regardée continue dans un cadre.
- **Démarrage automatique réglable depuis le téléviseur**, avec l'adresse du téléviseur proposée d'office.
- **Deux thèmes** sombres, Luciole (vert) et Ambre, et **français / anglais** dans l'appli et la page web.
- **Logos** préparés par le serveur : fond noir retiré, rognés, taille homogène, sur fond transparent.
- **Page d'accueil web** à la racine, et adresse `http://luciole.local:8765` (Avahi).
- Installation documentée sur Proxmox, Raspberry Pi ou PC ; fuseau horaire réglé par le script d'installation.
- **Médiathèque → Bibliothèque** depuis la page web : cocher des films ou des séries de vos dossiers
  et les ranger d'un coup, selon leur genre ou dans la catégorie choisie. Un clic sur un dossier ne montre que lui.
- **Conversion du son** (DTS, TrueHD → AC3) depuis la page web, si l'installation autorise l'écriture
  dans la médiathèque. La vidéo n'est pas touchée ; l'original est supprimé, ou gardé sur demande.
- **Plusieurs versions d'un film** (4K, 1080p, 720p) : une seule fiche, la meilleure version lisible démarre,
  une autre se choisit sur la fiche, et Luciole passe à la suivante si une version ne démarre pas.
  Limite de qualité réglable sur le téléviseur.
- **Arborescence Kodi / Plex / Jellyfin** : bandes-annonces et bonus reconnus (plus jamais pris pour des films),
  bouton **Bonus** sur la fiche, bande-annonce locale lue avant YouTube, logo `clearlogo` à la place du titre.
- **En direct en vignettes** : l'image du programme en cours (XMLTV) ou le logo de la chaîne, à la place des blocs
  de la grille ; la grille horaire reste à un OK, sur la ligne « Affichage ».
- **Numérotation par bouquet** : chaque bouquet a ses numéros, la TV les suit (touches 0–9 comprises).
- **Tri de la Bibliothèque** : ajout récent, date de sortie, ou de A à Z.
- **Résumé pendant la lecture** d'un film ou d'un épisode : la touche Bas ouvre un volet sous les commandes.
- En-tête : loupe, réglages et heure sur la ligne du logo ; la pastille de la chaîne en cours à droite des onglets.
