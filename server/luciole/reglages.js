/* Luciole — page de réglages du serveur */
(function () {
  'use strict';
  var token = new URLSearchParams(location.search).get('token') || '';
  var $ = function (id) { return document.getElementById(id); };
  var tab = 'subs', catKind = 'live', filter = '';
  var bqs = [], curBq = null, bqChans = [], chans = [], cats = [], srcs = [], maps = [];

  /* ---------- outils ---------- */
  function api(method, path, body) {
    // la page des réglages voit tout, même ce que le code parental ferme sur la TV
    var o = { method: method, headers: { 'X-Luciole-Admin': '1' } };
    if (token) o.headers['X-Luciole-Token'] = token;
    if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(path, o).then(function (r) {
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error ? tr(d.error) : tr('erreur {n}', { n: r.status })); return d; });
    });
  }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function norm(s) { return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function img(u) { return u ? u + (token ? '&token=' + encodeURIComponent(token) : '') : ''; }
  function say(id, text, bad) { var n = $(id); n.textContent = ''; n.append(mk('span', bad ? 'msg' : '', text)); }
  function fail(id) { return function (e) { say(id, tr('Erreur : {m}', { m: e.message }), true); }; }
  function logoNode(c) {
    var i = mk('img', 'chlogo'); i.alt = ''; i.loading = 'lazy';
    if (c.logo) { i.src = img(c.logo); i.onerror = function () { i.style.visibility = 'hidden'; }; }
    else i.style.visibility = 'hidden';
    return i;
  }
  function posterNode(c) {
    var i = mk('img', 'poster-mini'); i.alt = ''; i.loading = 'lazy';
    if (c.poster) { i.src = img(c.poster); i.onerror = function () { i.style.visibility = 'hidden'; }; }
    else i.style.visibility = 'hidden';
    return i;
  }
  /* ---------- abonnements : pastille de provenance ---------- */
  var provs = [], provBy = {};
  function setProviders(list) {
    provs = list || []; provBy = {};
    provs.forEach(function (p) { provBy[p.src] = p; });
  }
  function srcNode(c) {
    var p = provs.length > 1 && provBy[c.src];
    if (!p) return document.createTextNode('');
    var b = mk('span', 'srcb', p.letter); b.style.background = p.color; b.title = p.name;
    return b;
  }
  function srcPrefix(c) {
    var p = provs.length > 1 && c.src && provBy[c.src];
    return p ? '[' + p.letter + '] ' : '';
  }
  function when(ts) {
    return new Date(ts * 1000).toLocaleString(LANG === 'en' ? 'en-GB' : 'fr-BE', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function day(ts) {
    return new Date(ts * 1000).toLocaleDateString(LANG === 'en' ? 'en-GB' : 'fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function tags(c) {
    var out = [];
    if (c.quality) out.push(mk('span', 'tag q', c.quality));
    if (c.archive) out.push(mk('span', 'tag replay', tr('Replay')));
    return out;
  }

  /* ---------- boîte de dialogue ---------- */
  /* « dlg » est la fenêtre courante ; « dlg2 » sert quand une fenêtre doit en ouvrir une autre
     (choisir une jaquette depuis l'éditeur de fiche, par exemple). */
  function dialog(title, buildBody, onOk, okLabel, which) {
    var p = which || 'dlg', d = $(p);
    d.classList.remove('wide');
    $(p + '-title').textContent = title;
    $(p + '-body').textContent = '';
    $(p + '-ok').textContent = okLabel || tr('Valider');
    var ctx = buildBody($(p + '-body'));
    d.showModal();
    var first = $(p + '-body').querySelector('input, select, button');
    if (first) setTimeout(function () { first.focus(); if (first.select) first.select(); }, 30);
    function close() { d.close(); $(p + '-ok').onclick = null; $(p + '-cancel').onclick = null; }
    // sans rien à valider (une fenêtre où l'on choisit), un seul bouton suffit
    $(p + '-cancel').style.display = onOk ? '' : 'none';
    $(p + '-cancel').onclick = close;
    $(p + '-ok').onclick = function () {
      var r = onOk && onOk(ctx);
      if (r && r.then) r.then(close, function (e) { alert(e.message); }); else close();
    };
    return close;
  }
  function askText(title, label, value, onOk, okLabel, which) {
    dialog(title, function (box) {
      box.append(mk('label', 'lbl', label));
      var i = mk('input', 'edit w100'); i.type = 'text'; i.value = value || '';
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') $((which || 'dlg') + '-ok').click(); });
      box.append(i);
      return i;
    }, function (i) { return onOk(i.value.trim()); }, okLabel, which);
  }
  function confirmBox(title, text, onOk, okLabel) {
    dialog(title, function (box) { box.append(mk('p', '', text)); return null; }, function () { return onOk(); }, okLabel || tr('Confirmer'));
  }

  /* ---------- code parental ---------- */
  var lockState = { pin: false, locked: { live: [], vod: [], series: [] } }, pinCache = '';
  function loadLock() {
    return api('GET', '/api/lock').then(function (d) { lockState = d; renderLockBox(); return d; }).catch(function () {});
  }
  function isLocked(kind, ref) { return (lockState.locked[kind] || []).indexOf(String(ref)) > -1; }
  function askPin(title, label, onOk) {
    dialog(title, function (box) {
      box.append(mk('label', 'lbl', label));
      var i = mk('input', 'edit w100'); i.type = 'password'; i.inputMode = 'numeric'; i.autocomplete = 'off';
      i.maxLength = 8; i.placeholder = '••••';
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('dlg-ok').click(); });
      box.append(i);
      return i;
    }, function (i) { return onOk(i.value.trim()); });
  }
  /* le code actuel, demandé une fois par visite de la page */
  function withPin(fn) {
    if (!lockState.pin) {
      return askPin(tr('Choisir un code parental'), tr('Nouveau code (4 à 8 chiffres)'), function (v) {
        return api('POST', '/api/lock/pin', { pin: v }).then(function () { pinCache = v; return loadLock(); }).then(function () { return fn(pinCache); });
      });
    }
    if (pinCache) return fn(pinCache).catch(function (e) { pinCache = ''; alert(e.message); });
    askPin(tr('Code parental'), tr('Code actuel'), function (v) {
      return fn(v).then(function (r) { pinCache = v; return r; });
    });
  }
  function toggleLock(kind, ref, on, then) {
    withPin(function (pin) {
      return api('POST', '/api/lock/set', { kind: kind, id: String(ref), on: on, current: pin }).then(function () { return loadLock(); }).then(then);
    });
  }
  function lockButton(kind, ref, then) {
    var on = isLocked(kind, ref);
    var b = mk('button', 'link lockbtn' + (on ? ' on' : ''), on ? '🔒 ' + tr('Verrouillé') : tr('Verrouiller'));
    b.title = tr(on ? 'Retirer le code parental de ce bouquet' : 'Demander le code parental sur la TV');
    b.onclick = function () { toggleLock(kind, ref, !on, then); };
    return b;
  }
  function renderLockBox() {
    var box = $('lockbox'); if (!box) return;
    box.textContent = '';
    var n = lockState.locked.live.length + lockState.locked.vod.length + lockState.locked.series.length;
    var txt = mk('div', '');
    txt.append(mk('strong', '', tr('Code parental')),
      mk('small', '', lockState.pin ? tr('Actif · {n} bouquet(s) verrouillé(s). Sur la TV, ils gardent un cadenas et demandent le code.', { n: n })
                                     : tr('Aucun code. Choisissez-en un pour verrouiller des bouquets (chaînes, films ou séries pour adultes).')));
    var acts = mk('div', 'acts');
    var set = mk('button', 'btn small', lockState.pin ? tr('Changer le code') : tr('Choisir un code'));
    set.onclick = function () {
      if (!lockState.pin) return withPin(function () { return Promise.resolve(); });
      withPin(function (cur) {
        return new Promise(function (ok) {
          askPin(tr('Nouveau code'), tr('Nouveau code (4 à 8 chiffres)'), function (v) {
            return api('POST', '/api/lock/pin', { pin: v, current: cur }).then(function () { pinCache = v; ok(); return loadLock(); });
          });
        });
      });
    };
    acts.append(set);
    if (lockState.pin) {
      var off = mk('button', 'link', tr('Retirer le code')); off.style.color = '#FF9DA1';
      off.onclick = function () {
        withPin(function (cur) {
          return api('POST', '/api/lock/pin', { pin: '', current: cur }).then(function () {
            pinCache = ''; return loadLock();
          }).then(function () { if (tab === 'cats') loadCats(); else loadBouquets(true); });
        });
      };
      acts.append(off);
    }
    box.append(txt, acts);
  }

  /* ---------- glisser-déposer ---------- */
  function makeSortable(list, onDrop) {
    var dragged = null;
    list.addEventListener('dragstart', function (e) {
      var li = e.target.closest('li'); if (!li) return;
      dragged = li; li.classList.add('drag'); e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', ''); } catch (err) { /* Firefox */ }
    });
    list.addEventListener('dragend', function () {
      if (dragged) dragged.classList.remove('drag');
      Array.prototype.forEach.call(list.children, function (n) { n.classList.remove('over'); });
      dragged = null;
    });
    list.addEventListener('dragover', function (e) {
      e.preventDefault();
      var li = e.target.closest('li');
      if (!li || li === dragged) return;
      Array.prototype.forEach.call(list.children, function (n) { n.classList.remove('over'); });
      li.classList.add('over');
    });
    list.addEventListener('drop', function (e) {
      e.preventDefault();
      var li = e.target.closest('li');
      if (!li || !dragged || li === dragged) return;
      var items = Array.prototype.slice.call(list.children);
      var from = items.indexOf(dragged), to = items.indexOf(li);
      list.insertBefore(dragged, from < to ? li.nextSibling : li);
      onDrop(from, to);
    });
  }

  /* ================= ABONNEMENTS ================= */
  function loadSubs() {
    return api('GET', '/api/providers').then(function (d) {
      setProviders(d.providers);
      var box = $('subs'); box.textContent = '';
      d.providers.forEach(function (p) { box.append(subCard(p, d.now)); });
    }).catch(function (e) { $('subs').textContent = tr('Erreur : {m}', { m: e.message }); });
  }
  function subCard(p, nowTs) {
    var card = mk('div', 'panel');
    var head = mk('div', 'head');
    var b = mk('span', 'srcb big', p.letter); b.style.background = p.color;
    head.append(b, mk('h2', '', p.name));
    var syncBtn = mk('button', 'btn small', tr('Synchroniser'));
    syncBtn.onclick = function () {
      api('POST', '/api/sync', { src: p.src }).then(function () { syncBtn.textContent = tr('En cours…'); status(); });
    };
    head.append(syncBtn);
    card.append(head);
    var kv = mk('div', 'kv'), a = p.account;
    function row(k, v, cls) { kv.append(mk('span', '', k)); var x = mk('span', cls || '', v); kv.append(x); return x; }
    if (a) {
      var st = (a.status || '').toLowerCase();
      row(tr('État'), st === 'active' ? tr('actif') : (a.status || '?'), st === 'active' ? 'state-ok' : 'state-bad');
      if (a.expires) {
        var cls = a.days_left <= 7 ? 'state-bad' : (a.days_left <= 30 ? 'state-warn' : 'state-ok');
        row(tr('Expire le'), day(a.expires));
        row(tr('Jours restants'), tr(a.days_left > 1 ? '{n} jours' : '{n} jour', { n: a.days_left }), cls);
      } else row(tr('Expire le'), tr('sans date d’expiration'));
      if (a.max_connections) {
        row(tr('Connexions'), tr('{a} utilisée(s) sur {m} autorisée(s)', { a: a.active_cons || 0, m: a.max_connections }));
      }
      if (a.trial) row(tr('Type'), tr('essai'), 'state-warn');
      if (a.fetched) row(tr('Relevé le'), when(a.fetched));
    } else row(tr('État'), tr('pas encore de réponse du fournisseur'), 'state-warn');
    row(tr('Catalogue'), tr('{l} chaînes, {v} films, {s} séries', { l: p.live, v: p.vod, s: p.series }));
    row(tr('Synchronisation'), p.last_sync ? when(p.last_sync) : tr('jamais'));
    if (p.status && p.status !== 'ok') row(tr('Dernière erreur'), p.status, 'state-bad');
    row(tr('Identifiant'), p.id);
    card.append(kv);
    if (a && a.expires && a.days_left !== null) {
      // jauge sur 30 jours : elle se vide à l'approche de l'échéance
      var m = mk('div', 'meter' + (a.days_left <= 7 ? ' bad' : (a.days_left <= 30 ? ' warn' : '')));
      var i = mk('i'); i.style.width = Math.max(3, Math.min(100, a.days_left / 30 * 100)) + '%'; m.append(i);
      card.append(m);
    }
    // pastille : lettre et couleur, réglables ici
    var tools = mk('div', 'tools');
    var l = mk('input', 'edit'); l.type = 'text'; l.maxLength = 2; l.value = p.letter; l.style.width = '64px';
    l.setAttribute('aria-label', tr('Lettre de la pastille'));
    var c = mk('input'); c.type = 'color'; c.value = p.color; c.setAttribute('aria-label', tr('Couleur de la pastille'));
    var save = mk('button', 'btn small', tr('Enregistrer la pastille'));
    save.onclick = function () {
      api('POST', '/api/providers/set', { src: p.src, letter: l.value, color: c.value }).then(loadSubs);
    };
    var auto = mk('button', 'link', tr('Automatique'));
    auto.onclick = function () { api('POST', '/api/providers/set', { src: p.src, letter: '', color: '' }).then(loadSubs); };
    tools.append(mk('span', 'help', tr('Pastille')), l, c, save);
    if (p.letter_set || p.color_set) tools.append(auto);
    tools.style.marginTop = '6px';
    card.append(tools);
    return card;
  }

  /* ================= BIBLIOTHÈQUE ================= */
  // films et séries séparés : les nombres et les titres ne concernent que le type choisi
  var libCats = [], libItems = [], libCat = 0, libKind = 'movie';
  Array.prototype.forEach.call(document.querySelectorAll('[data-lk]'), function (b) {
    b.onclick = function () {
      libKind = b.getAttribute('data-lk'); libCat = 0;
      Array.prototype.forEach.call(document.querySelectorAll('[data-lk]'), function (x) {
        x.setAttribute('aria-selected', String(x === b));
      });
      loadLib();
    };
  });
  function loadLib() {
    return api('GET', '/api/library?kind=' + libKind + '&sort=' + $('libsort').value + (libCat ? '&cat=' + libCat : '')).then(function (d) {
      libCats = d.cats; libItems = d.items;
      renderLibCats(d.total); renderLibItems(d.missing);
    }).catch(fail('libsum'));
  }
  function renderLibCats(total) {
    var ul = $('libcats'); ul.textContent = '';
    var all = mk('li', 'stack' + (!libCat ? ' sel' : ''));
    var top0 = mk('div', 'top'), b0 = mk('button', 'name link', tr(libKind === 'series' ? 'Toutes les séries' : 'Tous les films'));
    b0.style.cssText = 'text-align:left;color:inherit;padding:0;font-size:16px';
    b0.onclick = function () { libCat = 0; loadLib(); };
    top0.append(b0, mk('span', 'count', String(total))); all.append(top0); ul.append(all);
    libCats.forEach(function (c, i) {
      var li = mk('li', 'stack' + (c.id === libCat ? ' sel' : ''));
      var top = mk('div', 'top');
      var n = mk('button', 'name link', c.name); n.style.cssText = 'text-align:left;color:inherit;padding:0;font-size:16px';
      n.onclick = function () { libCat = c.id; loadLib(); };
      top.append(n, mk('span', 'count', String(c.count)));
      li.append(top);
      var acts = mk('div', 'acts');
      var up = mk('button', 'link', '▲'); up.title = tr('Monter'); up.disabled = i === 0;
      up.onclick = function () { api('POST', '/api/library/cats/move', { id: c.id, delta: -1 }).then(loadLib); };
      var dn = mk('button', 'link', '▼'); dn.title = tr('Descendre'); dn.disabled = i === libCats.length - 1;
      dn.onclick = function () { api('POST', '/api/library/cats/move', { id: c.id, delta: 1 }).then(loadLib); };
      var rn = mk('button', 'link', tr('Renommer'));
      rn.onclick = function () {
        askText(tr('Renommer la catégorie'), tr('Nom'), c.name, function (v) {
          return api('POST', '/api/library/cats/rename', { id: c.id, name: v }).then(loadLib);
        });
      };
      var del = mk('button', 'link', tr('Supprimer')); del.style.color = '#FF9DA1';
      del.onclick = function () {
        dialog(tr('Supprimer « {n} » ?', { n: c.name }), function (box) {
          box.append(mk('p', 'help', tr('Que deviennent ses {n} titres ?', { n: c.count })));
          var sel = mk('select', 'w100');
          var o0 = mk('option', '', tr('Ils quittent la Bibliothèque')); o0.value = ''; sel.append(o0);
          libCats.forEach(function (x) {
            if (x.id === c.id) return;
            var o = mk('option', '', tr('Les ranger dans « {n} »', { n: x.name })); o.value = x.id; sel.append(o);
          });
          box.append(sel);
          return sel;
        }, function (sel) {
          return api('DELETE', '/api/library/cats?id=' + c.id + (sel.value ? '&into=' + sel.value : ''))
            .then(function () { if (libCat === c.id) libCat = 0; return loadLib(); });
        }, tr('Supprimer'));
      };
      acts.append(up, dn, rn, del);
      li.append(acts);
      ul.append(li);
    });
  }
  function renderLibItems(missing) {
    var ul = $('libitems'), term = norm($('libq').value.trim()); ul.textContent = '';
    var shown = libItems.filter(function (it) { return !term || norm(it.name).indexOf(term) > -1; });
    if (!shown.length) ul.append(mk('li', 'empty', tr(libItems.length ? 'Rien ne correspond.' : 'Rien ici pour l’instant. Ajoutez des titres depuis le téléviseur (bouton « Bibliothèque » d’une fiche), ou depuis vos dossiers dans la section Médiathèque.')));
    shown.forEach(function (it) {
      var li = mk('li');
      li.append(posterNode(it));
      var n = mk('span', 'name'); n.append(document.createTextNode(it.name));
      n.append(mk('small', '', tr(it.kind === 'movie' ? 'Film' : 'Série')));
      li.append(n);
      var sel = mk('select'); sel.setAttribute('aria-label', tr('Catégorie'));
      libCats.forEach(function (c) { var o = mk('option', '', c.name); o.value = c.id; sel.append(o); });
      sel.value = it.lib_cat;
      sel.onchange = function () {
        api('POST', '/api/library/move', { kind: it.kind, id: it.id, cat: Number(sel.value) }).then(loadLib).catch(fail('libsum'));
      };
      var rm = mk('button', 'link', tr('Retirer')); rm.style.color = '#FF9DA1';
      rm.onclick = function () { api('POST', '/api/library/remove', { kind: it.kind, id: it.id }).then(loadLib); };
      li.append(sel, rm);
      ul.append(li);
    });
    $('libsum').textContent = tr('{n} titres', { n: shown.length }) +
      (missing ? ' · ' + tr('{n} retirés du catalogue par le fournisseur (ils reviendront s’il les remet)', { n: missing }) : '');
  }
  $('lib-new').onclick = function () {
    askText(tr('Nouvelle catégorie'), tr('Nom'), '', function (v) {
      return api('POST', '/api/library/cats', { name: v }).then(loadLib);
    }, tr('Créer'));
  };
  var lq; $('libq').oninput = function () { clearTimeout(lq); lq = setTimeout(function () { renderLibItems(0); }, 200); };
  $('libsort').onchange = loadLib;

  /* ================= MES BOUQUETS ================= */
  var bqKind = 'live';
  var KIND_LABEL = { live: 'chaînes', vod: 'films', series: 'séries' };
  function bqUnit() { return tr(KIND_LABEL[bqKind]); }

  function loadBouquets(keep) {
    loadLock();
    return api('GET', '/api/bouquets?kind=' + bqKind).then(function (d) {
      bqs = d.bouquets;
      if (!keep || !bqs.some(function (b) { return b.bouquet === curBq; })) curBq = bqs.length ? bqs[0].bouquet : null;
      renderBouquets();
      return curBq ? loadBqChannels() : renderBqChannels();
    }).catch(fail('bq-sum'));
  }
  function renderBouquets() {
    var ul = $('bqlist'); ul.textContent = '';
    if (!bqs.length) { ul.append(mk('li', 'empty', tr('Aucun bouquet pour l’instant.'))); return; }
    bqs.forEach(function (b, i) {
      var li = mk('li', 'stack' + (b.bouquet === curBq ? ' sel' : ''));
      var top = mk('div', 'top');
      top.append(mk('span', 'handle', '☰'));
      var n = mk('button', 'name link'); n.style.cssText = 'text-align:left;color:inherit;padding:0;font-size:16px';
      n.append(document.createTextNode(b.name));
      n.onclick = function () { curBq = b.bouquet; renderBouquets(); loadBqChannels(); };
      top.append(n, mk('span', 'count', b.count + ' ' + (bqKind === 'live' ? tr('ch.') : '')));
      li.append(top);
      var acts = mk('div', 'acts'); li.append(acts);
      var up = mk('button', 'link', '▲'); up.title = tr('Monter'); up.disabled = i === 0;
      up.onclick = function () { api('POST', '/api/bouquets/move', { id: b.bouquet, delta: -1 }).then(function () { loadBouquets(true); }); };
      var dn = mk('button', 'link', '▼'); dn.title = tr('Descendre'); dn.disabled = i === bqs.length - 1;
      dn.onclick = function () { api('POST', '/api/bouquets/move', { id: b.bouquet, delta: 1 }).then(function () { loadBouquets(true); }); };
      var rn = mk('button', 'link', tr('Renommer'));
      rn.onclick = function () {
        askText(tr('Renommer le bouquet'), tr('Nom'), b.name, function (v) {
          return api('POST', '/api/bouquets/rename', { id: b.bouquet, name: v }).then(function () { loadBouquets(true); });
        });
      };
      var del = mk('button', 'link', tr('Supprimer')); del.style.color = '#FF9DA1';
      del.onclick = function () {
        confirmBox(tr('Supprimer « {n} » ?', { n: b.name }), tr('Le bouquet disparaît de la TV. Le contenu lui-même n’est pas touché.'), function () {
          return api('DELETE', '/api/bouquets?id=' + b.bouquet).then(function () { curBq = null; loadBouquets(); });
        }, tr('Supprimer'));
      };
      acts.append(up, dn, rn, lockButton(bqKind, 'b' + b.bouquet, renderBouquets), del);
      ul.append(li);
    });
  }
  function loadBqChannels() {
    var path = bqKind === 'live' ? '/api/live?cat=b' + curBq
             : (bqKind === 'vod' ? '/api/vod?cat=b' + curBq + '&limit=200' : '/api/series?cat=b' + curBq + '&limit=200');
    return api('GET', path).then(function (d) {
      bqChans = d.channels || d.items || []; renderBqChannels();
    }).catch(fail('bq-sum'));
  }
  function renderBqChannels() {
    var ul = $('bqchans'); ul.textContent = '';
    $('bq-sum').textContent = bqChans.length + ' ' + bqUnit();
    var b = bqs.filter(function (x) { return x.bouquet === curBq; })[0];
    $('bq-title').textContent = b ? b.name : tr('Contenu');
    $('bq-add').disabled = !b;
    $('bq-renum').disabled = !b || bqKind !== 'live';
    $('bq-renum').classList.toggle('hidden', bqKind !== 'live');
    $('bq-add').textContent = tr('Ajouter des {u}', { u: bqUnit() });
    $('bq-hint').textContent = bqKind === 'live'
      ? tr("Glissez les lignes pour changer l'ordre. Cet ordre sert aussi à la renumérotation.")
      : tr("Glissez les lignes pour changer l'ordre d'affichage sur la TV.");
    if (!b) { ul.append(mk('li', 'empty', tr('Créez un bouquet pour commencer.'))); $('bq-sum').textContent = ''; return; }
    if (!bqChans.length) { ul.append(mk('li', 'empty', tr('Bouquet vide. Utilisez « Ajouter des {u} ».', { u: bqUnit() }))); }
    bqChans.forEach(function (c) {
      var li = mk('li'); li.draggable = true;
      li.append(mk('span', 'handle', '☰'));
      if (bqKind === 'live') {
        // le numéro dans ce bouquet : un clic pour le changer (vide = son numéro habituel)
        var num = mk('button', 'count num-edit' + (c.num_own ? ' own' : ''), String(c.num));
        num.title = tr('Numéro dans ce bouquet');
        num.onclick = function (e) {
          e.stopPropagation();
          askText(tr('Numéro de {n} dans « {b} »', { n: c.name, b: $('bq-title').textContent }),
                  tr('Numéro (vide : son numéro habituel)'), c.num_own ? String(c.num) : '', function (v) {
            return api('POST', '/api/bouquets/number', { id: curBq, chan: c.id, num: v.trim() }).then(loadBqChannels);
          });
        };
        li.append(num, srcNode(c), logoNode(c));
      }
      else li.append(posterNode(c));
      var n = mk('span', 'name'); n.append(document.createTextNode(c.name));
      if (c.orig_name && c.orig_name !== c.name) n.append(mk('small', '', tr('Fournisseur : {n}', { n: c.orig_name })));
      li.append(n);
      if (bqKind === 'live') tags(c).forEach(function (t) { li.append(t); });
      var rm = mk('button', 'link', tr('Retirer')); rm.style.color = '#FF9DA1';
      rm.onclick = function () {
        api('POST', '/api/bouquets/remove', { id: curBq, channels: [c.id] }).then(function () { loadBouquets(true); });
      };
      li.append(rm);
      ul.append(li);
    });

  }
  makeSortable($('bqchans'), function () {
    var ids = Array.prototype.map.call($('bqchans').children, function (li, i) { return bqChans[i] && bqChans[i].id; });
    // l'ordre du DOM a changé : on relit les identifiants dans leur nouvel ordre
    var order = [], nodes = Array.prototype.slice.call($('bqchans').children);
    var before = bqChans.slice();
    nodes.forEach(function (node) {
      var name = node.querySelector('.name') ? node.querySelector('.name').firstChild.textContent : '';
      var idx = before.findIndex(function (c) { return c && c.name === name; });
      if (idx >= 0) { order.push(before[idx].id); before[idx] = null; }
    });
    if (order.length !== bqChans.length) { loadBqChannels(); return; }
    api('POST', '/api/bouquets/items', { id: curBq, channels: order })
      .then(function () { say('bq-sum', tr('Ordre enregistré')); loadBqChannels(); }).catch(fail('bq-sum'));
    void ids;
  });
  document.querySelectorAll('[data-bqk]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('[data-bqk]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      bqKind = b.dataset.bqk; curBq = null;
      loadBouquets();
    };
  });
  $('bq-new').onclick = function () {
    askText(tr('Nouveau bouquet'), tr('Nom'), '', function (v) {
      return api('POST', '/api/bouquets/create', { name: v || tr('Nouveau bouquet'), kind: bqKind })
        .then(function (r) { curBq = r.id; return loadBouquets(true); });
    }, tr('Créer'));
  };
  $('bq-from-cat').onclick = function () {
    api('GET', '/api/categories?all=1&kind=' + bqKind).then(function (d) {
      var provider = d.filter(function (c) { return !c.own; });
      dialog(tr('Créer depuis une catégorie du fournisseur'), function (box) {
        box.append(mk('label', 'lbl', tr('Catégorie')));
        var sel = mk('select', 'w100');
        provider.forEach(function (c) { var o = mk('option', '', srcPrefix(c) + c.name + ' (' + c.count + ')'); o.value = c.id; sel.append(o); });
        box.append(sel);
        box.append(mk('label', 'lbl', tr('Nom du bouquet')));
        var i = mk('input', 'edit w100'); i.type = 'text';
        i.value = provider.length ? provider[0].name : '';
        sel.onchange = function () { i.value = provider.filter(function (c) { return c.id === sel.value; })[0].name; };
        box.append(i);
        return { sel: sel, i: i };
      }, function (c) {
        return api('POST', '/api/bouquets/create', { name: c.i.value.trim(), cats: [c.sel.value], kind: bqKind })
          .then(function (r) { curBq = r.id; return loadBouquets(true); });
      }, tr('Créer'));
    });
  };
  $('bq-renum').onclick = function () {
    dialog(tr('Renuméroter « {n} »', { n: $('bq-title').textContent }), function (box) {
      box.append(mk('p', 'help', tr('Les chaînes du bouquet sont numérotées dans leur ordre actuel, pour ce bouquet.')));
      box.append(mk('label', 'lbl', tr('Premier numéro')));
      var i = mk('input', 'edit'); i.type = 'text'; i.inputMode = 'numeric'; i.value = '1'; box.append(i);
      box.append(mk('label', 'lbl', tr('Pas')));
      var s = mk('input', 'edit'); s.type = 'text'; s.inputMode = 'numeric'; s.value = '1'; box.append(s);
      var lab = mk('label', 'chk'), ev = mk('input'); ev.type = 'checkbox';
      lab.append(ev, mk('span', '', tr('Utiliser aussi ces numéros dans « Toutes les chaînes » et les autres listes')));
      box.append(lab);
      box.append(mk('p', 'help', tr('Sinon, ces numéros ne valent que dans ce bouquet : une chaîne peut avoir un autre numéro ailleurs.')));
      return { i: i, s: s, ev: ev };
    }, function (c) {
      return api('POST', '/api/bouquets/renumber', { id: curBq, start: c.i.value, step: c.s.value, everywhere: c.ev.checked })
        .then(function (r) { say('bq-sum', tr('{n} chaînes renumérotées', { n: r.renumbered })); return loadBqChannels(); });
    }, tr('Renuméroter'));
  };
  $('bq-add').onclick = function () {
    api('GET', '/api/categories?all=1&kind=' + bqKind).then(function (d) {
      var provider = d.filter(function (c) { return !c.own; });
      dialog(tr('Ajouter des {u}', { u: bqUnit() }), function (box) {
        var tools = mk('div', 'tools');
        var q = mk('input'); q.type = 'search'; q.placeholder = tr('Rechercher'); q.className = 'grow';
        var sel = mk('select');
        var optAll = mk('option', '', tr('Toutes les catégories')); optAll.value = 'all'; sel.append(optAll);
        provider.forEach(function (c) { var o = mk('option', '', srcPrefix(c) + c.name); o.value = c.id; sel.append(o); });
        var all = mk('button', 'btn small', tr('Tout cocher'));
        tools.append(q, sel, all); box.append(tools);
        var ul = mk('ul', 'scroll'); ul.style.maxHeight = '320px'; box.append(ul);
        var info = mk('p', 'help', ''); box.append(info);
        var current = [];
        function load() {
          var url = bqKind === 'live'
            ? '/api/channels/admin?cat=' + encodeURIComponent(sel.value || 'all') + '&q=' + encodeURIComponent(q.value)
            : (sel.value && sel.value !== 'all'
                ? '/api/' + (bqKind === 'vod' ? 'vod' : 'series') + '?cat=' + encodeURIComponent(sel.value) + '&limit=200&sort=nom'
                : '/api/search?q=' + encodeURIComponent(q.value));
          api('GET', url).then(function (res) {
            var list = bqKind === 'live' ? res
                     : (res.items || (bqKind === 'vod' ? res.vod : res.series) || []);
            var have = {};
            bqChans.forEach(function (c) { have[c.id] = 1; });
            var term = q.value.trim().toLowerCase();
            current = list.filter(function (c) {
              if (have[c.id]) return false;
              if (bqKind !== 'live' && term && c.name.toLowerCase().indexOf(term) < 0) return false;
              return true;
            });
            ul.textContent = '';
            if (!current.length) ul.append(mk('li', 'empty', tr(bqKind === 'live' ? 'Aucune chaîne à ajouter ici.'
              : 'Rien à ajouter ici. Choisissez un bouquet, ou tapez au moins deux lettres.')));
            current.forEach(function (c) {
              var li = mk('li');
              var cb = mk('input'); cb.type = 'checkbox'; cb.value = c.id; cb.className = 'pick';
              li.append(cb);
              if (bqKind === 'live') li.append(logoNode(c), mk('span', 'count', String(c.num)), srcNode(c));
              else li.append(posterNode(c));
              li.append(mk('span', 'name', c.name));
              if (bqKind === 'live') tags(c).forEach(function (t) { li.append(t); });
              ul.append(li);
            });
            info.textContent = tr('{n} {u} disponibles', { n: current.length, u: bqUnit() });
          });
        }
        var t; q.oninput = function () { clearTimeout(t); t = setTimeout(load, 300); };
        sel.onchange = load;
        all.onclick = function () {
          var boxes = ul.querySelectorAll('.pick'), on = !boxes[0] || !boxes[0].checked;
          Array.prototype.forEach.call(boxes, function (b) { b.checked = on; });
        };
        load();
        return ul;
      }, function (ul) {
        var ids = Array.prototype.map.call(ul.querySelectorAll('.pick:checked'), function (b) { return Number(b.value); });
        if (!ids.length) return Promise.resolve();
        return api('POST', '/api/bouquets/add', { id: curBq, channels: ids })
          .then(function (r) { say('bq-sum', tr('{n} {u} ajoutés', { n: r.added, u: bqUnit() })); return loadBouquets(true); });
      }, tr('Ajouter'));
    });
  };

  /* ================= CHAÎNES ================= */
  function fillCatSelect(id, kind) {
    return api('GET', '/api/categories?all=1&kind=' + (kind || 'live')).then(function (d) {
      var sel = $(id), cur = sel.value; sel.length = 1;
      d.forEach(function (c) {
        var o = mk('option', '', (c.own ? '★ ' : '') + srcPrefix(c) + c.name + (c.hidden ? tr(' (masqué)') : ''));
        o.value = c.id; sel.append(o);
      });
      sel.value = cur;
    });
  }
  function loadChans() {
    return api('GET', '/api/channels/admin?cat=' + encodeURIComponent($('ccat').value) + '&q=' + encodeURIComponent($('cq').value.trim()))
      .then(function (d) { chans = d; renderChans(); }).catch(fail('csummary'));
  }
  function renderChans() {
    var ul = $('clist'); ul.textContent = '';
    var used = {}; chans.forEach(function (c) { used[c.num] = (used[c.num] || 0) + 1; });
    if (!chans.length) ul.append(mk('li', 'empty', tr('Aucune chaîne.')));
    chans.forEach(function (c) {
      var li = mk('li', c.hidden ? 'off' : '');
      var num = mk('input', 'edit num'); num.inputMode = 'numeric'; num.value = c.num;
      num.setAttribute('aria-label', tr('Numéro de {n}', { n: c.name }));
      if (used[c.num] > 1) { num.style.color = '#FFB37A'; num.title = tr('Ce numéro est utilisé par plusieurs chaînes'); }
      var wrap = mk('div'); wrap.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px';
      var name = mk('input', 'edit title'); name.value = c.name; name.setAttribute('aria-label', tr('Nom de la chaîne'));
      wrap.append(name, mk('span', 'orig', c.manual ? tr('Ajoutée à la main · n° {n} · {o}', { n: c.orig_num, o: c.orig_name })
        : tr('Fournisseur : n° {n} · {o}', { n: c.orig_num, o: c.orig_name }) + (c.cat_name ? ' · ' + c.cat_name : '')));
      var state = mk('span', 'ok', '');
      li.append(srcNode(c), logoNode(c), num, wrap);
      tags(c).forEach(function (t) { li.append(t); });
      if (c.epg) { var e = mk('span', 'tag epg', tr('Guide')); e.title = c.epg; li.append(e); }
      li.append(state);
      var lg = mk('button', 'btn small', tr('Logo'));
      lg.onclick = function () { editLogo(c); };
      li.append(lg);
      if (c.manual) {
        var lk = mk('button', 'link', tr('Lien'));
        lk.onclick = function () { editManualUrl(c); };
        var del = mk('button', 'link danger', tr('Supprimer'));
        del.onclick = function () {
          confirmBox(tr('Supprimer « {n} »', { n: c.name }), tr('Cette chaîne ajoutée à la main sera retirée de Luciole, de vos bouquets et de vos favoris.'), function () {
            return api('POST', '/api/manual/remove', { ids: [c.id] }).then(function () { fillCatSelect('ccat').then(loadChans); });
          }, tr('Supprimer'));
        };
        li.append(lk, del);
      }
      if (c.custom) {
        var r = mk('button', 'link', tr('Rétablir'));
        r.onclick = function () { send(c, null, null, state); };
        li.append(r);
      }
      function commit() {
        var n = num.value.trim(), t = name.value.trim();
        if (String(c.num) === n && c.name === t) return;
        send(c, t === c.orig_name ? null : t, n === String(c.orig_num) ? null : n, state);
      }
      [num, name].forEach(function (inp) {
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') inp.blur();
          if (e.key === 'Escape') { num.value = c.num; name.value = c.name; inp.blur(); }
        });
        inp.addEventListener('change', commit);
      });
      ul.append(li);
    });
    $('csummary').textContent = tr('{n} chaînes', { n: chans.length }) + (chans.length >= 3000 ? tr(' (affinez la recherche)') : '');
  }
  function editLogo(c) {
    var ctx = { kind: 'live', id: c.id, data: { logo: c.logo, name: c.name } };
    dialog(tr('Logo de {n}', { n: c.name }), function (box) {
      box.append(mk('p', 'help', tr('Collez une adresse web, ou choisissez un fichier sur votre PC. L’image est copiée sur le serveur ; « Rétablir » revient au logo du fournisseur. Le fond noir est retiré automatiquement ; si le résultat n’est pas bon, envoyez une version PNG transparente.')));
      artBox(box, tr('Logo'), 'logo', ctx);
      return null;
    }, null, tr('Fermer'));
  }
  function send(c, name, num, state) {
    api('POST', '/api/channels/edit', { id: c.id, name: name, num: num }).then(function (r) {
      state.textContent = tr('✓ Enregistré');
      if (r.same_number) say('csummary', tr('Attention : ce numéro est aussi celui de « {n} ».', { n: r.same_number }), true);
      setTimeout(loadChans, 600);
    }).catch(function (e) { state.textContent = ''; fail('csummary')(e); });
  }
  /* chaînes ajoutées à la main : un lien, ou une liste M3U (adresse ou texte collé) */
  function editManualUrl(c) {
    api('GET', '/api/manual').then(function (list) {
      var m = list.filter(function (x) { return x.id === c.id; })[0];
      askText(tr('Lien de « {n} »', { n: c.name }), tr('Adresse du flux'), m ? m.url : '', function (v) {
        return api('POST', '/api/manual/edit', { id: c.id, url: v }).then(function () { say('csummary', tr('Lien enregistré.')); });
      }, tr('Enregistrer'));
    }).catch(fail('csummary'));
  }
  $('man-add').onclick = function () {
    api('GET', '/api/bouquets?kind=live').then(function (d) {
      var mode = 'one';
      dialog(tr('Ajouter une chaîne'), function (box) {
        var tabs = mk('div', 'tabs'); tabs.style.margin = '0 0 6px';
        var t1 = mk('button', '', tr('Un lien')), t2 = mk('button', '', tr('Une liste M3U'));
        tabs.append(t1, t2); box.append(tabs);
        var one = mk('div'), many = mk('div');
        function field(parent, label, type, ph) {
          parent.append(mk('label', 'lbl', label));
          var i = mk(type === 'area' ? 'textarea' : 'input', 'edit w100');
          if (type !== 'area') i.type = type; if (ph) i.placeholder = ph;
          parent.append(i); return i;
        }
        var f = {
          name: field(one, tr('Nom'), 'text', tr('Ma chaîne')),
          url: field(one, tr('Adresse du flux'), 'url', 'https://…/index.m3u8'),
          logo: field(one, tr('Logo (adresse d’une image, facultatif)'), 'url', 'https://…/logo.png'),
          num: field(one, tr('Numéro (facultatif)'), 'number', ''),
          list: field(many, tr('Adresse de la liste M3U'), 'url', 'https://…/liste.m3u'),
          text: field(many, tr('… ou collez son contenu ici'), 'area', '#EXTM3U\n#EXTINF:-1 tvg-logo="…",Nom\nhttps://…')
        };
        f.text.style.minHeight = '160px';
        many.append(mk('p', 'help', tr('Chaque entrée #EXTINF devient une chaîne, avec son nom et son logo. Les liens déjà présents sont ignorés.')));
        box.append(one, many);
        box.append(mk('label', 'lbl', tr('Ajouter aussi au bouquet')));
        var sel = mk('select', 'w100'); sel.append(mk('option', '', tr('Aucun (seulement « Mes liens »)')));
        sel.options[0].value = '';
        (d.bouquets || []).forEach(function (b) { var o = mk('option', '', b.name); o.value = b.bouquet; sel.append(o); });
        box.append(sel);
        function show(m) {
          mode = m; one.hidden = m !== 'one'; many.hidden = m !== 'many';
          t1.setAttribute('aria-selected', m === 'one'); t2.setAttribute('aria-selected', m === 'many');
        }
        t1.onclick = function () { show('one'); }; t2.onclick = function () { show('many'); };
        show('one');
        f.sel = sel; return f;
      }, function (f) {
        var bq = f.sel.value ? Number(f.sel.value) : 0;
        var req = mode === 'one'
          ? api('POST', '/api/manual/add', { name: f.name.value.trim(), url: f.url.value.trim(), logo: f.logo.value.trim(),
                                            num: f.num.value.trim(), bouquet: bq })
          : api('POST', '/api/manual/import', { url: f.list.value.trim(), text: f.text.value, bouquet: bq });
        return req.then(function (r) {
          say('csummary', r.added ? tr('{n} chaîne(s) ajoutée(s) dans « Mes liens ».', { n: r.added })
                                  : tr('Rien de nouveau : ces liens sont déjà là.'));
          $('ccat').value = 'manual';
          return fillCatSelect('ccat').then(function () { $('ccat').value = 'manual'; return loadChans(); });
        });
      }, tr('Ajouter'));
    }).catch(fail('csummary'));
  };
  $('num-reset').onclick = function () {
    confirmBox(tr('Numéros d’origine'), tr('Tous les numéros que vous avez choisis seront oubliés. Les noms sont conservés.'), function () {
      return api('POST', '/api/numbers/reset', {}).then(loadChans);
    }, tr('Rétablir'));
  };

  /* ================= MÉDIATHÈQUE ================= */
  var mKind = 'movie', mTimer = null, mItems = [], mRoots = [];
  var mConv = { enabled: false }, cJobs = {}, cTimer = null;
  /* le dossier choisi à gauche : il filtre « Contenu » et « Choisir pour la Bibliothèque » */
  var mRoot = (function () { try { return Number(localStorage.getItem('luciole.web.mroot')) || 0; } catch (e) { return 0; } })();
  function setRoot(id) {
    mRoot = Number(id) || 0;
    try { localStorage.setItem('luciole.web.mroot', mRoot); } catch (e) {}
    renderRoots();
    $('proot').value = mRoot || '';
    pSel = {}; pLast = null;
    // un dossier de séries montre les séries, un dossier de films les films
    var r = mRoots.filter(function (x) { return x.id === mRoot; })[0];
    var want = r && r.kind === 'series' ? 'series' : r && r.kind === 'films' ? 'movie' : null;
    if (want) {
      pKind = want;
      document.querySelectorAll('[data-pk]').forEach(function (x) { x.setAttribute('aria-selected', x.dataset.pk === want); });
      if (mKind !== 'probleme') {
        mKind = want === 'series' ? 'episode' : 'movie';
        document.querySelectorAll('[data-mk]').forEach(function (x) { x.setAttribute('aria-selected', x.dataset.mk === mKind); });
      }
    }
    loadMediaItems(); loadPick();
  }
  function renderRoots() {
    var ul = $('mroots'); ul.textContent = '';
    if (!mRoots.length) { ul.append(mk('li', 'empty', tr('Aucun dossier déclaré.'))); }
    else {
      var total = mRoots.reduce(function (a, r) { return a + (r.count || 0); }, 0);
      var all = mk('li', 'root-pick' + (!mRoot ? ' sel' : ''));
      var w0 = mk('div'); w0.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px';
      w0.append(mk('span', 'title', tr('Tous les dossiers')), mk('span', 'orig', tr('{n} fichiers', { n: total })));
      all.append(w0); all.onclick = function () { setRoot(0); };
      ul.append(all);
    }
    mRoots.forEach(function (r) {
      var li = mk('li', 'root-pick' + (r.id === mRoot ? ' sel' : ''));
      li.title = tr('Ne montrer que ce dossier');
      var wrap = mk('div'); wrap.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px';
      wrap.append(mk('span', 'title', r.name || r.path),
                  mk('span', 'orig', r.path + ' · ' + tr({ films: 'films', series: 'séries', auto: 'détection auto' }[r.kind] || r.kind) +
                     (r.count ? ' · ' + tr('{n} fichiers', { n: r.count }) : '') + (r.status ? ' · ' + r.status : '')));
      if (r.writable === false) wrap.append(mk('span', 'orig warn', tr('lecture seule pour Luciole : le son ne peut pas y être converti')));
      var del = mk('button', 'link danger', tr('Retirer'));
      del.onclick = function (e) {
        e.stopPropagation();
        confirmBox(tr('Retirer ce dossier'), tr('Ses films et épisodes quittent le catalogue. Les fichiers ne sont pas touchés.'), function () {
          api('POST', '/api/medias/remove', { id: r.id }).then(function () { if (mRoot === r.id) mRoot = 0; return loadMedias(); })
            .then(loadMediaItems).then(loadPick).catch(fail('msummary'));
        });
      };
      li.onclick = function () { setRoot(r.id === mRoot ? 0 : r.id); };
      li.append(wrap, del);
      ul.append(li);
    });
    var cur = mRoots.filter(function (r) { return r.id === mRoot; })[0];
    $('mhead').textContent = cur ? tr('Contenu de « {n} »', { n: cur.name || cur.path }) : tr('Contenu');
    renderConv();
  }

  function loadMedias() {
    return api('GET', '/api/medias').then(function (d) {
      mRoots = d.roots; mConv = d.convert || { enabled: false };
      if (mRoot && !d.roots.some(function (r) { return r.id === mRoot; })) mRoot = 0;
      fillPickRoots(d.roots);
      $('proot').value = mRoot || '';
      renderRoots();
      loadConv();
      var bits = [];
      bits.push(tr(d.tmdb ? 'Fiches TMDB activées' : 'Aucune clé TMDB : pas de jaquettes ni de résumés'));
      bits.push(tr(d.ffprobe ? 'Analyse des pistes disponible' : 'ffprobe absent : compatibilité non vérifiée'));
      $('msummary').textContent = bits.join(' · ');
      var st = $('mstate');
      if (d.running) {
        st.textContent = tr('Analyse en cours…');
        clearTimeout(mTimer); mTimer = setTimeout(function () { loadMedias(); loadMediaItems(); loadPick(); }, 3000);
      } else if (d.last) {
        st.textContent = tr('Dernière analyse : {n} fichiers vus, {f} films et {s} séries mis à jour', { n: d.last.seen, f: d.last.films, s: d.last.series }) +
          (d.last.films_sans_fiche || d.last.series_sans_fiche
            ? ' · ' + tr('{n} sans fiche', { n: d.last.films_sans_fiche + d.last.series_sans_fiche }) : '');
      } else {
        st.textContent = '';
      }
    }).catch(fail('msummary'));
  }

  function loadMediaItems() {
    return api('GET', '/api/medias/items?kind=' + mKind + (mRoot ? '&root=' + mRoot : '') + '&q=' + encodeURIComponent($('mq').value.trim()))
      .then(function (d) { mItems = d.items; renderMediaItems(); }).catch(fail('mcount'));
  }

  function renderMediaItems() {
    var ul = $('mlist'); ul.textContent = '';
    if (!mItems.length) ul.append(mk('li', 'empty', tr('Rien à afficher.')));
    mItems.forEach(function (it) {
      var li = mk('li');
      var wrap = mk('div'); wrap.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px';
      var title = it.title + (it.year ? ' (' + it.year + ')' : '') +
        (it.kind === 'episode' ? ' · S' + (it.season || 0) + 'E' + (it.episode || 0) : '');
      var tech = [];
      if (it.height) tech.push(it.height + 'p');
      if (it.video) tech.push(it.video);
      if (it.audio) tech.push(it.audio);
      if (it.size) tech.push(Math.round(it.size / 1048576) + ' Mo');
      wrap.append(mk('span', 'title', it.published || title));
      if (it.published && it.published !== title) wrap.append(mk('span', 'orig', tr('fichier : {n}', { n: title })));
      wrap.append(mk('span', 'orig', it.path));
      if (tech.length) wrap.append(mk('span', 'orig', tech.join(' · ')));
      if (it.kind === 'movie' && it.versions > 1) {
        wrap.append(mk('span', 'orig ver', tr('Version {v} · une des {n} versions de ce film', { v: it.version_label, n: it.versions }) +
          (it.pref ? ' · ' + tr('démarre en priorité') : it.has_pref ? '' : ' · ' + tr('choix automatique'))));
      }
      li.append(wrap);
      if (!it.playable) li.append(mk('span', 'tag danger', tr('illisible')));
      else if (!it.matched) li.append(mk('span', 'tag', tr('sans fiche')));
      var job = cJobs[it.id];
      if (job && (job.state === 'attente' || job.state === 'en cours')) {
        li.append(mk('span', 'tag run', job.state === 'en cours' ? tr('conversion {p} %', { p: job.pct }) : tr('en attente')));
      } else if (it.fixable && mConv.enabled) {
        var cv = mk('button', 'link', tr('Convertir le son'));
        cv.onclick = function () { convertFiles({ ids: [it.id] }); };
        li.append(cv);
      }
      if (it.kind === 'movie' && it.versions > 1) {
        var vb = mk('button', 'link', tr(it.pref ? 'Remettre en automatique' : 'Démarrer celle-ci'));
        vb.onclick = function () {
          api('POST', '/api/movie/version', { id: it.vod, file: it.pref ? 0 : it.id }).then(loadMediaItems).catch(fail('mcount'));
        };
        li.append(vb);
      }
      if (it.kind === 'movie' && it.versions > 1) {
        var nb = mk('button', 'link', tr('Nommer la version'));
        nb.onclick = function () {
          askText(tr('Nom de cette version'), it.edition ? tr('Lu dans le nom du fichier : « {e} ». Laissez vide pour le garder.', { e: it.edition })
                                                        : tr('Par exemple « Version longue » ou « Copie 35 mm ». Laissez vide pour n’en mettre aucun.'),
            it.vlabel, function (v) {
              return api('POST', '/api/movie/version/label', { file: it.id, label: v }).then(loadMediaItems);
            }, tr('Enregistrer'));
        };
        li.append(nb);
      }
      var fix = mk('button', 'link', tr('Corriger la fiche'));
      fix.onclick = function () { pickMatch(it); };
      li.append(fix);
      if (it.note) ul.append(li), ul.append(mk('li', 'empty', it.note));
      else ul.append(li);
    });
    var nfix = mItems.filter(function (it) { return it.fixable; }).length, hlp = $('mfixhelp');
    hlp.hidden = mKind !== 'probleme';
    hlp.textContent = mKind !== 'probleme' ? '' :
      (nfix && !mConv.enabled ? tr('Le son de {n} fichiers peut être converti par Luciole si vous l’autorisez à écrire dans vos dossiers (voir la documentation du serveur, « Conversion du son »). ', { n: nfix }) : '') +
      tr('Luciole ne convertit que le son. Une vidéo que le téléviseur ne lit pas se réencode en dehors de Luciole, par exemple avec HandBrake.');
    $('mcount').textContent = tr('{n} éléments', { n: mItems.length }) + (mItems.length >= 400 ? tr(' (affinez la recherche)') : '');
  }

  /* recherche TMDB pour rattacher le bon film ou la bonne série */
  function pickMatch(it) {
    var kind = it.kind === 'episode' ? 'tv' : 'movie';
    askText(tr('Corriger la fiche'), tr('Titre à chercher sur TMDB'), it.title || '', function (term) {
      if (!term) return;
      return api('GET', '/api/medias/search?kind=' + kind + '&q=' + encodeURIComponent(term))
        .then(function (d) {
          if (!d.results.length) throw new Error(tr('aucun résultat sur TMDB'));
          var chosen = null;
          setTimeout(function () {
            dialog(tr('Choisir la fiche'), function (box) {
              d.results.forEach(function (r) {
                var b = mk('button', 'btn wide', (r.title || '') + (r.year ? ' (' + r.year + ')' : ''));
                b.onclick = function () { chosen = r.id; $('dlg-ok').click(); };
                if (r.plot) b.title = r.plot;
                box.append(b);
              });
              return null;
            }, function () {
              if (!chosen) return;
              var body = kind === 'tv' ? { kind: 'tv', show: it.show || 0, tmdb: chosen }
                                       : { kind: 'movie', id: it.id, tmdb: chosen };
              return api('POST', '/api/medias/match', body).then(loadMediaItems);
            }, tr('Annuler'));
          }, 60);
        });
    });
  }

  /* ---------- conversion du son ---------- */
  function loadConv() {
    if (!mConv.enabled) { cJobs = {}; renderConv(); return Promise.resolve(); }
    return api('GET', '/api/medias/convert').then(function (d) {
      var was = Object.keys(cJobs).filter(function (k) { return cJobs[k].state === 'en cours' || cJobs[k].state === 'attente'; }).length;
      cJobs = {}; mConv.jobs = d.jobs; mConv.keep = d.keep; mConv.running = d.running;
      d.jobs.forEach(function (j) { cJobs[j.id] = j; });
      renderConv();
      var now = d.jobs.filter(function (j) { return j.state === 'en cours' || j.state === 'attente'; }).length;
      clearTimeout(cTimer);
      if (now) {
        cTimer = setTimeout(loadConv, 2000);
        if (mKind === 'probleme' || now !== was) renderMediaItems();
      } else if (was) {                         // la file vient de se vider : les listes changent
        loadMedias(); loadMediaItems();
      }
    }).catch(function () {});
  }
  function convertFiles(body) {
    return api('POST', '/api/medias/convert', body).then(function (d) {
      if (!d.added) $('mstate').textContent = tr('Rien à convertir ici.');
      return loadConv().then(renderMediaItems);
    }).catch(fail('mstate'));
  }
  function renderConv() {
    var box = $('mconv'); box.textContent = '';
    box.hidden = !mConv.enabled;
    if (!mConv.enabled) return;
    box.append(mk('h3', '', tr('Conversion du son')));
    box.append(mk('p', 'help', tr('Le son que le téléviseur ne lit pas (DTS, TrueHD…) est converti en AC3 5.1. L’image et les sous-titres sont recopiés tels quels. La vidéo, elle, se réencode en dehors de Luciole.')));
    if (!mConv.ffmpeg) { box.append(mk('p', 'help warn', tr('ffmpeg n’est pas installé sur le serveur : relancez le script d’installation.'))); return; }
    var lab = mk('label', 'chk'), cb = mk('input'); cb.type = 'checkbox'; cb.checked = !!mConv.keep;
    lab.append(cb, mk('span', '', tr('Garder l’original, dans le dossier caché .luciole-originaux du dossier (sinon il est supprimé après vérification)')));
    cb.onchange = function () { api('POST', '/api/medias/convert/keep', { keep: cb.checked }).then(function (d) { mConv.keep = d.keep; }).catch(fail('mstate')); };
    box.append(lab);
    var cur = mRoots.filter(function (r) { return r.id === mRoot; })[0];
    var n = cur ? cur.fixable : mRoots.reduce(function (a, r) { return a + (r.fixable || 0); }, 0);
    var row = mk('div', 'tools');
    var go = mk('button', 'btn main', n ? tr(cur ? 'Convertir le son de ce dossier ({n})' : 'Convertir tout le son illisible ({n})', { n: n }) : tr('Aucun son à convertir'));
    go.disabled = !n || (cur && cur.writable === false);
    go.onclick = function () {
      confirmBox(tr('Convertir le son'), tr('{n} fichiers seront réécrits, l’un après l’autre. Comptez quelques minutes par film ; vous pouvez fermer la page.', { n: n }) +
        (mConv.keep ? ' ' + tr('Les originaux seront gardés dans .luciole-originaux.') : ' ' + tr('Les originaux seront supprimés après vérification.')), function () {
        return convertFiles({ root: mRoot || 0 });
      }, tr('Convertir'));
    };
    row.append(go);
    var jobs = (mConv.jobs || []).slice().reverse();
    var busy = jobs.some(function (j) { return j.state === 'attente' || j.state === 'en cours'; });
    if (busy) { var st = mk('button', 'btn danger', tr('Arrêter')); st.onclick = function () { api('POST', '/api/medias/convert/cancel', {}).then(loadConv); }; row.append(st); }
    else if (jobs.length) { var cl = mk('button', 'btn', tr('Effacer la liste')); cl.onclick = function () { api('POST', '/api/medias/convert/forget', {}).then(loadConv); }; row.append(cl); }
    box.append(row);
    if (!jobs.length) return;
    var ul = mk('ul', 'jobs');
    jobs.slice(0, 12).forEach(function (j) {
      var li = mk('li'), nm = mk('div', 'nm');
      var cls = { 'fait': 'ok', 'erreur': 'bad', 'en cours': 'run' }[j.state] || '';
      nm.append(mk('b', '', j.title), mk('span', 'st ' + cls, j.state === 'en cours' ? j.pct + ' %' : tr(j.state)));
      li.append(nm);
      if (j.state === 'en cours') { var b = mk('div', 'bar'), i = mk('i'); i.style.width = j.pct + '%'; b.append(i); li.append(b); }
      if (j.msg) li.append(mk('div', 'why', tr(j.msg)));
      ul.append(li);
    });
    box.append(ul);
    if (jobs.length > 12) box.append(mk('p', 'help', tr('… et {n} autres', { n: jobs.length - 12 })));
  }

  /* ---------- choisir pour la Bibliothèque, depuis les dossiers ---------- */
  var pKind = 'movie', pItems = [], pCats = [], pSel = {}, pLast = null, pBusy = false;

  function loadPick() {
    var root = $('proot').value;
    return api('GET', '/api/medias/titles?kind=' + pKind + (root ? '&root=' + root : '')).then(function (d) {
      pItems = d.items; pCats = d.cats;
      var keep = {}; pItems.forEach(function (it) { if (pSel[it.id]) keep[it.id] = true; }); pSel = keep;
      fillPickCats(); renderPick();
    }).catch(fail('psum'));
  }
  function fillPickRoots(roots) {
    var sel = $('proot'), v = sel.value;
    sel.textContent = '';
    var o0 = mk('option', '', tr('Tous les dossiers')); o0.value = ''; sel.append(o0);
    roots.forEach(function (r) { var o = mk('option', '', r.name || r.path); o.value = r.id; sel.append(o); });
    sel.value = v;
    if (sel.value !== v) sel.value = '';
  }
  function fillPickCats() {
    var t = $('ptarget'), tv = t.value, f = $('pcatf'), fv = f.value;
    t.textContent = ''; f.textContent = '';
    var a = mk('option', '', tr('Ranger selon le genre')); a.value = ''; t.append(a);
    var f0 = mk('option', '', tr('Toutes les catégories')); f0.value = ''; f.append(f0);
    pCats.forEach(function (c) {
      var o = mk('option', '', tr('Ranger dans « {n} »', { n: c.name })); o.value = c.id; t.append(o);
      var g = mk('option', '', c.name + (c.count ? ' (' + c.count + ')' : '')); g.value = c.id; f.append(g);
    });
    var n = mk('option', '', tr('Ranger dans une nouvelle catégorie…')); n.value = 'new'; t.append(n);
    t.value = tv; if (t.value !== tv) t.value = '';
    f.value = fv; if (f.value !== fv) f.value = '';
  }
  function pickShown() {
    var term = norm($('pq').value.trim()), st = $('pstate').value, cf = Number($('pcatf').value) || 0;
    return pItems.filter(function (it) {
      if (st === 'in' && !it.lib_cat) return false;
      if (st === 'out' && it.lib_cat) return false;
      if (cf && it.lib_cat !== cf) return false;
      return !term || norm(it.name).indexOf(term) > -1;
    });
  }
  function pickCount() {
    var n = Object.keys(pSel).length;
    $('psel').textContent = n ? tr(n > 1 ? '{n} titres cochés' : '{n} titre coché', { n: n }) : tr('Cochez des titres (Maj + clic : plusieurs d’affilée)');
    $('pbar').classList.toggle('has-sel', n > 0);
    $('padd').disabled = $('prm').disabled = !n || pBusy;
  }
  function renderPick() {
    var ul = $('pgrid'), shown = pickShown(); ul.textContent = '';
    if (!shown.length) {
      ul.append(mk('li', 'empty', tr(pItems.length ? 'Rien ne correspond.'
        : $('proot').value ? (pKind === 'series' ? 'Aucune série dans ce dossier.' : 'Aucun film dans ce dossier.')
        : pKind === 'series' ? 'Aucune série dans vos dossiers. Ajoutez un dossier puis lancez « Analyser ».'
                             : 'Aucun film dans vos dossiers. Ajoutez un dossier puis lancez « Analyser ».')));
    }
    shown.forEach(function (it, i) {
      var li = mk('li', 'pick' + (pSel[it.id] ? ' sel' : '')); li.dataset.i = i;
      var art = mk('div', 'art' + (it.poster ? '' : ' none'), it.poster ? '' : tr('Pas d’affiche'));
      if (it.poster) { var im = mk('img'); im.alt = ''; im.loading = 'lazy'; im.src = img(it.poster); im.onerror = function () { im.remove(); art.classList.add('none'); art.textContent = tr('Pas d’affiche'); }; art.append(im); }
      var box = mk('span', 'box', pSel[it.id] ? '✓' : '');
      // le nom publié porte déjà son année « (2014) » : celle du fichier, parfois fausse, ne s'ajoute pas
      var yr = it.year && !/\(\d{4}\)/.test(String(it.name)) ? it.year : '';
      var sub = [yr, it.genre].filter(Boolean).join(' · ');
      if (pKind === 'series' && it.files) sub = tr('{n} épisodes', { n: it.files }) + (sub ? ' · ' + sub : '');
      if (pKind === 'movie' && it.files > 1) sub = tr('{n} versions', { n: it.files }) + (sub ? ' · ' + sub : '');
      li.append(box, art, mk('div', 't', it.name), mk('div', 's', sub || '\u00a0'),
                mk('span', 'lib' + (it.lib_cat ? '' : ' none'), it.lib_cat ? it.lib_name : tr('Pas dans la Bibliothèque')));
      li.title = it.name;
      li.onclick = function (e) {
        var on = !pSel[it.id];
        if (e.shiftKey && pLast !== null) {                  // une série d'affilée
          var a = Math.min(pLast, i), b = Math.max(pLast, i);
          for (var k = a; k <= b; k++) { if (on) pSel[shown[k].id] = true; else delete pSel[shown[k].id]; }
          renderPick();
        } else {
          if (on) pSel[it.id] = true; else delete pSel[it.id];
          li.classList.toggle('sel', on); box.textContent = on ? '✓' : '';
          pickCount();
        }
        pLast = i;
      };
      ul.append(li);
    });
    var inLib = pItems.filter(function (it) { return it.lib_cat; }).length;
    $('psum').textContent = tr('{n} affichés', { n: shown.length }) + ' · ' +
      tr(pKind === 'series' ? '{a} séries sur {b} déjà dans la Bibliothèque' : '{a} films sur {b} déjà dans la Bibliothèque', { a: inLib, b: pItems.length });
    pickCount();
  }
  /* par paquets, pour suivre l'avancement quand il y en a beaucoup */
  function pickRun(path, body, ids, label) {
    pBusy = true; pickCount();
    var done = 0, created = [];
    function next() {
      if (!ids.length) return Promise.resolve();
      var part = ids.splice(0, 20);
      return api('POST', path, Object.assign({ ids: part }, body)).then(function (d) {
        done += part.length; (d.created || []).forEach(function (n) { created.push(n); });
        $('psum').textContent = tr(label, { n: done });
        return next();
      });
    }
    return next().then(function () {
      pSel = {}; pBusy = false;
      return loadPick().then(function () {
        if (created.length) $('psum').textContent += ' · ' + tr('nouvelles catégories : {n}', { n: created.join(', ') });
      });
    }).catch(function (e) { pBusy = false; pickCount(); fail('psum')(e); });
  }
  $('padd').onclick = function () {
    var ids = Object.keys(pSel).map(Number), target = $('ptarget').value;
    if (!ids.length) return;
    var go = function (cat) { return pickRun('/api/library/add_many', { kind: pKind, cat: cat || 0, lang: LANG }, ids, 'Ajout… {n} titres'); };
    if (target === 'new') {
      askText(tr('Nouvelle catégorie'), tr('Nom'), '', function (v) {
        if (!v) return;
        return api('POST', '/api/library/cats', { name: v }).then(function (d) { go(d.id); });
      });
    } else go(Number(target));
  };
  $('prm').onclick = function () {
    var ids = Object.keys(pSel).map(Number).filter(function (id) { return pItems.some(function (it) { return it.id === id && it.lib_cat; }); });
    if (!ids.length) { $('psum').textContent = tr('Aucun des titres cochés n’est dans la Bibliothèque.'); return; }
    confirmBox(tr('Retirer de la Bibliothèque'), tr('{n} titres quittent la Bibliothèque. Les fichiers ne sont pas touchés.', { n: ids.length }), function () {
      pickRun('/api/library/remove_many', { kind: pKind }, ids, 'Retrait… {n} titres');
    }, tr('Retirer'));
  };
  $('pall').onclick = function () { pickShown().forEach(function (it) { pSel[it.id] = true; }); renderPick(); };
  $('pnone').onclick = function () { pSel = {}; renderPick(); };
  document.querySelectorAll('[data-pk]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('[data-pk]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      pKind = b.dataset.pk; pSel = {}; pLast = null; $('pcatf').value = '';
      loadPick();
    };
  });
  $('proot').onchange = function () { setRoot($('proot').value); };
  $('pstate').onchange = $('pcatf').onchange = function () { pLast = null; renderPick(); };
  var pqt; $('pq').oninput = function () { clearTimeout(pqt); pqt = setTimeout(function () { pLast = null; renderPick(); }, 150); };

  document.querySelectorAll('[data-mk]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('[data-mk]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      mKind = b.dataset.mk;
      loadMediaItems();
    };
  });
  var mqt; $('mq').oninput = function () { clearTimeout(mqt); mqt = setTimeout(loadMediaItems, 300); };
  $('madd').onclick = function () {
    var path = $('mpath').value.trim();
    if (!path) return;
    api('POST', '/api/medias/add', { path: path, kind: $('mkind').value })
      .then(function () { $('mpath').value = ''; return loadMedias(); }).catch(fail('msummary'));
  };
  $('mscan').onclick = function () {
    api('POST', '/api/medias/scan', {}).then(function () { $('mstate').textContent = tr('Analyse en cours…'); loadMedias(); })
      .catch(fail('msummary'));
  };
  $('mforce').onclick = function () {
    confirmBox(tr('Tout réanalyser'), tr('Les fiches sont redemandées à TMDB pour l’ensemble de la médiathèque. Vos corrections manuelles sont conservées.'), function () {
      api('POST', '/api/medias/scan', { force: true }).then(function () { $('mstate').textContent = tr('Analyse en cours…'); loadMedias(); })
        .catch(fail('msummary'));
    });
  };

  /* ================= FILMS ET SÉRIES ================= */
  var iKind = 'vod', items = [];
  function loadItems() {
    return api('GET', '/api/items?kind=' + iKind + '&cat=' + encodeURIComponent($('icat').value) +
                      '&q=' + encodeURIComponent($('iq').value.trim()))
      .then(function (d) { items = d.items; renderItems(); }).catch(fail('isummary'));
  }
  function renderItems() {
    var ul = $('ilist'); ul.textContent = '';
    if (!items.length) ul.append(mk('li', 'empty', tr(iKind === 'vod' ? 'Aucun film.' : 'Aucune série.')));
    items.forEach(function (it) {
      var li = mk('li');
      li.append(posterNode(it));
      var wrap = mk('div'); wrap.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px';
      var name = mk('input', 'edit title'); name.value = it.name;
      name.setAttribute('aria-label', tr('Titre'));
      wrap.append(name, mk('span', 'orig', tr('Fournisseur : {n}', { n: it.orig_name }) + (it.cat_name ? ' · ' + it.cat_name : '')));
      var state = mk('span', 'ok', '');
      li.append(wrap);
      if (it.manual) li.append(mk('span', 'tag', tr('à la main')));
      if (it.edited) li.append(mk('span', 'tag', tr('fiche corrigée')));
      li.append(state);
      var ed = mk('button', 'btn small', tr('Modifier'));
      ed.onclick = function () { editItem(it); };
      li.append(ed);
      if (it.manual) {
        var r = mk('button', 'link', tr('Rétablir'));
        r.onclick = function () { sendItem(it, null, state); };
        li.append(r);
      }
      name.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') name.blur();
        if (e.key === 'Escape') { name.value = it.name; name.blur(); }
      });
      name.addEventListener('change', function () {
        var t = name.value.trim();
        if (t === it.name) return;
        sendItem(it, t || null, state);
      });
      ul.append(li);
    });
    $('isummary').textContent = tr(iKind === 'vod' ? '{n} films' : '{n} séries', { n: items.length }) +
      (items.length >= 400 ? tr(' (affinez la recherche)') : '');
  }
  /* ---------- éditeur de fiche ---------- */
  function artBox(box, label, slot, ctx) {
    var wrap = mk('div', 'artslot');
    wrap.append(mk('span', 'lbl', label));
    var node = mk('img', slot === 'backdrop' ? 'art wide' : slot === 'logo' ? 'art logo' : 'art');
    node.alt = ''; node.loading = 'lazy';
    bust(node, ctx.data[slot]);
    var acts = mk('div', 'tools');
    var web = mk('button', 'btn small', tr('Adresse web'));
    web.onclick = function () { askArtUrl(ctx, slot, node); };
    var pc = mk('button', 'btn small', tr('Depuis le PC'));
    var file = mk('input'); file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
    pc.onclick = function () { file.click(); };
    file.onchange = function () { if (file.files[0]) sendArtFile(ctx, slot, file.files[0], node); file.value = ''; };
    acts.append(web, pc, file);
    if (ctx.kind !== 'live') {
      var tm = mk('button', 'btn small', 'TMDB');
      tm.onclick = function () { pickTmdb(ctx, slot, node); };
      acts.append(tm);
    }
    var off = mk('button', 'link', tr('Rétablir'));
    off.onclick = function () {
      api('POST', '/api/art/reset', { kind: ctx.kind, id: ctx.id, slot: slot })
        .then(function (d) { refreshArt(ctx, slot, node, d); }).catch(function (e) { alert(e.message); });
    };
    acts.append(off);
    wrap.append(node, acts);
    box.append(wrap);
    return node;
  }
  function bust(node, src) {
    if (!src) { node.removeAttribute('src'); node.style.visibility = 'hidden'; return; }
    node.style.visibility = '';
    node.src = img(src) + '&r=' + Date.now();   // l'image a changé : on court-circuite le cache
  }
  function refreshArt(ctx, slot, node, d) {
    ctx.data[slot] = d.img;
    bust(node, d.img);
    // la liste derrière la fenêtre montre la même image : on la remet à jour aussi
    setTimeout(ctx.kind === 'live' ? loadChans : loadItems, 400);
  }
  function sendArtFile(ctx, slot, file, node) {
    var o = { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Luciole-Admin': '1' }, body: file };
    if (token) o.headers['X-Luciole-Token'] = token;
    fetch('/api/art/upload?kind=' + ctx.kind + '&id=' + ctx.id + '&slot=' + slot, o)
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error); return d; }); })
      .then(function (d) { refreshArt(ctx, slot, node, d); })
      .catch(function (e) { alert(tr('Image refusée : {m}', { m: e.message })); });
  }
  function askArtUrl(ctx, slot, node) {
    askText(tr('Adresse de l’image'), tr('Collez l’adresse web de l’image (elle sera copiée sur le serveur).'), '',
      function (url) {
        if (!url) return;
        return api('POST', '/api/art/fetch', { kind: ctx.kind, id: ctx.id, slot: slot, url: url })
          .then(function (d) { refreshArt(ctx, slot, node, d); });
      }, tr('Utiliser cette image'), 'dlg2');
  }
  function pickTmdb(ctx, slot, node) {
    var wide = slot === 'backdrop';
    dialog(tr('Chercher sur TMDB'), function (box) {
      box.parentNode.classList.add('wide');
      var q = mk('input', 'edit w100'); q.type = 'search'; q.value = ctx.data.name || '';
      var res = mk('div', wide ? 'tmdb wide' : 'tmdb'); var state = mk('p', 'help', '');
      if (slot === 'logo') res.classList.add('logos');
      var back = mk('button', 'btn small', tr('← Autres titres')); back.style.display = 'none';
      function use(url) {
        api('POST', '/api/art/fetch', { kind: ctx.kind, id: ctx.id, slot: slot, url: url })
          .then(function (d) { $('dlg2-cancel').click(); refreshArt(ctx, slot, node, d); })
          .catch(function (e) { alert(e.message); });
      }
      /* un titre choisi : toutes ses images, pour prendre un autre fond ou une autre jaquette */
      function images(r) {
        state.textContent = tr('Recherche…'); res.textContent = ''; back.style.display = '';
        api('GET', '/api/art/images?kind=' + ctx.kind + '&tmdb=' + r.id + '&slot=' + slot)
          .then(function (d) {
            var t = r.title + (r.year ? ' (' + r.year + ')' : '');
            state.textContent = d.images.length
              ? tr('{t} : {n} image(s). Cliquez sur celle à utiliser.', { t: t, n: d.images.length })
              : tr('Rien trouvé sous ce titre.');
            d.images.forEach(function (im) {
              var c = mk('button', 'tcard');
              var i = mk('img'); i.alt = ''; i.loading = 'lazy'; i.src = img(im.img);
              var info = (im.w && im.h ? im.w + ' × ' + im.h : '') + (im.lang ? ' · ' + im.lang.toUpperCase() : '');
              c.append(i, mk('span', '', info || ' '));
              c.onclick = function () { use(im.url); };
              res.append(c);
            });
          }).catch(function (e) { state.textContent = tr('Erreur : {m}', { m: e.message }); });
      }
      function run() {
        state.textContent = tr('Recherche…'); res.textContent = ''; back.style.display = 'none';
        api('GET', '/api/art/search?kind=' + ctx.kind + '&q=' + encodeURIComponent(q.value.trim()))
          .then(function (d) {
            var found = d.results.filter(function (r) { return slot === 'backdrop' ? r.backdrop_url : slot === 'logo' ? true : r.poster_url; });
            if (found.length === 1) return images(found[0]);   // un seul titre : on montre tout de suite ses images
            state.textContent = found.length ? tr('Choisissez le titre pour voir toutes ses images.') : tr('Rien trouvé sous ce titre.');
            found.forEach(function (r) {
              var c = mk('button', 'tcard');
              var i = mk('img'); i.alt = ''; i.loading = 'lazy';
              i.src = img(slot === 'backdrop' ? r.backdrop : r.poster);
              c.append(i, mk('span', '', r.title + (r.year ? ' (' + r.year + ')' : '')));
              c.onclick = function () { images(r); };
              res.append(c);
            });
          }).catch(function (e) { state.textContent = tr('Erreur : {m}', { m: e.message }); });
      }
      q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
      var go = mk('button', 'btn small', tr('Chercher')); go.onclick = run;
      back.onclick = run;
      var tools = mk('div', 'tools'); tools.append(go, back);
      box.append(mk('label', 'lbl', tr('Titre à chercher')), q, tools, state, res);
      run();
      return null;
    }, null, tr('Fermer'), 'dlg2');
  }
  function editItem(it) {
    api('GET', '/api/items/detail?kind=' + iKind + '&id=' + it.id).then(function (d) {
      var ctx = { kind: iKind, id: it.id, data: d };
      dialog(tr('Modifier la fiche'), function (box) {
        box.append(mk('label', 'lbl', tr('Titre')));
        var name = mk('input', 'edit w100'); name.type = 'text'; name.value = d.name || '';
        box.append(name);
        if (d.orig_name && d.orig_name !== d.name) box.append(mk('p', 'help', tr('Fournisseur : {n}', { n: d.orig_name })));
        box.append(mk('label', 'lbl', tr('Résumé')));
        var plot = mk('textarea', 'edit w100'); plot.rows = 6; plot.value = d.plot || '';
        box.append(plot);
        var arts = mk('div', 'arts');
        box.append(arts);
        ctx.poster = artBox(arts, tr('Jaquette'), 'poster', ctx);
        ctx.backdrop = artBox(arts, tr('Fond'), 'backdrop', ctx);
        ctx.logo = artBox(arts, tr('Logo du titre'), 'logo', ctx);
        box.append(mk('p', 'help', tr('Logo du titre : sans choix ici, Luciole prend le fichier clearlogo.png posé à côté, sinon celui de TMDB.')));
        box.append(mk('label', 'lbl', tr('Bande-annonce (lien YouTube)')));
        var trailer = mk('input', 'edit w100'); trailer.type = 'url'; trailer.value = d.trailer || '';
        trailer.placeholder = 'https://www.youtube.com/watch?v=…';
        box.append(trailer, mk('p', 'help', tr('Vide : celle du fournisseur ou de TMDB.')));
        return { name: name, plot: plot, trailer: trailer };
      }, function (c) {
        return api('POST', '/api/items/edit', {
          kind: iKind, id: it.id, name: c.name.value.trim(), plot: c.plot.value.trim(), trailer: c.trailer.value.trim()
        }).then(loadItems);
      }, tr('Enregistrer'));
    }).catch(fail('isummary'));
  }

  function sendItem(it, name, state) {
    api('POST', '/api/items/rename', { kind: iKind, id: it.id, name: name }).then(function () {
      state.textContent = tr('✓ Enregistré');
      setTimeout(loadItems, 600);
    }).catch(function (e) { state.textContent = ''; fail('isummary')(e); });
  }
  document.querySelectorAll('[data-ikind]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('[data-ikind]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      iKind = b.dataset.ikind;
      $('icat').length = 1; $('icat').value = 'all';
      fillCatSelect('icat', iKind).then(loadItems);
    };
  });
  var it_; $('iq').oninput = function () { clearTimeout(it_); it_ = setTimeout(loadItems, 300); };
  $('icat').onchange = loadItems;

  /* ================= NOMS ================= */
  var prevKind = 'live';
  function loadRules() {
    return api('GET', '/api/rules?preview=' + prevKind).then(function (d) {
      var ul = $('rules'); ul.textContent = '';
      d.rules.forEach(function (r) {
        var li = mk('li');
        var cb = mk('input'); cb.type = 'checkbox'; cb.checked = r.enabled;
        cb.setAttribute('aria-label', tr('Activer la règle'));
        cb.onchange = function () { api('POST', '/api/rules', { id: r.id, enabled: cb.checked }).then(loadRules); };
        var n = mk('span', 'name');
        n.append(document.createTextNode(r.label ? tr(r.label) : r.pattern));
        if (r.label) n.append(mk('small', '', r.pattern + (r.repl ? '  →  « ' + r.repl + ' »' : '')));
        li.append(cb, n);
        if (!r.builtin) {
          var ed = mk('button', 'link', tr('Modifier'));
          ed.onclick = function () {
            askText(tr('Modifier la règle'), tr('Motif (expression régulière)'), r.pattern, function (v) {
              return api('POST', '/api/rules', { id: r.id, pattern: v, repl: r.repl }).then(loadRules);
            });
          };
          var del = mk('button', 'link', tr('Supprimer')); del.style.color = '#FF9DA1';
          del.onclick = function () { api('DELETE', '/api/rules?id=' + r.id).then(loadRules); };
          li.append(ed, del);
        } else li.append(mk('span', 'tag', tr('livrée')));
        ul.append(li);
      });
      var box = $('preview'); box.textContent = '';
      d.preview.changed.forEach(function (p) {
        box.append(mk('div', 'b', p.before), mk('div', '', '→'), mk('div', 'a', p.after + (p.manual ? tr('  (nom à la main)') : '')));
      });
      if (!d.preview.changed.length) box.append(mk('div', 'empty', tr('Aucun nom modifié par les règles.')));
      $('prevsum').textContent = tr('{n} noms modifiés · {u} inchangés', { n: d.preview.changed.length, u: d.preview.unchanged });
    }).catch(fail('prevsum'));
  }
  document.querySelectorAll('[data-prev]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('[data-prev]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      prevKind = b.dataset.prev;
      loadRules();
    };
  });
  $('rule-new').onclick = function () {
    dialog(tr('Nouvelle règle'), function (box) {
      box.append(mk('p', 'help', tr('Le motif est une expression régulière, insensible à la casse. Exemple : \\|FR\\| pour enlever |FR|.')));
      box.append(mk('label', 'lbl', tr('Motif')));
      var p = mk('input', 'edit w100'); p.type = 'text'; p.placeholder = '\\|FR\\|'; box.append(p);
      box.append(mk('label', 'lbl', tr('Remplacer par (vide = supprimer)')));
      var r = mk('input', 'edit w100'); r.type = 'text'; box.append(r);
      return { p: p, r: r };
    }, function (c) {
      return api('POST', '/api/rules', { pattern: c.p.value, repl: c.r.value }).then(loadRules);
    }, tr('Ajouter'));
  };
  $('names-reset').onclick = function () {
    confirmBox(tr('Noms d’origine'), tr('Tous les noms tapés à la main seront oubliés : chaînes, films, séries et bouquets. Les règles et les numéros restent.'), function () {
      return api('POST', '/api/names/reset', {}).then(loadRules);
    }, tr('Rétablir'));
  };

  /* ================= GUIDE ================= */
  function loadGuide() {
    return api('GET', '/api/epg/sources').then(function (d) {
      srcs = d.sources;
      var ul = $('srclist'); ul.textContent = '';
      if (!srcs.length) ul.append(mk('li', 'empty', tr('Aucune source. Le guide du fournisseur est utilisé seul.')));
      srcs.forEach(function (s) {
        var li = mk('li', s.enabled ? '' : 'off');
        var cb = mk('input'); cb.type = 'checkbox'; cb.checked = s.enabled; cb.setAttribute('aria-label', tr('Activer'));
        cb.onchange = function () { api('POST', '/api/epg/sources/set', { id: s.id, enabled: cb.checked }).then(loadGuide); };
        var n = mk('span', 'name');
        n.append(document.createTextNode(s.name || s.url));
        var info = s.last ? when(s.last) + ' · ' + tr('{n} programmes', { n: s.count }) : tr('jamais téléchargée');
        n.append(mk('small', '', (s.name ? s.url + ' · ' : '') + info + (s.status && s.status !== 'ok' ? ' · ' + s.status : '')));
        li.append(cb, n);
        var del = mk('button', 'link', tr('Supprimer')); del.style.color = '#FF9DA1';
        del.onclick = function () {
          confirmBox(tr('Supprimer cette source ?'), tr('Ses programmes seront effacés du guide.'), function () {
            return api('DELETE', '/api/epg/sources?id=' + s.id).then(loadGuide);
          }, tr('Supprimer'));
        };
        li.append(del);
        ul.append(li);
      });
      var st = d.status;
      $('epgsum').textContent = tr('{m} chaînes sur {c} associées à un guide externe (dont {h} à la main) · {i} programmes avec vignette',
        { m: st.mapped, c: st.channels, h: st.manual, i: st.programmes_with_image });
    }).then(loadMapping).catch(fail('epgsum'));
  }
  /* les lignes de séparation des fournisseurs (« ▼--- |FR| V O D ---▼ ») n'ont jamais de guide :
     mêmes motifs que la recherche du serveur */
  var SEPARATOR = /---|▼|►|###|===|\*\*\*|═|~~|●★|★●/;
  function loadMapping() {
    return api('GET', '/api/channels/admin?cat=all&q=' + encodeURIComponent($('gq').value.trim())).then(function (d) {
      d = d.filter(function (c) { return !SEPARATOR.test(c.name || '') && !SEPARATOR.test(c.orig_name || ''); });
      maps = $('only-unmapped').checked ? d.filter(function (c) { return !c.epg; }) : d;
      var ul = $('maplist'); ul.textContent = '';
      if (!maps.length) ul.append(mk('li', 'empty', tr('Toutes les chaînes ont un guide externe.')));
      maps.slice(0, 300).forEach(function (c) {
        var li = mk('li');
        li.append(srcNode(c), logoNode(c), mk('span', 'count', String(c.num)));
        var n = mk('span', 'name');
        n.append(document.createTextNode(c.name));
        n.append(mk('small', '', c.epg ? tr('Guide : {n}', { n: c.epg }) + (c.epg_manual ? tr(' (à la main)') : '') : tr('Guide du fournisseur seulement')));
        li.append(n);
        var b = mk('button', 'link', tr(c.epg ? 'Changer' : 'Associer'));
        b.onclick = function () { mapDialog(c); };
        li.append(b);
        if (c.epg_manual) {
          var a = mk('button', 'link', tr('Auto'));
          a.onclick = function () { api('POST', '/api/epg/map', { chan: c.id, auto: true }).then(loadGuide); };
          li.append(a);
        }
        ul.append(li);
      });
    });
  }
  function mapDialog(c) {
    dialog(tr('Guide pour « {n} »', { n: c.name }), function (box) {
      var q = mk('input', 'edit w100'); q.type = 'search'; q.value = c.name; q.placeholder = tr('Nom dans le guide');
      box.append(q);
      var ul = mk('ul', 'scroll'); ul.style.cssText = 'max-height:300px;margin-top:12px'; box.append(ul);
      var chosen = { src: null, xid: null };
      function search() {
        api('GET', '/api/epg/search?q=' + encodeURIComponent(q.value)).then(function (d) {
          ul.textContent = '';
          if (!d.results.length) ul.append(mk('li', 'empty', tr('Rien trouvé dans les sources.')));
          d.results.forEach(function (r) {
            var li = mk('li');
            var rb = mk('input'); rb.type = 'radio'; rb.name = 'xid';
            rb.onchange = function () { chosen = { src: r.src, xid: r.xid }; };
            var n = mk('span', 'name'); n.append(document.createTextNode(r.name));
            n.append(mk('small', '', r.source + ' · ' + r.xid));
            li.append(rb, n); ul.append(li);
          });
        });
      }
      var t; q.oninput = function () { clearTimeout(t); t = setTimeout(search, 300); };
      search();
      var none = mk('button', 'btn small', tr('Aucun (guide du fournisseur)'));
      none.style.marginTop = '12px';
      none.onclick = function () { chosen = { src: null, xid: null }; $('dlg-ok').click(); };
      box.append(none);
      return function () { return chosen; };
    }, function (get) {
      var c2 = get();
      return api('POST', '/api/epg/map', { chan: c.id, src: c2.src, xid: c2.xid }).then(loadGuide);
    }, tr('Associer'));
  }
  $('src-add').onclick = function () {
    var url = $('srcurl').value.trim();
    if (!url) return;
    api('POST', '/api/epg/sources', { url: url, name: $('srcname').value.trim() }).then(function () {
      $('srcurl').value = ''; $('srcname').value = '';
      say('epgsum', tr('Source ajoutée. Cliquez sur « Télécharger maintenant ».'));
      loadGuide();
    }).catch(fail('epgsum'));
  };
  $('epg-refresh').onclick = function () {
    api('POST', '/api/epg/refresh', {}).then(function () {
      say('epgsum', tr('Téléchargement en cours… cela peut prendre quelques minutes.'));
      setTimeout(loadGuide, 8000);
    }).catch(fail('epgsum'));
  };
  $('epg-automap').onclick = function () {
    api('POST', '/api/epg/automap', {}).then(function (r) {
      say('epgsum', tr('{n} chaînes associées', { n: r.mapped })); loadGuide();
    }).catch(fail('epgsum'));
  };
  var mt; $('gq').oninput = function () { clearTimeout(mt); mt = setTimeout(loadMapping, 300); };
  $('only-unmapped').onchange = loadMapping;

  /* ================= BOUQUETS DU FOURNISSEUR ================= */
  function shown() { return cats.filter(function (c) { return norm(c.name + ' ' + c.orig_name).indexOf(filter) > -1; }); }
  function loadCats() {
    loadLock();
    return api('GET', '/api/categories?all=1&kind=' + catKind).then(function (d) {
      cats = d.filter(function (c) { return !c.own; }); renderCats();
    }).catch(fail('summary'));
  }
  function renderCats() {
    var ul = $('list'), rows = shown(); ul.textContent = '';
    rows.forEach(function (c) {
      var li = mk('li', c.hidden ? 'off' : '');
      var box = mk('input'); box.type = 'checkbox'; box.checked = !c.hidden;
      box.setAttribute('aria-label', tr('Afficher {n}', { n: c.name }));
      box.onchange = function () { saveVis([c.id], !box.checked); };
      var name = mk('button', 'name link');
      name.style.cssText = 'text-align:left;color:inherit;padding:0;font-size:16px'; name.title = tr('Renommer');
      name.append(document.createTextNode(c.name));
      if (c.name !== c.orig_name) name.append(mk('small', '', tr('Fournisseur : {n}', { n: c.orig_name })));
      name.onclick = function () {
        askText(tr('Renommer le bouquet'), tr('Nom'), c.name, function (v) {
          return api('POST', '/api/categories/rename', { kind: catKind, id: c.id, name: v }).then(loadCats);
        });
      };
      li.append(box, srcNode(c), name, mk('span', 'count', tr('{n} titres', { n: c.count })), lockButton(catKind, c.id, renderCats));
      if (c.name !== c.orig_name) {
        var r = mk('button', 'link', tr('Nom d’origine'));
        r.onclick = function () { api('POST', '/api/categories/rename', { kind: catKind, id: c.id, name: null }).then(loadCats); };
        li.append(r);
      }
      if (c.manual) {
        var reset = mk('button', 'link', tr('Règle auto')); reset.title = tr('Revenir aux règles de config.toml');
        reset.onclick = function () { saveVis([c.id], null); };
        li.append(reset);
      } else if (c.hidden) li.append(mk('span', 'tag', tr('masqué par une règle')));
      ul.append(li);
    });
    var vis = cats.filter(function (c) { return !c.hidden; }).length;
    $('summary').textContent = tr('{v} bouquets visibles sur {n}', { v: vis, n: cats.length }) + (filter ? ' · ' + tr('{n} affichés', { n: rows.length }) : '');
  }
  function saveVis(ids, hidden) { return api('POST', '/api/categories/visibility', { kind: catKind, ids: ids, hidden: hidden }).then(loadCats); }
  $('q').oninput = function (e) { filter = norm(e.target.value.trim()); renderCats(); };
  $('showAll').onclick = function () { saveVis(shown().map(function (c) { return c.id; }), false); };
  $('hideAll').onclick = function () { saveVis(shown().map(function (c) { return c.id; }), true); };
  document.querySelectorAll('[data-kind]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('[data-kind]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      catKind = b.dataset.kind; loadCats();
    };
  });

  /* ================= téléviseur : démarrage automatique ================= */
  var tvPoll = null;

  function tvWords(d) {
    var etat = d.state === 'on' ? tr('allumé') : (d.state === 'standby' ? tr('en veille')
      : (d.state ? d.state : tr('injoignable')));
    var out = [tr('Téléviseur : {e}', { e: etat })];
    if (d.state === 'on' && d.front === true) out.push(tr('Luciole est à l’écran'));
    else if (d.state === 'on' && d.front === false) out.push(tr('Luciole n’est pas à l’écran'));
    out.push(tr(d.paired ? 'autorisé' : 'pas encore autorisé'));
    if (d.enabled) out.push(tr(d.watching ? 'surveillance active' : 'surveillance à redémarrer'));
    if (d.busy) out.push(tr('lancement en cours…'));
    if (d.last) out.push(tr('dernier réveil : {d}', { d: d.last }));
    return out.join(' · ');
  }

  function loadTv() {
    clearTimeout(tvPoll);
    return api('GET', '/api/tv').then(function (d) {
      if (document.activeElement !== $('tvhost')) $('tvhost').value = d.host || '';
      if (document.activeElement !== $('tvapp')) $('tvapp').value = d.app || '';
      if (document.activeElement !== $('tvdelai')) $('tvdelai').value = d.delay;
      if (document.activeElement !== $('tvessais')) $('tvessais').value = d.tries;
      $('tvauto').checked = !!d.enabled;
      $('tvstate').textContent = tvWords(d);
      $('tvpaired').textContent = d.paired ? tr('Le serveur est autorisé sur ce téléviseur.') : '';
      if (tab === 'tv') tvPoll = setTimeout(loadTv, 15000);
    }).catch(fail('tvstate'));
  }

  function tvSave() {
    return api('POST', '/api/tv/set', {
      host: $('tvhost').value.trim(), app: $('tvapp').value.trim(),
      delai: $('tvdelai').value, essais: $('tvessais').value, auto: $('tvauto').checked
    }).then(function (d) { $('tvstate').textContent = tr('Enregistré.') + ' ' + tvWords(d); }).catch(fail('tvstate'));
  }

  $('tvsave').onclick = tvSave;
  $('tvauto').onchange = tvSave;

  $('tvtest').onclick = function () {
    $('tvstate').textContent = tr('Lancement demandé…');
    tvSave().then(function () { return api('POST', '/api/tv/test', {}); }).then(function (r) {
      $('tvstate').textContent = tr('Demandé par {h}', { h: r.how }) +
        tr(r.front === true ? ', Luciole est à l’écran.' : (r.front === false
          ? ', mais Luciole n’est pas à l’écran — augmentez le nombre d’essais.'
          : '. Le téléviseur ne confirme pas ; regardez l’écran.'));
      setTimeout(loadTv, 4000);
    }).catch(fail('tvstate'));
  };

  $('tvpair').onclick = function () {
    $('tvpaired').textContent = tr('Regardez le téléviseur et acceptez la demande…');
    $('tvapps').textContent = '';
    tvSave().then(function () { return api('POST', '/api/tv/pair', {}); }).then(function (d) {
      $('tvpaired').textContent = (d.paired ? tr('Autorisation obtenue.') + ' ' : '') +
        tr(d.apps.length > 1 ? '{n} applications installées :' : '{n} application installée :', { n: d.apps.length });
      d.apps.forEach(function (a) {
        var li = mk('li', 'line');
        li.append(mk('span', 'nm', a.name || tr('(sans nom)')), mk('code', '', a.id));
        var use = mk('button', 'btn small', tr('Choisir'));
        use.onclick = function () { $('tvapp').value = a.id; tvSave(); };
        li.append(use);
        $('tvapps').append(li);
      });
      loadTv();
    }).catch(fail('tvpaired'));
  };

  /* ================= onglets et état ================= */
  var LOAD = {
    subs: loadSubs, lib: loadLib,
    bq: function () { return loadBouquets(true); },
    chans: function () { return fillCatSelect('ccat').then(loadChans); },
    items: function () { return fillCatSelect('icat', iKind).then(loadItems); },
    medias: function () { return loadMedias().then(loadMediaItems).then(loadPick); },
    tv: loadTv,
    names: loadRules, guide: loadGuide, cats: loadCats
  };
  document.querySelectorAll('[data-tab]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('[data-tab]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      tab = b.dataset.tab;
      ['subs', 'lib', 'bq', 'chans', 'items', 'medias', 'tv', 'names', 'guide', 'cats'].forEach(function (t) { $('t-' + t).hidden = t !== tab; });
      LOAD[tab]();
    };
  });
  var ct; $('cq').oninput = function () { clearTimeout(ct); ct = setTimeout(loadChans, 300); };
  $('ccat').onchange = loadChans;

  function status() {
    api('GET', '/api/status').then(function (s) {
      var d = s.catalog_sync ? when(s.catalog_sync) : tr('jamais');
      $('status').textContent = (s.syncing ? tr('Synchronisation en cours… ') : tr('Dernière synchronisation : {d}', { d: d })) +
        ' · ' + tr('{l} chaînes, {v} films, {s} séries', { l: s.counts.live, v: s.counts.vod, s: s.counts.series });
      if (s.syncing) setTimeout(function () { status(); if (LOAD[tab]) LOAD[tab](); }, 4000);
    }).catch(function () {});
  }
  $('sync').onclick = function () { api('POST', '/api/sync', {}).then(status); };

  /* ---------- thème et langue de la page (indépendants de ceux du téléviseur) ---------- */
  $('pref-theme').value = document.documentElement.className.indexOf('ambre') >= 0 ? 'ambre' : 'luciole';
  $('pref-theme').onchange = function () {
    var t = this.value;
    document.documentElement.className = 'theme-' + t;
    try { localStorage.setItem('luciole.web.theme', JSON.stringify(t)); } catch (e) { /* navigation privée */ }
  };
  $('pref-lang').value = LANG;
  $('pref-lang').onchange = function () {
    try { localStorage.setItem('luciole.web.lang', JSON.stringify(this.value)); } catch (e) { /* navigation privée */ }
    location.reload();
  };

  translatePage();
  // la page d'accueil envoie directement vers une section : reglages#lib, reglages#tv…
  var want = location.hash.replace('#', '');
  var btn = want && document.querySelector('[data-tab="' + want + '"]');
  if (btn) btn.click(); else loadSubs();
  if (token) Array.prototype.forEach.call(document.querySelectorAll('.topnav a'), function (a) {
    a.href = a.getAttribute('href') + '?token=' + encodeURIComponent(token);
  });
  status();
})();
