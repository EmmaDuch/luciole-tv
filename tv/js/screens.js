/* Luciole — écrans de l'appli */
'use strict';

/* ---------- fabrication de cartes ---------- */
function progPct(p) {
  if (!p) return 0;
  return Math.max(0, Math.min(100, Math.round((nowSec() - p.start) / Math.max(1, p.stop - p.start) * 100)));
}
function artHTML(ch, prog, extra) {
  /* vignette 16:9 : image du programme si on en a une, sinon initiales sur fond coloré */
  var img = prog && prog.image ? prog.image : '';
  return '<div class="tile16' + (extra || '') + '" style="background:' + tint(ch.id) + '">' +
    (img ? '<img loading="lazy" src="' + esc(API.img(img)) + '" alt="" onerror="this.remove()">' : '') +
    '<span class="ini">' + esc(initials(ch.name)) + '</span>' +
    '<span class="lv">' + tr('EN DIRECT') + '</span>' + srcBadge(ch.src, 'tl') +
    '<span class="n">' + esc(ch.num ? ch.num + ' · ' + ch.name : ch.name) + '</span>' +
    (prog ? '<div class="bar"><i style="width:' + progPct(prog) + '%;background:var(--accent)"></i></div>' : '') +
    '</div>';
}
function chCardHTML(ch, idx) {
  return '<div class="card focusable" data-key="ch:' + ch.id + '" data-idx="' + idx + '" data-act="channel">' +
    artHTML(ch, ch.now) +
    '<div class="cap">' + esc(ch.now ? ch.now.title : ch.name) + '</div>' +
    '<div class="cap2">' + esc(ch.now ? ch.name : tr('Pas de guide')) + '</div></div>';
}
function posterHTML(it, idx, sub) {
  var p = it.progress, pct = p && !p.done ? p.pct : 0;
  return '<div class="poster focusable" data-key="' + it.kind + ':' + it.id + '" data-idx="' + idx + '" data-act="open">' +
    '<div class="art" style="background:' + tint(it.id) + '"><div class="fallback">' + esc(it.name) + '</div>' +
    (it.poster ? '<img loading="lazy" src="' + esc(API.img(it.poster)) + '" alt="" onerror="this.remove()">' : '') +
    (it.fav ? '<span class="badge">' + ICON.starFill + '</span>' : '') +
    (p && p.done ? '<span class="badge">' + ICON.check + '</span>' : '') +
    (pct > 0 ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') +
    '</div><div class="cap">' + esc(it.name) + '</div>' + (sub ? '<div class="cap2">' + esc(sub) + '</div>' : '') + '</div>';
}
function tileHTML(act, icon, title, sub) {
  return '<div class="poster tile focusable" data-act="' + act + '" data-key="tile:' + act + '"><div class="art">' +
    '<div class="tile-icon">' + icon + '</div><div><div class="tile-title">' + title + '</div><div class="tile-sub">' + sub + '</div></div>' +
    '</div><div class="cap">' + tr('Ma liste') + '</div></div>';
}
function badgesHTML(ch, info) {
  var out = [];
  var res = info && info.label ? info.label : (ch && ch.quality ? ch.quality : '');
  if (res) out.push('<span class="bdg">' + esc(res) + '</span>');
  if (info && info.codec) out.push('<span class="bdg">' + esc(codecName(info.codec)) + '</span>');
  if (info && info.audio) out.push('<span class="bdg">' + esc(info.audio) + '</span>');
  if (ch && ch.archive) out.push('<span class="bdg fill">' + tr('REPLAY') + '</span>');
  return out.join('');
}
function loadingHTML(msg) { return '<div class="spinner"></div><div>' + esc(msg || tr('Chargement…')) + '</div>'; }
function errorHTML(msg) {
  return '<div>' + esc(msg) + '</div><button class="btn focusable" data-act="retry" data-default>' + tr('Réessayer') + '</button>';
}
function remainingLabel(p) {
  if (!p) return '';
  if (p.done) return tr('Terminé');
  return p.remaining ? tr('{d} restantes', { d: dur(p.remaining) }) : '';
}
function keepFocus(root, fn) {
  var key = Focus.current && root.contains(Focus.current) ? Focus.current.getAttribute('data-key') : null;
  fn();
  if (!root.__rendered) { root.__rendered = true; if (Focus.scope === root || root.contains(Focus.scope)) Focus.first(root); return; }
  var n = key ? root.querySelector('[data-key="' + key.replace(/"/g, '') + '"]') : null;
  if (n) Focus.set(n, true); else if (!Focus.valid()) Focus.first(root);
}

/* ---------- navigation générale ---------- */
var App = {
  lastBack: 0,
  go: function (name) {
    var make = {
      home: HomeScreen, live: GuideScreen, search: SearchScreen, settings: SettingsScreen, library: LibraryScreen,
      vod: function () { return CatalogScreen('vod'); }, series: function () { return CatalogScreen('series'); }
    }[name];
    if (make) Router.replaceAll(make());
  },
  resumeNow: function () {
    if (!Now.channel) return;
    var ch = Now.channel;
    API.get('/api/live?cat=all').then(function (d) {
      var i = d.channels.findIndex(function (c) { return c.id === ch.id; });
      App.playLive(d.channels, i < 0 ? 0 : i);
    }).catch(function () { App.playLive([ch], 0); });
  },
  rootBack: function () {
    var s = Router.screen();
    if (s && s.name !== 'home') { this.go('home'); return; }
    if (Date.now() - this.lastBack < 2500) { this.exit(); return; }
    this.lastBack = Date.now();
    Toast.show(tr('Appuyez encore sur Retour pour quitter Luciole'));
  },
  exit: function () {
    Player.stop();
    try { tizen.application.getCurrentApplication().exit(); } catch (e) { Toast.show(tr('Au revoir')); }
  },
  open: function (kind, id) {
    if (kind === 'movie') Router.push(MovieScreen(id));
    else if (kind === 'series') Router.push(SeriesScreen(id));
    else if (kind === 'channel') Router.push(ChannelScreen(id));
  },
  /* ctx : { cat, src, total } quand la liste vient du guide : le lecteur la complète pour zapper partout */
  playLive: function (channels, index, ctx) {
    Router.push(PlayerScreen({ mode: 'live', channels: channels, index: index, ctx: ctx || null }));
  },
  playReplay: function (channel, prog) { Router.push(PlayerScreen({ mode: 'replay', channel: channel, prog: prog })); },
  playMovie: function (item, fromStart) { Router.push(PlayerScreen({ mode: 'movie', item: item, fromStart: fromStart })); },
  // un bonus ou une bande-annonce du film : même lecteur, sans reprise ni historique
  playExtra: function (movie, extra) { Router.push(PlayerScreen({ mode: 'movie', item: movie, extra: extra, fromStart: true })); },
  playEpisodes: function (series, episodes, index, fromStart) {
    Router.push(PlayerScreen({ mode: 'episode', series: series, episodes: episodes, index: index, fromStart: fromStart }));
  },
  resumeSeries: function (seriesId) {
    Toast.show(tr('Chargement…'), 1200);
    API.get('/api/series/detail?id=' + seriesId).then(function (d) {
      var flat = flattenEpisodes(d);
      var idx = d.resume ? flat.findIndex(function (e) { return e.id === d.resume.episode_id; }) : 0;
      App.playEpisodes({ id: d.id, name: d.name, poster: d.poster, backdrop: d.backdrop }, flat, Math.max(0, idx));
    }).catch(function (e) { Toast.show(e.message); });
  },
  toggleWatchlist: function (it, onDone) {
    var req = it.watchlist ? API.del('/api/watchlist?kind=' + it.kind + '&id=' + it.id)
      : API.post('/api/watchlist', { kind: it.kind, id: it.id, fav: false });
    req.then(function () {
      it.watchlist = !it.watchlist; if (!it.watchlist) it.fav = false;
      Toast.show(tr(it.watchlist ? 'Ajouté à « À regarder plus tard »' : 'Retiré de « À regarder plus tard »'));
      if (onDone) onDone();
    }).catch(function (e) { Toast.show(e.message); });
  },
  toggleFav: function (it, onDone) {
    API.post('/api/watchlist', { kind: it.kind, id: it.id, fav: !it.fav }).then(function () {
      it.fav = !it.fav; it.watchlist = true;
      Toast.show(tr(it.fav ? 'Ajouté aux favoris' : 'Retiré des favoris'));
      if (onDone) onDone();
    }).catch(function (e) { Toast.show(e.message); });
  },
  toggleFavChannel: function (ch, onDone) {
    API.post('/api/favchannels', { id: ch.id, on: !ch.fav }).then(function () {
      ch.fav = !ch.fav;
      Toast.show(tr(ch.fav ? '{n} ajoutée aux favoris' : '{n} retirée des favoris', { n: ch.name }));
      if (onDone) onDone();
    }).catch(function (e) { Toast.show(e.message); });
  }
};
function flattenEpisodes(d) {
  var flat = [];
  (d.seasons || []).forEach(function (s) { s.episodes.forEach(function (e) { e.season = s.season; flat.push(e); }); });
  return flat;
}
function baseScreen(name, html) {
  return { name: name, el: el('<section class="screen" data-screen="' + name + '">' + html + '</section>') };
}

/* =====================================================================
   PREMIER LANCEMENT / ADRESSE DU SERVEUR
   ===================================================================== */
function SetupScreen(first) {
  var s = baseScreen('setup',
    '<div class="form">' +
    brandHTML('position:static') +
    '<h1>' + tr(first ? 'Bienvenue' : 'Serveur Luciole') + '</h1>' +
    '<p>' + tr('Indiquez l’adresse du serveur Luciole sur votre réseau. Par exemple 192.168.1.20') + '</p>' +
    '<div class="field"><label for="srv">' + tr('Adresse du serveur') + '</label><input id="srv" class="input focusable" data-default autocomplete="off" spellcheck="false" placeholder="192.168.1.20"></div>' +
    '<div class="field"><label for="tok">' + tr('Mot de passe du serveur (laisser vide s’il n’y en a pas)') + '</label><input id="tok" class="input focusable" autocomplete="off" spellcheck="false"></div>' +
    '<div class="error" id="err"></div>' +
    '<div class="actions"><button class="btn focusable" data-act="save">' + tr('Se connecter') + '</button>' +
    (first ? '' : '<button class="btn focusable" data-act="cancel">' + tr('Annuler') + '</button>') + '</div></div>');
  var srv = $('#srv', s.el), tok = $('#tok', s.el), err = $('#err', s.el);
  srv.value = (API.base || '').replace(/^http:\/\//, '').replace(/:8765$/, '');
  tok.value = API.token || '';
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (n.tagName === 'INPUT') { n.focus(); return; }
    if (act === 'cancel') { Router.back(); return; }
    if (act !== 'save') return;
    var base = API.normalize(srv.value), token = tok.value.trim();
    if (!base) { err.textContent = tr('Indiquez une adresse.'); return; }
    err.textContent = tr('Connexion…');
    var oldToken = API.token; API.token = token;
    API.req('GET', '/api/status', null, base).then(function (st) {
      API.base = base; Store.set('server', base); Store.set('token', token);
      Providers.set(st.providers || []);
      if (!st.catalog_sync) Toast.show(tr('Connecté. Le serveur prépare encore le catalogue…'), 4000);
      App.go('home');
    }).catch(function (e) {
      API.token = oldToken;
      err.textContent = tr('Impossible de joindre {b} : {e}. Vérifiez l’adresse et que le serveur est démarré.', { b: base, e: e.message });
    });
  };
  return s;
}

/* =====================================================================
   ACCUEIL
   ===================================================================== */
function HomeScreen() {
  var s = baseScreen('home',
    '<div class="hero-art"><div class="hero-img"></div></div>' + headerHTML('home') +
    '<div class="hero"></div><div class="dots"></div>' +
    '<div class="rows scroll-y" data-pad="40"><div class="inner"></div></div><div class="state"></div>');
  var data = null, hero = $('.hero', s.el), rows = $('.rows .inner', s.el), state = $('.state', s.el);
  var art = $('.hero-art .hero-img', s.el), dots = $('.dots', s.el), heroList = [], heroIdx = 0, heroTimer = null;

  function load(quiet) {
    if (!quiet) { state.innerHTML = loadingHTML(); state.classList.remove('hidden'); }
    API.get('/api/home').then(function (d) { data = d; state.classList.add('hidden'); keepFocus(s.el, render); })
      .catch(function (e) {
        if (quiet && data) return;
        hero.innerHTML = ''; rows.innerHTML = '';
        state.classList.remove('hidden'); state.innerHTML = errorHTML(e.message); Focus.first(state);
      });
  }
  /* le carrousel ne montre que les nouveautés (films et séries) ; la reprise est dans la rangée en dessous */
  function buildHeroList() {
    heroList = (data.hero || []).map(function (m) {
      return { kind: m.kind, id: m.id, name: m.name, poster: m.poster, backdrop: m.backdrop || m.poster, added: m.added, fresh: true };
    });
    if (!heroList.length && data.channels[0]) heroList.push({ kind: 'live', channel: data.channels[0] });
  }
  function renderHero() {
    var h = heroList[heroIdx];
    if (!h) {
      hero.innerHTML = '<div class="kicker">' + tr('Bienvenue') + '</div><h1>Luciole</h1>' +
        '<p class="plot">' + tr('Le catalogue est vide pour l’instant. Vérifiez la synchronisation dans les Réglages.') + '</p>' +
        '<div class="actions"><button class="btn focusable" data-default data-nav="settings" data-key="hero-play">' + tr('Réglages') + '</button></div>';
      return;
    }
    var kicker, title, meta, plot = '', prog = '';
    if (h.kind === 'live') {
      kicker = tr('En direct'); title = h.channel.now ? h.channel.now.title : h.channel.name;
      meta = h.channel.num + ' · ' + h.channel.name;
    } else if (h.fresh) {
      kicker = tr('Nouveau'); title = h.name;
      meta = !h.added ? tr(h.kind === 'series' ? 'Série' : 'Film')
        : tr(h.kind === 'series' ? 'Série mise à jour {d}' : 'Film ajouté {d}', { d: dayLabel(h.added) });
    } else {
      kicker = tr(h.resume && h.resume.next ? 'Épisode suivant' : 'Reprendre la lecture');
      title = h.name;
      meta = h.kind === 'series' && h.resume
        ? tr('Saison {s} · Épisode {e}', { s: h.resume.season, e: h.resume.episode }) + (h.resume.title ? ' · ' + h.resume.title : '')
        : tr('Film');
      var p = h.progress;
      if (p && !p.done) {
        prog = '<div style="display:flex;align-items:center;gap:16px"><div class="bar" style="width:420px"><i style="width:' +
          p.pct + '%"></i></div><span class="meta" style="font-size:19px">' + esc(remainingLabel(p)) + '</span></div>';
      }
    }
    hero.innerHTML = '<div class="kicker">' + esc(kicker) + '</div><h1>' + esc(title) + '</h1>' +
      '<div class="meta">' + esc(meta) + '</div>' + plot + prog +
      '<div class="actions"><button class="btn focusable" data-default data-act="hero-play" data-key="hero-play">' +
      ICON.play + tr(h.kind === 'live' ? 'Regarder' : (h.fresh ? 'Regarder' : 'Reprendre')) + '</button>' +
      '<button class="btn focusable" data-act="hero-open" data-key="hero-open">' +
      tr(h.kind === 'live' ? 'La chaîne' : 'Voir la fiche') + '</button></div>';
    var bg = h.kind === 'live' ? (h.channel.now && h.channel.now.image) : (h.backdrop || h.poster);
    art.style.backgroundImage = bg ? 'url("' + API.img(bg) + '")' : '';
    dots.innerHTML = heroList.length > 1 ? heroList.map(function (_, i) {
      return '<i class="' + (i === heroIdx ? 'on' : '') + '"></i>';
    }).join('') : '';
  }
  function rotate() {
    clearTimeout(heroTimer);
    if (heroList.length < 2) return;
    heroTimer = setTimeout(function () {
      if (s.el.classList.contains('browsing') || Router.top() !== s) { rotate(); return; }
      heroIdx = (heroIdx + 1) % heroList.length;
      renderHero();
      rotate();
    }, 9000);
  }
  function render() {
    buildHeroList();
    if (heroIdx >= heroList.length) heroIdx = 0;
    renderHero();
    rotate();
    var out = '';
    if (data.channels.length) {
      out += '<div class="section"><h2>' + tr('Chaînes favorites') + ' <small>' + tr('Touche jaune dans le guide pour en ajouter') + '</small></h2>' +
        '<div class="strip" data-group="fav"><div class="row">' + data.channels.map(chCardHTML).join('') + '</div></div></div>';
    } else {
      out += '<div class="section"><h2>' + tr('Chaînes favorites') + '</h2>' +
        '<div class="empty-card focusable" data-nav="live">' + tr('Aucune chaîne favorite. Dans le guide, placez-vous sur une chaîne et appuyez sur la touche jaune.') + '</div></div>';
    }
    if (data.continue.length) {
      out += '<div class="section"><h2>' + tr('Reprendre la lecture') + '</h2><div class="strip" data-group="cont"><div class="row">' +
        data.continue.map(function (it, i) {
          var sub = it.kind === 'series' && it.resume ? tr('S{s} · É{e}', { s: it.resume.season, e: it.resume.episode }) : remainingLabel(it.progress);
          return posterHTML(it, i, sub).replace('data-act="open"', 'data-act="resume"').replace('data-key="', 'data-key="c-');
        }).join('') + '</div></div></div>';
    }
    if (data.recent_movies.length) {
      out += '<div class="section"><h2>' + tr('Films ajoutés récemment') + '</h2><div class="strip" data-group="movies"><div class="row">' +
        data.recent_movies.map(function (it, i) { return posterHTML(it, i); }).join('') + '</div></div></div>';
    }
    if (data.recent_series.length) {
      out += '<div class="section"><h2>' + tr('Séries mises à jour') + '</h2><div class="strip" data-group="series"><div class="row">' +
        data.recent_series.map(function (it, i) { return posterHTML(it, i); }).join('') + '</div></div></div>';
    }
    rows.innerHTML = out;
    chainRows();
  }
  /* chaque rangée est une liste horizontale ; haut et bas passent d'une rangée à l'autre */
  function chainRows() {
    var zones = $$('.section > .strip, .section > .empty-card', rows);
    zones.forEach(function (z, i) {
      if (z.classList.contains('strip')) z.setAttribute('data-list', 'h');
      var prev = zones[i - 1], next = zones[i + 1];
      z.setAttribute('data-nav-up', prev ? (prev.getAttribute('data-group') || 'row' + (i - 1)) : 'pills');
      z.setAttribute('data-nav-down', next ? (next.getAttribute('data-group') || 'row' + (i + 1)) : 'stop');
      if (!z.getAttribute('data-group')) z.setAttribute('data-group', 'row' + i);
    });
  }
  function findItem(n) {
    var key = n.getAttribute('data-key') || '', idx = Number(n.getAttribute('data-idx'));
    if (key.indexOf('c-') === 0) return data.continue[idx];
    var grp = n.closest('[data-group]'), g = grp && grp.getAttribute('data-group');
    if (g === 'movies') return data.recent_movies[idx];
    if (g === 'series') return data.recent_series[idx];
    return null;
  }
  function playItem(it) {
    if (!it) return;
    if (it.kind === 'movie') App.playMovie(it); else App.resumeSeries(it.id);
  }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act'), h = heroList[heroIdx];
    if (act === 'retry') return load();
    if (act === 'hero-play') {
      if (!h) return;
      if (h.kind === 'live') return App.playLive(data.channels, 0);
      return playItem(h);
    }
    if (act === 'hero-open') {
      if (!h) return;
      return App.open(h.kind === 'live' ? 'channel' : h.kind, h.kind === 'live' ? h.channel.id : h.id);
    }
    if (act === 'resume') return playItem(findItem(n));
    if (act === 'open') { var it = findItem(n); if (it) App.open(it.kind, it.id); return; }
    if (act === 'channel') App.playLive(data.channels, Number(n.getAttribute('data-idx')));
  };
  s.onKey = function (k) {
    var n = Focus.current;
    if (k === KEY.YELLOW && n && n.getAttribute('data-act') === 'open') {
      var it = findItem(n); if (it) App.toggleWatchlist(it, function () { load(true); });
      return true;
    }
    // gauche sur le premier bouton : élément précédent ; droite sur le dernier (« Voir la fiche ») : suivant.
    // Entre les deux, les flèches passent d'un bouton à l'autre.
    var hact = n && n.getAttribute('data-act');
    if (heroList.length > 1 && ((hact === 'hero-play' && k === KEY.LEFT) || (hact === 'hero-open' && k === KEY.RIGHT))) {
      heroIdx = (heroIdx + (k === KEY.RIGHT ? 1 : heroList.length - 1)) % heroList.length;
      renderHero(); rotate();
      var f = $('[data-key="' + (k === KEY.RIGHT ? 'hero-open' : 'hero-play') + '"]', s.el); if (f) Focus.set(f, true);
      return true;
    }
    if (k === KEY.INFO && n && n.getAttribute('data-act') === 'channel') {
      App.open('channel', data.channels[Number(n.getAttribute('data-idx'))].id); return true;
    }
    return false;
  };
  var rowsBox = $('.rows', s.el);
  s.el.addEventListener('focused', function (e) {
    var inRows = rowsBox.contains(e.target);
    s.el.classList.toggle('browsing', inRows);
    if (!inRows) { rowsBox.scrollTop = 0; return; }
    /* on fait remonter la rangée choisie vers le haut, comme sur l'accueil de la TV */
    var sec = e.target.closest('.section');
    if (sec) rowsBox.scrollTop = Math.max(0, sec.offsetTop - 40);
  });
  s.show = function (returning) { load(returning); rotate(); };
  s.hide = function () { clearTimeout(heroTimer); };
  s.destroy = function () { clearTimeout(heroTimer); };
  return s;
}

/* =====================================================================
   GUIDE EN GRILLE (En direct)
   ===================================================================== */
var G = { X: 160, W: 1280, HOURS: 3 };   /* zone des programmes, dans .g-rows */

function GuideScreen() {
  var s = baseScreen('live', headerHTML('live') +
    '<div class="g-art"></div>' +
    '<div class="g-info"><h1 id="gi-t"></h1><div class="meta" id="gi-m"></div><div class="d" id="gi-d"></div>' +
    '<div class="badges" id="gi-b"></div></div>' +
    '<div class="g-cats scroll-y" data-group="cats" data-list="v" data-pad="60" data-nav-right="grid" data-nav-up="pills" data-nav-down="stop">' +
    '<div class="cats"></div></div>' +
    '<div class="g-time"></div><div class="g-nowline hidden"></div>' +
    '<div class="g-rows scroll-y" data-group="grid" data-pad="90" data-nav-left="cats" data-nav-right="stop"></div>' +
    '<div class="state hidden"></div>' +
    '<div class="hints"><span class="hint"><span class="key">OK</span>' + tr('Regarder') + '</span>' +
    '<span class="hint"><span class="key yellow">' + tr('Jaune') + '</span>' + tr('Favori') + '</span>' +
    '<span class="hint"><span class="key green">' + tr('Vert') + '</span>' + tr('Replay') + '</span>' +
    '<span class="hint"><span class="key blue">' + tr('Bleu') + '</span>' + tr('Modifier') + '</span>' +
    '<span class="hint"><span class="key">Info</span>' + tr('La chaîne') + '</span></div>');
  var catsBox = $('.cats', s.el), rowsBox = $('.g-rows', s.el), timeBox = $('.g-time', s.el);
  var nowLine = $('.g-nowline', s.el), state = $('.state', s.el), art = $('.g-art', s.el);
  var cats = [], cat = Store.get('liveCat', 'all'), chans = [], total = 0, loading = false, req = 0;
  var src = Providers.many() ? Store.get('liveSrc', 0) : 0;      // 0 : tous les abonnements, mélangés
  if (src && !Providers.by[src]) src = 0;
  var winStart = 0, rowEls = [], curRow = 0, curProg = 0, tick = null, numBuf = '', numTimer = null;
  var prevTimer = null, prevId = null, alive = true, handing = false;
  // affichage : vignettes (par défaut, l'image du programme quand le guide en donne une) ou grille horaire
  var view = Store.get('liveView', 'tiles') === 'grid' ? 'grid' : 'tiles';
  s.el.classList.toggle('view-tiles', view === 'tiles');

  /* ----- aperçu vidéo : la chaîne survolée se lance dans le cadre en haut à droite ----- */
  function artRect() {
    // le cadre est plus large que l'image (≈ 2,4:1) : la vidéo, en 16:9, le remplit sur toute sa largeur ;
    // ce qui dépasse en haut et en bas est caché par le masque autour du cadre (pas de bandes noires)
    var r = art.getBoundingClientRect();
    var x = r.left / SCALE, y = r.top / SCALE, w = r.width / SCALE, h = r.height / SCALE, vh = w * 9 / 16;
    if (vh < h) return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    return { x: Math.round(x), y: Math.round(y - (vh - h) / 2), w: Math.round(w), h: Math.round(vh) };
  }
  function stopPreview() {
    clearTimeout(prevTimer); prevTimer = null;
    if (prevId === null) return;
    prevId = null;
    art.classList.remove('live');
    s.el.classList.remove('previewing');
    if (handing) { handing = false; return; }   // le lecteur reprend le flux tel quel
    s.playingId = null;
    Player.stop();
  }
  function schedulePreview() {
    if (!Store.get('preview', true)) return;
    var ch = chans[curRow];
    if (!ch || ch.id === prevId) return;
    clearTimeout(prevTimer);
    prevTimer = setTimeout(function () { startPreview(ch); }, 1400);
  }
  function startPreview(ch) {
    if (!alive || Router.top() !== s || !Store.get('preview', true)) return;
    if (chans[curRow] !== ch) return;                 // on a bougé entre-temps
    prevId = ch.id; s.playingId = ch.id;
    API.get('/api/play?kind=live&id=' + ch.id).then(function (d) {
      if (!alive || prevId !== ch.id || Router.top() !== s) return;
      art.classList.add('live');
      s.el.classList.add('previewing');
      Player.play(d.url, {
        live: true, rect: artRect(),
        onError: function () { stopPreview(); },
        onEnd: function () { stopPreview(); }
      });
    }).catch(function () { prevId = null; s.playingId = null; });
  }

  function roundWin(t) { return Math.floor(t / 1800) * 1800; }
  function pps() { return G.W / (G.HOURS * 3600); }

  function loadCats() {
    API.get('/api/categories?kind=live' + (src ? '&src=' + src : '')).then(function (d) {
      cats = [{ id: 'viewsel', viewsel: true }].concat(Providers.many() ? [{ id: 'srcsel', srcsel: true }] : []).concat(
        [{ id: 'fav', name: tr('Favoris'), fav: true }, { id: 'all', name: tr('Toutes les chaînes') },
          { id: 'replay', name: tr('Avec replay') }], d);
      renderCats();
    }).catch(function () {});
  }
  /* filtre par abonnement : OK passe au suivant (tous → A → B → tous) */
  function srcLabel() {
    if (!src) return tr('Tous les serveurs');
    var p = Providers.by[src];
    return srcBadge(src, 'inline') + esc(p ? p.name : '');
  }
  function viewLabel() { return view === 'tiles' ? ICON.mosaic + tr('Vignettes') : ICON.guide + tr('Grille horaire'); }
  function nextView() {
    view = view === 'tiles' ? 'grid' : 'tiles';
    Store.set('liveView', view);
    s.el.classList.toggle('view-tiles', view === 'tiles');
    var n = catsBox.querySelector('[data-act="viewsel"] .nm');
    if (n) n.innerHTML = viewLabel();
    var keep = curRow;
    renderGrid();
    focusCell(keep, nowIndex(keep), true);
  }
  function nextSrc() {
    var ids = [0].concat(Providers.list.map(function (p) { return p.src; }));
    src = ids[(ids.indexOf(src) + 1) % ids.length];
    Store.set('liveSrc', src);
    var n = catsBox.querySelector('[data-act="srcsel"] .nm');
    if (n) n.innerHTML = srcLabel();
    loadCats();
    load(cat, true);
  }
  function renderCats() {
    // la liste ne change pas en naviguant : on ne reconstruit que si elle est vraiment différente,
    // sinon on déplace juste la marque « active » — sans quoi le focus serait perdu à chaque pas
    var sig = src + '#' + (API.unlock ? 'o' : 'f') + '#' + cats.map(function (c) { return c.id + ':' + (c.name || ''); }).join('|');
    if (catsBox.getAttribute('data-sig') !== sig) {
      catsBox.setAttribute('data-sig', sig);
      catsBox.innerHTML = cats.map(function (c) {
        if (c.viewsel) {
          return '<div class="cat srcsel focusable" data-act="viewsel" data-key="cat:viewsel">' +
            '<span class="nm">' + viewLabel() + '</span><small>' + tr('Affichage') + ' · OK</small></div>';
        }
        if (c.srcsel) {
          return '<div class="cat srcsel focusable" data-act="srcsel" data-key="cat:srcsel">' +
            '<span class="nm">' + srcLabel() + '</span><small>' + tr('Serveur') + ' · OK</small></div>';
        }
        if (c.fav) {
          return '<div class="fav focusable" data-cat="fav" data-key="cat:fav">' +
            ICON.starFill + tr('Favoris') + '</div><div class="sepline"></div>';
        }
        // avec plusieurs abonnements, un bouquet du fournisseur porte sa pastille
        return '<div class="cat focusable" data-cat="' + esc(c.id) + '" data-key="cat:' + esc(c.id) + '">' +
          '<span class="nm">' + (c.src && !src ? srcBadge(c.src, 'inline') : '') + esc(c.name) + lockMark(c) + '</span><small></small></div>';
      }).join('');
    }
    cats.forEach(function (c) {
      var n = catsBox.querySelector('[data-cat="' + cssEsc(c.id) + '"]');
      if (!n) return;
      n.classList.toggle('active', c.id === cat);
      var sm = n.querySelector('small');
      if (sm && !c.srcsel && !c.viewsel) sm.textContent = (c.id === cat && c.count) ? tr('{n} chaînes', { n: c.count }) : '';
    });
  }
  function load(c, reset) {
    if (reset) { cat = c; Store.set('liveCat', c); chans = []; curRow = 0; curProg = 0; winStart = roundWin(nowSec()); }
    if (loading) return;
    loading = true;
    var my = ++req;
    if (reset) { rowsBox.innerHTML = ''; state.innerHTML = loadingHTML(); state.classList.remove('hidden'); }
    API.get('/api/guide?cat=' + encodeURIComponent(cat) + '&src=' + src + '&start=' + winStart + '&hours=' + G.HOURS +
            '&offset=' + chans.length + '&limit=50').then(function (d) {
      if (my !== req) return;
      loading = false; state.classList.add('hidden');
      total = d.total;
      chans = chans.concat(d.channels);
      if (reset) renderCats();
      if (!chans.length) {
        state.innerHTML = cat === 'fav'
          ? tr('Pas encore de favoris. Choisissez « Toutes les chaînes » et appuyez sur la touche jaune.')
          : tr('Aucune chaîne dans cette catégorie.');
        state.classList.remove('hidden');
        if (cat === 'fav') load('all', true);
        return;
      }
      if (reset) renderGrid(); else keepFocus(s.el, renderGrid);
      // si l'utilisateur parcourt encore la colonne de gauche, la grille ne lui vole pas le focus
      if (reset) focusCell(0, nowIndex(0), !!(Focus.current && (Focus.current.hasAttribute('data-cat') ||
        Focus.current.getAttribute('data-act') === 'srcsel')));
    }).catch(function (e) {
      loading = false;
      if (reset) { state.innerHTML = errorHTML(e.message); state.classList.remove('hidden'); Focus.first(state); }
    });
  }
  function reloadWindow() {
    /* la fenêtre d'heures a bougé : on redemande les programmes pour les mêmes chaînes */
    var my = ++req, count = chans.length;
    API.get('/api/guide?cat=' + encodeURIComponent(cat) + '&src=' + src + '&start=' + winStart + '&hours=' + G.HOURS +
            '&offset=0&limit=' + count).then(function (d) {
      if (my !== req) return;
      chans = d.channels; renderGrid(); focusCell(curRow, curProg);
    }).catch(function () {});
  }
  function renderTime() {
    var html = '', t = winStart, p = pps();
    var nowX = (nowSec() - winStart) * p;
    for (var i = 0; i <= G.HOURS * 2; i++) {
      var x = (t - winStart) * p;
      // on saute l'heure ronde qui tomberait sous le repère rouge de l'heure courante
      if (x <= G.W - 40 && Math.abs(x - nowX) > 70) html += '<span style="left:' + Math.round(x) + 'px">' + hhmm(t) + '</span>';
      t += 1800;
    }
    var nx = nowX;
    if (nx >= 0 && nx <= G.W) {
      html += '<span class="now" style="left:' + Math.round(nx) + 'px;transform:translateX(-50%)">' + clockNow() + '</span>';
      nowLine.classList.remove('hidden');
      nowLine.style.left = Math.round(440 + G.X + nx) + 'px';
    } else nowLine.classList.add('hidden');
    timeBox.innerHTML = html;
  }
  function rowHTML(ch, ri) {
    var p = pps(), winEnd = winStart + G.HOURS * 3600, blocks = '';
    var progs = ch.programmes || [];
    if (!progs.length) {
      blocks = '<div class="g-prog none focusable" style="left:' + G.X + 'px;width:' + (G.W - 6) + 'px" ' +
        'data-row="' + ri + '" data-pi="-1" data-key="g:' + ch.id + ':-1">' + tr('Aucune information') + '</div>';
    } else {
      progs.forEach(function (pr, pi) {
        var a = Math.max(pr.start, winStart), b = Math.min(pr.stop, winEnd);
        if (b <= a) return;
        var left = G.X + (a - winStart) * p, w = Math.max(28, (b - a) * p - 6);
        var past = pr.stop <= nowSec();
        blocks += '<div class="g-prog focusable' + (past ? ' past' : '') + '" style="left:' + Math.round(left) +
          'px;width:' + Math.round(w) + 'px" data-row="' + ri + '" data-pi="' + pi + '" data-key="g:' + ch.id + ':' + pi + '">' +
          esc(pr.title || tr('Programme')) + (past && ch.archive ? '<span class="rp">' + tr('REPLAY') + '</span>' : '') + '</div>';
      });
    }
    return '<div class="g-row" data-row="' + ri + '">' +
      '<div class="g-ch"><span class="n">' + esc(ch.num || '') +
      '<small><span class="st">' + (ch.fav ? '★' : '☆') + '</span>' + srcBadge(ch.src) + '</small></span>' +
      logoHTML(ch) + '</div>' + blocks + '</div>';
  }
  /* une vignette : l'image du programme en cours (XMLTV), sinon la couleur de la chaîne et son logo */
  function tileHTML(ch, ri) {
    var pi = nowIndex(ri), pr = pi >= 0 ? ch.programmes[pi] : null, t = nowSec();
    if (pr && (pr.stop <= t || pr.start > t)) pr = null;
    var nx = pr ? (ch.programmes[pi + 1] || null) : null;
    return '<div class="mz g-tile focusable' + (pr && pr.image ? ' has-img' : '') + '" data-row="' + ri + '" data-pi="' + pi + '" data-key="gt:' + ch.id + '">' +
      '<div class="mz-art" style="background:' + tint(ch.id) + '">' +
      (pr && pr.image ? '<img loading="lazy" src="' + esc(API.img(pr.image)) + '" alt="" onerror="this.parentNode.parentNode.classList.remove(\'has-img\');this.remove()">' : '') +
      '<div class="mz-shade"></div>' + logoHTML(ch, 'mz-logo') +
      '<span class="mz-num">' + esc(ch.num || '') + '</span>' + srcBadge(ch.src, 'tl') +
      '<span class="st mz-fav">' + (ch.fav ? '★' : '') + '</span>' +
      (pr ? '<div class="bar"><i style="width:' + progPct(pr) + '%;background:var(--accent)"></i></div>' : '') +
      '</div><div class="mz-t">' + esc(pr ? (pr.title || tr('Programme')) : tr('Rien au guide')) + '</div>' +
      '<div class="mz-c">' + esc(ch.name) + (nx ? ' · ' + tr('Ensuite') + ' ' + hhmm(nx.start) : '') + '</div></div>';
  }
  function renderGrid() {
    if (view === 'tiles') {
      rowsBox.innerHTML = '<div class="g-tiles">' + chans.map(tileHTML).join('') + '</div>';
      rowEls = [];
      return;
    }
    renderTime();
    rowsBox.innerHTML = chans.map(rowHTML).join('');
    rowEls = $$('.g-row', rowsBox);
  }
  function nowIndex(ri) {
    var progs = (chans[ri] && chans[ri].programmes) || [];
    var t = nowSec();
    for (var i = 0; i < progs.length; i++) if (progs[i].stop > t) return i;
    return progs.length ? progs.length - 1 : -1;
  }
  function cellNode(ri, pi) {
    if (view === 'tiles') return rowsBox.querySelector('.g-tile[data-row="' + ri + '"]');
    var row = rowEls[ri];
    if (!row) return null;
    return row.querySelector('[data-pi="' + pi + '"]') || row.querySelector('.g-prog');
  }
  function focusCell(ri, pi, silent) {
    var n = cellNode(ri, pi);
    if (!n) return;
    curRow = ri; curProg = Number(n.getAttribute('data-pi'));
    if (!silent) Focus.set(n);      // silencieux : on garde le focus dans la colonne des bouquets
    else { showInfo(); }
  }
  function current() {
    var ch = chans[curRow];
    if (!ch) return {};
    var pr = (ch.programmes || [])[curProg];
    return { ch: ch, pr: pr };
  }
  function showInfo() {
    var c = current();
    if (!c.ch) return;
    var pr = c.pr;
    $('#gi-t', s.el).textContent = pr ? (pr.title || tr('Programme')) : c.ch.name;
    var m = [];
    if (pr) {
      m.push(hhmm(pr.start) + ' – ' + hhmm(pr.stop));
      if (pr.stop > nowSec() && pr.start <= nowSec()) m.push(tr('{d} restantes', { d: dur(pr.stop - nowSec()) }));
      else m.push(dur(pr.stop - pr.start));
      if (pr.categ) m.push(pr.categ);
    } else m.push(tr('Pas de guide pour cette chaîne'));
    $('#gi-m', s.el).innerHTML = m.map(esc).join(' <span class="sep">|</span> ');
    $('#gi-d', s.el).textContent = pr && pr.desc ? pr.desc : '';
    $('#gi-b', s.el).innerHTML = badgesHTML(c.ch, null);
    if (prevId === c.ch.id) return;        // l'aperçu occupe déjà le cadre
    var img = pr && pr.image;
    art.innerHTML = (img ? '<img src="' + esc(API.img(img)) + '" alt="" onerror="this.remove()">' : '') +
      '<span class="ini">' + esc(initials(c.ch.name)) + '</span>';
    art.style.background = tint(c.ch.id);
  }
  s.el.addEventListener('focused', function (e) {
    var n = e.target;
    if (n.classList.contains('g-prog') || n.classList.contains('g-tile')) {
      curRow = Number(n.getAttribute('data-row'));
      curProg = Number(n.getAttribute('data-pi'));
      if (prevId !== null && chans[curRow] && chans[curRow].id !== prevId) stopPreview();
      showInfo();
      schedulePreview();
      if (curRow > chans.length - 8 && chans.length < total) load(cat, false);
    } else if (n.hasAttribute('data-cat')) autoCat(n.getAttribute('data-cat'));
  });
  var autoCat = debounce(function (c) {
    var cc = cats.filter(function (x) { return x.id === c; })[0];
    if (cc && cc.locked && !API.unlock) return;      // un bouquet verrouillé s'ouvre avec OK, et le code
    if (Focus.current && Focus.current.getAttribute('data-cat') === c && c !== cat) {
      cats.forEach(function (x) { x.count = x.id === c ? x.count : x.count; });
      load(c, true);
      renderCats();
    }
  }, 450);

  function shiftWindow(dir) {
    winStart += dir * 1800;
    if (winStart < roundWin(nowSec()) - 6 * 3600) winStart = roundWin(nowSec()) - 6 * 3600;
    reloadWindow();
  }
  function moveProg(dir) {
    var ch = chans[curRow];
    if (!ch) return true;
    var progs = ch.programmes || [], next = curProg + dir;
    if (next < 0) return false;   // au bord gauche : on part vers les catégories
    if (next >= progs.length) { shiftWindow(1); return true; }
    var n = cellNode(curRow, next);
    if (!n) { shiftWindow(dir); return true; }
    focusCell(curRow, next);
    return true;
  }
  function moveRow(dir) {
    var ri = curRow + dir;
    if (ri < 0) return false;
    if (ri >= chans.length) {
      if (chans.length < total) load(cat, false);
      return true;
    }
    /* on garde la même position dans le temps */
    var c = current(), t = c.pr ? c.pr.start : nowSec();
    var progs = chans[ri].programmes || [], pi = 0;
    for (var i = 0; i < progs.length; i++) if (progs[i].stop > t) { pi = i; break; }
    focusCell(ri, pi);
    return true;
  }

  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'retry') return load(cat, true);
    if (act === 'srcsel') return nextSrc();
    if (act === 'viewsel') return nextView();
    if (n.hasAttribute('data-cat')) { load(n.getAttribute('data-cat'), true); renderCats(); return; }
    if (!n.classList.contains('g-prog') && !n.classList.contains('g-tile')) return;
    var c = current();
    if (!c.ch) return;
    var t = nowSec();
    if (c.pr && c.pr.stop <= t) {
      if (!c.ch.archive) { Toast.show(tr('Programme terminé, et pas de replay sur cette chaîne')); return; }
      return App.playReplay(c.ch, c.pr);
    }
    if (c.pr && c.pr.start > t) { progDetailGuide(c.ch, c.pr); return; }
    // si l'aperçu joue déjà cette chaîne, on la passe au lecteur sans la relancer
    if (prevId === c.ch.id) handing = true;
    App.playLive(chans, curRow, { cat: cat, src: src, total: total });
  };
  s.onKey = function (k) {
    var n = Focus.current, inTiles = n && n.classList.contains('g-tile');
    var inGrid = n && (n.classList.contains('g-prog') || inTiles);
    if (inGrid) {
      if (inTiles && (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN)) {
        // les vignettes se parcourent librement ; à gauche de la première colonne, la colonne des listes
        if (k === KEY.LEFT && !Focus.move('left')) { var cg0 = $('[data-group="cats"]', s.el), m0 = cg0 && Focus.enterGroup(cg0); if (m0) Focus.set(m0); }
        else if (k !== KEY.LEFT) Focus.move(k === KEY.RIGHT ? 'right' : k === KEY.UP ? 'up' : 'down');
        return true;
      }
      if (k === KEY.RIGHT) return moveProg(1);
      if (k === KEY.LEFT) {
        if (moveProg(-1)) return true;
        // au bord gauche de la grille : on va dans la colonne des bouquets, jamais sur une autre ligne
        var cg = $('[data-group="cats"]', s.el), m = cg && Focus.enterGroup(cg);
        if (m) Focus.set(m);
        return true;
      }
      if (k === KEY.DOWN || k === KEY.CH_DOWN) return moveRow(1);
      if (k === KEY.UP || k === KEY.CH_UP) return moveRow(-1);
      var ch = chans[curRow];
      if (k === KEY.YELLOW && ch) {
        App.toggleFavChannel(ch, function () {
          var row = rowEls[curRow], tile = view === 'tiles' && cellNode(curRow);
          if (row) row.querySelector('.st').textContent = ch.fav ? '★' : '☆';
          if (tile) tile.querySelector('.st').textContent = ch.fav ? '★' : '';
        });
        return true;
      }
      if (k === KEY.GREEN && ch) {
        if (ch.archive) Router.push(ReplayScreen(ch)); else Toast.show(tr('Pas de replay sur {n}', { n: ch.name }));
        return true;
      }
      if (k === KEY.BLUE && ch) { editChannel(ch, function () { load(cat, true); }); return true; }
      if (k === KEY.INFO && ch) { App.open('channel', ch.id); return true; }
      if (k >= 48 && k <= 57) {
        numBuf += String(k - 48); Toast.show(tr('Chaîne {n}', { n: numBuf }), 1500);
        clearTimeout(numTimer);
        numTimer = setTimeout(function () {
          var i = chans.findIndex(function (c) { return String(c.num) === numBuf; });
          numBuf = '';
          if (i < 0) Toast.show(tr('Chaîne introuvable dans cette liste')); else focusCell(i, nowIndex(i));
        }, 1300);
        return true;
      }
    }
    if (k === KEY.BLUE && n && n.hasAttribute('data-cat')) {
      var c0 = cats.filter(function (x) { return x.id === n.getAttribute('data-cat'); })[0];
      if (!c0 || !c0.orig_name) { Toast.show(tr('Cette liste ne peut pas être renommée')); return true; }
      renameCategory('live', c0, function () { loadCats(); });
      return true;
    }
    return false;
  };
  /* fiche d'un programme de la grille (même contenu que dans le panneau du lecteur) */
  function progDetailGuide(ch, p) {
    var ov = { el: el('<div class="panel pd">' +
      (p.image ? '<div class="pd-art"><img src="' + esc(API.img(p.image)) + '" alt="" onerror="this.parentNode.remove()"></div>' : '') +
      '<div class="pd-day">' + esc(dayLabel(p.start)) + ' · ' + esc(ch.name) + '</div>' +
      '<h2>' + esc(p.title || tr('Programme')) + '</h2>' +
      '<div class="pd-meta">' + [hhmm(p.start) + ' – ' + hhmm(p.stop), dur(p.stop - p.start), p.categ || '']
        .filter(Boolean).map(esc).join(' <span style="opacity:.45">|</span> ') + '</div>' +
      '<div class="scroll-y pd-plot" data-pad="40">' +
      (p.desc ? esc(p.desc) : '<span style="color:var(--muted)">' + tr('Pas de résumé pour ce programme.') + '</span>') +
      '</div></div>') };
    ov.onEnter = function () { Router.closeOverlay(); };
    Router.overlay(ov);
  }

  s.show = function (returning) {
    alive = true;
    if (!returning) { loadCats(); load(cat, true); }
    else { renderTime(); showInfo(); }
    tick = setInterval(function () { renderTime(); }, 30000);
  };
  s.hide = function () { clearInterval(tick); stopPreview(); };
  s.destroy = function () { alive = false; clearInterval(tick); stopPreview(); };
  return s;
}

/* =====================================================================
   PAGE D'UNE CHAÎNE
   ===================================================================== */
function ChannelScreen(id) {
  var s = baseScreen('channel', '<div class="ch-bg"></div>' + headerHTML('live') +
    '<div class="crumb">' + ICON.back + tr('Chaîne') + '</div>' +
    '<div class="ch-head"></div><div class="ch-cols"></div><div class="ch-others"></div><div class="state"></div>');
  var d = null, head = $('.ch-head', s.el), cols = $('.ch-cols', s.el), others = $('.ch-others', s.el);
  var state = $('.state', s.el), bg = $('.ch-bg', s.el);
  function load() {
    state.innerHTML = loadingHTML(); state.classList.remove('hidden');
    API.get('/api/channel?id=' + id).then(function (r) { d = r; state.classList.add('hidden'); keepFocus(s.el, render); })
      .catch(function (e) { state.innerHTML = errorHTML(e.message); state.classList.remove('hidden'); Focus.first(state); });
  }
  function thumb(prog, label) {
    if (!prog) return '<div class="ch-thumb" style="background:' + tint(d.id) + '"><span class="ini">' + esc(initials(d.name)) + '</span></div>';
    return '<div class="ch-thumb" style="background:' + tint(d.id) + '">' +
      (prog.image ? '<img src="' + esc(API.img(prog.image)) + '" alt="" onerror="this.remove()">' : '') +
      '<span class="ini">' + esc(initials(d.name)) + '</span>' +
      (label ? '<span class="bdg live lv">' + tr('EN DIRECT') + '</span>' : '') +
      '<span class="hh">' + hhmm(prog.start) + ' – ' + hhmm(prog.stop) + '</span>' +
      (label ? '<div class="bar"><i style="width:' + progPct(prog) + '%"></i></div>' : '') + '</div>';
  }
  function render() {
    bg.style.backgroundImage = d.now && d.now.image ? 'url("' + API.img(d.now.image) + '")' : '';
    head.innerHTML = logoHTML(d, 'logo-round logo-big') +
      '<div style="flex:1;min-width:0"><div class="ch-title">' +
      '<span class="ch-star">' + (d.fav ? ICON.starFill : ICON.star) + '</span>' +
      '<h1>' + esc(d.num ? d.num + ' ' + d.name : d.name) + '</h1>' + srcBadge(d.src, 'big') +
      '<div class="badges">' + badgesHTML(d, null) +
      (d.archive_days ? '<span class="bdg fill">' + tr(d.archive_days > 1 ? 'REPLAY {n} JOURS' : 'REPLAY {n} JOUR', { n: d.archive_days }) + '</span>' : '') +
      '</div></div>' +
      '<p class="plot" style="margin-top:14px;max-width:1200px">' +
      esc([d.provider || '', d.cat_name, d.guide_name ? tr('Guide : {n}', { n: d.guide_name }) : ''].filter(Boolean).join(' · ') ||
          tr('Chaîne de votre abonnement.')) + '</p></div>';
    cols.innerHTML =
      '<div class="ch-col"><div class="lbl">' + tr('En cours') + '</div>' + thumb(d.now, true) +
      '<div class="ch-pt">' + esc(d.now ? d.now.title : d.name) + '</div>' +
      '<div class="ch-pd">' + esc(d.now && d.now.desc ? d.now.desc : '') + '</div></div>' +
      '<div class="ch-mid" data-group="act">' +
      '<button class="btn focusable" data-default data-act="watch" data-key="watch">' + ICON.play + tr('Regarder la chaîne') + '</button>' +
      (d.archive ? '<button class="btn focusable" data-act="replay" data-key="replay">' + ICON.history24 + tr('Replay de la chaîne') + '</button>' : '') +
      '<button class="btn focusable" data-act="fav" data-key="fav">' + (d.fav ? ICON.starFill : ICON.star) +
      tr(d.fav ? 'Retirer des favoris' : 'Ajouter aux favoris') + '</button></div>' +
      '<div class="ch-col"><div class="lbl">' + tr('Programme suivant') + '</div>' + thumb(d.next, false) +
      '<div class="ch-pt">' + esc(d.next ? d.next.title : '—') + '</div>' +
      '<div class="ch-pd">' + esc(d.next && d.next.desc ? d.next.desc : '') + '</div></div>';
    others.innerHTML = d.others.length
      ? '<div class="lbl">' + tr('Peut aussi vous intéresser') + '</div><div class="scroll-x" data-group="others" data-padx="96"><div class="row">' +
        d.others.map(function (c, i) {
          return '<div class="orb focusable' + (c.logo ? ' has-img' : '') + '" data-act="other" data-idx="' + i + '" data-key="o:' + c.id + '">' +
            (c.logo ? '<img src="' + esc(API.img(c.logo)) + '" alt="" onerror="this.parentNode.classList.remove(\'has-img\');this.remove()">' : '') +
            '<span class="ini">' + esc(initials(c.name)) + '</span></div>';
        }).join('') + '</div></div>'
      : '';
  }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'retry') return load();
    if (act === 'watch') {
      return API.get('/api/live?cat=all').then(function (r) {
        var i = r.channels.findIndex(function (c) { return c.id === d.id; });
        App.playLive(i < 0 ? [d] : r.channels, i < 0 ? 0 : i);
      }).catch(function () { App.playLive([d], 0); });
    }
    if (act === 'replay') return Router.push(ReplayScreen(d));
    if (act === 'fav') return App.toggleFavChannel(d, function () { keepFocus(s.el, render); });
    if (act === 'other') return Router.push(ChannelScreen(d.others[Number(n.getAttribute('data-idx'))].id));
  };
  s.onKey = function (k) {
    if (k === KEY.YELLOW && d) { App.toggleFavChannel(d, function () { keepFocus(s.el, render); }); return true; }
    if (k === KEY.GREEN && d && d.archive) { Router.push(ReplayScreen(d)); return true; }
    return false;
  };
  s.show = function () { load(); };
  return s;
}

/* =====================================================================
   LECTEUR PLEIN ÉCRAN
   ===================================================================== */
/* médiathèque : limite de définition choisie dans les réglages (0 = la meilleure lisible) */
function maxQuality() { return Number(Store.get('maxQuality', 0)) || 0; }
function qualityLabel(h) { return h === 1080 ? tr('1080p au plus') : h === 720 ? tr('720p au plus') : tr('La meilleure lisible'); }

function PlayerScreen(o) {
  var live = o.mode === 'live', replay = o.mode === 'replay', base = 0;
  var s = baseScreen('player',
    '<div class="player-ui' + (live ? ' compact' : '') + '"><div class="scrim"></div>' +
    '<div class="p-panel">' +
    '<div class="p-head">' +
    '<img class="p-poster hidden" id="p-poster" alt="">' +
    '<div class="p-meta">' +
    '<div class="p-top" id="p-top"></div>' +
    '<h1 class="p-title" id="p-title"></h1>' +
    '<div class="p-sub" id="p-sub"></div>' +
    '</div>' + (live ? '<div class="p-chlogo" id="p-chlogo"></div>' : '') + '</div>' +
    '<div class="p-seek' + (live ? '' : ' vod focusable') + '" id="p-seek"' + (live ? '' : ' data-key="seek"') + '>' +
    '<i id="p-fill" style="width:0"></i>' + (live ? '' : '<b id="p-knob" style="left:0"></b>') + '</div>' +
    (live ? '<div class="p-rest" id="p-rest"></div>'
          : '<div class="p-times"><span id="p-pos">0:00</span><span id="p-dur"></span></div>') +
    '<div class="p-ctl" data-group="ctl" data-list="h">' +
    (live
      ? '<div class="btn focusable" data-default data-act="home">' + ICON.home + tr('Accueil') + '</div>' +
        '<div class="btn focusable" data-act="guide">' + ICON.guide + tr('Guide') + '</div>' +
        '<div class="btn focusable" data-act="mosaic">' + ICON.mosaic + tr('Mosaïque') + '</div>' +
        '<div class="btn focusable hidden" data-act="startover">' + ICON.restart + tr('Depuis le début') + '</div>' +
        '<div class="btn focusable hidden" data-act="replay">' + ICON.history24 + tr('Replay') + '</div>'
      : '<div class="round focusable" data-act="rw" aria-label="' + tr('Reculer') + '">' + ICON.rw + '</div>' +
        '<div class="round big focusable" data-default data-act="toggle" aria-label="' + tr('Pause') + '">' + ICON.pause + '</div>' +
        '<div class="round focusable" data-act="ff" aria-label="' + tr('Avancer') + '">' + ICON.ff + '</div>' +
        (o.mode === 'episode' ? '<div class="btn focusable" data-act="nextep">' + ICON.next + tr('Épisode suivant') + '</div>' : '')) +
    '<div class="grow"></div>' +
    (live ? '' : '<span class="p-hint">' + ICON.chevDown + tr('Résumé') + '</span>') +
    (live ? '<div class="round focusable" data-act="info" aria-label="' + tr('La chaîne') + '">' + ICON.info + '</div>' +
            '<div class="round focusable" data-act="fav" aria-label="' + tr('Favori') + '">' + ICON.star + '</div>' : '') +
    '<div class="round focusable" data-act="tracks" aria-label="' + tr('Audio et sous-titres') + '">' + ICON.subs + '</div>' +
    '</div>' +
    (live ? '<div class="p-pop" id="p-pop"></div>' : '<div class="p-more" id="p-more"></div>') +
    '</div>' +
    '</div><div class="p-status hidden"></div><div class="zap hidden"></div>');
  s.el.classList.add('see-through');
  var ui = $('.player-ui', s.el), status = $('.p-status', s.el), zapBox = $('.zap', s.el);
  var idx = o.index || 0, hideTimer = null, zapTimer = null, numBuf = '', numTimer = null;

  /* titre et infos trop longs : ils défilent lentement (pause, défilement, pause, retour) au lieu d'être coupés */
  function marquee(el) {
    if (!el || !alive) return;
    var inner = el.firstChild && el.firstChild.className === 'mq' && el.childNodes.length === 1 ? el.firstChild : null;
    // même texte, même place (le bandeau compact a un titre plus petit) : on laisse tourner
    var key = el.textContent + '|' + el.clientWidth + '|' + (inner ? inner.offsetWidth : -1);
    if (el._mqKey === key) return;
    clearTimeout(el._mq);
    if (!inner) {
      inner = document.createElement('span'); inner.className = 'mq';
      while (el.firstChild) inner.appendChild(el.firstChild);
      el.appendChild(inner);
    }
    inner.style.transition = 'none'; inner.style.transform = 'translateX(0)';
    inner.style.opacity = '1';
    var over = inner.offsetWidth - el.clientWidth;
    el._mqKey = el.textContent + '|' + el.clientWidth + '|' + inner.offsetWidth;
    el._mqOn = over > 4;
    el.classList.toggle('mq-on', el._mqOn);
    if (!el._mqOn) return;
    var dist = over + 30, dur = Math.max(4, dist / 70);           // environ 70 pixels par seconde
    (function loop() {
      el._mq = setTimeout(function () {
        if (!alive) return;
        inner.style.transition = 'transform ' + dur + 's linear';
        inner.style.transform = 'translateX(-' + dist + 'px)';
        el._mq = setTimeout(function () {
          inner.style.transition = 'opacity .4s'; inner.style.opacity = '0';
          el._mq = setTimeout(function () {
            inner.style.transition = 'none'; inner.style.transform = 'translateX(0)';
            void inner.offsetWidth; inner.style.transition = 'opacity .4s'; inner.style.opacity = '1';
            loop();
          }, 450);
        }, dur * 1000 + 2500);
      }, 3000);
    })();
  }
  function marqueeAll() { marquee($('#p-title', s.el)); marquee($('#p-sub', s.el)); }
  var mqWatch = null;
  try {
    mqWatch = new MutationObserver(function () { setTimeout(marqueeAll, 0); });
    ['#p-title', '#p-sub'].forEach(function (q) {
      var n = $(q, s.el); if (n) mqWatch.observe(n, { childList: true, characterData: true, subtree: true });
    });
  } catch (e) { mqWatch = null; }
  var cur = null, lastSaved = 0, seekTarget = null, seekTimer = null, endTimer = null, nextUp = null;
  var alive = true, epgTimer = null, infoTimer = null, vInfo = null;
  var RETRY_DELAYS = [2, 3, 5, 8, 12, 20], retries = 0, retryTimer = null, healthyTimer = null, quickRetried = false;
  // film en plusieurs versions : celles qui n'ont pas démarré, la version en cours, et s'il en reste
  var tried = [], curVer = null, verLeft = 0, verLabel = '', readyOnce = false;
  var lastTick = Date.now(), lastPos = -1, watchdog = null, resumeAt = null, userPaused = false;

  function showUI(persist, full) {
    if (live) ui.classList.toggle('compact', !full);
    marqueeAll();
    ui.classList.remove('faded'); document.body.classList.add('overlay-up');
    clearTimeout(hideTimer);
    if (!persist) hideTimer = setTimeout(hideUI, full ? 12000 : 5000);
  }
  /* passe de la barre discrète au bandeau complet */
  function expandUI() {
    if (!live || !ui.classList.contains('compact')) return false;
    showUI(false, true);
    var first = $('.p-ctl .focusable:not(.hidden)', s.el);
    if (first) Focus.set(first);
    return true;
  }
  function collapseUI() {
    if (!live || ui.classList.contains('compact')) return false;
    showUI(false, false);
    if (Focus.current && ui.contains(Focus.current)) Focus.current.classList.remove('focused'), Focus.current = null;
    return true;
  }
  function uiHidden() { return ui.classList.contains('faded'); }
  /* Bas : un volet sous les commandes, avec le résumé de ce qu'on regarde */
  var moreOpen = false, moreFor = null;
  function moreHTML(d) {
    var bits = [], head = '';
    if (d.year) bits.push(d.year);
    if (d.genre) bits.push(d.genre);
    if (d.duration) bits.push(dur(d.duration));
    if (d.director) bits.push(tr('Réalisation : {n}', { n: d.director }));
    if (d.head) head = '<div class="pm-head">' + esc(d.head) + '</div>';
    return head + (bits.length ? '<div class="pm-meta">' + esc(bits.join('  ·  ')) + '</div>' : '') +
      '<p class="pm-plot">' + (d.plot ? esc(d.plot) : '<span class="pm-none">' + tr('Pas de résumé disponible.') + '</span>') + '</p>' +
      (d.cast ? '<div class="pm-cast">' + esc(tr('Avec {n}', { n: d.cast })) + '</div>' : '');
  }
  function fillMore() {
    var box = $('#p-more', s.el), key, data;
    if (!box) return;
    if (replay) {
      key = 'r' + o.prog.start;
      data = { genre: o.prog.categ, plot: o.prog.desc };
    } else if (o.extra) {
      key = 'x' + o.extra.id;
      data = { genre: tr(EXTRA_KIND[o.extra.kind] || 'Bonus') + ' · ' + o.item.name, plot: o.item.plot };
    } else if (o.mode === 'movie') {
      key = 'm' + o.item.id;
      var m = o.item.detail || o.item;
      data = { year: m.year, genre: m.genre, duration: m.duration, director: m.director, cast: m.cast, plot: m.plot };
      if (!o.item.detail) {
        API.get('/api/movie?id=' + o.item.id).then(function (d) {
          o.item.detail = d; if (alive && moreFor === key) { moreFor = null; fillMore(); }
        }).catch(function () { o.item.detail = o.item; });
      }
    } else {
      var e = o.episodes[idx];
      key = 'e' + e.id;
      data = { duration: e.duration, plot: e.plot || (o.series.plot || '') };
      if (!e.plot && o.series.plot === undefined) {
        API.get('/api/series/detail?id=' + o.series.id).then(function (d) {
          o.series.plot = d.plot || ''; if (alive && moreFor === key) { moreFor = null; fillMore(); }
        }).catch(function () { o.series.plot = ''; });
      }
    }
    if (moreFor === key) return;
    moreFor = key;
    box.innerHTML = moreHTML(data);
  }
  function openMore() {
    if (live || moreOpen) return;
    fillMore();
    moreOpen = true; ui.classList.add('more');
    showUI(true);
  }
  function closeMore() {
    if (!moreOpen) return false;
    moreOpen = false; ui.classList.remove('more');
    showUI(userPaused);
    return true;
  }
  function hideUI() {
    if (!Player.isPlaying() || Router.overlays.length || nextUp || moreOpen) return;
    ui.classList.add('faded'); document.body.classList.remove('overlay-up');
    if (live) {
      ui.classList.add('compact');
      if (Focus.current && ui.contains(Focus.current)) Focus.current.classList.remove('focused'), Focus.current = null;
    }
  }
  function setStatus(html) {
    if (!html) { status.classList.add('hidden'); status.innerHTML = ''; return; }
    status.innerHTML = html; status.classList.remove('hidden');
  }
  function setToggleIcon() {
    var b = $('[data-act="toggle"]', s.el);
    if (b) b.innerHTML = Player.isPlaying() ? ICON.pause : ICON.play32;
  }
  function refreshBadges() {
    var ch = live ? o.channels[idx] : (replay ? o.channel : null);
    var top = $('#p-top', s.el);
    if (!top) return;
    if (live) {
      // le logo dit déjà le nom : on garde le numéro, et le nom seulement quand il n'y a pas de logo
      // le numéro en premier à gauche, le logo en grand à droite au-dessus de la barre ;
      // le nom seulement quand la chaîne n'a pas de logo (ou qu'il ne se charge pas)
      var lg = $('#p-chlogo', s.el);
      if (lg) {
        // en image de fond « contain » : le logo entre toujours entier dans son cadre, jamais rogné
        // version « au plus près » du logo (sans le carré transparent des listes) : il touche le bas du cadre
        var big = /[?&]m=logo(&|$)/.test(ch.logo || '') ? ch.logo.replace(/([?&])m=logo(&|$)/, '$1m=logow$2').replace(/([?&])w=\d+/, '$1w=640') : ch.logo;
        lg.style.backgroundImage = big ? 'url("' + API.img(big).replace(/"/g, '%22') + '")' : 'none';
        if (big) {
          var probe = new Image();
          probe.onerror = function () { lg.style.backgroundImage = 'none'; var n = $('#p-chname', s.el); if (n) n.hidden = false; };
          probe.src = API.img(big);
        }
      }
      top.innerHTML =
        (ch.num ? '<span class="p-num">' + esc(String(ch.num)) + '</span>' : '') +
        '<span id="p-chname" style="font-size:25px;font-weight:600"' + (ch.logo ? ' hidden' : '') + '>' + esc(ch.name) + '</span>' +
        '<span class="bdg live">' + tr('EN DIRECT') + '</span>' +
        srcBadge(ch.src) + badgesHTML(ch, vInfo);
    } else if (replay) {
      top.innerHTML = logoHTML(o.channel, 'p-logo') +
        '<span class="bdg fill">' + tr('REPLAY') + '</span>' +
        '<span style="font-size:25px;font-weight:600">' + esc(o.channel.name) + '</span>' +
        '<span style="font-size:21px;color:var(--soft)">' + esc(dayLabel(o.prog.start)) + '</span>' +
        badgesHTML(null, vInfo);
    } else {
      top.innerHTML = '<span class="bdg">' + tr(o.extra ? 'BONUS' : o.mode === 'movie' ? 'FILM' : 'SÉRIE') + '</span>' + badgesHTML(null, vInfo);
    }
  }

  /* le guide passe les chaînes avec leurs « programmes » mais sans « now » :
     on le reconstruit, sinon pas d'image ni de progression dans le bandeau */
  function ensureNow(ch, then) {
    if (!ch || ch._loading) return;
    var t = nowSec();
    if (ch.now && ch.now.stop > t) { if (then) then(); return; }
    if (ch.programmes && ch.programmes.length) {
      var p = ch.programmes.filter(function (x) { return x.stop > t; });
      if (p.length) { ch.now = p[0]; ch.next = p[1] || null; if (then) then(); return; }
    }
    ch._loading = true;
    API.get('/api/epg?id=' + ch.id + '&hours=4').then(function (d) {
      ch._loading = false;
      var p = (d.programmes || []).filter(function (x) { return x.stop > nowSec(); });
      ch.now = p[0] || null; ch.next = p[1] || null;
      if (alive && then) then();
    }).catch(function () { ch._loading = false; });
  }

  /* ----- informations affichées ----- */
  function liveInfo() {
    var ch = o.channels[idx];
    refreshBadges();
    $('#p-title', s.el).textContent = ch.now ? ch.now.title : ch.name;
    var m = [];
    if (ch.now) m.push(hhmm(ch.now.start) + ' – ' + hhmm(ch.now.stop));
    if (ch.now && ch.now.categ) m.push(ch.now.categ);
    if (ch.next) m.push(tr('Ensuite {h} · {t}', { h: hhmm(ch.next.start), t: ch.next.title }));
    $('#p-sub', s.el).innerHTML = m.map(esc).join(' <span style="opacity:.45">|</span> ');
    $('#p-fill', s.el).style.width = progPct(ch.now) + '%';
    var rest = $('#p-rest', s.el);
    if (rest) rest.textContent = ch.now ? tr('{d} restantes', { d: dur(Math.max(0, ch.now.stop - nowSec())) }) : '';
    var so = $('[data-act="startover"]', s.el), rp = $('[data-act="replay"]', s.el);
    if (so) so.classList.toggle('hidden', !(ch.archive && ch.now));
    if (rp) rp.classList.toggle('hidden', !ch.archive);
    var fav = $('[data-act="fav"]', s.el);
    if (fav) { fav.innerHTML = ch.fav ? ICON.starFill : ICON.star; fav.classList.toggle('on', !!ch.fav); }
    Now.set(ch, ch.now);
  }
  function refreshEpg() {
    var ch = o.channels[idx];
    if (!ch || !ch.now || ch.now.stop > nowSec()) { if (live) liveInfo(); return; }
    API.get('/api/epg?id=' + ch.id + '&hours=4').then(function (d) {
      var p = d.programmes.filter(function (x) { return x.stop > nowSec(); });
      ch.now = p[0] || null; ch.next = p[1] || null; if (alive) liveInfo();
    }).catch(function () {});
  }
  /* l'affiche à gauche du titre, dans le bandeau. On essaie les images dans l'ordre
     et on n'affiche que celle dont la forme convient (affiche en hauteur, ou image
     d'épisode en largeur) : une image mal proportionnée serait rognée n'importe comment.
     Si aucune ne convient, rien n'est affiché. */
  function setPoster(src, wide) {
    var list = Array.isArray(src) ? src : [{ src: src, wide: !!wide }];
    var im = $('#p-poster', s.el);
    if (!im) return;
    var token = (im._tok || 0) + 1; im._tok = token;
    im.classList.add('hidden'); im.removeAttribute('src');
    (function tryAt(i) {
      while (i < list.length && !list[i].src) i++;
      if (i >= list.length) return;
      var c = list[i];
      im.onerror = function () { if (im._tok === token) tryAt(i + 1); };
      im.onload = function () {
        if (im._tok !== token) return;
        var w = im.naturalWidth, h = im.naturalHeight, ok = w && h && (c.wide ? w / h > 1.2 : h / w > 1.2);
        if (!ok) return tryAt(i + 1);
        im.classList.toggle('wide', !!c.wide);
        im.classList.remove('hidden');
      };
      im.src = API.img(c.src);
    })(0);
  }
  function vodInfo() {
    refreshBadges();
    if (replay) {
      setPoster(o.prog.image, true);
      $('#p-title', s.el).textContent = o.prog.title || o.channel.name;
      $('#p-sub', s.el).textContent = hhmm(o.prog.start) + ' – ' + hhmm(o.prog.stop) +
        (o.prog.categ ? ' | ' + o.prog.categ : '');
    } else if (o.mode === 'movie') {
      setPoster(o.item.poster);
      $('#p-title', s.el).textContent = o.extra ? tr(o.extra.title) : o.item.name;
      $('#p-sub', s.el).textContent = o.extra ? o.item.name : '';
    } else {
      var e = o.episodes[idx], nxt = o.episodes[idx + 1];
      setPoster([{ src: e.image, wide: true }, { src: o.series.poster }]);
      $('#p-title', s.el).textContent = e.title || tr('Épisode {n}', { n: e.episode });
      $('#p-sub', s.el).textContent = tr('{s} · Saison {n} · Épisode {e}', { s: o.series.name, n: e.season, e: e.episode }) +
        (nxt ? '   |   ' + tr('Ensuite S{s} · É{e}', { s: nxt.season, e: nxt.episode }) : '');
      var nb = $('[data-act="nextep"]', s.el); if (nb) nb.classList.toggle('hidden', !nxt);
    }
  }
  function updateTime(pos) {
    if (live) return;
    if (replay) pos = base + pos;
    var d = replay ? cur.duration : (Player.duration() || (cur && cur.duration) || 0);
    var p = seekTarget !== null ? seekTarget : pos;
    var pct = d ? Math.min(100, p / d * 100) : 0;
    $('#p-fill', s.el).style.width = pct + '%';
    var kn = $('#p-knob', s.el); if (kn) kn.style.left = pct + '%';
    $('#p-pos', s.el).textContent = clock(p);
    $('#p-dur', s.el).textContent = d ? '-' + clock(Math.max(0, d - p)) : '';
    if (cur && Date.now() - lastSaved > 15000 && pos > 10) save();
  }
  function save(done) {
    if (live || replay || !cur || o.extra) return;
    var d = Player.duration() || cur.duration || 0, pos = done ? d : Player.position();
    if (!d || pos < 5) return;
    lastSaved = Date.now();
    var body = { kind: o.mode === 'movie' ? 'movie' : 'episode', id: cur.id, position: pos, duration: d };
    if (o.mode === 'episode') body.series_id = o.series.id;
    API.post('/api/progress', body).catch(function () {});
  }

  /* ----- lecture ----- */
  function start() {
    clearTimeout(retryTimer); clearTimeout(endTimer);
    lastTick = Date.now(); lastPos = -1; userPaused = false; vInfo = null;
    nextUp = null; $$('.next-up', s.el).forEach(function (n) { n.remove(); });
    setStatus(loadingHTML()); showUI(true, live ? !ui.classList.contains('compact') : undefined);
    var q, myIdx = idx;
    if (live) {
      cur = o.channels[idx];
      ensureNow(cur, function () { if (alive) { liveInfo(); popular(); } });
      liveInfo(); pushRecent(cur); popular();
      q = '/api/play?kind=live&id=' + cur.id;
    }
    else if (replay) {
      cur = { id: o.channel.id, duration: o.prog.stop - o.prog.start };
      base = resumeAt !== null ? Math.max(0, Math.floor(resumeAt / 60) * 60) : 0; resumeAt = null;
      vodInfo(); q = '/api/play?kind=replay&id=' + o.channel.id + '&start=' + (o.prog.start + base) + '&stop=' + o.prog.stop;
    } else if (o.extra) {
      cur = o.item; vodInfo(); q = '/api/play?kind=extra&id=' + o.extra.id;
    } else if (o.mode === 'movie') {
      cur = o.item; vodInfo();
      q = '/api/play?kind=movie&id=' + cur.id + '&maxh=' + maxQuality() + (tried.length ? '&skip=' + tried.join(',') : '');
    }
    else { cur = o.episodes[idx]; vodInfo(); q = '/api/play?kind=episode&id=' + cur.id + '&ext=' + encodeURIComponent(cur.ext || 'mp4') +
      (o.series ? '&series=' + o.series.id : ''); }
    if (live && Player.url && Player.state !== 'idle' && s.prevPlayingId === cur.id) {
      s.prevPlayingId = null;
      Player.setRect({ x: 0, y: 0, w: 1920, h: 1080 }); Player.setDisplay(displayPref());
      Player.cb = callbacks(); setStatus(''); setToggleIcon(); showUI(); grabInfo();
      return;
    }
    readyOnce = false;
    API.get(q).then(function (d) {
      if (!alive || myIdx !== idx) return;
      curVer = d.version || null; verLeft = d.left || 0; verLabel = d.version_label || '';
      if (d.local && d.playable === false) setStatus('<div class="warn">' + esc(d.note || tr('Format non lu par le téléviseur')) + '</div>');
      Player.play(d.local ? API.media(d.url) : d.url, Object.assign(callbacks(), {
        live: live, rect: { x: 0, y: 0, w: 1920, h: 1080 }, display: displayPref(),
        buffer: live ? Store.get('liveBuffer', 3) : 5,
        start: resumeAt !== null && !replay ? resumeAt : (o.fromStart ? 0 : (d.start || 0))
      }));
      o.fromStart = false; resumeAt = null;
    }).catch(function (e) { failed(e.message); });
  }
  function grabInfo() {
    clearTimeout(infoTimer);
    infoTimer = setTimeout(function () {
      if (!alive) return;
      vInfo = Player.videoInfo();
      refreshBadges();
    }, 1500);
  }
  /* langue audio et sous-titres : celle retenue pour la série, sinon le réglage du type de contenu */
  /* format de l'image : retenu chaîne par chaîne en direct, une fois pour toutes en films et séries */
  function displayKey() { return live ? 'ar.c.' + (cur && cur.id) : 'ar.vod'; }
  function displayPref() { return Store.get(displayKey(), null) || (live ? Store.get('ar.live', 'box') : 'box'); }
  function langKind() { return live || replay ? 'live' : (o.mode === 'episode' ? 'series' : 'movie'); }
  function langPref() {
    if (o.mode === 'episode' && o.series && !o.extra) {
      var mem = Store.get('trk.s.' + o.series.id, null);
      if (mem) return mem;
    }
    return trackPref(langKind());
  }
  function callbacks() {
    return {
      onReady: function () {
        if (!alive) return;
        if (!readyOnce) setTimeout(function () { if (alive) Player.applyLang(langPref()); }, 400);
        readyOnce = true;
        setStatus(''); setToggleIcon(); showUI(); grabInfo();
        lastTick = Date.now();
        clearTimeout(healthyTimer); healthyTimer = setTimeout(function () { retries = 0; quickRetried = false; }, 60000);
      },
      onBuffering: function (b) { if (!alive) return; setStatus(b ? loadingHTML() : ''); },
      onTime: function (pos) { if (!alive) return; if (pos !== lastPos) { lastPos = pos; lastTick = Date.now(); } updateTime(pos); },
      onEnd: function () { if (alive) ended(); },
      onError: function (msg) { if (alive) failed(msg); }
    };
  }
  function failed(msg) {
    var pos = Player.position();
    Player.stop();
    clearTimeout(healthyTimer);
    // une version qui ne démarre pas : on passe à la suivante (la meilleure lisible parmi les autres)
    if (o.mode === 'movie' && curVer && verLeft > 0 && !readyOnce) {
      tried.push(curVer);
      Toast.show(tr('La version {v} ne démarre pas : essai d’une autre version', { v: verLabel || '?' }), 4000);
      start();
      return;
    }
    // en direct, une coupure isolée se relance tout de suite (écran noir le plus court possible)
    if (live && retries === 0 && !quickRetried) {
      quickRetried = true;
      setStatus(loadingHTML());
      retryTimer = setTimeout(function () { if (alive) start(); }, 300);
      return;
    }
    if (retries < RETRY_DELAYS.length) {
      var wait = RETRY_DELAYS[retries++];
      if (!live && pos > 5) resumeAt = replay ? base + pos : pos;
      setStatus(loadingHTML(tr('Reconnexion dans {w} s (essai {n} sur {m})', { w: wait, n: retries, m: RETRY_DELAYS.length }) +
        (!live && resumeAt ? tr(' · la lecture reprendra au même endroit') : '')));
      retryTimer = setTimeout(function () { if (alive) start(); }, wait * 1000);
      return;
    }
    setStatus('<div>' + tr(live ? 'Lecture impossible sur cette chaîne.' : 'Lecture impossible.') + '<br>' +
      '<span style="font-size:20px;color:var(--muted)">' + esc(msg || '') + '</span></div>' +
      '<div class="actions" data-group="err"><button class="btn focusable" data-act="retry" data-default>' + tr('Réessayer') + '</button>' +
      (live ? '<button class="btn focusable" data-act="next">' + tr('Chaîne suivante') + '</button>' : '') + '</div>');
    showUI(true); Focus.first(status);
  }
  function ended() {
    save(true);
    if (o.mode === 'episode' && o.episodes[idx + 1]) {
      var nxt = o.episodes[idx + 1], left = 10;
      nextUp = el('<div class="next-up"><div class="kicker">' + tr('Épisode suivant dans {n} s', { n: '<span id="nu-s">10</span>' }) + '</div>' +
        '<div style="font-size:28px;font-weight:600">' + tr('S{s} · É{e}', { s: nxt.season, e: nxt.episode }) + (nxt.title ? ' · ' + esc(nxt.title) : '') + '</div>' +
        '<div class="actions" style="margin-top:4px"><button class="btn focusable" data-act="nextep" data-default>' + ICON.play + tr('Regarder') + '</button>' +
        '<button class="btn focusable" data-act="quit">' + tr('Arrêter') + '</button></div></div>');
      s.el.appendChild(nextUp); showUI(true); Focus.first(nextUp);
      var t = function () {
        left--; var n = $('#nu-s', s.el); if (n) n.textContent = left;
        if (left <= 0) { idx++; start(); } else endTimer = setTimeout(t, 1000);
      };
      endTimer = setTimeout(t, 1000);
    } else if (!live) Router.back();
    else failed(tr('le direct s’est arrêté'));
  }

  /* ----- chaînes populaires, zapping ----- */
  /* mémoire des chaînes regardées, gardée sur le téléviseur */
  function pushRecent(ch) {
    if (!ch) return;
    var l = Store.get('recentCh', []).filter(function (x) { return x && x.id !== ch.id; });
    l.unshift({ id: ch.id, num: ch.num, name: ch.name, logo: ch.logo, src: ch.src });
    Store.set('recentCh', l.slice(0, 12));
  }
  function popular() {
    var box = $('#p-pop', s.el);
    if (!box || !live) return;
    var here = o.channels[idx].id;
    var recent = Store.get('recentCh', []).filter(function (c) { return c && c.id !== here; });
    var fromList = o.channels.filter(function (c) { return c.id !== here; });
    var list = recent.length ? recent.slice(0, 10) : fromList.slice(0, 10);
    var label = tr(recent.length ? 'Dernières chaînes' : 'Chaînes');
    box.innerHTML = list.length ? '<div class="lbl">' + label + '</div>' +
      '<div class="strip" data-group="pop" data-list="h" data-nav-up="ctl" data-nav-down="stop"><div class="row">' +
      list.map(function (c) {
        var full = o.channels.filter(function (x) { return x.id === c.id; })[0] || c;
        return '<div class="focusable" data-act="pick" data-cid="' + c.id + '" data-key="p:' + c.id + '">' +
          artHTML(full, full.now) + '</div>';
      }).join('') + '</div></div>' : '';
    // le programme en cours manque parfois : on le demande une seule fois par chaîne
    list.forEach(function (c) {
      var full = o.channels.filter(function (x) { return x.id === c.id; })[0];
      if (!full || full.now || full._asked) return;
      full._asked = true;
      ensureNow(full, function () { if (alive) popular(); });
    });
  }
  /* bascule vers une chaîne choisie dans la rangée du bas, même si elle n'est pas dans la liste courante */
  function pickChannel(cid) {
    var i = o.channels.findIndex(function (x) { return x.id === cid; });
    if (i < 0) {
      var st = Store.get('recentCh', []).filter(function (x) { return x && x.id === cid; })[0];
      if (!st) return;
      o.channels = o.channels.concat([{ id: st.id, num: st.num, name: st.name, logo: st.logo, src: st.src }]);
      i = o.channels.length - 1;
    }
    zap(0, i);
  }
  function zap(delta, absolute) {
    if (!live) return;
    var n = o.channels.length;
    idx = absolute !== undefined ? absolute : (idx + delta + n) % n;
    ensureNow(o.channels[idx], function () { if (alive) { liveInfo(); popular(); } });
    liveInfo(); showUI(false, !ui.classList.contains('compact'));
    zapBox.textContent = o.channels[idx].num || o.channels[idx].name; zapBox.classList.remove('hidden');
    clearTimeout(zapTimer);
    zapTimer = setTimeout(function () {
      zapBox.classList.add('hidden'); retries = 0; quickRetried = false; resumeAt = null; setStatus(''); Player.stop(); start();
    }, 450);
  }
  function seekBy(sec) {
    if (live) return;
    var from = seekTarget !== null ? seekTarget : (replay ? base : 0) + Player.position();
    var d = replay ? cur.duration : (Player.duration() || 0);
    seekTarget = Math.max(0, d ? Math.min(d - 3, from + sec) : from + sec);
    updateTime(Player.position()); showUI();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () {
      if (replay) { resumeAt = seekTarget; seekTarget = null; Player.stop(); start(); return; }
      Player.seekTo(seekTarget); seekTarget = null;
    }, replay ? 900 : 700);
  }

  /* ----- panneaux ----- */
  function guidePanel() {
    var ch = o.channels[idx], progs = [];
    var ov = { el: el('<div class="panel"><h2>' + esc(ch.name) + '</h2><div class="lbl">' + tr('Guide des programmes') + '</div>' +
      '<div class="scroll-y" data-pad="60"><div class="state" style="position:static;margin-top:120px">' + loadingHTML() + '</div></div></div>') };
    ov.onEnter = function (n) {
      var i = n && n.getAttribute('data-pi');
      if (i === null || i === undefined) return Router.closeOverlay();
      progDetail(ch, progs[Number(i)]);
    };
    Router.overlay(ov); showUI(true);
    API.get('/api/epg?id=' + ch.id + '&hours=24&back=4').then(function (d) {
      progs = d.programmes;
      var box = $('.scroll-y', ov.el), t = nowSec();
      box.innerHTML = progs.length ? progs.map(function (p, i) {
        var cur = p.start <= t && p.stop > t;
        return '<div class="opt focusable' + (cur ? ' sel' : '') + '" data-pi="' + i + '"' + (cur ? ' data-default' : '') + '>' +
          '<span class="t">' + hhmm(p.start) + '</span>' +
          '<span style="flex:1">' + esc(p.title) + '</span>' +
          (cur ? '<span class="bdg live">' + tr('EN COURS') + '</span>' : '') + '</div>';
      }).join('') : '<div class="opt">' + tr('Pas de guide pour cette chaîne.') + '</div>';
      Focus.first(ov.el);
    }).catch(function (e) { $('.scroll-y', ov.el).innerHTML = '<div class="opt">' + esc(e.message) + '</div>'; });
    ov.onClose = function () { showUI(); };
  }

  /* zapping rapide : la liste des chaînes, à gauche, sans quitter la lecture */
  /* changer de bouquet sans quitter la lecture : la liste rapide et la mosaïque en profitent,
     et Haut / Bas suivent ensuite le nouveau bouquet */
  function bouquetName() { return (o.ctx && o.ctx.name) || tr('Chaînes'); }
  function chooseBouquet(done) {
    API.get('/api/categories?kind=live').then(function (d) {
      var list = [{ id: 'fav', name: tr('Favoris') }, { id: 'all', name: tr('Toutes les chaînes') }].concat(d);
      var curCat = o.ctx ? String(o.ctx.cat) : '';
      // pas la classe « zap » : la mosaïque la cache, et ce choix doit aussi s'ouvrir par-dessus elle
      var pv = { el: el('<div class="panel left zap-like"><div class="lbl">' + tr('Bouquet') + '</div>' +
        '<div class="scroll-y" data-pad="120">' + list.map(function (c) {
          var here = String(c.id) === curCat;
          return '<div class="zrow focusable' + (here ? ' sel' : '') + '" data-bq="' + esc(c.id) + '" data-key="bq:' + esc(c.id) + '"' +
            (here ? ' data-default' : '') + '><div class="zmeta"><div class="zname">' +
            (c.src ? srcBadge(c.src, 'inline') : '') + esc(c.name) + lockMark(c) + '</div>' +
            (c.count ? '<div class="znow">' + tr('{n} chaînes', { n: c.count }) + '</div>' : '') + '</div></div>';
        }).join('') + '</div></div>') };
      pv.onEnter = function (n) {
        var id = n && n.getAttribute('data-bq');
        if (!id) return Router.closeOverlay();
        var c = list.filter(function (x) { return String(x.id) === id; })[0];
        API.get('/api/live?cat=' + encodeURIComponent(id)).then(function (r) {
          var chans = r.channels || [];
          if (!chans.length) { Toast.show(tr('Aucune chaîne dans ce bouquet')); return; }
          var playing = o.channels[idx];
          var i = chans.findIndex(function (x) { return playing && x.id === playing.id; });
          // la chaîne en cours n'est pas dans ce bouquet : elle reste en tête de liste, le temps de zapper
          if (i < 0 && playing) { chans = [playing].concat(chans); i = 0; }
          o.channels = chans;
          o.ctx = { cat: id, src: 0, total: chans.length, name: c ? c.name : '' };
          idx = Math.max(0, i);
          Router.closeOverlay();
          if (done) done(i >= 0);
        }).catch(function (e) { if (e.message) Toast.show(e.message); });
      };
      Router.overlay(pv);
      var cur = $('.zrow.sel', pv.el); if (cur) Focus.set(cur); else Focus.first(pv.el);
    }).catch(function (e) { Toast.show(e.message); });
  }

  /* le programme en cours d'une chaîne, sans garder un titre déjà fini */
  function nowOf(c) {
    var t = nowSec();
    if (c.now && c.now.stop > t) return c.now;
    var p = (c.programmes || []).filter(function (x) { return x.stop > t; });
    if (p.length) { c.now = p[0]; c.next = p[1] || null; return c.now; }
    if (c.now && c.now.stop <= t) { c.now = null; c.next = null; }
    return null;
  }
  /* un panneau qui se ferme seul quand on ne touche plus à la télécommande */
  function idleClose(ov, ms) {
    var t = null;
    function arm() {
      clearTimeout(t);
      t = setTimeout(function () {
        if (Router.overlays.indexOf(ov) < 0) return;
        if (Router.top() !== ov) return arm();      // un choix est ouvert par-dessus : on attend
        Router.closeOverlay();
      }, ms);
    }
    arm();
    return { reset: arm, stop: function () { clearTimeout(t); } };
  }
  /* les programmes en cours de toute la liste : une requête par bouquet, sinon chaîne par chaîne autour de i */
  function refreshNow(around, done) {
    if (o.ctx) {
      API.get('/api/live?cat=' + encodeURIComponent(o.ctx.cat) + '&src=' + (o.ctx.src || 0)).then(function (d) {
        var by = {}; (d.channels || []).forEach(function (c) { by[c.id] = c; });
        o.channels.forEach(function (c) { var f = by[c.id]; if (f) { c.now = f.now; c.next = f.next; } });
        if (alive) done(null);
      }).catch(function () {});
      return;
    }
    for (var i = Math.max(0, around - 8); i < Math.min(o.channels.length, around + 9); i++) {
      (function (c, i) { if (!nowOf(c)) ensureNow(c, function () { done(i); }); })(o.channels[i], i);
    }
  }

  function zapPanel() {
    var WIN = 240, start = 0, ov = null, idle = null;
    function window_(center) {
      start = Math.max(0, Math.min(center - Math.floor(WIN / 2), o.channels.length - WIN));
      if (start < 0) start = 0;
      return o.channels.slice(start, start + WIN);
    }
    function rowHTML(c, i) {
      var here = i === idx;
      return '<div class="zrow focusable' + (here ? ' sel' : '') + '" data-ci="' + i + '" data-key="z:' + c.id + '"' +
        (here ? ' data-default' : '') + '>' +
        logoHTML(c, 'zlogo') +
        '<div class="znum">' + (c.num || '') + '</div>' +
        '<div class="zmeta"><div class="zname">' + srcBadge(c.src, 'inline') + esc(c.name) + '</div>' +
        '<div class="znow">' + esc((nowOf(c) || {}).title || '') + '</div></div>' +
        (here ? '<span class="bdg live">' + tr('EN DIRECT') + '</span>' : '') + '</div>';
    }
    function render(center) {
      var list = window_(center);
      $('.scroll-y', ov.el).innerHTML = '<div class="zrow zbq focusable" data-act="bq" data-key="z:bq"><div class="zmeta">' +
        '<div class="zname zbq-name">' + ICON.list + esc(bouquetName()) + '</div><div class="znow">' + tr('OK pour changer de bouquet') + '</div></div></div>' +
        list.map(function (c, k) { return rowHTML(c, start + k); }).join('');
    }
    ov = { el: el('<div class="panel left zap"><div class="lbl">' + tr('Chaînes') + '</div>' +
      '<div class="scroll-y" data-pad="120"></div></div>') };
    ov.onEnter = function (n) {
      if (n && n.getAttribute('data-act') === 'bq') {
        // la liste se ferme le temps du choix, puis se rouvre sur le nouveau bouquet
        Router.closeOverlay();
        return chooseBouquet(function () { zapPanel(); });
      }
      var i = n && n.getAttribute('data-ci');
      if (i === null || i === undefined) return Router.closeOverlay();
      Router.closeOverlay();
      zap(0, Number(i));
    };
    ov.onKey = function () { if (idle) idle.reset(); return false; };
    function updateRow(i) {
      var n = ov && $('[data-ci="' + i + '"] .znow', ov.el);
      if (n) n.textContent = (nowOf(o.channels[i]) || {}).title || '';
    }
    // près du bord de la fenêtre affichée, on la recentre pour pouvoir continuer
    ov.onMove = function () {
      var cur = Focus.current && Focus.current.getAttribute('data-ci');
      if (cur === null || cur === undefined) return;
      var i = Number(cur);
      if (!o.ctx) refreshNow(i, function (j) { updateRow(j); });
      if (o.channels.length <= WIN) return;
      if (i < start + 20 || i > start + WIN - 20) {
        render(i);
        var n = $('[data-ci="' + i + '"]', ov.el);
        if (n) Focus.set(n);
      }
    };
    // le bandeau du programme s'efface tant que la liste est ouverte (il dépasserait à droite du panneau)
    ui.classList.add('faded');
    Router.overlay(ov);
    render(idx);
    var cur = $('[data-ci="' + idx + '"]', ov.el);
    if (cur) Focus.set(cur); else Focus.first(ov.el);
    idle = idleClose(ov, 10000);
    ov.onClose = function () { idle.stop(); showUI(); };
    // les titres affichés peuvent dater : on les redemande à l'ouverture
    refreshNow(idx, function (j) {
      if (Router.overlays.indexOf(ov) < 0) return;
      if (j !== null) return updateRow(j);
      for (var k = start; k < Math.min(o.channels.length, start + WIN); k++) updateRow(k);
    });
  }

  /* fiche détaillée d'un programme, ouverte depuis la liste du guide */
  function progDetail(ch, p) {
    if (!p) return;
    var t = nowSec(), past = p.stop <= t, cur = p.start <= t && p.stop > t;
    var meta = [hhmm(p.start) + ' – ' + hhmm(p.stop), dur(p.stop - p.start)];
    if (p.categ) meta.push(p.categ);
    var actions = '';
    if (ch.archive && (past || cur)) {
      actions = '<div class="pd-actions"><div class="btn primary focusable" data-act="pd-replay" data-key="pd-replay" data-default>' +
        ICON.restart + tr(cur ? 'Depuis le début' : 'Voir en replay') + '</div></div>';
    }
    var ov = { el: el('<div class="panel pd">' +
      (p.image ? '<div class="pd-art"><img src="' + esc(API.img(p.image)) + '" alt="" onerror="this.parentNode.remove()"></div>' : '') +
      '<div class="pd-day">' + esc(dayLabel(p.start)) + '</div>' +
      '<h2>' + esc(p.title) + '</h2>' +
      '<div class="pd-meta">' + meta.map(esc).join(' <span style="opacity:.45">|</span> ') + '</div>' +
      '<div class="scroll-y pd-plot" data-pad="40">' + (p.desc ? esc(p.desc) : '<span style="color:var(--muted)">' + tr('Pas de résumé pour ce programme.') + '</span>') + '</div>' +
      actions + '</div>') };
    ov.onEnter = function (n) {
      if (n && n.getAttribute('data-act') === 'pd-replay') {
        Router.closeOverlay(); Router.closeOverlay();
        App.playReplay(ch, p);
        return;
      }
      Router.closeOverlay();
    };
    Router.overlay(ov);
    if (actions) Focus.first(ov.el);
  }
  /* ----- mosaïque : toutes les chaînes en vignettes, la chaîne en cours continue en petit ----- */
  function mosaic() {
    if (!live) return;
    var COLS = 4, numBuf2 = '', numT = null, focusedIdx = idx, ov = null, mzIdle = null;
    // une longue liste n'est jamais dessinée en entier : une fenêtre de vignettes autour de la sélection
    var WIN = 96, wStart = 0;
    var VIDEO = { x: 1236, y: 64, w: 588, h: 331 };
    function now0(c) {
      var t = nowSec();
      if (c.now && c.now.stop > t) return c.now;
      var p = (c.programmes || []).filter(function (x) { return x.stop > t; });
      if (p.length) { c.now = p[0]; c.next = p[1] || null; return c.now; }
      return null;
    }
    function tile(c, i) {
      var p = now0(c), here = i === idx;
      return '<div class="mz focusable' + (here ? ' playing' : '') + '" data-mi="' + i + '" data-key="mz:' + c.id + '">' +
        '<div class="mz-art" style="background:' + tint(c.id) + '">' +
        (p && p.image ? '<img loading="lazy" src="' + esc(API.img(p.image)) + '" alt="" onerror="this.remove()">' : '') +
        '<div class="mz-shade"></div>' + logoHTML(c, 'mz-logo') +
        '<span class="mz-num">' + esc(c.num || '') + '</span>' + srcBadge(c.src, 'tl') +
        (here ? '<span class="bdg live mz-live">' + tr('EN DIRECT') + '</span>' : '') +
        (p ? '<div class="bar"><i style="width:' + progPct(p) + '%;background:var(--accent)"></i></div>' : '') +
        '</div><div class="mz-t">' + esc(p ? p.title : tr('Rien au guide')) + '</div>' +
        '<div class="mz-c">' + esc(c.name) + (c.next ? ' · ' + tr('Ensuite') + ' ' + hhmm(c.next.start) : '') + '</div></div>';
    }
    function detail(i) {
      var c = o.channels[i], p = c && now0(c), box = $('.mz-detail', ov.el);
      if (!c || !box) return;
      box.innerHTML = '<div class="mz-kick">' + logoHTML(c, 'mz-dlogo') + '<span>' + esc((c.num ? c.num + ' · ' : '') + c.name) + '</span>' +
        srcBadge(c.src) + badgesHTML(c, null) + '</div>' +
        '<h2>' + esc(p ? p.title : c.name) + '</h2>' +
        '<div class="meta">' + (p ? esc(hhmm(p.start) + ' – ' + hhmm(p.stop)) + ' <span class="sep">|</span> ' +
          esc(tr('{d} restantes', { d: dur(Math.max(0, p.stop - nowSec())) })) + (p.categ ? ' <span class="sep">|</span> ' + esc(p.categ) : '') : esc(tr('Pas de guide pour cette chaîne'))) + '</div>' +
        (p ? '<div class="bar" style="width:520px"><i style="width:' + progPct(p) + '%;background:var(--accent)"></i></div>' : '') +
        '<p class="mz-desc">' + esc(p && p.desc ? p.desc : '') + '</p>' +
        (c.next ? '<div class="mz-next"><b>' + tr('Ensuite') + '</b> ' + esc(hhmm(c.next.start) + ' · ' + c.next.title) + '</div>' : '');
      // le programme manque encore : on le demande, puis on réaffiche si la vignette est toujours choisie
      if (!p && !c._asked) {
        c._asked = true;
        ensureNow(c, function () {
          if (!ov || focusedIdx !== i) return;
          detail(i);
          var n = $('[data-mi="' + i + '"]', ov.el); if (n) { var f = el(tile(c, i)); n.replaceWith(f); Focus.set(f, true); }
        });
      }
    }
    function close() {
      Player.setRect({ x: 0, y: 0, w: 1920, h: 1080 });
      document.body.classList.remove('mosaic-up');
      clearTimeout(numT);
    }
    function renderWindow(center) {
      var n = o.channels.length;
      wStart = Math.max(0, Math.min(center - Math.floor(WIN / 2), n - WIN));
      wStart -= wStart % COLS;                    // la grille garde ses colonnes en place
      if (wStart < 0) wStart = 0;
      $('.mz-row', ov.el).innerHTML = o.channels.slice(wStart, wStart + WIN).map(function (c, k) { return tile(c, wStart + k); }).join('');
    }
    function focusTile(i) {
      if (i < wStart || i >= wStart + WIN) renderWindow(i);
      var n = $('[data-mi="' + i + '"]', ov.el);
      if (n) Focus.set(n);
    }
    ov = { el: el('<div class="mosaic"><div class="mz-top"><div class="mz-detail"></div>' +
      '<div class="mz-video"><span class="mz-vlbl">' + tr('En cours de lecture') + '</span></div></div>' +
      '<div class="mz-grid scroll-y" data-pad="140"><div class="mz-row"></div></div>' +
      '<div class="hints"><span class="hint"><span class="key">OK</span>' + tr('Regarder') + '</span>' +
      '<span class="hint"><span class="key blue">' + tr('Bleu') + '</span>' + tr('Bouquet') + ' · ' + '<span class="mz-bq">' + esc(bouquetName()) + '</span></span>' +
      '<span class="hint"><span class="key">0-9</span>' + tr('Aller au numéro') + '</span>' +
      '<span class="hint"><span class="key yellow">' + tr('Jaune') + '</span>' + tr('Favori') + '</span>' +
      '<span class="hint"><span class="key">' + tr('Retour') + '</span>' + tr('Fermer') + '</span></div></div>') };
    ov.onEnter = function (n) {
      var i = n && n.getAttribute('data-mi');
      if (i === null || i === undefined) return;
      Router.closeOverlay();
      if (Number(i) !== idx) { setStatus(''); zap(0, Number(i)); }
    };
    ov.onKey = function (k) {
      if (mzIdle) mzIdle.reset();
      if (k === KEY.BLUE) {
        chooseBouquet(function () {
          renderWindow(idx); focusedIdx = idx;
          var b = $('.mz-bq', ov.el); if (b) b.textContent = bouquetName();
          var n = $('[data-mi="' + idx + '"]', ov.el); if (n) Focus.set(n); else Focus.first(ov.el);
          detail(idx);
          // les programmes du nouveau bouquet, chaîne par chaîne, comme à l'ouverture
          o.channels.forEach(function (c) { c._asked = false; });
        });
        return true;
      }
      if (k >= 48 && k <= 57) {
        numBuf2 += String(k - 48); Toast.show(tr('Chaîne {n}', { n: numBuf2 }), 1300);
        clearTimeout(numT);
        numT = setTimeout(function () {
          var i = o.channels.findIndex(function (c) { return String(c.num) === numBuf2; });
          numBuf2 = '';
          if (i < 0) { Toast.show(tr('Chaîne introuvable')); return; }
          focusTile(i);
        }, 1100);
        return true;
      }
      if (k === KEY.YELLOW) {
        var c = o.channels[focusedIdx];
        if (c) App.toggleFavChannel(c, function () { if (focusedIdx === idx) liveInfo(); });
        return true;
      }
      if (k === KEY.CH_UP || k === KEY.CH_DOWN) {
        focusTile(Math.max(0, Math.min(o.channels.length - 1, focusedIdx + (k === KEY.CH_UP ? COLS : -COLS))));
        return true;
      }
      return false;
    };
    // près du bord de la fenêtre dessinée, on la recentre pour continuer sans à-coup
    ov.onMove = function () {
      if (o.channels.length <= WIN) return;
      var near = focusedIdx < wStart + COLS * 2 && wStart > 0 ||
        focusedIdx >= wStart + WIN - COLS * 2 && wStart + WIN < o.channels.length;
      if (near) { var keep = focusedIdx; renderWindow(keep); var n = $('[data-mi="' + keep + '"]', ov.el); if (n) Focus.set(n, true); }
    };
    ov.onClose = function () { if (mzIdle) mzIdle.stop(); close(); showUI(); };
    ov.el.addEventListener('focused', function (e) {
      var i = e.target.getAttribute('data-mi');
      if (i !== null) { focusedIdx = Number(i); detail(focusedIdx); }
    });
    document.body.classList.add('mosaic-up');
    hideUI();
    Router.overlay(ov);
    mzIdle = idleClose(ov, 30000);
    Player.setRect(VIDEO);
    renderWindow(idx);
    var cur = $('[data-mi="' + idx + '"]', ov.el);
    if (cur) Focus.set(cur); else Focus.first(ov.el);
    detail(idx);
    // les programmes de toutes les chaînes, en une requête quand la liste vient d'une catégorie
    if (o.ctx) {
      API.get('/api/live?cat=' + encodeURIComponent(o.ctx.cat) + '&src=' + (o.ctx.src || 0)).then(function (d) {
        if (!ov || Router.top() !== ov) return;
        var by = {}; (d.channels || []).forEach(function (c) { by[c.id] = c; });
        o.channels.forEach(function (c, i) {
          var f = by[c.id]; if (!f) return;
          c.now = f.now; c.next = f.next;
          var n = $('[data-mi="' + i + '"]', ov.el);
          if (n) { var t = el(tile(c, i)); var had = Focus.current === n; n.replaceWith(t); if (had) Focus.set(t, true); }
        });
        detail(focusedIdx);
      }).catch(function () {});
    }
  }

  function tracksPanel() {
    var t = Player.tracks(), v = Player.videoInfo();
    var opt = function (type, index, label, sel) {
      return '<div class="opt focusable' + (sel ? ' sel' : '') + '" data-type="' + type + '" data-index="' + index + '"' +
        (sel ? ' data-default' : '') + '><span>' + esc(label) + '</span>' + (sel ? ICON.check : '') + '</div>';
    };
    var info = v.label ? '<div class="lbl">' + tr('Flux') + '</div><div class="opt">' + esc(v.label + (v.width ? '  ' + v.width + '×' + v.height : '')) +
      '<span class="t" style="width:auto">' + esc(codecName(v.codec) + (v.audio ? ' · ' + v.audio : '')) + '</span></div>' : '';
    var disp = Player.display || 'box';
    var html = info + '<div class="lbl">' + tr('Image') + '</div>' +
      opt('d', 'box', tr('Entière, avec des bandes noires'), disp === 'box') +
      opt('d', 'full', tr('Plein écran (étirée)'), disp === 'full') +
      opt('d', 'auto', tr('D’après la vidéo'), disp === 'auto') +
      '<div class="lbl">' + tr('Audio') + '</div>' +
      (t.audio.length ? t.audio.map(function (a) { return opt('a', a.index, a.label, a.index === t.curAudio); }).join('')
        : '<div class="opt">' + tr('Piste par défaut') + '</div>') +
      '<div class="lbl">' + tr('Sous-titres') + '</div>' + opt('t', -1, tr('Désactivés'), t.curText < 0) +
      t.text.map(function (a) { return opt('t', a.index, a.label, a.index === t.curText); }).join('');
    var ov = { el: el('<div class="panel"><h2>' + tr('Image, son et sous-titres') + '</h2><div class="scroll-y" data-pad="60">' + html + '</div></div>') };
    ov.onEnter = function (n) {
      var type = n.getAttribute('data-type'), index = Number(n.getAttribute('data-index'));
      if (type === 'd') {
        var mode = n.getAttribute('data-index');
        Player.setDisplay(mode); Store.set(displayKey(), mode);
        if (live) Store.set('ar.live', mode);   // la chaîne suivante jamais réglée part du dernier choix
        Router.closeOverlay(); return;
      }
      if (type === 'a') Player.selectAudio(index); else if (type === 't') Player.selectText(index);
      // dans une série, le choix suit les épisodes suivants
      if (o.mode === 'episode' && o.series && !o.extra) Store.set('trk.s.' + o.series.id, Player.currentLang());
      Router.closeOverlay();
    };
    ov.onClose = function () { showUI(); };
    Router.overlay(ov); showUI(true);
  }

  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    showUI(false, live ? !ui.classList.contains('compact') : undefined);
    if (act === 'toggle') { Player.toggle(); userPaused = !Player.isPlaying(); lastTick = Date.now(); setToggleIcon(); if (userPaused) showUI(true); }
    else if (act === 'home') { Router.back(); App.go('home'); }
    else if (act === 'pick') { setStatus(''); pickChannel(Number(n.getAttribute('data-cid'))); }
    else if (act === 'next') { setStatus(''); zap(1); }
    else if (act === 'rw') seekBy(replay ? -300 : -10);
    else if (act === 'ff') seekBy(replay ? 300 : 30);
    else if (act === 'retry') { retries = 0; quickRetried = false; setStatus(''); start(); }
    else if (act === 'guide') guidePanel();
    else if (act === 'mosaic') mosaic();
    else if (act === 'tracks') tracksPanel();
    else if (act === 'info') App.open('channel', o.channels[idx].id);
    else if (act === 'fav') App.toggleFavChannel(o.channels[idx], liveInfo);
    else if (act === 'startover') { var so = o.channels[idx]; if (so.now) App.playReplay(so, so.now); }
    else if (act === 'replay') Router.push(ReplayScreen(o.channels[idx]));
    else if (act === 'nextep') { save(); if (o.episodes[idx + 1]) { idx++; Player.stop(); start(); } }
    else if (act === 'quit') Router.back();
    else if (n.id === 'p-seek') { Player.toggle(); userPaused = !Player.isPlaying(); lastTick = Date.now(); setToggleIcon(); }
  };
  s.onKey = function (k) {
    var wasHidden = ui.classList.contains('faded');
    if (k === KEY.PLAY) { Player.resume(); userPaused = false; lastTick = Date.now(); setToggleIcon(); showUI(); return true; }
    if (k === KEY.PAUSE) { Player.pause(); userPaused = true; setToggleIcon(); showUI(true); return true; }
    if (k === KEY.PLAYPAUSE) { Player.toggle(); userPaused = !Player.isPlaying(); lastTick = Date.now(); setToggleIcon(); showUI(userPaused); return true; }
    if (k === KEY.STOP) { Router.back(); return true; }
    if (k === KEY.INFO) {
      if (live) { App.open('channel', o.channels[idx].id); return true; }
      if (wasHidden) showUI(); else { ui.classList.add('faded'); document.body.classList.remove('overlay-up'); }
      return true;
    }
    if (live) {
      /* Haut / P+ : chaîne suivante (1 → 2 → 3…), Bas / P- : précédente ; boucle aux extrémités */
      if (!Router.overlays.length && (k === KEY.CH_UP || (k === KEY.UP && wasHidden))) { setStatus(''); zap(1); return true; }
      if (!Router.overlays.length && (k === KEY.CH_DOWN || (k === KEY.DOWN && wasHidden))) { setStatus(''); zap(-1); return true; }
      if (k === KEY.GUIDE) { guidePanel(); return true; }
      if (k === KEY.YELLOW) { App.toggleFavChannel(o.channels[idx], liveInfo); return true; }
      if (k === KEY.GREEN && o.channels[idx].archive) { Router.push(ReplayScreen(o.channels[idx])); return true; }
      if (k >= 48 && k <= 57) {
        numBuf += String(k - 48); zapBox.textContent = numBuf; zapBox.classList.remove('hidden');
        clearTimeout(numTimer);
        numTimer = setTimeout(function () {
          var i = o.channels.findIndex(function (ch) { return String(ch.num) === numBuf; });
          numBuf = '';
          if (i < 0) { zapBox.classList.add('hidden'); Toast.show(tr('Chaîne introuvable')); } else zap(0, i);
        }, 1400);
        return true;
      }
    } else {
      if (moreOpen && !Router.overlays.length && (k === KEY.UP || k === KEY.BACK)) { closeMore(); return true; }
      if (!moreOpen && !Router.overlays.length && k === KEY.DOWN &&
          (wasHidden || !Focus.current || $('.p-ctl', s.el).contains(Focus.current))) {
        if (wasHidden || !Focus.valid()) Focus.set($('[data-act="toggle"]', s.el));
        openMore(); return true;
      }
      if (k === KEY.FF) { seekBy(replay ? 300 : 30); return true; }
      if (k === KEY.RW) { seekBy(replay ? -300 : -10); return true; }
      if (Focus.current && Focus.current.id === 'p-seek' && (k === KEY.LEFT || k === KEY.RIGHT)) {
        seekBy(k === KEY.LEFT ? (replay ? -60 : -10) : (replay ? 60 : 30)); return true;
      }
      if (k === KEY.CH_DOWN && o.mode === 'episode' && o.episodes[idx + 1]) { save(); idx++; Player.stop(); start(); return true; }
    }
    // en direct, gauche ouvre la liste rapide des chaînes, droite la mosaïque (bandeau replié ou caché)
    if (live && !Router.overlays.length && (wasHidden || ui.classList.contains('compact'))) {
      if (k === KEY.LEFT) { showUI(); zapPanel(); return true; }
      if (k === KEY.RIGHT) { mosaic(); return true; }
    }
    if (wasHidden && (k === KEY.ENTER || k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN)) { showUI(); return true; }
    // en direct : la barre discrète s'ouvre sur OK, et se referme sur Retour
    if (live) {
      if (k === KEY.LEFT && ui.classList.contains('compact')) { zapPanel(); return true; }
      if (k === KEY.ENTER && ui.classList.contains('compact')) { expandUI(); return true; }
      if ((k === KEY.UP || k === KEY.DOWN) && ui.classList.contains('compact')) { expandUI(); return true; }
      if (k === KEY.BACK && !ui.classList.contains('compact')) { collapseUI(); return true; }
    }
    showUI(false, live ? !ui.classList.contains('compact') : undefined);
    return false;
  };
  /* le guide ne charge les chaînes que par paquets de 50 : pour que Haut et Bas fassent
     le tour complet de la liste, on la redemande en entier, sans couper la lecture */
  function completeList() {
    var c = o.ctx;
    if (!live || !c || !(c.total > o.channels.length)) return;
    API.get('/api/live?cat=' + encodeURIComponent(c.cat) + '&src=' + (c.src || 0)).then(function (d) {
      if (!alive || !d.channels || d.channels.length <= o.channels.length) return;
      var have = {}, curId = o.channels[idx].id;
      o.channels.forEach(function (x) { have[x.id] = x; });
      o.channels = d.channels.map(function (x) { return have[x.id] || x; });
      var i = o.channels.findIndex(function (x) { return x.id === curId; });
      if (i >= 0) idx = i;
    }).catch(function () {});
  }
  s.show = function (returning) {
    if (returning) { start(); return; }
    var prev = Router.stack[Router.stack.length - 2];
    s.prevPlayingId = prev && prev.name === 'live' ? prev.playingId : null;
    start();
    completeList();
    epgTimer = setInterval(function () { if (live) refreshEpg(); }, 30000);
    watchdog = setInterval(function () {
      if (!alive || userPaused || Player.state === 'idle' || seekTarget !== null) return;
      if (Date.now() - lastTick > (live ? 10000 + Store.get('liveBuffer', 3) * 1000 : 30000)) failed(tr('le flux s’est figé'));
    }, 5000);
  };
  s.hide = function () { clearTimeout(retryTimer); clearTimeout(zapTimer); clearTimeout(seekTimer); Player.cb = {}; };
  s.destroy = function () {
    alive = false; save();
    [hideTimer, zapTimer, endTimer, seekTimer, retryTimer, healthyTimer, infoTimer].forEach(clearTimeout);
    clearInterval(epgTimer); clearInterval(watchdog);
    document.body.classList.remove('overlay-up');
    Player.stop();
    if (!live) Now.clear();
  };
  s.suspend = function () { save(); Player.suspend(); };
  s.resume = function () { Player.restore(); lastTick = Date.now(); showUI(); };
  return s;
}

/* =====================================================================
   REPLAY D'UNE CHAÎNE
   ===================================================================== */
function ReplayScreen(ch) {
  var s = baseScreen('replay', headerHTML('live') +
    '<div class="page-top"><div class="icon-btn focusable" data-act="back" aria-label="' + tr('Retour') + '">' + ICON.back + '</div>' +
    logoHTML(ch) + '<h1>' + tr('Replay · {n}', { n: esc(ch.name) }) + '</h1>' +
    '<div class="chips" data-group="days" data-nav-down="progs"><div class="row"></div></div></div>' +
    '<div class="grid-wrap scroll-y" data-pad="100"><div class="replay-list" data-group="progs" data-nav-up="days"></div></div>' +
    '<div class="state"></div>');
  var progs = [], days = [], day = null, list = $('.replay-list', s.el), state = $('.state', s.el);
  function dayKey(ts) { var d = new Date(ts * 1000); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function load() {
    state.innerHTML = loadingHTML(); state.classList.remove('hidden');
    API.get('/api/replay?id=' + ch.id).then(function (d) {
      progs = d.programmes; state.classList.add('hidden');
      var seen = {}; days = [];
      progs.forEach(function (p) { var k = dayKey(p.start); if (!seen[k]) { seen[k] = 1; days.push({ key: k, ts: p.start }); } });
      if (!progs.length) { state.innerHTML = tr('Aucun programme en replay pour le moment.'); state.classList.remove('hidden'); return; }
      day = days[0].key;
      $('.chips .row', s.el).innerHTML = days.map(function (x) {
        return '<div class="chip focusable' + (x.key === day ? ' active' : '') + '" data-day="' + x.key + '">' +
          esc(dayName(x.ts)) + '</div>';
      }).join('');
      renderDay();
      Focus.first(list);
    }).catch(function (e) { state.innerHTML = errorHTML(e.message); state.classList.remove('hidden'); Focus.first(state); });
  }
  function renderDay() {
    var t = nowSec();
    list.innerHTML = progs.map(function (p, i) {
      if (dayKey(p.start) !== day) return '';
      var onAir = p.stop > t;
      return '<div class="rp-row focusable' + (p.available ? '' : ' unavailable') + '" data-idx="' + i + '">' +
        '<div class="rp-time">' + hhmm(p.start) + '<small>' + dur(p.stop - p.start) + '</small></div>' +
        (p.image ? '<div class="rp-img"><img loading="lazy" src="' + esc(API.img(p.image)) + '" alt="" onerror="this.remove()"></div>' : '') +
        '<div class="rp-body"><div class="rp-title">' + esc(p.title || tr('Programme')) + '</div>' +
        (p.desc ? '<div class="rp-desc">' + esc(p.desc) + '</div>' : '') + '</div>' +
        (onAir ? '<span class="bdg red">' + tr('EN COURS') + '</span>' : (p.available ? '' : '<span class="rp-na">' + tr('Non disponible') + '</span>')) +
        '</div>';
    }).join('');
    $('.grid-wrap', s.el).scrollTop = 0;
  }
  s.el.addEventListener('focused', function (e) {
    var n = e.target;
    if (n.hasAttribute('data-day') && n.getAttribute('data-day') !== day) {
      day = n.getAttribute('data-day');
      $$('.chip', s.el).forEach(function (c) { c.classList.toggle('active', c === n); });
      renderDay();
    }
  });
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'back') return Router.back();
    if (act === 'retry') return load();
    if (n.classList.contains('rp-row')) {
      var p = progs[Number(n.getAttribute('data-idx'))];
      if (!p.available) { Toast.show(tr('Ce programme n’est pas enregistré par votre fournisseur')); return; }
      App.playReplay(ch, p);
    }
  };
  s.show = function (returning) { if (!returning) load(); };
  return s;
}

/* =====================================================================
   FILMS / SÉRIES (catalogue)
   ===================================================================== */
function CatalogScreen(kind) {
  var isVod = kind === 'vod';
  var s = baseScreen(kind, headerHTML(kind) +
    '<div class="page-top"><div class="chips" data-group="chips" data-nav-down="grid"><div class="row"></div></div></div>' +
    '<div class="grid-wrap scroll-y" data-pad="80"><div class="grid" data-group="grid" data-nav-up="chips"></div></div>' +
    '<div class="state hidden"></div>');
  var chips = $('.chips .row', s.el), grid = $('.grid', s.el), wrap = $('.grid-wrap', s.el), state = $('.state', s.el);
  var cat = 'all', items = [], total = 0, loading = false, req = 0, firstLoad = true;
  var path = isVod ? '/api/vod' : '/api/series';

  function loadCats() {
    API.get('/api/categories?kind=' + kind).then(function (d) {
      chips.innerHTML = [{ id: 'all', name: tr(isVod ? 'Tous les films' : 'Toutes les séries') }].concat(d).map(function (c) {
        return '<div class="chip focusable' + (c.id === cat ? ' active' : '') + '" data-cat="' + esc(c.id) + '" data-key="cat:' + esc(c.id) + '">' +
          (c.src ? srcBadge(c.src, 'inline') : '') + esc(c.name) + lockMark(c) + '</div>';
      }).join('');
    }).catch(function () {});
  }
  function load(reset) {
    if (loading && !reset) return;
    if (reset) { items = []; total = 0; grid.innerHTML = ''; wrap.scrollTop = 0; state.innerHTML = loadingHTML(); state.classList.remove('hidden'); }
    loading = true;
    var my = ++req;
    API.get(path + '?cat=' + encodeURIComponent(cat) + '&offset=' + items.length + '&limit=70').then(function (d) {
      if (my !== req) return;
      loading = false; state.classList.add('hidden');
      var start = items.length;
      if (reset && cat === 'all') {
        grid.insertAdjacentHTML('beforeend',
          tileHTML('history', ICON.history, tr('Historique'), tr(isVod ? 'Films déjà vus ou commencés' : 'Séries déjà vues ou en cours')) +
          tileHTML('later', ICON.bookmark, tr('À regarder plus tard'), tr(isVod ? 'Vos favoris et films mis de côté' : 'Vos favoris et séries mises de côté')));
      }
      items = items.concat(d.items); total = d.total;
      grid.insertAdjacentHTML('beforeend', d.items.map(function (it, i) {
        return posterHTML(it, start + i, isVod ? (it.progress && !it.progress.done ? remainingLabel(it.progress) : '') : (it.genre || ''));
      }).join(''));
      if (reset) {
        if (!items.length) { state.innerHTML = tr('Rien dans cette catégorie.'); state.classList.remove('hidden'); }
        if (firstLoad || !Focus.valid() || Focus.current.closest('.grid')) Focus.first(grid);
        firstLoad = false;
      }
    }).catch(function (e) {
      loading = false;
      if (reset) { state.innerHTML = errorHTML(e.message); state.classList.remove('hidden'); Focus.first(state); }
    });
  }
  s.el.addEventListener('focused', function (e) {
    var i = Number(e.target.getAttribute('data-idx'));
    if (e.target.classList.contains('poster') && i > items.length - 22 && items.length < total) load(false);
  });
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'retry') return load(true);
    if (n.classList.contains('chip')) {
      cat = n.getAttribute('data-cat');
      $$('.chip', s.el).forEach(function (c) { c.classList.toggle('active', c === n); });
      load(true); return;
    }
    if (act === 'history') return Router.push(HistoryScreen(isVod ? 'movies' : 'series'));
    if (act === 'later') return Router.push(WatchlistScreen(isVod ? 'movies' : 'series'));
    if (act === 'open') { var it = items[Number(n.getAttribute('data-idx'))]; if (it) App.open(it.kind, it.id); }
  };
  s.onKey = function (k) {
    var n = Focus.current;
    if (k === KEY.BLUE && n && n.classList.contains('chip') && n.getAttribute('data-cat') !== 'all') {
      var cid = n.getAttribute('data-cat');
      API.get('/api/categories?kind=' + kind).then(function (d) {
        var c0 = d.filter(function (c) { return c.id === cid; })[0];
        if (c0) renameCategory(kind, c0, loadCats);
      });
      return true;
    }
    if (k === KEY.YELLOW && n && n.getAttribute('data-act') === 'open') {
      var it = items[Number(n.getAttribute('data-idx'))];
      App.toggleWatchlist(it, function () { var f = el(posterHTML(it, Number(n.getAttribute('data-idx')), '')); n.replaceWith(f); Focus.set(f, true); });
      return true;
    }
    return false;
  };
  s.show = function (returning) {
    if (!returning) { loadCats(); load(true); return; }
    API.get(path + '?cat=' + encodeURIComponent(cat) + '&offset=0&limit=' + Math.min(200, items.length || 1)).then(function (d) {
      d.items.forEach(function (it, i) {
        var old = items[i]; if (!old || old.id !== it.id) return;
        items[i] = it;
        var n = grid.querySelector('[data-idx="' + i + '"]');
        if (n && (JSON.stringify(old.progress) !== JSON.stringify(it.progress) || old.fav !== it.fav)) {
          var f = el(posterHTML(it, i, isVod ? (it.progress && !it.progress.done ? remainingLabel(it.progress) : '') : (it.genre || '')));
          var had = Focus.current === n; n.replaceWith(f); if (had) Focus.set(f, true);
        }
      });
    }).catch(function () {});
  };
  return s;
}

/* =====================================================================
   FICHE FILM
   ===================================================================== */
function MovieScreen(id) {
  var s = baseScreen('movie', '<div class="backdrop"></div>' + headerHTML('vod') +
    '<div class="crumb">' + ICON.back + tr('Films') + '</div><div class="detail"></div><div class="state"></div>');
  var m = null, box = $('.detail', s.el), state = $('.state', s.el);
  function load() {
    state.innerHTML = loadingHTML(); state.classList.remove('hidden');
    API.get('/api/movie?id=' + id + '&maxh=' + maxQuality()).then(function (d) { m = d; state.classList.add('hidden'); keepFocus(s.el, render); })
      .catch(function (e) { state.innerHTML = errorHTML(e.message); state.classList.remove('hidden'); Focus.first(state); });
  }
  function render() {
    var p = m.progress, resumable = p && !p.done && p.position > 30;
    $('.backdrop', s.el).style.backgroundImage = m.backdrop ? 'url("' + API.img(m.backdrop) + '")' : '';
    var meta = [m.year, m.genre, dur(m.duration), fmtRating(m.rating) ? '★ ' + fmtRating(m.rating) : ''].filter(Boolean)
      .map(esc).join(' <span class="sep">|</span> ');
    box.innerHTML = (m.logo ? '<h1 class="has-logo"><img class="title-logo" src="' + esc(API.img(m.logo)) + '" alt="' + esc(m.name) +
        '" onerror="var h=this.parentNode;h.classList.remove(\'has-logo\');h.textContent=this.alt"></h1>' : '<h1>' + esc(m.name) + '</h1>') +
      '<div class="meta">' + meta + '</div>' +
      (m.plot ? '<p class="plot">' + esc(m.plot) + '</p>' : '') +
      (m.director || m.cast ? '<div class="meta" style="font-size:19px">' +
        esc([m.director ? tr('Réalisation : {n}', { n: m.director }) : '', m.cast ? tr('Avec : {n}', { n: m.cast }) : ''].filter(Boolean).join(' · ')).slice(0, 220) + '</div>' : '') +
      (resumable ? '<div style="display:flex;align-items:center;gap:16px"><div class="bar" style="width:440px"><i style="width:' + p.pct + '%"></i></div>' +
        '<span class="meta" style="font-size:19px">' + esc(remainingLabel(p)) + '</span></div>' : '') +
      '<div class="actions" data-group="act"><button class="btn focusable" data-default data-act="play" data-key="play">' +
      ICON.play + tr(resumable ? 'Reprendre' : 'Regarder') + '</button>' +
      (resumable ? '<button class="btn focusable" data-act="restart" data-key="restart">' + tr('Depuis le début') + '</button>' : '') +
      (m.local_trailer || m.trailer ? '<button class="btn focusable" data-act="trailer" data-key="trailer">' + ICON.film + tr('Bande-annonce') + '</button>' : '') +
      versionButtonHTML(m) + extrasButtonHTML(m) +
      libButtonHTML(m.library) +
      '<button class="btn square focusable' + (m.watchlist ? ' on' : '') + '" data-act="later" data-key="later" aria-label="' + tr('À regarder plus tard') + '">' +
      (m.watchlist ? ICON.bookmarkFill : ICON.bookmark) + '</button>' +
      '<button class="btn square focusable' + (m.fav ? ' on' : '') + '" data-act="fav" data-key="fav" aria-label="' + tr('Favori') + '">' +
      (m.fav ? ICON.starFill : ICON.star) + '</button></div>';
  }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'retry') return load();
    if (act === 'play') App.playMovie(m);
    if (act === 'restart') App.playMovie(m, true);
    if (act === 'trailer') {
      // la bande-annonce posée à côté du film passe avant celle de YouTube
      if (m.local_trailer) App.playExtra(m, { id: m.local_trailer, title: 'Bande-annonce', kind: 'trailer' });
      else openTrailer(m.trailer, m.name);
    }
    if (act === 'extras') extrasPanel(m);
    if (act === 'later') App.toggleWatchlist(m, function () { keepFocus(s.el, render); });
    if (act === 'fav') App.toggleFav(m, function () { keepFocus(s.el, render); });
    if (act === 'library') libraryAction('movie', m, function () { keepFocus(s.el, render); });
    if (act === 'version') versionPanel(m, load);
  };
  s.onKey = function (k) { if (k === KEY.YELLOW && m) { App.toggleWatchlist(m, function () { keepFocus(s.el, render); }); return true; } return false; };
  s.show = function () { load(); };
  return s;
}

/* =====================================================================
   FICHE SÉRIE
   ===================================================================== */
function SeriesScreen(id) {
  var s = baseScreen('serie', '<div class="backdrop" style="height:760px"></div>' + headerHTML('series') +
    '<div class="crumb">' + ICON.back + tr('Séries') + '</div><div class="detail"></div>' +
    '<div class="seasons"><div class="chips" data-group="seasons" data-nav-down="eps" data-nav-up="act"><div class="row"></div></div></div>' +
    '<div class="episodes scroll-x" data-group="eps" data-padx="96" data-nav-up="seasons" data-nav-down="stop"><div class="row"></div></div>' +
    '<div class="state"></div>');
  var d = null, flat = [], season = null, box = $('.detail', s.el), state = $('.state', s.el);
  function load() {
    state.innerHTML = loadingHTML(); state.classList.remove('hidden');
    API.get('/api/series/detail?id=' + id).then(function (r) {
      d = r; flat = flattenEpisodes(d); state.classList.add('hidden');
      if (season === null) season = d.resume ? d.resume.season : (d.seasons[0] ? d.seasons[0].season : null);
      keepFocus(s.el, render);
    }).catch(function (e) { state.innerHTML = errorHTML(e.message); state.classList.remove('hidden'); Focus.first(state); });
  }
  function resumeIndex() {
    if (!d.resume) return 0;
    var i = flat.findIndex(function (e) { return e.id === d.resume.episode_id; });
    return i < 0 ? 0 : i;
  }
  function render() {
    $('.backdrop', s.el).style.backgroundImage = d.backdrop ? 'url("' + API.img(d.backdrop) + '")' : '';
    var r = d.resume, label = r ? tr('{l} S{s} · É{e}', { l: tr(r.next ? 'Regarder' : 'Reprendre'), s: r.season, e: r.episode }) : tr('Regarder');
    var meta = [d.seasons.length ? tr(d.seasons.length > 1 ? '{n} saisons' : '{n} saison', { n: d.seasons.length }) : '', d.genre,
      fmtRating(d.rating) ? '★ ' + fmtRating(d.rating) : ''].filter(Boolean).map(esc).join(' <span class="sep">|</span> ');
    box.innerHTML = (d.logo ? '<h1 class="has-logo"><img class="title-logo sm" src="' + esc(API.img(d.logo)) + '" alt="' + esc(d.name) +
        '" onerror="var h=this.parentNode;h.classList.remove(\'has-logo\');h.style.fontSize=\'64px\';h.textContent=this.alt"></h1>'
        : '<h1 style="font-size:64px">' + esc(d.name) + '</h1>') + '<div class="meta">' + meta + '</div>' +
      (d.plot ? '<p class="plot" style="-webkit-line-clamp:2">' + esc(d.plot) + '</p>' : '') +
      (d.director || d.cast ? '<div class="meta" style="font-size:19px">' +
        esc([d.director ? tr('Création : {n}', { n: d.director }) : '', d.cast ? tr('Avec : {n}', { n: d.cast }) : ''].filter(Boolean).join(' · ').slice(0, 200)) + '</div>' : '') +
      '<div class="actions" data-group="act" data-nav-down="seasons">' +
      (flat.length ? '<button class="btn focusable" data-default data-act="play" data-key="play">' + ICON.play + esc(label) + '</button>' : '') +
      (r ? '<button class="btn focusable" data-act="restart" data-key="restart">' + tr('Depuis le début') + '</button>' : '') +
      (d.local_trailer || d.trailer ? '<button class="btn focusable" data-act="trailer" data-key="trailer">' + ICON.film + tr('Bande-annonce') + '</button>' : '') +
      extrasButtonHTML(d) +
      libButtonHTML(d.library) +
      '<button class="btn square focusable' + (d.watchlist ? ' on' : '') + '" data-act="later" data-key="later" aria-label="' + tr('À regarder plus tard') + '">' +
      (d.watchlist ? ICON.bookmarkFill : ICON.bookmark) + '</button>' +
      '<button class="btn square focusable' + (d.fav ? ' on' : '') + '" data-act="fav" data-key="fav" aria-label="' + tr('Favori') + '">' +
      (d.fav ? ICON.starFill : ICON.star) + '</button></div>';
    $('.seasons .row', s.el).innerHTML = d.seasons.map(function (x) {
      return '<div class="chip focusable' + (x.season === season ? ' active' : '') + '" data-season="' + x.season + '" data-key="season:' + x.season + '">' + tr('Saison {n}', { n: x.season }) + '</div>';
    }).join('');
    renderEpisodes();
    if (!flat.length) { state.innerHTML = tr('Aucun épisode disponible pour l’instant.'); state.classList.remove('hidden'); }
  }
  function renderEpisodes() {
    var sea = d.seasons.filter(function (x) { return x.season === season; })[0];
    var row = $('.episodes .row', s.el);
    $('.episodes', s.el).scrollLeft = 0;
    row.innerHTML = sea ? sea.episodes.map(function (e) {
      var p = e.progress, cur = d.resume && d.resume.episode_id === e.id;
      return '<div class="ep focusable' + (cur ? ' current' : '') + '" data-ep="' + e.id + '" data-key="ep:' + e.id + '">' +
        '<div class="art" style="background:' + tint(e.id) + '"><span class="num">' + e.episode + '</span>' +
        (e.thumb ? '<img loading="lazy" src="' + esc(API.img(e.thumb)) + '" alt="" onerror="this.remove()">' : '') +
        (p ? '<div class="bar"><i style="width:' + p.pct + '%"></i></div>' : '') + '</div>' +
        '<div class="t1">' + esc(e.title ? tr('É{e} · {t}', { e: e.episode, t: e.title }) : tr('Épisode {n}', { n: e.episode })) + '</div>' +
        '<div class="t2">' + esc(p && p.done ? tr('Vu') + (e.duration ? ' · ' + dur(e.duration) : '') : p ? remainingLabel(p) : dur(e.duration)) + '</div></div>';
    }).join('') : '';
  }
  s.el.addEventListener('focused', function (e) {
    var n = e.target;
    if (n.hasAttribute('data-season')) {
      var sn = Number(n.getAttribute('data-season'));
      if (sn !== season) {
        season = sn;
        $$('.seasons .chip', s.el).forEach(function (c) { c.classList.toggle('active', c === n); });
        renderEpisodes();
      }
    }
  });
  function series() { return { id: d.id, name: d.name, backdrop: d.backdrop }; }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'retry') return load();
    if (act === 'play') return App.playEpisodes(series(), flat, resumeIndex());
    if (act === 'restart') return App.playEpisodes(series(), flat, 0, true);
    if (act === 'trailer') return d.local_trailer ? App.playExtra(d, { id: d.local_trailer, title: 'Bande-annonce', kind: 'trailer' })
                                                  : openTrailer(d.trailer, d.name);
    if (act === 'extras') return extrasPanel(d);
    if (act === 'later') return App.toggleWatchlist(d, function () { keepFocus(s.el, render); });
    if (act === 'fav') return App.toggleFav(d, function () { keepFocus(s.el, render); });
    if (act === 'library') return libraryAction('series', d, function () { keepFocus(s.el, render); });
    if (n.hasAttribute('data-ep')) {
      var epId = Number(n.getAttribute('data-ep'));
      var i = flat.findIndex(function (e) { return e.id === epId; });
      App.playEpisodes(series(), flat, i, !!(flat[i].progress && flat[i].progress.done));
    }
  };
  s.onKey = function (k) { if (k === KEY.YELLOW && d) { App.toggleWatchlist(d, function () { keepFocus(s.el, render); }); return true; } return false; };
  s.show = function () { load(); };
  return s;
}

/* =====================================================================
   HISTORIQUE
   ===================================================================== */
function HistoryScreen(initial) {
  var FILTERS = [['all', 'Tout'], ['progress', 'En cours'], ['done', 'Terminés'], ['movies', 'Films'], ['series', 'Séries']];
  var s = baseScreen('history', headerHTML('') +
    '<div class="page-top"><div class="icon-btn focusable" data-act="back" aria-label="' + tr('Retour') + '">' + ICON.back + '</div>' +
    '<div class="tile-icon" style="width:52px;height:52px">' + ICON.history + '</div><h1>' + tr('Historique') + '</h1>' +
    '<div class="chips" data-group="chips" data-nav-down="grid"><div class="row">' + FILTERS.map(function (f) {
      return '<div class="chip focusable' + (f[0] === initial ? ' active' : '') + '" data-filter="' + f[0] + '" data-key="f:' + f[0] + '">' + tr(f[1]) + '</div>';
    }).join('') + '</div></div>' +
    '<div class="btn focusable" data-act="clear" style="height:56px;font-size:20px">' + ICON.trash + tr('Effacer') + '</div></div>' +
    '<div class="grid-wrap scroll-y" data-pad="80"><div class="grid" data-group="grid" data-nav-up="chips"></div></div>' +
    '<div class="state hidden"></div>' +
    '<div class="hints right"><span class="hint"><span class="key">OK</span>' + tr('Reprendre') + '</span>' +
    '<span class="hint"><span class="key red">' + tr('Rouge') + '</span>' + tr('Retirer') + '</span></div>');
  var filter = initial || 'all', items = [], grid = $('.grid', s.el), state = $('.state', s.el);
  function sub(it) {
    var where = it.kind === 'series' && it.season ? tr('S{s} · É{e}', { s: it.season, e: it.episode }) + ' · ' : (it.kind === 'movie' ? tr('Film · ') : '');
    var p = it.progress;
    return where + (p.done ? tr('terminé ') : (p.remaining ? tr('{d} restantes · ', { d: dur(p.remaining) }) : '')) + dayLabel(it.updated);
  }
  function load() {
    state.innerHTML = loadingHTML(); state.classList.remove('hidden');
    API.get('/api/history?filter=' + filter).then(function (d) {
      items = d.items; state.classList.add('hidden'); keepFocus(s.el, render);
    }).catch(function (e) { state.innerHTML = errorHTML(e.message); state.classList.remove('hidden'); Focus.first(state); });
  }
  function render() {
    var week = nowSec() - 7 * 86400, html = '', lastGroup = null;
    items.forEach(function (it, i) {
      var g = tr(it.updated >= week ? 'Cette semaine' : 'Plus tôt');
      if (g !== lastGroup) { html += '<div class="grid-title">' + g + '</div>'; lastGroup = g; }
      html += posterHTML(it, i, sub(it)).replace('data-key="', 'data-key="h-');
    });
    grid.innerHTML = html;
    var f0 = grid.querySelector('.poster'); if (f0) f0.setAttribute('data-default', '');
    if (!items.length) { state.innerHTML = tr('Rien dans l’historique pour l’instant.'); state.classList.remove('hidden'); }
  }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'retry') return load();
    if (act === 'back') return Router.back();
    if (act === 'clear') {
      return confirmDialog(tr('Effacer l’historique ?'), tr('Toute la progression de lecture sera supprimée. Les listes et favoris sont conservés.'), tr('Effacer'), function () {
        API.del('/api/history').then(function () { Toast.show(tr('Historique effacé')); load(); }).catch(function (e) { Toast.show(e.message); });
      });
    }
    if (n.hasAttribute('data-filter')) {
      filter = n.getAttribute('data-filter');
      $$('.chip', s.el).forEach(function (c) { c.classList.toggle('active', c === n); });
      return load();
    }
    if (act === 'open') {
      var it = items[Number(n.getAttribute('data-idx'))]; if (!it) return;
      if (it.kind === 'movie') App.playMovie(it, it.progress.done); else App.resumeSeries(it.id);
    }
  };
  s.onKey = function (k) {
    var n = Focus.current;
    if (k === KEY.RED && n && n.getAttribute('data-act') === 'open') {
      var it = items[Number(n.getAttribute('data-idx'))];
      API.del('/api/history?kind=' + it.kind + '&id=' + it.id).then(function () {
        Toast.show(tr('« {n} » retiré de l’historique', { n: it.name }));
        items.splice(items.indexOf(it), 1);
        render();
        if (!Focus.valid()) Focus.first();
      }).catch(function (e) { Toast.show(e.message); });
      return true;
    }
    return false;
  };
  s.show = function () { load(); };
  return s;
}

/* =====================================================================
   À REGARDER PLUS TARD
   ===================================================================== */
function WatchlistScreen(initial) {
  var FILTERS = [['all', 'Tout'], ['fav', 'Favoris'], ['movies', 'Films'], ['series', 'Séries']];
  var s = baseScreen('later', headerHTML('') +
    '<div class="page-top"><div class="icon-btn focusable" data-act="back" aria-label="' + tr('Retour') + '">' + ICON.back + '</div>' +
    '<div class="tile-icon" style="width:52px;height:52px">' + ICON.bookmark + '</div><h1>' + tr('À regarder plus tard') + '</h1>' +
    '<div class="chips" data-group="chips" data-nav-down="grid"><div class="row">' + FILTERS.map(function (f) {
      return '<div class="chip focusable' + (f[0] === initial ? ' active' : '') + '" data-filter="' + f[0] + '" data-key="f:' + f[0] + '">' + tr(f[1]) + '</div>';
    }).join('') + '</div></div>' +
    '<div class="btn focusable" data-act="sort" style="height:56px;font-size:20px">' + ICON.sort + '<span id="sortlbl"></span></div></div>' +
    '<div class="grid-wrap scroll-y" data-pad="80"><div class="grid" data-group="grid" data-nav-up="chips"></div></div>' +
    '<div class="state hidden"></div>' +
    '<div class="hints right"><span class="hint"><span class="key">OK</span>' + tr('Ouvrir') + '</span>' +
    '<span class="hint"><span class="key yellow">' + tr('Jaune') + '</span>' + tr('Favori') + '</span>' +
    '<span class="hint"><span class="key red">' + tr('Rouge') + '</span>' + tr('Retirer') + '</span></div>');
  var filter = initial || 'all', sort = Store.get('laterSort', 'added'), items = [], grid = $('.grid', s.el), state = $('.state', s.el);
  function label() { $('#sortlbl', s.el).textContent = tr(sort === 'added' ? 'Date d’ajout' : 'Titre (A-Z)'); }
  function load() {
    label();
    state.innerHTML = loadingHTML(); state.classList.remove('hidden');
    API.get('/api/watchlist?filter=' + filter + '&sort=' + sort).then(function (d) {
      items = d.items; state.classList.add('hidden'); keepFocus(s.el, render);
    }).catch(function (e) { state.innerHTML = errorHTML(e.message); state.classList.remove('hidden'); Focus.first(state); });
  }
  function render() {
    grid.innerHTML = items.map(function (it, i) {
      it.watchlist = true;
      return posterHTML(it, i, tr('{k} · ajouté {d}', { k: tr(it.kind === 'movie' ? 'Film' : 'Série'), d: dayLabel(it.added) }));
    }).join('');
    var f0 = grid.querySelector('.poster'); if (f0) f0.setAttribute('data-default', '');
    if (!items.length) {
      state.innerHTML = tr('Votre liste est vide. Sur une fiche, choisissez le signet ou appuyez sur la touche jaune.');
      state.classList.remove('hidden');
    }
  }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'retry') return load();
    if (act === 'back') return Router.back();
    if (act === 'sort') { sort = sort === 'added' ? 'name' : 'added'; Store.set('laterSort', sort); return load(); }
    if (n.hasAttribute('data-filter')) {
      filter = n.getAttribute('data-filter');
      $$('.chip', s.el).forEach(function (c) { c.classList.toggle('active', c === n); });
      return load();
    }
    if (act === 'open') { var it = items[Number(n.getAttribute('data-idx'))]; if (it) App.open(it.kind, it.id); }
  };
  s.onKey = function (k) {
    var n = Focus.current;
    if (!n || n.getAttribute('data-act') !== 'open') return false;
    var it = items[Number(n.getAttribute('data-idx'))];
    if (k === KEY.YELLOW) { App.toggleFav(it, function () { if (filter === 'fav' && !it.fav) load(); else keepFocus(s.el, render); }); return true; }
    if (k === KEY.RED) {
      API.del('/api/watchlist?kind=' + it.kind + '&id=' + it.id).then(function () {
        Toast.show(tr('« {n} » retiré de la liste', { n: it.name })); load();
      }).catch(function (e) { Toast.show(e.message); });
      return true;
    }
    return false;
  };
  s.show = function () { load(); };
  return s;
}

/* =====================================================================
   BIBLIOTHÈQUE : votre sélection, rangée dans vos catégories
   ===================================================================== */
/* bonus du film (dossiers « Deleted Scenes », « Interviews »… ou fichiers « -featurette ») */
function extrasButtonHTML(m) {
  var n = (m.extras || []).filter(function (e) { return e.kind !== 'trailer' || e.id !== m.local_trailer; }).length;
  if (!n) return '';
  return '<button class="btn focusable" data-act="extras" data-key="extras">' + tr('Bonus') + '<span class="ver-n">' + n + '</span></button>';
}
var EXTRA_KIND = { trailer: 'Bande-annonce', sample: 'Extrait', featurette: 'Making-of', behindthescenes: 'Coulisses',
                   deleted: 'Scène coupée', interview: 'Interview', scene: 'Scène', short: 'Court métrage', extra: 'Bonus' };
function extrasPanel(m) {
  var ov = { el: el('<div class="panel"><h2>' + esc(m.name) + '</h2><div class="lbl">' + tr('Bonus') + '</div>' +
    '<div class="scroll-y" data-pad="60">' +
    m.extras.map(function (e, i) {
      var sub = [tr(EXTRA_KIND[e.kind] || 'Bonus'), e.duration ? dur(e.duration) : '',
                 e.playable ? '' : tr('Format non lu par le téléviseur')].filter(Boolean).join(' · ');
      return '<div class="opt focusable' + (e.playable ? '' : ' dim') + '" data-i="' + i + '"' + (i ? '' : ' data-default') + '>' +
        '<span>' + esc(tr(e.title)) + '<small class="t2">' + esc(sub) + '</small></span>' + ICON.play + '</div>';
    }).join('') + '</div></div>') };
  ov.onEnter = function (n) {
    var i = n.getAttribute('data-i');
    if (i === null) return;
    Router.closeOverlay();
    App.playExtra(m, m.extras[Number(i)]);
  };
  Router.overlay(ov);
}

/* film en plusieurs versions (4K, 1080p…) : le bouton de la fiche, et le choix */
/* note sur 10, une décimale (« 6,0 » ; « 6.0 » en anglais) */
function fmtRating(r) {
  var n = parseFloat(String(r).replace(',', '.'));
  if (!isFinite(n) || n <= 0) return '';
  return n.toFixed(1).replace('.', LANG === 'en' ? '.' : ',');
}
function versionButtonHTML(m) {
  if (!m.versions || m.versions.length < 2) return '';
  var v = m.versions.filter(function (x) { return x.id === m.version; })[0] || m.versions[0];
  return '<button class="btn focusable" data-act="version" data-key="version">' + esc(v.label) +
    '<span class="ver-n">' + tr('{n} versions', { n: m.versions.length }) + '</span></button>';
}
function versionPanel(m, onDone) {
  var auto = !m.version_pref;
  // ce que donnerait le choix automatique, avec la limite des réglages
  var lim = maxQuality(), ok = m.versions.filter(function (x) { return x.playable; });
  var under = ok.filter(function (x) { return !lim || x.tier <= lim; });
  var best = under[0] || ok.slice().sort(function (a, b) { return a.tier - b.tier; })[0] || m.versions[0];
  var go = function (file) {
    Router.closeOverlay();
    API.post('/api/movie/version', { id: m.id, file: file }).then(function () {
      Toast.show(file ? tr('Ce film démarrera dans cette version') : tr('Version automatique : la meilleure lisible'));
      if (onDone) onDone();
    }).catch(function (e) { Toast.show(e.message); });
  };
  var ov = { el: el('<div class="panel"><h2>' + esc(m.name) + '</h2><div class="lbl">' + tr('Version qui démarre') + '</div>' +
    '<div class="scroll-y" data-pad="60">' +
    '<div class="opt focusable' + (auto ? ' sel' : '') + '" data-file="0"' + (auto ? ' data-default' : '') + '><span>' + tr('Automatique') +
    '<small class="t2">' + esc(qualityLabel(lim) + (best ? ' · ' + tr('ici {v}', { v: best.label }) : '')) + '</small></span>' + (auto ? ICON.check : '') + '</div>' +
    m.versions.map(function (v) {
      var on = v.id === m.version_pref;
      var sub = [(v.size ? (v.size >= 1e9 ? (v.size / 1e9).toFixed(1).replace('.', LANG === 'en' ? '.' : ',') + ' ' + tr('Go')
                                         : Math.max(1, Math.round(v.size / 1e6)) + ' ' + tr('Mo')) : ''),
                 v.playable ? '' : (v.note || tr('Format non lu par le téléviseur'))].filter(Boolean).join(' · ');
      return '<div class="opt focusable' + (on ? ' sel' : '') + (v.playable ? '' : ' dim') + '" data-file="' + v.id + '"' + (on ? ' data-default' : '') + '>' +
        '<span>' + esc(v.label) + (sub ? '<small class="t2">' + esc(sub) + '</small>' : '') + '</span>' + (on ? ICON.check : '') + '</div>';
    }).join('') + '</div></div>') };
  ov.onEnter = function (n) { var f = n.getAttribute('data-file'); if (f !== null) go(Number(f)); };
  Router.overlay(ov);
}

function libButtonHTML(lib) {
  return '<button class="btn focusable' + (lib ? ' on' : '') + '" data-act="library" data-key="library">' + ICON.library +
    esc(lib ? lib.name : tr('Bibliothèque')) + '</button>';
}
/* sur une fiche : ajoute à la Bibliothèque (catégorie devinée), ou propose de la changer */
function libraryAction(kind, it, onDone) {
  if (!it.library) {
    API.post('/api/library/add', { kind: kind, id: it.id, lang: LANG }).then(function (r) {
      it.library = { cat: r.cat, name: r.name };
      Toast.show(tr('Ajouté à la Bibliothèque · {c}', { c: r.name }) + (r.created ? ' ' + tr('(nouvelle catégorie)') : ''), 3500);
      if (onDone) onDone();
    }).catch(function (e) { Toast.show(e.message); });
    return;
  }
  libraryPanel(kind, it, onDone);
}
/* panneau : choisir la catégorie, en créer une, ou retirer le titre */
function libraryPanel(kind, it, onDone) {
  API.get('/api/library?kind=' + kind + '&cat=-1').then(function (d) {
    var cur = it.library && it.library.cat;
    var ov = { el: el('<div class="panel"><h2>' + esc(it.name) + '</h2><div class="lbl">' + tr('Catégorie dans la Bibliothèque') + '</div>' +
      '<div class="scroll-y" data-pad="60">' +
      d.cats.map(function (c) {
        return '<div class="opt focusable' + (c.id === cur ? ' sel' : '') + '" data-cat="' + c.id + '"' + (c.id === cur ? ' data-default' : '') +
          '><span>' + esc(c.name) + '</span>' + (c.id === cur ? ICON.check : '<span class="t" style="width:auto">' + c.count + '</span>') + '</div>';
      }).join('') +
      '<div class="opt focusable" data-act="new"><span>' + tr('Nouvelle catégorie…') + '</span></div>' +
      '<div class="opt focusable" data-act="remove" style="color:#FF9DA1"><span>' + tr('Retirer de la Bibliothèque') + '</span></div>' +
      '</div></div>') };
    ov.onEnter = function (n) {
      var act = n.getAttribute('data-act'), cat = n.getAttribute('data-cat');
      if (cat) {
        Router.closeOverlay();
        API.post('/api/library/move', { kind: kind, id: it.id, cat: Number(cat) }).then(function (r) {
          it.library = r.library; Toast.show(tr('Rangé dans « {c} »', { c: r.library.name })); if (onDone) onDone();
        }).catch(function (e) { Toast.show(e.message); });
      } else if (act === 'remove') {
        Router.closeOverlay();
        API.post('/api/library/remove', { kind: kind, id: it.id }).then(function () {
          it.library = null; Toast.show(tr('Retiré de la Bibliothèque')); if (onDone) onDone();
        }).catch(function (e) { Toast.show(e.message); });
      } else if (act === 'new') {
        Router.closeOverlay();
        editDialog(tr('Nouvelle catégorie'), [{ id: 'name', label: tr('Nom'), value: '' }], function (v) {
          if (!v.name) return Promise.reject(new Error(tr('Donnez un nom à la catégorie.')));
          return API.post('/api/library/cats', { name: v.name }).then(function (r) {
            return API.post('/api/library/move', { kind: kind, id: it.id, cat: r.id });
          }).then(function (r) {
            it.library = r.library; Toast.show(tr('Rangé dans « {c} »', { c: r.library.name })); if (onDone) onDone();
          });
        });
      }
    };
    Router.overlay(ov);
  }).catch(function (e) { Toast.show(e.message); });
}

function LibraryScreen() {
  var s = baseScreen('library', headerHTML('library') +
    '<div class="page-top"><div class="chips" data-group="chips" data-nav-down="grid"><div class="row"></div></div></div>' +
    '<div class="grid-wrap scroll-y" data-pad="80"><div class="grid" data-group="grid" data-nav-up="chips"></div></div>' +
    '<div class="state hidden"></div>' +
    '<div class="hints right"><span class="hint"><span class="key">OK</span>' + tr('Ouvrir') + '</span>' +
    '<span class="hint"><span class="key yellow">' + tr('Jaune') + '</span>' + tr('Catégorie') + '</span>' +
    '<span class="hint"><span class="key blue">' + tr('Bleu') + '</span>' + tr('Renommer') + '</span>' +
    '<span class="hint"><span class="key red">' + tr('Rouge') + '</span>' + tr('Retirer') + '</span></div>');
  var chips = $('.chips .row', s.el), grid = $('.grid', s.el), state = $('.state', s.el);
  // films et séries ne se mélangent pas : on choisit l'un ou l'autre, puis le genre
  var kind = Store.get('libKind', 'movie') === 'series' ? 'series' : 'movie';
  var cat = Store.get('libCat', 0), cats = [], items = [], total = 0, first = true;
  // tri : ajout dans la Bibliothèque, date de sortie, ordre alphabétique (OK sur la puce pour changer)
  var SORTS = [['added', 'Ajout récent'], ['year', 'Date de sortie'], ['name', 'De A à Z']];
  var sort = Store.get('libSort', 'added');
  if (!SORTS.some(function (x) { return x[0] === sort; })) sort = 'added';
  function load() {
    if (first) { state.innerHTML = loadingHTML(); state.classList.remove('hidden'); }
    API.get('/api/library?kind=' + kind + '&sort=' + sort + (cat ? '&cat=' + cat : '')).then(function (d) {
      // seuls les genres qui ont des titres de ce type
      cats = d.cats.filter(function (c) { return c.count > 0; }); items = d.items; total = d.total;
      if (cat && !cats.some(function (c) { return c.id === cat; })) { cat = 0; Store.set('libCat', 0); return load(); }
      state.classList.add('hidden');
      keepFocus(s.el, render);
      if (first && items.length) Focus.first(grid);
      first = false;
    }).catch(function (e) { state.innerHTML = errorHTML(e.message); state.classList.remove('hidden'); Focus.first(state); });
  }
  function render() {
    chips.innerHTML = [['movie', 'Films'], ['series', 'Séries']].map(function (k) {
      return '<div class="chip kind focusable' + (k[0] === kind ? ' active' : '') + '" data-kind="' + k[0] + '" data-key="lk:' + k[0] + '">' +
        tr(k[1]) + '</div>';
    }).join('') +
    '<div class="chip sort focusable" data-sort="1" data-key="ls">' + ICON.sort +
      tr(SORTS.filter(function (x) { return x[0] === sort; })[0][1]) + '</div>' +
    '<span class="chip-sep"></span>' +
    [{ id: 0, name: tr('Tout'), count: total }].concat(cats).map(function (c) {
      return '<div class="chip focusable' + (c.id === cat ? ' active' : '') + '" data-cat="' + c.id + '" data-key="lc:' + c.id + '">' +
        esc(c.name) + ' <span class="chip-n">' + c.count + '</span></div>';
    }).join('');
    grid.innerHTML = items.map(function (it, i) {
      var c = cats.filter(function (x) { return x.id === it.lib_cat; })[0];
      return posterHTML(it, i, cat ? '' : (c ? c.name : ''));
    }).join('');
    if (!items.length) {
      state.innerHTML = tr(total ? 'Rien dans cette catégorie.' : (kind === 'series'
        ? 'Aucune série dans votre Bibliothèque. Sur la fiche d’une série, choisissez « Bibliothèque ».'
        : 'Aucun film dans votre Bibliothèque. Sur la fiche d’un film, choisissez « Bibliothèque ».'));
      state.classList.remove('hidden');
    } else state.classList.add('hidden');
  }
  function current(n) { return n && n.getAttribute('data-act') === 'open' ? items[Number(n.getAttribute('data-idx'))] : null; }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'retry') return load();
    if (n.hasAttribute('data-kind')) {
      kind = n.getAttribute('data-kind'); Store.set('libKind', kind); cat = 0; Store.set('libCat', 0); return load();
    }
    if (n.hasAttribute('data-sort')) {
      var i = SORTS.map(function (x) { return x[0]; }).indexOf(sort);
      sort = SORTS[(i + 1) % SORTS.length][0]; Store.set('libSort', sort); return load();
    }
    if (n.classList.contains('chip')) { cat = Number(n.getAttribute('data-cat')); Store.set('libCat', cat); return load(); }
    var it = current(n); if (it) App.open(it.kind, it.id);
  };
  s.onKey = function (k) {
    var n = Focus.current, it = current(n);
    if (k === KEY.YELLOW && it) {
      it.library = { cat: it.lib_cat };
      libraryPanel(it.kind, it, load);
      return true;
    }
    if (k === KEY.RED && it) {
      API.post('/api/library/remove', { kind: it.kind, id: it.id }).then(function () {
        Toast.show(tr('« {n} » retiré de la Bibliothèque', { n: it.name })); load();
      }).catch(function (e) { Toast.show(e.message); });
      return true;
    }
    if (k === KEY.BLUE && n && n.classList.contains('chip') && Number(n.getAttribute('data-cat'))) {
      var c = cats.filter(function (x) { return x.id === Number(n.getAttribute('data-cat')); })[0];
      editDialog(tr('Renommer la catégorie'), [{ id: 'name', label: tr('Nom'), value: c.name }], function (v) {
        return API.post('/api/library/cats/rename', { id: c.id, name: v.name }).then(function () { Toast.show(tr('Catégorie renommée')); load(); });
      });
      return true;
    }
    return false;
  };
  s.show = function (returning) { load(); };
  return s;
}

/* =====================================================================
   RECHERCHE
   ===================================================================== */
function SearchScreen() {
  var s = baseScreen('search', headerHTML('search') +
    '<div class="search-box"><input class="input focusable" id="q" data-default placeholder="' + tr('Chaîne, film ou série…') + '" autocomplete="off" spellcheck="false" style="width:100%"></div>' +
    '<div class="search-results scroll-y" data-pad="60"><div class="inner"></div></div>');
  var input = $('#q', s.el), out = $('.search-results .inner', s.el), res = null, my = 0;
  var run = debounce(function () {
    var q = input.value.trim();
    if (q.length < 2) { out.innerHTML = '<div class="state" style="position:static;margin-top:80px">' + tr('Tapez au moins deux lettres. Les accents ne comptent pas.') + '</div>'; return; }
    var id = ++my;
    API.get('/api/search?q=' + encodeURIComponent(q)).then(function (d) {
      if (id !== my) return;
      res = d;
      var html = '';
      if (d.live.length) html += '<div class="section"><h2>' + tr('Chaînes') + '</h2><div class="strip" data-group="s-live"><div class="row">' + d.live.map(chCardHTML).join('') + '</div></div></div>';
      if (d.vod.length) html += '<div class="section"><h2>' + tr('Films') + '</h2><div class="strip" data-group="s-vod"><div class="row">' + d.vod.map(function (it, i) { return posterHTML(it, i); }).join('') + '</div></div></div>';
      if (d.series.length) html += '<div class="section"><h2>' + tr('Séries') + '</h2><div class="strip" data-group="s-series"><div class="row">' + d.series.map(function (it, i) { return posterHTML(it, i); }).join('') + '</div></div></div>';
      out.innerHTML = html || '<div class="state" style="position:static;margin-top:80px">' + tr('Aucun résultat pour « {q} ».', { q: esc(q) }) + '</div>';
    }).catch(function (e) { out.innerHTML = '<div class="state" style="position:static;margin-top:80px">' + esc(e.message) + '</div>'; });
  }, 450);
  input.addEventListener('input', run);
  s.onEnter = function (n) {
    if (n === input) { input.focus(); return; }
    var idx = Number(n.getAttribute('data-idx')), g = n.closest('[data-group]').getAttribute('data-group');
    if (g === 's-live') App.playLive(res.live, idx);
    else if (g === 's-vod') App.open('movie', res.vod[idx].id);
    else if (g === 's-series') App.open('series', res.series[idx].id);
  };
  s.onKey = function (k) {
    var n = Focus.current;
    if (k === KEY.INFO && n && n.getAttribute('data-act') === 'channel') {
      App.open('channel', res.live[Number(n.getAttribute('data-idx'))].id); return true;
    }
    return false;
  };
  s.show = function (returning) { if (!returning) run(); };
  return s;
}

/* =====================================================================
   RÉGLAGES
   ===================================================================== */
function SettingsScreen() {
  var s = baseScreen('settings', headerHTML('settings') +
    '<div class="page-top"><h1>' + tr('Réglages') + '</h1></div><div class="settings scroll-y" data-group="set" data-pad="80"></div>');
  var box = $('.settings', s.el), st = null, subs = [], lockOn = false;
  /* une ligne par abonnement : état, échéance, connexions */
  function subsHTML() {
    return subs.map(function (p) {
      var a = p.account, bits = [], cls = '';
      if (!a) bits.push(tr('pas encore de réponse du fournisseur'));
      else {
        bits.push((a.status || '').toLowerCase() === 'active' ? tr('actif') : (a.status || '?'));
        if (a.expires) {
          bits.push(tr('expire le {d}', { d: dateLong(a.expires) }));
          cls = a.days_left <= 7 ? ' bad' : (a.days_left <= 30 ? ' warn' : ' ok');
        }
        if (a.max_connections) bits.push(tr('{a}/{m} connexions', { a: a.active_cons || 0, m: a.max_connections }));
      }
      var days = a && a.expires ? '<span class="days' + cls + '">' + tr(a.days_left > 1 ? '{n} jours' : '{n} jour', { n: a.days_left }) + '</span>' : '';
      return '<div class="set-row focusable" data-act="sub" data-key="sub:' + p.src + '"><div style="display:flex;align-items:center;gap:16px">' +
        '<span class="srcb big" style="background:' + esc(p.color) + '">' + esc(p.letter) + '</span><div>' + esc(p.name) +
        '<small>' + esc(bits.join(' · ')) + '</small></div></div>' + days + '</div>';
    }).join('');
  }
  function render() {
    var prev = Store.get('preview', true), theme = Store.get('theme', 'luciole');
    var when = st && st.catalog_sync ? dayLabel(st.catalog_sync) + ' ' + tr('à') + ' ' + hhmm(st.catalog_sync) : tr('jamais');
    box.innerHTML =
      '<div class="set-row focusable" data-default data-act="server" data-key="server"><div>' + tr('Serveur Luciole') +
      '<small>' + tr('Adresse du serveur sur votre réseau') + '</small></div>' +
      '<span class="val">' + esc(API.base.replace(/^http:\/\//, '')) + '</span></div>' +
      subsHTML() +
      '<div class="set-row focusable" data-act="autostart" data-key="autostart"><div>' + tr('Démarrage automatique') +
      '<small>' + tr('Ouvrir Luciole quand le téléviseur s’allume') + '</small></div>' +
      '<span class="val">' + (st && st.tv ? tr(st.tv.enabled ? 'activé' : 'désactivé') : '') + ' ›</span></div>' +
      '<div class="set-row focusable" data-act="lang" data-key="lang"><div>' + tr('Langue') + '<small>' + tr('Langue de l’interface') + '</small></div>' +
      '<span class="val">' + (LANG === 'en' ? 'English' : 'Français') + '</span></div>' +
      '<div class="set-row focusable" data-act="theme" data-key="theme"><div>' + tr('Thème') + '<small>' + tr('Couleur d’accent de l’interface') + '</small></div>' +
      '<span class="val"><span class="swatch"></span>' + tr(theme === 'ambre' ? 'Ambre' : 'Luciole (vert)') + '</span></div>' +
      '<div class="set-row focusable" data-act="tracks" data-key="tracks"><div>' + tr('Langue audio et sous-titres') +
      '<small>' + tr('Choisis d’avance pour le direct, les films et les séries') + '</small></div>' +
      '<span class="val">' + esc(trackPrefLabel(trackPref('movie'))) + ' ›</span></div>' +
      (lockOn ? '<div class="set-row focusable" data-act="lock" data-key="lock"><div>' + tr('Code parental') +
      '<small>' + tr(API.unlock ? 'Les bouquets verrouillés sont ouverts. OK pour les refermer.' : 'Les bouquets verrouillés demandent le code. Il se choisit sur la page web.') + '</small></div>' +
      '<span class="val">' + ICON.lock + ' ' + tr(API.unlock ? 'ouvert' : 'fermé') + '</span></div>' : '') +
      '<div class="set-row focusable" data-act="buffer" data-key="buffer"><div>' + tr('Mémoire tampon du direct') +
      '<small>' + tr('Plus longue : moins de coupures sur un flux irrégulier, mais un zapping plus lent') + '</small></div>' +
      '<span class="val">' + tr('{n} s', { n: Store.get('liveBuffer', 3) }) + '</span></div>' +
      '<div class="set-row focusable" data-act="subsize" data-key="subsize"><div>' + tr('Taille des sous-titres') +
      '<small>' + tr('OK pour changer') + '</small></div>' +
      '<span class="val">' + esc(tr(SUB_SIZES[Store.get('subSize', 'm')] || 'Moyenne')) + '</span></div>' +
      '<div class="set-row focusable" data-act="quality" data-key="quality"><div>' + tr('Qualité des films de la médiathèque') +
      '<small>' + tr('Quand un film existe en plusieurs versions (4K, 1080p, 720p)') + '</small></div>' +
      '<span class="val">' + esc(qualityLabel(maxQuality())) + '</span></div>' +
      '<div class="set-row focusable" data-act="preview" data-key="preview"><div>' + tr('Aperçu vidéo dans le guide') +
      '<small>' + tr('Lance la chaîne en fond quand vous vous arrêtez dessus') + '</small></div>' +
      '<span class="toggle' + (prev ? ' on' : '') + '"></span></div>' +
      '<div class="set-row focusable" data-act="sync" data-key="sync"><div>' + tr('Mettre à jour le catalogue maintenant') + '<small>' +
      (st ? (st.syncing ? tr('Mise à jour en cours…') : tr('Dernière mise à jour : {w}', { w: esc(when) })) : tr('État inconnu')) + '</small></div>' +
      '<span class="val">' + (st ? tr('{l} chaînes · {v} films · {s} séries', { l: st.counts.live, v: st.counts.vod, s: st.counts.series }) : '') + '</span></div>' +
      // lignes d'information : sélectionnables sans action, sinon la page ne défile pas jusqu'à elles
      '<div class="set-row focusable" data-key="info-web"><div>' + tr('Bouquets, noms, numéros et guide') +
      '<small>' + tr('Depuis le navigateur d’un ordinateur : {u}', { u: esc(API.base) }) + '</small></div></div>' +
      '<div class="set-row focusable" data-key="info-version"><div>Luciole ' + VERSION + '<small>' +
      tr('OK valider · Retour revenir · jaune favori · vert replay · bleu modifier · Info la chaîne · 0-9 numéro') + '</small></div></div>';
  }
  function status() {
    API.get('/api/providers').then(function (d) { subs = d.providers || []; keepFocus(s.el, render); }).catch(function () {});
    API.get('/api/lock').then(function (d) { lockOn = !!d.pin; keepFocus(s.el, render); }).catch(function () {});
    API.get('/api/tv').then(function (d) { if (st) { st.tv = d; keepFocus(s.el, render); } }).catch(function () {});
    API.get('/api/status').then(function (d) {
      var tv = st && st.tv; st = d; st.tv = tv; Providers.set(d.providers || []); keepFocus(s.el, render);
      if (d.syncing) setTimeout(function () { if (Router.screen() === s) status(); }, 4000);
    }).catch(function (e) { st = null; keepFocus(s.el, render); Toast.show(e.message); });
  }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'server') Router.push(SetupScreen(false));
    if (act === 'autostart') Router.push(AutostartScreen());
    if (act === 'tracks') Router.push(TrackSettingsScreen());
    if (act === 'lock') {
      if (API.unlock) { Lock.close(); Toast.show(tr('Bouquets verrouillés refermés')); keepFocus(s.el, render); }
      else Lock.ask(function () { Toast.show(tr('Bouquets verrouillés ouverts')); keepFocus(s.el, render); });
    }
    if (act === 'buffer') {
      var steps = [3, 8, 15, 30], b = steps[(steps.indexOf(Store.get('liveBuffer', 3)) + 1) % steps.length];
      Store.set('liveBuffer', b); keepFocus(s.el, render);
    }
    if (act === 'subsize') {
      var order = ['s', 'm', 'l', 'xl'], sz = order[(order.indexOf(Store.get('subSize', 'm')) + 1) % order.length];
      Store.set('subSize', sz); applySubSize(sz); keepFocus(s.el, render);
    }
    if (act === 'sub') API.post('/api/sync').then(function () { Toast.show(tr('Mise à jour lancée')); status(); }).catch(function (e) { Toast.show(e.message); });
    if (act === 'preview') { Store.set('preview', !Store.get('preview', true)); keepFocus(s.el, render); }
    if (act === 'quality') {
      var qn = { 0: 1080, 1080: 720, 720: 0 }[maxQuality()];
      Store.set('maxQuality', qn); keepFocus(s.el, render);
    }
    if (act === 'theme') {
      var th = Store.get('theme', 'luciole') === 'ambre' ? 'luciole' : 'ambre';
      Store.set('theme', th); applyTheme(th); keepFocus(s.el, render);
    }
    if (act === 'lang') {
      // toute l'interface est fabriquée dans la langue choisie : on la reconstruit
      LANG = LANG === 'en' ? 'fr' : 'en';
      Store.set('lang', LANG);
      document.documentElement.lang = LANG;
      Router.replaceAll(SettingsScreen());
      var f = $('[data-key="lang"]'); if (f) Focus.set(f, true);
    }
    if (act === 'sync') API.post('/api/sync').then(function () { Toast.show(tr('Mise à jour lancée')); status(); }).catch(function (e) { Toast.show(e.message); });
  };
  s.show = function () { render(); status(); };
  return s;
}

/* =====================================================================
   CODE PARENTAL
   Un bouquet verrouillé garde un cadenas ; l'ouvrir (ou lire un de ses titres) demande le code.
   Une fois tapé, tout reste ouvert jusqu'à la fermeture de l'appli.
   ===================================================================== */
function lockMark(c) { return c && c.locked && !API.unlock ? '<span class="lockmark">' + ICON.lock + '</span>' : ''; }
var Lock = {
  busy: false,
  ask: function (onOk, onCancel) {
    if (this.busy) { if (onCancel) onCancel(); return; }
    this.busy = true;
    var self = this, code = '', done = false;
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
    var ov = { el: el('<div class="dialog-back"><div class="dialog pinpad" role="dialog" aria-label="' + tr('Code parental') + '">' +
      '<h2>' + ICON.lock + ' ' + tr('Code parental') + '</h2>' +
      '<p class="help">' + tr('Tapez le code avec les chiffres de la télécommande, puis OK.') + '</p>' +
      '<div class="pin-dots"></div><div class="error"></div>' +
      '<div class="keys">' + keys.map(function (k, i) {
        return '<button class="btn focusable" data-k="' + k + '"' + (i === 0 ? ' data-default' : '') + '>' +
          (k === 'del' ? '⌫' : (k === 'ok' ? tr('OK') : k)) + '</button>';
      }).join('') + '</div></div></div>') };
    function draw() {
      $('.pin-dots', ov.el).innerHTML = code ? code.split('').map(function () { return '<i></i>'; }).join('') : '<span>' + tr('— — — —') + '</span>';
    }
    function finish(ok) {
      if (done) return;
      done = true; self.busy = false;
      Router.closeOverlay();
      if (ok) { $$('.lockmark').forEach(function (m) { m.remove(); }); if (onOk) onOk(); } else if (onCancel) onCancel();
    }
    function submit() {
      if (code.length < 4) { $('.error', ov.el).textContent = tr('Le code compte au moins 4 chiffres.'); return; }
      $('.error', ov.el).textContent = '';
      API.req('POST', '/api/lock/unlock', { pin: code }, null, true).then(function (r) {
        API.unlock = r.token; finish(true);
      }).catch(function (e) {
        code = ''; draw(); $('.error', ov.el).textContent = e.message;
      });
    }
    function press(k) {
      if (k === 'del') code = code.slice(0, -1);
      else if (k === 'ok') return submit();
      else if (code.length < 8) code += k;
      draw();
    }
    ov.onEnter = function (n) { var k = n.getAttribute('data-k'); if (k) press(k); };
    ov.onKey = function (k) {
      // chiffres de la télécommande : la sélection passe sur OK, il ne reste qu'à valider
      if (k >= 48 && k <= 57) { press(String(k - 48)); Focus.set($('[data-k="ok"]', ov.el), true); return true; }
      if (k === KEY.BACK || k === KEY.ESC) { finish(false); return true; }
      return false;
    };
    ov.onClose = function () { if (!done) { done = true; self.busy = false; if (onCancel) onCancel(); } };
    Router.overlay(ov); draw();
  },
  close: function () {
    if (!API.unlock) return;
    API.post('/api/lock/close', { token: API.unlock }).catch(function () {});
    API.unlock = '';
  }
};

/* =====================================================================
   LANGUE AUDIO ET SOUS-TITRES (par type de contenu)
   ===================================================================== */
var SUB_SIZES = { s: 'Petite', m: 'Moyenne', l: 'Grande', xl: 'Très grande' };
function applySubSize(sz) {
  ['s', 'm', 'l', 'xl'].forEach(function (k) { document.body.classList.toggle('subs-' + k, k === sz); });
}
var TRACK_LANGS = ['', 'fr', 'en', 'nl', 'de', 'es', 'it', 'pt', 'ar', 'tr'];
var SUB_CHOICES = ['auto', 'off', 'fr', 'en', 'nl', 'de', 'es', 'it', 'pt', 'ar', 'tr'];
function trackPref(kind) {
  var p = Store.get('trk.' + kind, null) || {};
  return { a: p.a || '', t: p.t || 'auto' };
}
function audioPrefLabel(a) { return a ? langName(a) : tr('Celle du flux'); }
function subPrefLabel(t) { return t === 'off' ? tr('Désactivés') : (t === 'auto' ? tr('Ceux du flux') : langName(t)); }
function trackPrefLabel(p) { return audioPrefLabel(p.a) + ' · ' + subPrefLabel(p.t); }

function TrackSettingsScreen() {
  var s = baseScreen('tracks', headerHTML('settings') +
    '<div class="page-top"><div class="icon-btn focusable" data-act="back" aria-label="' + tr('Retour') + '">' + ICON.back + '</div>' +
    '<h1>' + tr('Langue audio et sous-titres') + '</h1></div><div class="settings scroll-y" data-group="set" data-pad="80"></div>');
  var box = $('.settings', s.el);
  var KINDS = [['live', 'En direct'], ['movie', 'Films'], ['series', 'Séries']];
  function render() {
    box.innerHTML = KINDS.map(function (k, i) {
      var p = trackPref(k[0]);
      return '<div class="set-row focusable"' + (i === 0 ? ' data-default' : '') + ' data-act="a" data-kind="' + k[0] + '" data-key="a:' + k[0] + '"><div>' +
        tr(k[1]) + ' · ' + tr('Audio') + '<small>' + tr('OK pour changer. Si la langue manque, le flux garde la sienne.') + '</small></div>' +
        '<span class="val">' + esc(audioPrefLabel(p.a)) + '</span></div>' +
        '<div class="set-row focusable" data-act="t" data-kind="' + k[0] + '" data-key="t:' + k[0] + '"><div>' +
        tr(k[1]) + ' · ' + tr('Sous-titres') + '<small>' + tr('OK pour changer.') + '</small></div>' +
        '<span class="val">' + esc(subPrefLabel(p.t)) + '</span></div>';
    }).join('') +
      // sélectionnable, sans action : sinon la page ne défile pas jusqu'à cette explication
      '<div class="set-row focusable" data-key="info"><div>' + tr('Dans une série') +
      '<small>' + tr('Un changement fait pendant un épisode est gardé pour les épisodes suivants de la même série.') + '</small></div></div>';
  }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'back') return Router.back();
    var kind = n.getAttribute('data-kind');
    if (!kind) return;
    var p = trackPref(kind);
    if (act === 'a') p.a = TRACK_LANGS[(TRACK_LANGS.indexOf(p.a) + 1) % TRACK_LANGS.length];
    if (act === 't') p.t = SUB_CHOICES[(SUB_CHOICES.indexOf(p.t) + 1) % SUB_CHOICES.length];
    Store.set('trk.' + kind, p);
    keepFocus(s.el, render);
  };
  s.show = function () { keepFocus(s.el, render); };
  return s;
}

/* =====================================================================
   DÉMARRAGE AUTOMATIQUE (réglé depuis le téléviseur lui-même)
   ===================================================================== */
function AutostartScreen() {
  var s = baseScreen('autostart', headerHTML('settings') +
    '<div class="page-top"><div class="icon-btn focusable" data-act="back" aria-label="' + tr('Retour') + '">' + ICON.back + '</div>' +
    '<h1>' + tr('Démarrage automatique') + '</h1></div><div class="settings scroll-y" data-group="set" data-pad="80"></div>');
  var box = $('.settings', s.el), d = null, busy = false;
  var DELAYS = [0, 3, 6, 10, 15, 20, 30];
  function myAppId() {
    try { return tizen.application.getCurrentApplication().appInfo.id; } catch (e) { return ''; }
  }
  function render() {
    if (!d) { box.innerHTML = '<div class="state" style="position:static">' + loadingHTML() + '</div>'; return; }
    var app = myAppId();
    var stateTxt = [tr(d.paired ? 'Serveur autorisé sur ce téléviseur' : 'Serveur pas encore autorisé')];
    if (d.enabled) stateTxt.push(tr(d.watching ? 'surveillance active' : 'surveillance à redémarrer'));
    if (d.last) stateTxt.push(tr('dernier réveil : {d}', { d: d.last }));
    box.innerHTML =
      '<div class="set-row focusable" data-default data-act="auto" data-key="auto"><div>' + tr('Ouvrir Luciole quand le téléviseur s’allume') +
      '<small>' + tr('Le serveur surveille le téléviseur et ouvre Luciole à la place de Samsung TV Plus.') + '</small></div>' +
      '<span class="toggle' + (d.enabled ? ' on' : '') + '"></span></div>' +
      '<div class="set-row focusable" data-act="host" data-key="host"><div>' + tr('Adresse du téléviseur') +
      '<small>' + (d.client && d.client !== d.host ? tr('OK : utiliser l’adresse de ce téléviseur ({ip})', { ip: esc(d.client) }) : tr('Donnez-lui une adresse fixe dans votre modem')) + '</small></div>' +
      '<span class="val">' + esc(d.host || '—') + '</span></div>' +
      '<div class="set-row focusable" data-act="app" data-key="app"><div>' + tr('Application ouverte') +
      '<small>' + (app && app !== d.app ? tr('OK : utiliser cette application ({id})', { id: esc(app) }) : tr('Identifiant de l’application Luciole')) + '</small></div>' +
      '<span class="val">' + esc(d.app || '—') + '</span></div>' +
      '<div class="set-row focusable" data-act="delay" data-key="delay"><div>' + tr('Attente après l’allumage') +
      '<small>' + tr('Le temps que le téléviseur finisse de démarrer. OK pour changer.') + '</small></div>' +
      '<span class="val">' + tr('{n} s', { n: d.delay }) + '</span></div>' +
      '<div class="set-row focusable" data-act="tries" data-key="tries"><div>' + tr('Essais') +
      '<small>' + tr('Luciole est relancé tant qu’il n’est pas à l’écran. OK pour changer.') + '</small></div>' +
      '<span class="val">' + d.tries + '</span></div>' +
      '<div class="set-row focusable" data-act="pair" data-key="pair"><div>' + tr('Autoriser le serveur') +
      '<small>' + tr('Une fenêtre Samsung s’ouvre : acceptez-la avec la télécommande. Une seule fois.') + '</small></div>' +
      '<span class="val">' + tr(d.paired ? 'autorisé' : 'à faire') + '</span></div>' +
      '<div class="set-row focusable" data-key="info-state"><div>' + tr('État') + '<small>' + esc(stateTxt.join(' · ')) + '</small></div></div>';
  }
  function load() {
    API.get('/api/tv').then(function (r) { d = r; keepFocus(s.el, render); }).catch(function (e) { Toast.show(e.message); });
  }
  function save(vals, msg) {
    if (busy) return;
    busy = true;
    API.post('/api/tv/set', vals).then(function (r) {
      busy = false; r.client = d.client; d = r; keepFocus(s.el, render); if (msg) Toast.show(msg);
    }).catch(function (e) { busy = false; Toast.show(e.message); });
  }
  s.onEnter = function (n) {
    var act = n.getAttribute('data-act');
    if (act === 'back') return Router.back();
    if (!d) return;
    if (act === 'auto') {
      if (!d.enabled && !d.host && d.client) return save({ auto: true, host: d.client }, tr('Démarrage automatique activé'));
      return save({ auto: !d.enabled }, tr(d.enabled ? 'Démarrage automatique désactivé' : 'Démarrage automatique activé'));
    }
    if (act === 'host') {
      if (d.client && d.client !== d.host) return save({ host: d.client }, tr('Adresse enregistrée'));
      return editDialog(tr('Adresse du téléviseur'), [{ id: 'host', label: tr('Adresse IP'), value: d.host || '' }], function (v) {
        return API.post('/api/tv/set', { host: v.host }).then(function (r) { r.client = d.client; d = r; keepFocus(s.el, render); });
      });
    }
    if (act === 'app') {
      var app = myAppId();
      if (app && app !== d.app) return save({ app: app }, tr('Application enregistrée'));
      return editDialog(tr('Application ouverte'), [{ id: 'app', label: tr('Identifiant'), value: d.app || '' }], function (v) {
        return API.post('/api/tv/set', { app: v.app }).then(function (r) { r.client = d.client; d = r; keepFocus(s.el, render); });
      });
    }
    if (act === 'delay') {
      var i = DELAYS.indexOf(d.delay);
      return save({ delai: DELAYS[(i + 1) % DELAYS.length] });
    }
    if (act === 'tries') return save({ essais: d.tries >= 10 ? 1 : d.tries + 1 });
    if (act === 'pair') {
      Toast.show(tr('Acceptez la fenêtre qui va s’afficher…'), 6000);
      API.post('/api/tv/pair', {}).then(function (r) {
        Toast.show(tr(r.paired ? 'Serveur autorisé' : 'Pas d’autorisation reçue'));
        load();
      }).catch(function (e) { Toast.show(e.message, 5000); });
    }
  };
  s.show = function () { render(); load(); };
  return s;
}

/* =====================================================================
   BANDE-ANNONCE
   ===================================================================== */
function openTrailer(videoId, title) {
  var src = API.base + '/trailer?v=' + encodeURIComponent(videoId) + (API.token ? '&token=' + encodeURIComponent(API.token) : '');
  var ov = { el: el('<div class="trailer" aria-label="' + esc(tr('Bande-annonce {t}', { t: title })) + '">' +
    '<iframe src="' + esc(src) + '" allow="autoplay; encrypted-media" tabindex="-1" title="' + tr('Bande-annonce') + '"></iframe>' +
    '<div class="trailer-msg"><div class="spinner"></div></div>' +
    '<div class="trailer-hint"><span class="hint"><span class="key">OK</span>' + tr('Pause') + '</span>' +
    '<span class="hint"><span class="key">← →</span>' + tr('Reculer, avancer') + '</span>' +
    '<span class="hint"><span class="key">' + tr('Retour') + '</span>' + tr('Fermer') + '</span></div></div>') };
  var frame = $('iframe', ov.el), msg = $('.trailer-msg', ov.el), hint = $('.trailer-hint', ov.el), started = false;
  function cmd(c, extra) { try { frame.contentWindow.postMessage(Object.assign({ cmd: c }, extra || {}), '*'); } catch (e) { /* cadre pas prêt */ } }
  function onMsg(e) {
    var m = e.data || {};
    if (m.luciole !== 'trailer') return;
    if (m.type === 'state' && m.data === 1) { started = true; msg.classList.add('hidden'); setTimeout(function () { hint.classList.add('faded'); }, 4000); }
    if (m.type === 'error') msg.innerHTML = '<div>' + tr('Bande-annonce indisponible (vidéo retirée ou non autorisée hors de YouTube).') + '</div>';
  }
  window.addEventListener('message', onMsg);
  var slow = setTimeout(function () { if (!started) msg.innerHTML = '<div>' + tr('Appuyez sur OK pour lancer la bande-annonce.') + '</div>'; }, 7000);
  ov.onKey = function (k) {
    hint.classList.remove('faded');
    if (k === KEY.ENTER || k === KEY.PLAYPAUSE || k === KEY.PLAY || k === KEY.PAUSE) { cmd('toggle'); return true; }
    if (k === KEY.LEFT || k === KEY.RW) { cmd('seek', { by: -10 }); return true; }
    if (k === KEY.RIGHT || k === KEY.FF) { cmd('seek', { by: 10 }); return true; }
    if (k === KEY.STOP) { Router.closeOverlay(); return true; }
    return k !== KEY.BACK;
  };
  ov.onClose = function () { window.removeEventListener('message', onMsg); clearTimeout(slow); cmd('stop'); frame.src = 'about:blank'; };
  Router.overlay(ov);
}

/* =====================================================================
   RENOMMER, RENUMÉROTER
   ===================================================================== */
function editDialog(title, fields, onSave, resetLabel, onReset) {
  var ov = { el: el('<div class="dialog-back"><div class="dialog" role="dialog" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' +
    fields.map(function (f) {
      return '<div class="field"><label for="ed-' + f.id + '">' + esc(f.label) + '</label>' +
        '<input id="ed-' + f.id + '" class="input focusable" data-field="' + f.id + '"' + (f.numeric ? ' inputmode="numeric"' : '') +
        ' value="' + esc(f.value) + '" autocomplete="off" spellcheck="false">' +
        (f.hint ? '<small style="color:var(--muted);font-size:18px">' + esc(f.hint) + '</small>' : '') + '</div>';
    }).join('') +
    '<div class="error" id="ed-err"></div><div class="actions" style="flex-wrap:wrap">' +
    '<button class="btn focusable" data-act="save">' + tr('Enregistrer') + '</button>' +
    (onReset ? '<button class="btn focusable" data-act="reset">' + esc(resetLabel) + '</button>' : '') +
    '<button class="btn focusable" data-act="cancel">' + tr('Annuler') + '</button></div></div></div>') };
  ov.onEnter = function (n) {
    if (n.tagName === 'INPUT') { n.focus(); return; }
    var act = n.getAttribute('data-act');
    if (act === 'cancel') { Router.closeOverlay(); return; }
    var done = function () { Router.closeOverlay(); };
    var fail = function (e) { $('#ed-err', ov.el).textContent = e.message; };
    if (act === 'reset') { onReset().then(done, fail); return; }
    if (act === 'save') {
      var vals = {};
      $$('[data-field]', ov.el).forEach(function (i) { vals[i.getAttribute('data-field')] = i.value.trim(); });
      onSave(vals).then(done, fail);
    }
  };
  Router.overlay(ov);
}
function editChannel(ch, after) {
  editDialog(tr('Modifier la chaîne'), [
    { id: 'num', label: tr('Numéro'), value: ch.num, numeric: true, hint: tr('Numéro du fournisseur : {n}', { n: ch.orig_num }) },
    { id: 'name', label: tr('Nom'), value: ch.name, hint: tr('Nom du fournisseur : {n}', { n: ch.orig_name }) }
  ], function (v) {
    if (v.num && !/^\d+$/.test(v.num)) return Promise.reject(new Error(tr('Le numéro doit être un nombre.')));
    return API.post('/api/channels/edit', {
      id: ch.id, name: v.name === ch.orig_name ? null : v.name, num: v.num === String(ch.orig_num) ? null : v.num
    }).then(function (r) {
      Toast.show(r.same_number ? tr('Enregistré. Attention : « {n} » a le même numéro.', { n: r.same_number }) : tr('Chaîne modifiée'), 3500);
      if (after) after();
    });
  }, tr('Valeurs du fournisseur'), function () {
    return API.post('/api/channels/edit', { id: ch.id, name: null, num: null })
      .then(function () { Toast.show(tr('Valeurs du fournisseur rétablies')); if (after) after(); });
  });
}
function renameCategory(kind, c, after) {
  editDialog(tr('Renommer le bouquet'), [{ id: 'name', label: tr('Nom'), value: c.name, hint: tr('Nom du fournisseur : {n}', { n: c.orig_name }) }], function (v) {
    return API.post('/api/categories/rename', { kind: kind, id: c.id, name: v.name === c.orig_name ? null : v.name })
      .then(function () { Toast.show(tr('Bouquet renommé')); if (after) after(); });
  }, tr('Nom du fournisseur'), function () {
    return API.post('/api/categories/rename', { kind: kind, id: c.id, name: null }).then(function () { if (after) after(); });
  });
}
