/* Luciole — langue de l'interface (français ou anglais).
 * Le texte français sert de clé : tr('Chargement…') renvoie la traduction anglaise si la
 * langue choisie est l'anglais, sinon le texte tel quel. Les {mots} entre accolades sont
 * remplacés par les valeurs passées : tr('{n} chaînes', { n: 12 }).
 * Les titres des programmes, films et séries restent dans la langue du fournisseur. */
'use strict';

var LANG = (function () {
  try {
    var v = JSON.parse(localStorage.getItem('luciole.lang'));
    if (v === 'fr' || v === 'en') return v;
  } catch (e) { /* rien d'enregistré */ }
  return 'fr';
})();

function tr(s, p) {
  var out = (LANG === 'en' && EN[s] !== undefined) ? EN[s] : s;
  if (p) out = out.replace(/\{(\w+)\}/g, function (m, k) { return p[k] !== undefined && p[k] !== null ? p[k] : m; });
  return out;
}

var EN = {
  /* communs */
  'Chargement…': 'Loading…', 'Réessayer': 'Try again', 'Annuler': 'Cancel', 'Enregistrer': 'Save',
  'Accueil': 'Home', 'En direct': 'Live', 'Films': 'Movies', 'Séries': 'Series', 'Bibliothèque': 'Library',
  'Rechercher': 'Search', 'Réglages': 'Settings', 'Retour': 'Back', 'Favori': 'Favourite', 'Favoris': 'Favourites',
  'Regarder': 'Watch', 'Reprendre': 'Resume', 'Depuis le début': 'From the start', 'Terminé': 'Finished',
  '{d} restantes': '{d} left', 'Programme': 'Programme', 'Film': 'Movie', 'Série': 'Series', 'Pas de guide': 'No guide',
  'EN DIRECT': 'LIVE', 'REPLAY': 'CATCH-UP', 'EN COURS': 'ON NOW', 'FILM': 'MOVIE', 'SÉRIE': 'SERIES',
  'Ma liste': 'My list', 'Bienvenue': 'Welcome', 'Nouveau': 'New', 'Au revoir': 'Goodbye',
  'aujourd’hui': 'today', 'hier': 'yesterday', 'le {d}': '{d}', 'jamais': 'never', 'à': 'at',
  'serveur injoignable': 'server unreachable', 'le serveur ne répond pas': 'the server is not responding',
  'erreur {n}': 'error {n}',
  /* messages venus du serveur */
  'chaîne inconnue': 'unknown channel', 'film inconnu': 'unknown movie', 'série inconnue': 'unknown series',
  'fiche inconnue': 'unknown item', 'le fournisseur ne répond pas': 'the provider is not responding',
  'jeton manquant ou incorrect': 'missing or wrong password', 'fichier inconnu': 'unknown file',
  'pas de replay sur cette chaîne': 'no catch-up on this channel',
  'cet abonnement n\'est plus dans la configuration': 'this subscription is no longer configured',
  'erreur interne': 'internal error',
  /* navigation, sortie */
  'Appuyez encore sur Retour pour quitter Luciole': 'Press Back again to quit Luciole',
  'Ajouté à « À regarder plus tard »': 'Added to “Watch later”', 'Retiré de « À regarder plus tard »': 'Removed from “Watch later”',
  'Ajouté aux favoris': 'Added to favourites', 'Retiré des favoris': 'Removed from favourites',
  '{n} ajoutée aux favoris': '{n} added to favourites', '{n} retirée des favoris': '{n} removed from favourites',
  /* premier lancement */
  'Serveur Luciole': 'Luciole server',
  'Indiquez l’adresse du serveur Luciole sur votre réseau. Par exemple 192.168.1.20': 'Enter the address of the Luciole server on your network. For example 192.168.1.20',
  'Adresse du serveur': 'Server address', 'Mot de passe du serveur (laisser vide s’il n’y en a pas)': 'Server password (leave empty if there is none)',
  'Se connecter': 'Connect', 'Indiquez une adresse.': 'Enter an address.', 'Connexion…': 'Connecting…',
  'Connecté. Le serveur prépare encore le catalogue…': 'Connected. The server is still preparing the catalogue…',
  'Impossible de joindre {b} : {e}. Vérifiez l’adresse et que le serveur est démarré.': 'Cannot reach {b}: {e}. Check the address and that the server is running.',
  /* accueil */
  'Le catalogue est vide pour l’instant. Vérifiez la synchronisation dans les Réglages.': 'The catalogue is empty for now. Check the synchronisation in Settings.',
  'Film ajouté {d}': 'Movie added {d}', 'Série mise à jour {d}': 'Series updated {d}', 'Épisode suivant': 'Next episode', 'Reprendre la lecture': 'Continue watching',
  'Saison {s} · Épisode {e}': 'Season {s} · Episode {e}', 'La chaîne': 'Channel', 'Voir la fiche': 'Details',
  'Chaînes favorites': 'Favourite channels', 'Touche jaune dans le guide pour en ajouter': 'Yellow button in the guide to add some',
  'Aucune chaîne favorite. Dans le guide, placez-vous sur une chaîne et appuyez sur la touche jaune.': 'No favourite channels. In the guide, move to a channel and press the yellow button.',
  'S{s} · É{e}': 'S{s} · E{e}', 'Films ajoutés récemment': 'Recently added movies', 'Séries mises à jour': 'Updated series',
  /* guide */
  'Jaune': 'Yellow', 'Vert': 'Green', 'Bleu': 'Blue', 'Rouge': 'Red', 'Modifier': 'Edit', 'Replay': 'Catch-up',
  'Toutes les chaînes': 'All channels', 'Avec replay': 'With catch-up', '{n} chaînes': '{n} channels',
  'Tous les serveurs': 'All servers', 'Serveur': 'Server',
  'Pas encore de favoris. Choisissez « Toutes les chaînes » et appuyez sur la touche jaune.': 'No favourites yet. Choose “All channels” and press the yellow button.',
  'Aucune chaîne dans cette catégorie.': 'No channels in this category.', 'Aucune information': 'No information',
  'Pas de guide pour cette chaîne': 'No guide for this channel', 'Pas de guide pour cette chaîne.': 'No guide for this channel.',
  'Programme terminé, et pas de replay sur cette chaîne': 'Programme over, and no catch-up on this channel',
  'Pas de replay sur {n}': 'No catch-up on {n}', 'Chaîne {n}': 'Channel {n}',
  'Chaîne introuvable dans cette liste': 'Channel not found in this list', 'Chaîne introuvable': 'Channel not found',
  'Cette liste ne peut pas être renommée': 'This list cannot be renamed',
  'Pas de résumé pour ce programme.': 'No summary for this programme.',
  'Résumé': 'Summary', 'Vignettes': 'Tiles', 'Grille horaire': 'Time grid', 'Affichage': 'View', 'Ajout récent': 'Recently added', 'Date de sortie': 'Release date', 'De A à Z': 'A to Z',
  'Bonus': 'Extras', 'BONUS': 'EXTRA', 'Extrait': 'Sample', 'Making-of': 'Featurette', 'Coulisses': 'Behind the scenes',
  'Scène coupée': 'Deleted scene', 'Interview': 'Interview', 'Scène': 'Scene', 'Court métrage': 'Short film',
  '1080p au plus': '1080p at most', '720p au plus': '720p at most', 'La meilleure lisible': 'Best playable',
  'La version {v} ne démarre pas : essai d’une autre version': 'Version {v} won’t start: trying another version',
  '{n} versions': '{n} versions', 'Ce film démarrera dans cette version': 'This film will start in this version',
  'Version automatique : la meilleure lisible': 'Automatic version: best playable', 'Version qui démarre': 'Version to start',
  'Automatique': 'Automatic', 'Go': 'GB', 'Mo': 'MB', 'ici {v}': 'here {v}',
  'Qualité des films de la médiathèque': 'Quality of media library films',
  'Quand un film existe en plusieurs versions (4K, 1080p, 720p)': 'When a film exists in several versions (4K, 1080p, 720p)',
  'Pas de résumé disponible.': 'No summary available.',
  'Avec {n}': 'Starring {n}',
  /* page d'une chaîne */
  'Chaîne': 'Channel', 'REPLAY {n} JOUR': 'CATCH-UP {n} DAY', 'REPLAY {n} JOURS': 'CATCH-UP {n} DAYS',
  'Guide : {n}': 'Guide: {n}', 'Chaîne de votre abonnement.': 'A channel from your subscription.',
  'En cours': 'On now', 'Regarder la chaîne': 'Watch channel', 'Replay de la chaîne': 'Channel catch-up',
  'Retirer des favoris': 'Remove from favourites', 'Ajouter aux favoris': 'Add to favourites',
  'Programme suivant': 'Up next', 'Peut aussi vous intéresser': 'You may also like',
  /* lecteur */
  'Guide': 'Guide', 'Reculer': 'Back', 'Pause': 'Pause', 'Avancer': 'Forward', 'Audio et sous-titres': 'Audio and subtitles',
  'Ensuite {h} · {t}': 'Next {h} · {t}', 'Épisode {n}': 'Episode {n}',
  '{s} · Saison {n} · Épisode {e}': '{s} · Season {n} · Episode {e}', 'Ensuite S{s} · É{e}': 'Next S{s} · E{e}',
  'Format non lu par le téléviseur': 'Format not supported by the TV',
  'Reconnexion dans {w} s (essai {n} sur {m})': 'Reconnecting in {w} s (attempt {n} of {m})',
  ' · la lecture reprendra au même endroit': ' · playback will resume at the same point',
  'Lecture impossible sur cette chaîne.': 'Cannot play this channel.', 'Lecture impossible.': 'Cannot play.',
  'Chaîne suivante': 'Next channel', 'Épisode suivant dans {n} s': 'Next episode in {n} s', 'Arrêter': 'Stop',
  'le direct s’est arrêté': 'the live stream stopped', 'le flux s’est figé': 'the stream froze',
  'le flux ne démarre pas': 'the stream does not start', 'lecture impossible dans ce navigateur': 'cannot play in this browser',
  'Dernières chaînes': 'Recent channels', 'Chaînes': 'Channels', 'Guide des programmes': 'Programme guide',
  'Voir en replay': 'Watch catch-up', 'Flux': 'Stream', 'Audio': 'Audio', 'Piste par défaut': 'Default track',
  'Sous-titres': 'Subtitles', 'Désactivés': 'Off', 'Piste {n}': 'Track {n}', 'Sous-titres {n}': 'Subtitles {n}',
  'Piste audio indisponible': 'Audio track unavailable', 'Sous-titres indisponibles': 'Subtitles unavailable',
  'Stéréo': 'Stereo', 'Mono': 'Mono',
  /* mosaïque */
  'Mosaïque': 'Mosaic', 'Maintenant': 'Now', 'Ensuite': 'Next', 'Rien au guide': 'Nothing in the guide',
  'En cours de lecture': 'Now playing', 'Aller au numéro': 'Go to number',
  /* replay */
  'Replay · {n}': 'Catch-up · {n}', 'Aucun programme en replay pour le moment.': 'No catch-up programmes for now.',
  'Non disponible': 'Unavailable', 'Ce programme n’est pas enregistré par votre fournisseur': 'This programme was not recorded by your provider',
  /* catalogue */
  'Tous les films': 'All movies', 'Toutes les séries': 'All series', 'Historique': 'History',
  'Films déjà vus ou commencés': 'Movies watched or started', 'Séries déjà vues ou en cours': 'Series watched or in progress',
  'À regarder plus tard': 'Watch later', 'Vos favoris et films mis de côté': 'Your favourites and saved movies',
  'Vos favoris et séries mises de côté': 'Your favourites and saved series', 'Rien dans cette catégorie.': 'Nothing in this category.',
  /* fiches */
  'Création : {n}': 'Created by: {n}', 'Réalisation : {n}': 'Directed by: {n}', 'Avec : {n}': 'Starring: {n}', 'Bande-annonce': 'Trailer',
  '{n} saison': '{n} season', '{n} saisons': '{n} seasons', 'Saison {n}': 'Season {n}',
  '{l} S{s} · É{e}': '{l} S{s} · E{e}', 'Aucun épisode disponible pour l’instant.': 'No episodes available yet.',
  'É{e} · {t}': 'E{e} · {t}', 'Vu': 'Watched',
  /* historique, liste */
  'Tout': 'All', 'Terminés': 'Finished', 'Effacer': 'Clear', 'Retirer': 'Remove', 'Ouvrir': 'Open',
  'Film · ': 'Movie · ', 'terminé ': 'finished ', '{d} restantes · ': '{d} left · ',
  'Cette semaine': 'This week', 'Plus tôt': 'Earlier', 'Rien dans l’historique pour l’instant.': 'Nothing in the history yet.',
  'Effacer l’historique ?': 'Clear the history?',
  'Toute la progression de lecture sera supprimée. Les listes et favoris sont conservés.': 'All playback progress will be deleted. Lists and favourites are kept.',
  'Historique effacé': 'History cleared', '« {n} » retiré de l’historique': '“{n}” removed from the history',
  'Date d’ajout': 'Date added', 'Titre (A-Z)': 'Title (A-Z)', '{k} · ajouté {d}': '{k} · added {d}',
  'Votre liste est vide. Sur une fiche, choisissez le signet ou appuyez sur la touche jaune.': 'Your list is empty. On a details page, choose the bookmark or press the yellow button.',
  '« {n} » retiré de la liste': '“{n}” removed from the list',
  /* recherche */
  'Chaîne, film ou série…': 'Channel, movie or series…', 'Tapez au moins deux lettres. Les accents ne comptent pas.': 'Type at least two letters. Accents do not matter.',
  'Aucun résultat pour « {q} ».': 'No results for “{q}”.',
  /* réglages */
  'Adresse du serveur sur votre réseau': 'Server address on your network',
  'Aperçu vidéo dans le guide': 'Video preview in the guide',
  'Lance la chaîne en fond quand vous vous arrêtez dessus': 'Plays the channel in the background when you stop on it',
  'Mettre à jour le catalogue maintenant': 'Update the catalogue now', 'Mise à jour en cours…': 'Update in progress…',
  'Dernière mise à jour : {w}': 'Last update: {w}', 'État inconnu': 'Unknown status',
  '{l} chaînes · {v} films · {s} séries': '{l} channels · {v} movies · {s} series',
  'Bouquets, noms, numéros et guide': 'Bouquets, names, numbers and guide',
  'Depuis le navigateur d’un ordinateur : {u}': 'From a computer’s browser: {u}',
  'OK valider · Retour revenir · jaune favori · vert replay · bleu modifier · Info la chaîne · 0-9 numéro': 'OK select · Back return · yellow favourite · green catch-up · blue edit · Info channel · 0-9 number',
  'Mise à jour lancée': 'Update started', 'Langue': 'Language', 'Langue de l’interface': 'Interface language',
  'Thème': 'Theme', 'Couleur d’accent de l’interface': 'Interface accent colour',
  'Luciole (vert)': 'Luciole (green)', 'Ambre': 'Amber',
  /* abonnements, démarrage automatique */
  'pas encore de réponse du fournisseur': 'no answer from the provider yet', 'actif': 'active',
  'expire le {d}': 'expires on {d}', '{a}/{m} connexions': '{a}/{m} connections', '{n} jours': '{n} days', '{n} jour': '{n} day',
  'Démarrage automatique': 'Automatic start', 'Ouvrir Luciole quand le téléviseur s’allume': 'Open Luciole when the TV turns on',
  'activé': 'on', 'désactivé': 'off', 'Serveur autorisé sur ce téléviseur': 'Server authorised on this TV',
  'Serveur pas encore autorisé': 'Server not authorised yet', 'surveillance active': 'watching',
  'surveillance à redémarrer': 'watcher needs a restart', 'dernier réveil : {d}': 'last wake-up: {d}',
  'Le serveur surveille le téléviseur et ouvre Luciole à la place de Samsung TV Plus.': 'The server watches the TV and opens Luciole instead of Samsung TV Plus.',
  'Adresse du téléviseur': 'TV address', 'OK : utiliser l’adresse de ce téléviseur ({ip})': 'OK: use this TV’s address ({ip})',
  'Donnez-lui une adresse fixe dans votre modem': 'Give it a fixed address in your modem', 'Application ouverte': 'Application opened',
  'OK : utiliser cette application ({id})': 'OK: use this application ({id})', 'Identifiant de l’application Luciole': 'Luciole application identifier',
  'Attente après l’allumage': 'Wait after power-on', 'Le temps que le téléviseur finisse de démarrer. OK pour changer.': 'Time for the TV to finish starting. OK to change.',
  '{n} s': '{n} s', 'Essais': 'Attempts', 'Luciole est relancé tant qu’il n’est pas à l’écran. OK pour changer.': 'Luciole is relaunched until it is on screen. OK to change.',
  'Autoriser le serveur': 'Authorise the server', 'Une fenêtre Samsung s’ouvre : acceptez-la avec la télécommande. Une seule fois.': 'A Samsung window opens: accept it with the remote. Only once.',
  'autorisé': 'authorised', 'à faire': 'to do', 'État': 'Status', 'Démarrage automatique activé': 'Automatic start on',
  'Démarrage automatique désactivé': 'Automatic start off', 'Adresse enregistrée': 'Address saved', 'Adresse IP': 'IP address',
  'Application enregistrée': 'Application saved', 'Identifiant': 'Identifier', 'Acceptez la fenêtre qui va s’afficher…': 'Accept the window that is about to appear…',
  'Serveur autorisé': 'Server authorised', 'Pas d’autorisation reçue': 'No authorisation received',
  'renseignez d\'abord l\'adresse du téléviseur': 'enter the TV address first',
  /* bande-annonce */
  'Bande-annonce {t}': 'Trailer {t}', 'Reculer, avancer': 'Back, forward', 'Fermer': 'Close',
  'Bande-annonce indisponible (vidéo retirée ou non autorisée hors de YouTube).': 'Trailer unavailable (video removed or not allowed outside YouTube).',
  'Appuyez sur OK pour lancer la bande-annonce.': 'Press OK to start the trailer.',
  /* modifier */
  'Modifier la chaîne': 'Edit channel', 'Numéro': 'Number', 'Nom': 'Name',
  'Numéro du fournisseur : {n}': 'Provider number: {n}', 'Nom du fournisseur : {n}': 'Provider name: {n}',
  'Le numéro doit être un nombre.': 'The number must be a number.',
  'Enregistré. Attention : « {n} » a le même numéro.': 'Saved. Note: “{n}” has the same number.',
  'Chaîne modifiée': 'Channel updated', 'Valeurs du fournisseur': 'Provider values',
  'Valeurs du fournisseur rétablies': 'Provider values restored', 'Renommer le bouquet': 'Rename bouquet',
  'Bouquet renommé': 'Bouquet renamed', 'Nom du fournisseur': 'Provider name',
  /* bibliothèque */
  'Ajouté à la Bibliothèque · {c}': 'Added to the Library · {c}', '(nouvelle catégorie)': '(new category)',
  'Catégorie dans la Bibliothèque': 'Category in the Library', 'Nouvelle catégorie…': 'New category…',
  'Retirer de la Bibliothèque': 'Remove from the Library', 'Rangé dans « {c} »': 'Filed under “{c}”',
  'Retiré de la Bibliothèque': 'Removed from the Library', 'Nouvelle catégorie': 'New category',
  'Donnez un nom à la catégorie.': 'Give the category a name.', 'Catégorie': 'Category', 'Renommer': 'Rename',
  'Votre Bibliothèque est vide. Sur la fiche d’un film ou d’une série, choisissez « Bibliothèque » : le titre y est rangé dans la catégorie de son genre.':
    'Your Library is empty. On a movie or series page, choose “Library”: the title is filed in the category of its genre.',
  '« {n} » retiré de la Bibliothèque': '“{n}” removed from the Library', 'Renommer la catégorie': 'Rename category',
  'Catégorie renommée': 'Category renamed',
  'Aucune série dans votre Bibliothèque. Sur la fiche d’une série, choisissez « Bibliothèque ».': 'No series in your Library. On a series page, choose “Library”.',
  'Aucun film dans votre Bibliothèque. Sur la fiche d’un film, choisissez « Bibliothèque ».': 'No movies in your Library. On a movie page, choose “Library”.', 'catégorie inconnue': 'unknown category', 'titre inconnu': 'unknown title',
  /* langues des pistes */
  'Français': 'French', 'Anglais': 'English', 'Néerlandais': 'Dutch', 'Allemand': 'German', 'Espagnol': 'Spanish',
  'Italien': 'Italian', 'Portugais': 'Portuguese', 'Arabe': 'Arabic', 'Turc': 'Turkish',
  /* langue audio et sous-titres par type de contenu */
  'Langue audio et sous-titres': 'Audio language and subtitles', 'Choisis d’avance pour le direct, les films et les séries': 'Chosen in advance for live TV, movies and series',
  'Celle du flux': 'Stream default', 'Ceux du flux': 'Stream default',
  'OK pour changer. Si la langue manque, le flux garde la sienne.': 'OK to change. If the language is missing, the stream keeps its own.',
  'OK pour changer.': 'OK to change.', 'OK pour changer': 'OK to change', 'Image': 'Picture', 'Image, son et sous-titres': 'Picture, sound and subtitles',
  'Entière, avec des bandes noires': 'Whole picture, with black bars', 'Plein écran (étirée)': 'Full screen (stretched)',
  'D’après la vidéo': 'From the video', 'Bouquet': 'Bouquet', 'OK pour changer de bouquet': 'OK to change bouquet',
  'Aucune chaîne dans ce bouquet': 'No channel in this bouquet', '{n} chaînes': '{n} channels', 'Mémoire tampon du direct': 'Live TV buffer', '{n} s': '{n} s',
  'Plus longue : moins de coupures sur un flux irrégulier, mais un zapping plus lent': 'Longer: fewer cuts on an unsteady stream, but slower zapping', 'Code parental': 'Parental code',
  'Tapez le code avec les chiffres de la télécommande, puis OK.': 'Type the code with the remote’s number keys, then OK.',
  'Le code compte au moins 4 chiffres.': 'The code has at least 4 digits.', 'code incorrect': 'wrong code',
  'verrouillé par le code parental': 'locked by the parental code', '— — — —': '— — — —',
  'Les bouquets verrouillés sont ouverts. OK pour les refermer.': 'Locked bouquets are open. OK to lock them again.',
  'Les bouquets verrouillés demandent le code. Il se choisit sur la page web.': 'Locked bouquets ask for the code. It is chosen on the web page.',
  'ouvert': 'open', 'fermé': 'locked', 'Bouquets verrouillés refermés': 'Locked bouquets closed again', 'Bouquets verrouillés ouverts': 'Locked bouquets opened', 'Taille des sous-titres': 'Subtitle size',
  'Petite': 'Small', 'Moyenne': 'Medium', 'Grande': 'Large', 'Très grande': 'Extra large', 'Dans une série': 'Within a series',
  'Un changement fait pendant un épisode est gardé pour les épisodes suivants de la même série.': 'A change made during an episode is kept for the next episodes of the same series.'
};

var DAYS = { fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
var MONTHS = {
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
};
