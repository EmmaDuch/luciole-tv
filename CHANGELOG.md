# Changements

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
