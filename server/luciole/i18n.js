/* Luciole — langue de la page web (français ou anglais), indépendante de celle du téléviseur.
 * Le texte français sert de clé. tr('{n} chaînes', { n: 3 }) renvoie « 3 channels » en anglais.
 * translatePage() traduit le texte fixe de la page (textes, placeholder, title, aria-label). */
'use strict';

var LANG = (function () {
  try {
    var v = JSON.parse(localStorage.getItem('luciole.web.lang'));
    if (v === 'fr' || v === 'en') return v;
  } catch (e) { /* rien d'enregistré */ }
  return /^fr\b/i.test(navigator.language || 'fr') ? 'fr' : ((navigator.language || '').slice(0, 2) === 'en' ? 'en' : 'fr');
})();
document.documentElement.lang = LANG;

function tr(s, p) {
  var out = (LANG === 'en' && EN[s] !== undefined) ? EN[s] : s;
  if (p) out = out.replace(/\{(\w+)\}/g, function (m, k) { return p[k] !== undefined && p[k] !== null ? p[k] : m; });
  return out;
}

function translatePage(root) {
  if (LANG === 'fr') return;
  var walk = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
  var n, todo = [];
  while ((n = walk.nextNode())) {
    var p = n.parentNode && n.parentNode.nodeName;
    if (p === 'SCRIPT' || p === 'STYLE' || p === 'CODE') continue;
    var key = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (key && EN[key] !== undefined) todo.push([n, key]);
  }
  todo.forEach(function (t) {
    var lead = /^\s/.test(t[0].nodeValue) ? ' ' : '', tail = /\s$/.test(t[0].nodeValue) ? ' ' : '';
    t[0].nodeValue = lead + EN[t[1]] + tail;
  });
  ['placeholder', 'title', 'aria-label'].forEach(function (a) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[' + a + ']'), function (el) {
      var v = el.getAttribute(a);
      if (EN[v] !== undefined) el.setAttribute(a, EN[v]);
    });
  });
  if (EN[document.title] !== undefined) document.title = EN[document.title];
}

var EN = {
  'Logo du titre': 'Title logo',
  'Logo du titre : sans choix ici, Luciole prend le fichier clearlogo.png posé à côté, sinon celui de TMDB.': 'Title logo: if none is chosen here, Luciole uses the clearlogo.png file next to the media, otherwise the TMDB one.',
  'Bande-annonce (lien YouTube)': 'Trailer (YouTube link)',
  'Vide : celle du fournisseur ou de TMDB.': 'Empty: the provider or TMDB one.',
  'Nommer la version': 'Name this version',
  'Nom de cette version': 'Name of this version',
  'Lu dans le nom du fichier : « {e} ». Laissez vide pour le garder.': 'Read from the file name: “{e}”. Leave empty to keep it.',
  'Par exemple « Version longue » ou « Copie 35 mm ». Laissez vide pour n’en mettre aucun.': 'For example “Extended version” or “35 mm print”. Leave empty for none.',
  'Ajouter une chaîne': 'Add a channel',
  'Un lien': 'A link',
  'Une liste M3U': 'An M3U list',
  'Ma chaîne': 'My channel',
  'Adresse du flux': 'Stream address',
  'Logo (adresse d’une image, facultatif)': 'Logo (image address, optional)',
  'Numéro (facultatif)': 'Number (optional)',
  'Adresse de la liste M3U': 'M3U list address',
  '… ou collez son contenu ici': '… or paste its content here',
  'Chaque entrée #EXTINF devient une chaîne, avec son nom et son logo. Les liens déjà présents sont ignorés.': 'Each #EXTINF entry becomes a channel, with its name and logo. Links already present are skipped.',
  'Ajouter aussi au bouquet': 'Also add to bouquet',
  'Aucun (seulement « Mes liens »)': 'None (only “My links”)',
  '{n} chaîne(s) ajoutée(s) dans « Mes liens ».': '{n} channel(s) added to “My links”.',
  'Rien de nouveau : ces liens sont déjà là.': 'Nothing new: these links are already there.',
  'Lien': 'Link',
  'Lien de « {n} »': 'Link of “{n}”',
  'Lien enregistré.': 'Link saved.',
  'Supprimer « {n} »': 'Delete “{n}”',
  'Cette chaîne ajoutée à la main sera retirée de Luciole, de vos bouquets et de vos favoris.': 'This manually added channel will be removed from Luciole, your bouquets and your favourites.',
  'Ajoutée à la main · n° {n} · {o}': 'Added manually · no. {n} · {o}',
  'Modifiez le numéro ou le nom puis appuyez sur Entrée. Un champ vide revient à la valeur du fournisseur. « Ajouter une chaîne » accepte un lien de flux ou une liste M3U ; ces chaînes vont dans le bouquet « Mes liens ».': 'Edit the number or name then press Enter. An empty field goes back to the provider value. “Add a channel” accepts a stream link or an M3U list; these channels go into the “My links” bouquet.',
  /* en-tête, onglets */
  'Luciole – Réglages': 'Luciole – Settings', 'Luciole – Accueil': 'Luciole – Home',
  'Organisez vos bouquets, vos chaînes et votre guide des programmes. Tout est enregistré tout de suite.':
    'Organise your bouquets, channels and programme guide. Everything is saved immediately.',
  'Thème': 'Theme', 'Langue': 'Language', 'Thème Luciole': 'Luciole theme', 'Thème Ambre': 'Amber theme',
  'Abonnements': 'Subscriptions', 'Mes bouquets': 'My bouquets', 'Chaînes': 'Channels', 'Films et séries': 'Movies and series',
  'Médiathèque': 'Media library', 'Téléviseur': 'TV', 'Noms': 'Names', 'Guide': 'Guide',
  'Bouquets du fournisseur': 'Provider bouquets', 'Synchroniser maintenant': 'Synchronise now',
  'Valider': 'OK', 'Annuler': 'Cancel', 'Confirmer': 'Confirm', 'Fermer': 'Close', 'Enregistrer': 'Save',
  'Erreur : {m}': 'Error: {m}', 'erreur {n}': 'error {n}', 'jamais': 'never',
  'Dernière synchronisation : {d}': 'Last synchronisation: {d}', 'Synchronisation en cours… ': 'Synchronising… ',
  '{l} chaînes, {v} films, {s} séries': '{l} channels, {v} movies, {s} series',
  /* abonnements */
  'Un abonnement par bloc': 'One subscription per', 'dans': 'block in',
  '. Les identifiants restent dans ce fichier ; cette page n\'affiche que l\'état de chaque abonnement.':
    '. Credentials stay in that file; this page only shows the status of each subscription.',
  'Synchroniser': 'Synchronise', 'En cours…': 'Running…', 'État': 'Status', 'actif': 'active',
  'Expire le': 'Expires on', 'Jours restants': 'Days left', '{n} jours': '{n} days', '{n} jour': '{n} day',
  'sans date d’expiration': 'no expiry date', 'Connexions': 'Connections',
  '{a} utilisée(s) sur {m} autorisée(s)': '{a} in use out of {m} allowed', 'Type': 'Type', 'essai': 'trial',
  'Relevé le': 'Checked on', 'pas encore de réponse du fournisseur': 'no answer from the provider yet',
  'Catalogue': 'Catalogue', 'Synchronisation': 'Synchronisation', 'Dernière erreur': 'Last error',
  'Identifiant': 'Identifier', 'Lettre de la pastille': 'Badge letter', 'Couleur de la pastille': 'Badge colour',
  'Enregistrer la pastille': 'Save badge', 'Automatique': 'Automatic', 'Pastille': 'Badge',
  /* mes bouquets */
  'Direct': 'Live', 'Films': 'Movies', 'Séries': 'Series',
  'Ils passent avant ceux du fournisseur sur la TV. Chaque sorte a ses propres bouquets.':
    'They come before the provider’s on the TV. Each kind has its own bouquets.',
  'Nouveau bouquet': 'New bouquet', 'Depuis une catégorie': 'From a category',
  'Créer à partir d\'un bouquet du fournisseur': 'Create from a provider bouquet', 'Contenu': 'Content',
  'Renuméroter': 'Renumber', 'Ajouter des chaînes': 'Add channels',
  'Glissez les lignes pour changer l\'ordre. Cet ordre sert aussi à la renumérotation.':
    'Drag rows to change the order. This order is also used for renumbering.',
  'Glissez les lignes pour changer l\'ordre d\'affichage sur la TV.': 'Drag rows to change the order on the TV.',
  'chaînes': 'channels', 'films': 'movies', 'séries': 'series', 'ch.': 'ch.',
  'Aucun bouquet pour l’instant.': 'No bouquets yet.', 'Monter': 'Move up', 'Descendre': 'Move down',
  'Renommer': 'Rename', 'Renommer le bouquet': 'Rename bouquet', 'Nom': 'Name', 'Supprimer': 'Delete',
  'Supprimer « {n} » ?': 'Delete “{n}”?',
  'Le bouquet disparaît de la TV. Le contenu lui-même n’est pas touché.': 'The bouquet disappears from the TV. The content itself is not touched.',
  'Ajouter des {u}': 'Add {u}', 'Créez un bouquet pour commencer.': 'Create a bouquet to start.',
  'Bouquet vide. Utilisez « Ajouter des {u} ».': 'Empty bouquet. Use “Add {u}”.',
  'Fournisseur : {n}': 'Provider: {n}', 'Retirer': 'Remove', 'Ordre enregistré': 'Order saved', 'Créer': 'Create',
  'Créer depuis une catégorie du fournisseur': 'Create from a provider category', 'Catégorie': 'Category',
  'Nom du bouquet': 'Bouquet name', 'Renuméroter « {n} »': 'Renumber “{n}”',
  'Premier numéro': 'First number', 'Pas': 'Step', '{n} chaînes renumérotées': '{n} channels renumbered',
  'Rechercher': 'Search', 'Toutes les catégories': 'All categories', 'Tout cocher': 'Tick all',
  'Aucune chaîne à ajouter ici.': 'No channels to add here.',
  'Rien à ajouter ici. Choisissez un bouquet, ou tapez au moins deux lettres.': 'Nothing to add here. Choose a bouquet, or type at least two letters.',
  '{n} {u} disponibles': '{n} {u} available', '{n} {u} ajoutés': '{n} {u} added', 'Ajouter': 'Add',
  /* chaînes */
  'Rechercher une chaîne': 'Search a channel', 'Bouquet': 'Bouquet', 'Tous les bouquets': 'All bouquets',
  'Numéros d\'origine': 'Original numbers', 'Numéros d’origine': 'Original numbers',
  'Modifiez le numéro ou le nom puis appuyez sur Entrée. Un champ vide revient à la valeur du fournisseur.':
    'Change the number or name then press Enter. An empty field goes back to the provider’s value.',
  ' (masqué)': ' (hidden)', 'Aucune chaîne.': 'No channels.', 'Numéro de {n}': 'Number of {n}',
  'Ce numéro est utilisé par plusieurs chaînes': 'This number is used by several channels',
  'Nom de la chaîne': 'Channel name', 'Fournisseur : n° {n} · {o}': 'Provider: no. {n} · {o}', 'Logo': 'Logo',
  'Rétablir': 'Restore', '{n} chaînes': '{n} channels', ' (affinez la recherche)': ' (refine the search)',
  'Logo de {n}': 'Logo of {n}',
  'Collez une adresse web, ou choisissez un fichier sur votre PC. L’image est copiée sur le serveur ; « Rétablir » revient au logo du fournisseur. Le fond noir est retiré automatiquement ; si le résultat n’est pas bon, envoyez une version PNG transparente.':
    'Paste a web address, or choose a file on your PC. The image is copied to the server; “Restore” goes back to the provider’s logo. A black background is removed automatically; if the result is not good, upload a transparent PNG.',
  '✓ Enregistré': '✓ Saved', 'Attention : ce numéro est aussi celui de « {n} ».': 'Note: this number is also used by “{n}”.',
  'Tous les numéros que vous avez choisis seront oubliés. Les noms sont conservés.': 'All the numbers you chose will be forgotten. Names are kept.',
  /* films et séries */
  'Rechercher un titre': 'Search a title',
  'Les règles de nettoyage s\'appliquent d\'abord. Tapez un titre puis Entrée pour le fixer à la main ; un champ vide revient aux règles.':
    'Cleaning rules apply first. Type a title then Enter to set it by hand; an empty field goes back to the rules.',
  'Aucun film.': 'No movies.', 'Aucune série.': 'No series.', 'Titre': 'Title', 'à la main': 'by hand',
  'fiche corrigée': 'edited details', 'Modifier': 'Edit', '{n} films': '{n} movies', '{n} séries': '{n} series',
  'Adresse web': 'Web address', 'Depuis le PC': 'From the PC', 'Image refusée : {m}': 'Image rejected: {m}',
  'Adresse de l’image': 'Image address', 'Collez l’adresse web de l’image (elle sera copiée sur le serveur).':
    'Paste the image’s web address (it will be copied to the server).', 'Utiliser cette image': 'Use this image',
  'Chercher sur TMDB': 'Search TMDB', 'Recherche…': 'Searching…', 'Rien trouvé sous ce titre.': 'Nothing found under this title.',
  '← Autres titres': '← Other titles', 'Choisissez le titre pour voir toutes ses images.': 'Pick the title to see all its images.',
  '{t} : {n} image(s). Cliquez sur celle à utiliser.': '{t}: {n} image(s). Click the one to use.',
  'Chercher': 'Search', 'Titre à chercher': 'Title to search', 'Modifier la fiche': 'Edit details',
  'Résumé': 'Summary', 'Jaquette': 'Poster', 'Fond': 'Backdrop',
  /* médiathèque */
  'Dossiers': 'Folders', 'Chemins tels que le serveur les voit, par exemple': 'Paths as the server sees them, for example',
  'Chemin du dossier': 'Folder path', 'Détection automatique': 'Automatic detection', 'Analyser': 'Scan',
  'Tout réanalyser': 'Rescan everything', 'Épisodes': 'Episodes', 'À vérifier': 'To check',
  'Rechercher un fichier': 'Search a file', 'Aucun dossier déclaré.': 'No folders declared.',
  'détection auto': 'auto detection', '{n} fichiers': '{n} files', 'Retirer ce dossier': 'Remove this folder',
  'Ses films et épisodes quittent le catalogue. Les fichiers ne sont pas touchés.': 'Its movies and episodes leave the catalogue. The files are not touched.',
  'Fiches TMDB activées': 'TMDB details enabled', 'Aucune clé TMDB : pas de jaquettes ni de résumés': 'No TMDB key: no posters or summaries',
  'Analyse des pistes disponible': 'Track analysis available', 'ffprobe absent : compatibilité non vérifiée': 'ffprobe missing: compatibility not checked',
  'Analyse en cours…': 'Scanning…', 'Dernière analyse : {n} fichiers vus, {f} films et {s} séries mis à jour': 'Last scan: {n} files seen, {f} films and {s} series updated',
  '{n} sans fiche': '{n} without details', 'Rien à afficher.': 'Nothing to show.', 'fichier : {n}': 'file: {n}',
  'illisible': 'unplayable', 'sans fiche': 'no details', 'Corriger la fiche': 'Fix details', '{n} éléments': '{n} items',
  'Titre à chercher sur TMDB': 'Title to search on TMDB', 'aucun résultat sur TMDB': 'no results on TMDB',
  'Choisir la fiche': 'Choose the details',
  'Les fiches sont redemandées à TMDB pour l’ensemble de la médiathèque. Vos corrections manuelles sont conservées.':
    'Details are fetched again from TMDB for the whole library. Your manual corrections are kept.',
  /* téléviseur */
  'Démarrage automatique': 'Automatic start',
  'Le serveur surveille le téléviseur et ouvre Luciole dès qu\'il s\'allume, à la place de Samsung TV Plus. Le téléviseur doit rester joignable sur le réseau.':
    'The server watches the TV and opens Luciole as soon as it turns on, instead of Samsung TV Plus. The TV must stay reachable on the network.',
  'Adresse du téléviseur': 'TV address', 'Adresse IP du téléviseur': 'TV IP address', 'Application': 'Application',
  'Identifiant de l\'application': 'Application identifier', 'Attente avant lancement': 'Wait before launch',
  'Secondes d\'attente': 'Seconds to wait', 'secondes': 'seconds', 'Essais': 'Attempts', 'Nombre d\'essais': 'Number of attempts',
  'Ouvrir Luciole quand le téléviseur s\'allume': 'Open Luciole when the TV turns on', 'Lancer maintenant': 'Launch now',
  'Autorisation': 'Authorisation',
  'La première fois, le téléviseur demande s\'il accepte le serveur. Allumez-le, cliquez ci-dessous, puis acceptez la fenêtre qui s\'affiche à l\'écran. Vous obtenez alors la liste des applications installées — pratique pour vérifier l\'identifiant exact de Luciole.':
    'The first time, the TV asks whether it accepts the server. Turn it on, click below, then accept the window shown on screen. You then get the list of installed applications — handy to check Luciole’s exact identifier.',
  'Demander l\'autorisation': 'Request authorisation', 'allumé': 'on', 'en veille': 'standby', 'injoignable': 'unreachable',
  'Téléviseur : {e}': 'TV: {e}', 'Luciole est à l’écran': 'Luciole is on screen', 'Luciole n’est pas à l’écran': 'Luciole is not on screen',
  'autorisé': 'authorised', 'pas encore autorisé': 'not authorised yet', 'surveillance active': 'watching',
  'surveillance à redémarrer': 'watcher needs a restart', 'lancement en cours…': 'launching…', 'dernier réveil : {d}': 'last wake-up: {d}',
  'Le serveur est autorisé sur ce téléviseur.': 'The server is authorised on this TV.', 'Enregistré.': 'Saved.',
  'Lancement demandé…': 'Launch requested…', 'Demandé par {h}': 'Requested via {h}',
  ', Luciole est à l’écran.': ', Luciole is on screen.',
  ', mais Luciole n’est pas à l’écran — augmentez le nombre d’essais.': ', but Luciole is not on screen — increase the number of attempts.',
  '. Le téléviseur ne confirme pas ; regardez l’écran.': '. The TV does not confirm; look at the screen.',
  'Regardez le téléviseur et acceptez la demande…': 'Look at the TV and accept the request…',
  'Autorisation obtenue.': 'Authorisation granted.', '{n} application installée :': '{n} application installed:',
  '{n} applications installées :': '{n} applications installed:', '(sans nom)': '(no name)', 'Choisir': 'Choose',
  /* noms */
  'Règles de nettoyage': 'Cleaning rules',
  'Appliquées au nom du fournisseur des chaînes, des films, des séries et des bouquets, dans l\'ordre. Un nom que vous avez tapé à la main n\'est jamais touché.':
    'Applied in order to the provider’s names of channels, movies, series and bouquets. A name you typed by hand is never touched.',
  'Ajouter une règle': 'Add a rule', 'Oublier les noms tapés à la main': 'Forget names typed by hand',
  'Noms d\'origine': 'Original names', 'Noms d’origine': 'Original names', 'Aperçu': 'Preview', 'Bouquets': 'Bouquets',
  'Activer la règle': 'Enable the rule', 'Modifier la règle': 'Edit the rule', 'Motif (expression régulière)': 'Pattern (regular expression)',
  'livrée': 'built-in', '  (nom à la main)': '  (name set by hand)', 'Aucun nom modifié par les règles.': 'No names changed by the rules.',
  '{n} noms modifiés · {u} inchangés': '{n} names changed · {u} unchanged', 'Nouvelle règle': 'New rule',
  'Le motif est une expression régulière, insensible à la casse. Exemple : \\|FR\\| pour enlever |FR|.':
    'The pattern is a case-insensitive regular expression. Example: \\|FR\\| to remove |FR|.',
  'Motif': 'Pattern', 'Remplacer par (vide = supprimer)': 'Replace with (empty = delete)',
  'Tous les noms tapés à la main seront oubliés : chaînes, films, séries et bouquets. Les règles et les numéros restent.':
    'All names typed by hand will be forgotten: channels, movies, series and bouquets. Rules and numbers stay.',
  'Enlever |FR| |BE| … au début': 'Remove |FR| |BE| … at the start', 'Enlever FR: BE- … au début': 'Remove FR: BE- … at the start',
  'Enlever (FR) (BE) … au début': 'Remove (FR) (BE) … at the start', 'Enlever ce qui est entre crochets': 'Remove what is in brackets',
  'Enlever HD, FHD, 4K … à la fin': 'Remove HD, FHD, 4K … at the end', 'Remplacer les barres | par une espace': 'Replace bars | with a space',
  /* guide */
  'Sources du guide': 'Guide sources',
  'Fichiers XMLTV publics qui complètent le guide du fournisseur, souvent avec un résumé et une vignette par programme. La première source qui reconnaît une chaîne gagne.':
    'Public XMLTV files that complement the provider’s guide, often with a summary and a picture per programme. The first source that recognises a channel wins.',
  'Adresse du fichier XMLTV': 'XMLTV file address', 'Nom (facultatif)': 'Name (optional)', 'Nom de la source': 'Source name',
  'Télécharger maintenant': 'Download now', 'Réassocier les chaînes': 'Re-match channels', 'Association des chaînes': 'Channel matching',
  'Les chaînes sans guide externe apparaissent ici. Cliquez sur « Associer » pour la chercher à la main.':
    'Channels without an external guide appear here. Click “Match” to find it by hand.',
  'Seulement les non associées': 'Only unmatched', 'Aucune source. Le guide du fournisseur est utilisé seul.': 'No sources. The provider’s guide is used alone.',
  'Activer': 'Enable', '{n} programmes': '{n} programmes', 'jamais téléchargée': 'never downloaded',
  'Supprimer cette source ?': 'Delete this source?', 'Ses programmes seront effacés du guide.': 'Its programmes will be removed from the guide.',
  '{m} chaînes sur {c} associées à un guide externe (dont {h} à la main) · {i} programmes avec vignette':
    '{m} of {c} channels matched to an external guide ({h} by hand) · {i} programmes with a picture',
  'Toutes les chaînes ont un guide externe.': 'All channels have an external guide.', 'Guide : {n}': 'Guide: {n}',
  ' (à la main)': ' (by hand)', 'Guide du fournisseur seulement': 'Provider guide only', 'Changer': 'Change', 'Associer': 'Match',
  'Auto': 'Auto', 'Guide pour « {n} »': 'Guide for “{n}”', 'Nom dans le guide': 'Name in the guide',
  'Rien trouvé dans les sources.': 'Nothing found in the sources.', 'Aucun (guide du fournisseur)': 'None (provider guide)',
  'Source ajoutée. Cliquez sur « Télécharger maintenant ».': 'Source added. Click “Download now”.',
  'Téléchargement en cours… cela peut prendre quelques minutes.': 'Downloading… this can take a few minutes.',
  '{n} chaînes associées': '{n} channels matched',
  /* bouquets du fournisseur */
  'Rechercher un bouquet': 'Search a bouquet', 'Tout afficher': 'Show all', 'Tout masquer': 'Hide all',
  'Case cochée = visible sur la TV. Cliquez sur le nom pour renommer.': 'Ticked = visible on the TV. Click the name to rename.',
  'Case cochée = visible sur la TV. Cliquez sur le nom pour renommer. « Verrouiller » demande le code parental sur la TV.': 'Ticked = visible on the TV. Click the name to rename. “Lock” asks for the parental code on the TV.',
  'Code parental': 'Parental code', 'Choisir un code parental': 'Choose a parental code', 'Nouveau code (4 à 8 chiffres)': 'New code (4 to 8 digits)',
  'Code actuel': 'Current code', 'Verrouillé': 'Locked', 'Verrouiller': 'Lock', 'Nouveau code': 'New code',
  'Retirer le code parental de ce bouquet': 'Remove the parental code from this bouquet', 'Demander le code parental sur la TV': 'Ask for the parental code on the TV',
  'Actif · {n} bouquet(s) verrouillé(s). Sur la TV, ils gardent un cadenas et demandent le code.': 'On · {n} locked bouquet(s). On the TV they show a padlock and ask for the code.',
  'Aucun code. Choisissez-en un pour verrouiller des bouquets (chaînes, films ou séries pour adultes).': 'No code. Choose one to lock bouquets (adult channels, movies or series).',
  'Changer le code': 'Change the code', 'Choisir un code': 'Choose a code', 'Retirer le code': 'Remove the code',
  'Afficher {n}': 'Show {n}', '{n} titres': '{n} titles', 'Nom d’origine': 'Original name', 'Règle auto': 'Automatic rule',
  'Revenir aux règles de config.toml': 'Go back to the config.toml rules', 'masqué par une règle': 'hidden by a rule',
  '{v} bouquets visibles sur {n}': '{v} of {n} bouquets visible', '{n} affichés': '{n} shown', 'Replay': 'Catch-up',
  /* bibliothèque */
  'Bibliothèque': 'Library', 'Catégories': 'Categories',
  'Elles se créent toutes seules quand vous ajoutez un titre, depuis le téléviseur ou la section Médiathèque, d\'après son genre. Renommez-les, rangez-les, ou créez les vôtres.':
    'They are created automatically when you add a title from the TV, from its genre. Rename them, reorder them, or create your own.',
  'Nouvelle catégorie': 'New category', 'Tri': 'Sort', 'Ajoutés récemment': 'Recently added', 'Titre (A-Z)': 'Title (A-Z)',
  'Toute la Bibliothèque': 'Whole Library', 'Tous les films': 'All movies', 'Toutes les séries': 'All series', 'Renommer la catégorie': 'Rename category',
  'Que deviennent ses {n} titres ?': 'What happens to its {n} titles?', 'Ils quittent la Bibliothèque': 'They leave the Library',
  'Les ranger dans « {n} »': 'File them under “{n}”', 'Rien ne correspond.': 'Nothing matches.',
  'Rien ici pour l’instant. Ajoutez des titres depuis le téléviseur (bouton « Bibliothèque » d’une fiche), ou depuis vos dossiers dans la section Médiathèque.':
    'Nothing here yet. Add titles from the TV: on a movie or series page, “Library” button.',
  'Film': 'Movie', 'Série': 'Series',
  '{n} retirés du catalogue par le fournisseur (ils reviendront s’il les remet)': '{n} removed from the catalogue by the provider (they come back if it restores them)',
  'catégorie inconnue': 'unknown category', 'titre inconnu': 'unknown title',
  /* accueil */
  'Accueil': 'Home', 'Réglages': 'Settings', 'Bonne nuit': 'Good night', 'Bonjour': 'Good morning',
  'Bon après-midi': 'Good afternoon', 'Bonsoir': 'Good evening', 'Luciole veille sur votre télévision.': 'Luciole is looking after your TV.',
  '{n} jours': '{n} days', '{n} jour': '{n} day', 'expire le {d}': 'expires on {d}', '{a}/{m} connexions': '{a}/{m} connections',
  'pas encore de réponse': 'no answer yet', 'Détails': 'Details', '{v} films · {s} séries': '{v} movies · {s} series',
  'Synchronisation en cours…': 'Synchronising…', 'Mis à jour : {d}': 'Updated: {d}', 'non configuré': 'not configured',
  'Démarrage automatique : {e}': 'Automatic start: {e}', 'activé': 'on', 'désactivé': 'off', 'Régler': 'Set up',
  'titres gardés': 'titles kept', 'Ajoutez des titres depuis le téléviseur, bouton « Bibliothèque ».': 'Add titles from the TV, “Library” button.',
  'Organiser': 'Organise', 'Aucune chaîne favorite. Sur le téléviseur, dans le guide, touche jaune.': 'No favourite channels. On the TV, in the guide, yellow button.',
  'ensuite {t}': 'next {t}', 'Tout est prêt sur le serveur. Les réglages sont un clic plus loin.': 'Everything is ready on the server. Settings are one click away.',
  'Première mise en route : le serveur prépare le catalogue.': 'First start: the server is preparing the catalogue.',
  'En ce moment sur vos chaînes favorites': 'On your favourite channels right now',
  'Catégories et titres gardés': 'Categories and kept titles', 'Listes de chaînes à votre goût': 'Channel lists to your taste',
  'Numéros, noms et logos': 'Numbers, names and logos', 'Titres, résumés et jaquettes': 'Titles, summaries and posters',
  'Vos fichiers sur le NAS': 'Your files on the NAS', 'Sources et association des chaînes': 'Sources and channel matching',
  'Ce qui s\'affiche sur la TV': 'What shows on the TV',
  /* médiathèque : choisir pour la Bibliothèque */
  'Choisir pour la Bibliothèque': 'Pick for the Library',
  'Cochez les films ou les séries de vos dossiers, puis rangez-les dans une catégorie de la Bibliothèque, ou laissez Luciole les ranger d\'après leur genre. Sur le téléviseur, rien ne change : le bouton « Bibliothèque » de chaque fiche reste là.':
    'Tick films or series from your folders, then file them in a Library category, or let Luciole file them by genre. Nothing changes on the TV: the “Library” button on each page is still there.',
  'Tous les dossiers': 'All folders', 'Tous': 'All', 'Pas encore dans la Bibliothèque': 'Not in the Library yet',
  'Déjà dans la Bibliothèque': 'Already in the Library', 'Toutes les catégories': 'All categories',
  'Pas d’affiche': 'No poster', 'Ne montrer que ce dossier': 'Show this folder only', 'Aucune série dans ce dossier.': 'No series in this folder.', 'Aucun film dans ce dossier.': 'No films in this folder.', '. Cliquez sur un dossier pour ne voir que son contenu.': '. Click a folder to see only its contents.', 'Contenu de « {n} »': 'Contents of “{n}”', 'Tout cocher': 'Tick all', 'Tout décocher': 'Untick all', 'Ajouter à la Bibliothèque': 'Add to the Library',
  'Ranger selon le genre': 'File by genre', 'Ranger dans « {n} »': 'File in “{n}”',
  'Ranger dans une nouvelle catégorie…': 'File in a new category…', 'Ranger dans': 'File in', 'Dossier': 'Folder',
  '{n} titres cochés': '{n} titles ticked', '{n} titre coché': '{n} title ticked',
  'Cochez des titres (Maj + clic : plusieurs d’affilée)': 'Tick titles (Shift + click: several in a row)',
  'Pas dans la Bibliothèque': 'Not in the Library', '{n} épisodes': '{n} episodes', '{n} affichés': '{n} shown',
  '{a} films sur {b} déjà dans la Bibliothèque': '{a} of {b} films already in the Library',
  '{a} séries sur {b} déjà dans la Bibliothèque': '{a} of {b} series already in the Library',
  'Aucun film dans vos dossiers. Ajoutez un dossier puis lancez « Analyser ».': 'No films in your folders. Add a folder, then run “Scan”.',
  'Aucune série dans vos dossiers. Ajoutez un dossier puis lancez « Analyser ».': 'No series in your folders. Add a folder, then run “Scan”.',
  'Ajout… {n} titres': 'Adding… {n} titles', 'Retrait… {n} titres': 'Removing… {n} titles',
  'nouvelles catégories : {n}': 'new categories: {n}', 'Retirer de la Bibliothèque': 'Remove from the Library',
  'Aucun des titres cochés n’est dans la Bibliothèque.': 'None of the ticked titles is in the Library.',
  '{n} titres quittent la Bibliothèque. Les fichiers ne sont pas touchés.': '{n} titles leave the Library. The files are not touched.',
  'Date de sortie': 'Release date',
  'Numéro dans ce bouquet': 'Number in this bouquet', 'Numéro de {n} dans « {b} »': 'Number of {n} in “{b}”',
  'Numéro (vide : son numéro habituel)': 'Number (empty: its usual number)',
  'Utiliser aussi ces numéros dans « Toutes les chaînes » et les autres listes': 'Also use these numbers in “All channels” and the other lists',
  'Sinon, ces numéros ne valent que dans ce bouquet : une chaîne peut avoir un autre numéro ailleurs.': 'Otherwise these numbers only apply to this bouquet: a channel can have another number elsewhere.',
  'Les chaînes du bouquet sont numérotées dans leur ordre actuel, pour ce bouquet.': 'The bouquet’s channels are numbered in their current order, for this bouquet.',
  /* médiathèque : versions d'un film */
  'Version {v} · une des {n} versions de ce film': 'Version {v} · one of this film’s {n} versions',
  'démarre en priorité': 'starts first', 'choix automatique': 'automatic choice',
  'Remettre en automatique': 'Back to automatic', 'Démarrer celle-ci': 'Start this one', '{n} versions': '{n} versions',
  /* médiathèque : conversion du son */
  'Conversion du son': 'Audio conversion', 'Convertir le son': 'Convert audio', 'Convertir': 'Convert',
  'Le son que le téléviseur ne lit pas (DTS, TrueHD…) est converti en AC3 5.1. L’image et les sous-titres sont recopiés tels quels. La vidéo, elle, se réencode en dehors de Luciole.':
    'Audio the TV cannot play (DTS, TrueHD…) is converted to AC3 5.1. Picture and subtitles are copied as they are. Video re-encoding is done outside Luciole.',
  'ffmpeg n’est pas installé sur le serveur : relancez le script d’installation.': 'ffmpeg is not installed on the server: run the install script again.',
  'Garder l’original, dans le dossier caché .luciole-originaux du dossier (sinon il est supprimé après vérification)':
    'Keep the original, in the folder’s hidden .luciole-originaux folder (otherwise it is deleted once checked)',
  'Convertir le son de ce dossier ({n})': 'Convert this folder’s audio ({n})', 'Convertir tout le son illisible ({n})': 'Convert all unplayable audio ({n})',
  'Aucun son à convertir': 'No audio to convert', 'Arrêter': 'Stop', 'Effacer la liste': 'Clear the list',
  '{n} fichiers seront réécrits, l’un après l’autre. Comptez quelques minutes par film ; vous pouvez fermer la page.':
    '{n} files will be rewritten, one after the other. Allow a few minutes per film; you can close the page.',
  'Les originaux seront gardés dans .luciole-originaux.': 'The originals will be kept in .luciole-originaux.',
  'Les originaux seront supprimés après vérification.': 'The originals will be deleted once checked.',
  'attente': 'waiting', 'en cours': 'running', 'fait': 'done', 'erreur': 'error', 'annulé': 'cancelled',
  'en attente': 'waiting', 'conversion {p} %': 'converting {p} %', '… et {n} autres': '… and {n} more',
  'Rien à convertir ici.': 'Nothing to convert here.',
  'lecture seule pour Luciole : le son ne peut pas y être converti': 'read-only for Luciole: audio cannot be converted here',
  'Le son de {n} fichiers peut être converti par Luciole si vous l’autorisez à écrire dans vos dossiers (voir la documentation du serveur, « Conversion du son »). ':
    'The audio of {n} files can be converted by Luciole if you allow it to write to your folders (see the server documentation, “Audio conversion”). ',
  'Luciole ne convertit que le son. Une vidéo que le téléviseur ne lit pas se réencode en dehors de Luciole, par exemple avec HandBrake.':
    'Luciole only converts audio. Video the TV cannot play is re-encoded outside Luciole, for example with HandBrake.',
  'rien à convertir': 'nothing to convert',
  'conversion désactivée : la médiathèque est en lecture seule': 'conversion disabled: the media library is read-only',
  'ffmpeg n\'est pas installé sur le serveur': 'ffmpeg is not installed on the server',
  /* erreurs venues du serveur */
  'chaîne inconnue': 'unknown channel', 'fiche inconnue': 'unknown item', 'abonnement inconnu': 'unknown subscription',
  'le fournisseur ne répond pas': 'the provider is not responding', 'erreur interne': 'internal error',
  'aucune clé TMDB dans la configuration': 'no TMDB key in the configuration', 'JSON invalide': 'invalid JSON',
  'code incorrect': 'wrong code', 'code actuel incorrect': 'wrong current code', 'le code doit compter 4 à 8 chiffres': 'the code must have 4 to 8 digits',
  "choisissez d'abord un code parental": 'choose a parental code first', 'verrouillé par le code parental': 'locked by the parental code'
};
