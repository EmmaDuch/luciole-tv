"""Serveur Luciole : API JSON pour l'appli TV.

Lancement : python3 -m luciole.server
"""
import base64
import gzip
import json
import logging
import os
import re
import threading
import urllib.parse
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import UA, __version__, artwork, bouquets, convert, custom, epg_ext, filters, library, medias, providers, sync, tvwake
from .common import connect, load_config, merge_hosts, norm, now, to_float, to_int
from .filters import visible
from .images import ImageCache
from .xtream import XtreamError

log = logging.getLogger("luciole.server")

INFO_TTL = 6 * 3600
DONE_RATIO = 0.92


_YT = re.compile(r"(?:v=|youtu\.be/|embed/|shorts/)?([A-Za-z0-9_-]{11})(?:[?&#].*)?$")


def _youtube_id(value):
    """Accepte un identifiant YouTube ou une adresse complète ; renvoie l'identifiant ou ''."""
    value = (value or "").strip()
    if not value:
        return ""
    m = _YT.search(value)
    return m.group(1) if m else ""


def _b64(value):
    """Le guide complet Xtream encode titres et résumés en base64."""
    if not value:
        return ""
    try:
        text = base64.b64decode(value, validate=True).decode("utf-8").strip()
        if text and all(c.isprintable() or c in "\n\t" for c in text):
            return text
    except Exception:
        pass
    return str(value).strip()


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


_QUALITY = re.compile(r"\b(4K|UHD|FHD|HD|SD)\b", re.IGNORECASE)
_QNAMES = {"4K": "4K", "UHD": "4K", "FHD": "FHD", "HD": "HD", "SD": "SD"}


def _quality(name):
    """Qualité annoncée par le fournisseur dans le nom de la chaîne."""
    found = [_QNAMES[m.group(1).upper()] for m in _QUALITY.finditer(name or "")]
    for q in ("4K", "FHD", "HD", "SD"):
        if q in found:
            return q
    return ""


def _ext(value):
    value = re.sub(r"[^A-Za-z0-9]", "", value or "")
    return value[:5] or "mp4"


class Luciole:
    """Toute la logique de l'API, séparée du transport HTTP."""

    def __init__(self, cfg):
        self.cfg = cfg
        self._local = threading.local()
        self.reg = providers.Registry(cfg, self.db)
        self.images = ImageCache(cfg, lambda: self.db)
        self._sync_thread = None
        self.media_job = None
        self.converter = convert.Converter(cfg)
        self.watcher = None
        filters.apply(self.db, cfg)  # la config a pu changer depuis la dernière synchro
        custom.seed_rules(self.db)
        epg_ext.apply_map(self.db)
        medias.ensure_categories(self.db)
        medias.allow_tmdb_images(self.db, cfg)

    def start_watcher(self):
        """Surveille le téléviseur dans un fil à part : au premier plan il n'y a rien à faire."""
        if self.watcher and self.watcher.is_alive():
            return self.watcher
        # le fil a sa propre connexion : sqlite n'aime pas être partagé entre fils
        self.watcher = tvwake.Watcher(self.cfg, self.cfg["server"]["data_dir"], connect(self.cfg))
        self.watcher.start()
        return self.watcher

    @property
    def db(self):
        db = getattr(self._local, "db", None)
        if db is None:
            db = self._local.db = connect(self.cfg)
        return db

    # ---------- utilitaires ----------
    def _resolve(self, item_id):
        """Client Xtream et identifiant du fournisseur pour un identifiant global."""
        try:
            return self.reg.resolve(item_id)
        except KeyError:
            self.reg.refresh(self.db)          # configuration rechargée entre-temps ?
            try:
                return self.reg.resolve(item_id)
            except KeyError:
                raise ApiError(404, "cet abonnement n'est plus dans la configuration") from None

    def _tz(self, src):
        row = self.db.execute("SELECT tz FROM provider WHERE src=?", (src,)).fetchone()
        return (row["tz"] if row else "") or ""

    @staticmethod
    def img(url, width):
        if not url:
            return ""
        return f"/img?w={width}&u={urllib.parse.quote(url, safe='')}"

    @staticmethod
    def logo(url, width=160):
        """Logo de chaîne : fond retiré, rogné et posé sur un carré transparent (voir images.py)."""
        if not url:
            return ""
        return f"/img?w={width}&m=logo&u={urllib.parse.quote(url, safe='')}"

    def _info(self, kind, item_id):
        """Fiche détaillée (série ou film), en cache ; une fiche périmée sert de secours."""
        row = self.db.execute("SELECT json, fetched FROM info_cache WHERE kind=? AND id=?",
                              (kind, item_id)).fetchone()
        if item_id >= medias.BASE:                      # médiathèque : la fiche ne périme pas
            if not row:
                raise ApiError(404, "fiche inconnue")
            return json.loads(row["json"])
        if row and now() - row["fetched"] < INFO_TTL:
            return json.loads(row["json"])
        try:
            xt, raw, src = self._resolve(item_id)
            if kind == "series":
                data = xt.api("get_series_info", series_id=raw)
            else:
                data = xt.api("get_vod_info", vod_id=raw)
        except XtreamError:
            if row:
                return json.loads(row["json"])
            raise ApiError(502, "le fournisseur ne répond pas")
        if not isinstance(data, dict):
            data = {}
        if kind == "series":
            # les épisodes reçoivent eux aussi un identifiant global, propre à cet abonnement
            for ep in self._episodes_flat(data):
                if ep.get("id") not in (None, ""):
                    ep["id"] = providers.gid(src, to_int(ep.get("id")))
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO info_cache VALUES (?,?,?,?)",
                            (kind, item_id, json.dumps(data), now()))
            hosts = set()
            for ep in self._episodes_flat(data) if kind == "series" else []:
                hosts.add(urllib.parse.urlsplit((ep.get("info") or {}).get("movie_image") or "").hostname)
            info = data.get("info") or {}
            for key in ("cover", "movie_image", "cover_big"):
                hosts.add(urllib.parse.urlsplit(info.get(key) or "").hostname)
            for b in info.get("backdrop_path") or []:
                hosts.add(urllib.parse.urlsplit(b or "").hostname)
            hosts.discard(None)
            hosts.discard("")
            merge_hosts(self.db, hosts)
        return data

    @staticmethod
    def _episodes_flat(data):
        eps = data.get("episodes") or {}
        if isinstance(eps, dict):
            for lst in eps.values():
                yield from lst or []
        else:
            yield from eps

    def _seasons(self, data):
        by_season = {}
        for ep in self._episodes_flat(data):
            by_season.setdefault(to_int(ep.get("season"), 1), []).append(ep)
        seasons = []
        for n in sorted(by_season):
            eps = sorted(by_season[n], key=lambda e: to_int(e.get("episode_num")))
            seasons.append((n, eps))
        return seasons

    def _progress_map(self, kind, ids):
        if not ids:
            return {}
        q = f"SELECT * FROM progress WHERE kind=? AND id IN ({','.join('?' * len(ids))})"
        return {r["id"]: r for r in self.db.execute(q, (kind, *ids))}

    @staticmethod
    def _prog(row):
        if not row:
            return None
        dur = row["duration"] or 0
        pct = min(100, round(100 * row["position"] / dur)) if dur else 0
        return {"position": row["position"], "duration": dur, "pct": 100 if row["done"] else pct,
                "remaining": max(0, round(dur - row["position"])) if dur else None, "done": bool(row["done"])}

    def _watch_flags(self, kind, ids):
        if not ids:
            return {}
        q = f"SELECT id, fav FROM watchlist WHERE kind=? AND id IN ({','.join('?' * len(ids))})"
        return {r["id"]: bool(r["fav"]) for r in self.db.execute(q, (kind, *ids))}

    def _now_next(self, epg_ids):
        t = now()
        ids = sorted({i for i in epg_ids if i})
        res = {}
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            q = (f"SELECT channel, start, stop, title, descr, icon, categ FROM epg "
                 f"WHERE channel IN ({','.join('?' * len(chunk))})"
                 " AND stop > ? AND start < ? ORDER BY channel, start")
            for r in self.db.execute(q, (*chunk, t, t + 12 * 3600)):
                lst = res.setdefault(r["channel"], [])
                if len(lst) < 2:
                    lst.append({"start": r["start"], "stop": r["stop"], "title": r["title"], "desc": r["descr"],
                                "image": self.img(r["icon"], 480), "categ": r["categ"] or ""})
        return res

    def _channels(self, rows):
        rows = list(rows)
        epg = self._now_next([(r["epg_key"] or r["epg_id"]) for r in rows])
        favs = {r["id"] for r in self.db.execute("SELECT id FROM fav_channels")}
        out = []
        for r in rows:
            progs = epg.get(r["epg_key"] or r["epg_id"], [])
            num = r["bq_num"] if "bq_num" in r.keys() else r["num"]
            out.append({"id": r["id"], "num": num, "name": r["name"], "src": r["src"],
                        "num_own": num != r["num"],
                        "logo": self.logo(r["logo"] or r["alt_logo"]),
                        "cat": r["cat"], "fav": r["id"] in favs, "archive": bool(r["archive"]),
                        "archive_days": r["archive_days"] or 0, "orig_name": r["orig_name"], "orig_num": r["orig_num"],
                        "quality": _quality(r["orig_name"]),
                        "now": progs[0] if progs else None, "next": progs[1] if len(progs) > 1 else None})
        return out

    def _vod_items(self, rows):
        rows = list(rows)
        ids = [r["id"] for r in rows]
        prog, wl = self._progress_map("movie", ids), self._watch_flags("movie", ids)
        return [{"kind": "movie", "id": r["id"], "name": r["name"], "poster": self.img(r["poster"], 240),
                 "rating": r["rating"], "added": r["added"], "progress": self._prog(prog.get(r["id"])),
                 "watchlist": r["id"] in wl, "fav": wl.get(r["id"], False)} for r in rows]

    def _series_items(self, rows):
        rows = list(rows)
        wl = self._watch_flags("series", [r["id"] for r in rows])
        return [{"kind": "series", "id": r["id"], "name": r["name"], "poster": self.img(r["poster"], 240),
                 "genre": r["genre"], "rating": r["rating"], "watchlist": r["id"] in wl,
                 "fav": wl.get(r["id"], False)} for r in rows]

    def _series_resume(self, series_id):
        """Épisode à reprendre : le dernier commencé, ou le suivant s'il est fini."""
        last = self.db.execute("SELECT * FROM progress WHERE kind='episode' AND series_id=? ORDER BY updated DESC "
                               "LIMIT 1", (series_id,)).fetchone()
        if not last:
            return None
        if not last["done"]:
            return {"episode_id": last["id"], "season": last["season"], "episode": last["episode"],
                    "title": library.episode_title(last["title"]), "progress": self._prog(last), "next": False, "updated": last["updated"]}
        try:
            data = self._info("series", series_id)
        except ApiError:
            return None
        flat = [(n, ep) for n, eps in self._seasons(data) for ep in eps]
        for i, (n, ep) in enumerate(flat):
            if to_int(ep.get("id")) == last["id"] and i + 1 < len(flat):
                n2, nxt = flat[i + 1]
                return {"episode_id": to_int(nxt.get("id")), "season": n2, "episode": to_int(nxt.get("episode_num")),
                        "title": library.episode_title(nxt.get("title")), "progress": None, "next": True, "updated": last["updated"]}
        return None

    # ---------- points d'API ----------
    def status(self, q):
        meta = {r["k"]: r["v"] for r in self.db.execute("SELECT k, v FROM meta WHERE k LIKE '%sync'")}
        count = lambda t: self.db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]  # noqa: E731
        return {"now": now(), "catalog_sync": to_int(meta.get("catalog_sync")) or None,
                "epg_sync": to_int(meta.get("epg_sync")) or None,
                "syncing": bool(self._sync_thread and self._sync_thread.is_alive()),
                "counts": {"live": count("live"), "vod": count("vod"), "series": count("series"),
                           "epg": count("epg")},
                "version": __version__,
                "providers": self.providers_brief()}

    def providers_brief(self):
        """Ce que l'appli TV a besoin de savoir des abonnements : nom, lettre, couleur."""
        return [{"src": p["src"], "name": p["name"], "letter": p["letter"], "color": p["color"]}
                for p in providers.listing(self.db, self.cfg)]

    def providers_list(self, q):
        return {"providers": providers.listing(self.db, self.cfg), "now": now()}

    def provider_set(self, q, body):
        src = to_int(body.get("src"))
        if not self.db.execute("SELECT 1 FROM provider WHERE src=?", (src,)).fetchone():
            raise ApiError(404, "abonnement inconnu")
        providers.customize(self.db, src, body.get("letter"), body.get("color"))
        self.reg.refresh(self.db)
        return self.providers_list(q)

    def start_sync(self, q, body):
        if not (self._sync_thread and self._sync_thread.is_alive()):
            only = to_int((body or {}).get("src")) or None
            self._sync_thread = threading.Thread(target=self._sync, args=(only,), daemon=True)
            self._sync_thread.start()
        return {"syncing": True}

    def _sync(self, only=None):
        try:
            sync.run(self.cfg, only)
        finally:
            self.reg.refresh(connect(self.cfg))

    def categories(self, q):
        kind = q.get("kind", "live")
        if kind not in ("live", "vod", "series"):
            raise ApiError(400, "kind doit valoir live, vod ou series")
        everything = q.get("all") == "1"
        src = to_int(q.get("src"))
        own = bouquets.listing(self.db, kind)
        rows = self.db.execute(
            f"SELECT c.id, c.name, c.orig_name, c.hidden, c.src, COUNT(t.id) AS n FROM categories c "
            f"JOIN {kind} t ON t.cat = c.id WHERE c.kind = ? {'' if everything else 'AND c.hidden = 0'} "
            f"{'AND c.src = ?' if src else ''} GROUP BY c.id ORDER BY c.src = 0 DESC, c.src, c.pos",
            (kind, src) if src else (kind,))
        manual = {r["id"] for r in self.db.execute("SELECT id FROM cat_override WHERE kind=?", (kind,))}
        return own + [{"id": r["id"], "name": r["name"], "orig_name": r["orig_name"] or r["name"], "count": r["n"],
                       "hidden": bool(r["hidden"]), "manual": r["id"] in manual, "own": False, "src": r["src"]}
                      for r in rows]

    # ---------- personnalisation : noms et numéros ----------
    def rename_category(self, q, body):
        kind, cat_id = body.get("kind"), str(body.get("id", ""))
        if kind not in ("live", "vod", "series") or not cat_id:
            raise ApiError(400, "kind (live|vod|series) et id sont requis")
        custom.rename_category(self.db, kind, cat_id, body.get("name"))
        return {"ok": True}

    def edit_channel(self, q, body):
        chan_id = to_int(body.get("id"))
        if not self.db.execute("SELECT 1 FROM live WHERE id=?", (chan_id,)).fetchone():
            raise ApiError(404, "chaîne inconnue")
        num = body.get("num")
        if num not in (None, "") and (not str(num).strip().isdigit() or int(num) > 999999):
            raise ApiError(400, "le numéro doit être un nombre entier")
        custom.edit_channel(self.db, chan_id, body.get("name"), num)
        row = self.db.execute("SELECT name FROM live WHERE num = (SELECT num FROM live WHERE id=?) AND id != ? LIMIT 1",
                              (chan_id, chan_id)).fetchone()
        return {"ok": True, "same_number": row["name"] if row else None}

    def set_channel_logo(self, q, body):
        """Logo collé à la main ; adresse vide : retour au logo du fournisseur."""
        chan_id = to_int(body.get("id"))
        r = self.db.execute("SELECT logo, orig_logo, alt_logo FROM live WHERE id=?", (chan_id,)).fetchone()
        if not r:
            raise ApiError(404, "chaîne inconnue")
        url = (body.get("url") or "").strip()
        if url:
            try:
                data = artwork.fetch(url, self.cfg["sync"]["timeout"])
            except ValueError as e:
                raise ApiError(400, str(e))
            return {"ok": True, "logo": self.logo(self._store_art("live", chan_id, "logo", data))}
        custom.set_channel_logo(self.db, chan_id, None)
        artwork.forget(self.cfg, "live", chan_id, "logo")
        back = self.db.execute("SELECT logo, alt_logo FROM live WHERE id=?", (chan_id,)).fetchone()
        return {"ok": True, "logo": self.logo(back["logo"] or back["alt_logo"])}

    def channels_admin(self, q):
        """Toutes les chaînes, bouquets masqués compris (page de réglages)."""
        cat, term = q.get("cat", "all"), norm(q.get("q", "")).strip()
        where, args = [], []
        if cat != "all":
            where.append("l.cat = ?"); args.append(cat)
        if term:
            where.append("(l.norm LIKE ? OR l.orig_name LIKE ?)"); args += ["%" + term + "%", "%" + term + "%"]
        bq = bouquets.parse_id(cat)
        if bq is not None:
            where, args = ["l.id IN (SELECT chan FROM bouquet_items WHERE bouquet = ?)"], [bq]
        if to_int(q.get("src")):
            where.append("l.src = ?"); args.append(to_int(q.get("src")))
        sql = ("SELECT l.*, c.name AS cat_name, c.hidden AS cat_hidden, o.id AS custom, "
               "       m.xid AS xid, m.auto AS xauto, e.name AS xname FROM live l "
               "LEFT JOIN categories c ON c.kind = 'live' AND c.id = l.cat "
               "LEFT JOIN chan_override o ON o.id = l.id "
               "LEFT JOIN epg_map m ON m.chan = l.id "
               "LEFT JOIN epg_chan e ON e.src = m.src AND e.xid = m.xid "
               + ("WHERE " + " AND ".join(where) if where else "")
               + " GROUP BY l.id ORDER BY l.num, l.src, l.name LIMIT 3000")
        return [{"id": r["id"], "num": r["num"], "name": r["name"], "orig_num": r["orig_num"], "src": r["src"],
                 "orig_name": r["orig_name"], "logo": self.logo(r["logo"] or r["alt_logo"], 96), "cat": r["cat"],
                 "cat_name": r["cat_name"] or "", "hidden": bool(r["cat_hidden"]),
                 "custom": r["custom"] is not None, "archive": bool(r["archive"]),
                 "quality": _quality(r["orig_name"]), "epg": r["xname"] or ("" if r["xid"] else ""),
                 "epg_manual": bool(r["xid"]) and not r["xauto"]}
                for r in self.db.execute(sql, args)]

    # ---------- bouquets personnels ----------
    def bouquets_list(self, q):
        kind = q.get("kind", "live")
        if kind == "all":
            return {"bouquets": sum((bouquets.listing(self.db, k) for k in bouquets.KINDS), [])}
        try:
            return {"bouquets": bouquets.listing(self.db, kind)}
        except ValueError as e:
            raise ApiError(400, str(e))

    def _bq(self, body):
        bid = to_int(body.get("id"))
        if not self.db.execute("SELECT 1 FROM bouquets WHERE id=?", (bid,)).fetchone():
            raise ApiError(404, "bouquet inconnu")
        return bid

    def bouquet_create(self, q, body):
        kind = body.get("kind", "live")
        try:
            if body.get("cats"):
                bid = bouquets.from_category(self.db, body.get("name") or "Nouveau bouquet", body["cats"], kind)
            else:
                bid = bouquets.create(self.db, body.get("name"), kind)
        except ValueError as e:
            raise ApiError(400, str(e))
        return {"id": bid, "cat": bouquets.cat_id(bid), "kind": kind}

    def bouquet_rename(self, q, body):
        try:
            bouquets.rename(self.db, self._bq(body), body.get("name"))
        except ValueError as e:
            raise ApiError(400, str(e))
        return {"ok": True}

    def bouquet_delete(self, q, body):
        bouquets.delete(self.db, to_int(q.get("id")))
        return {"ok": True}

    def bouquet_move(self, q, body):
        bouquets.move(self.db, self._bq(body), to_int(body.get("delta"), 1))
        return {"ok": True}

    def bouquet_items(self, q, body):
        n = bouquets.set_items(self.db, self._bq(body), body.get("channels") or [])
        return {"count": n}

    def bouquet_add(self, q, body):
        bid = self._bq(body)
        kind = bouquets.kind_of(self.db, bid) or "live"
        ids = body.get("channels") or []
        if body.get("cat"):
            order = "num, name" if kind == "live" else "norm"
            ids += [r["id"] for r in self.db.execute(f"SELECT id FROM {kind} WHERE cat=? ORDER BY {order}",
                                                     (str(body["cat"]),))]
        return {"added": bouquets.add(self.db, bid, ids)}

    def bouquet_remove(self, q, body):
        bouquets.remove(self.db, self._bq(body), body.get("channels") or [])
        return {"ok": True}

    def bouquet_number(self, q, body):
        """Numéro d'une seule chaîne dans un bouquet ({id, chan, num}, num vide : le numéro habituel)."""
        num = body.get("num")
        if num not in (None, "") and (not str(num).strip().isdigit() or int(num) > 99999):
            raise ApiError(400, "numéro invalide")
        if not bouquets.set_number(self.db, self._bq(body), to_int(body.get("chan")), num):
            raise ApiError(404, "chaîne absente du bouquet")
        return {"ok": True}

    def bouquet_renumber(self, q, body):
        try:
            n = bouquets.renumber(self.db, self._bq(body), to_int(body.get("start"), 1),
                                  max(1, to_int(body.get("step"), 1)), bool(body.get("everywhere")))
        except ValueError as e:
            raise ApiError(400, str(e))
        return {"renumbered": n}

    def numbers_reset(self, q, body):
        bouquets.reset_numbers(self.db)
        return {"ok": True}

    # ---------- règles de nettoyage des noms ----------
    def rules_list(self, q):
        return {"rules": custom.list_rules(self.db),
                "preview": custom.preview(self.db, kind=q.get("preview", "live"))}

    def rules_set(self, q, body):
        try:
            custom.set_rule(self.db, to_int(body.get("id")) or None, body.get("pattern"), body.get("repl"),
                            body.get("enabled"))
        except re.error as e:
            raise ApiError(400, "règle mal écrite : %s" % e)
        return {"ok": True}

    def rules_delete(self, q, body):
        custom.delete_rule(self.db, to_int(q.get("id")))
        return {"ok": True}

    def names_reset(self, q, body):
        custom.reset_names(self.db, (body or {}).get("kind", "all"))
        return {"ok": True}

    def rename_item(self, q, body):
        kind, item_id = body.get("kind"), to_int(body.get("id"))
        if kind not in ("vod", "series"):
            raise ApiError(400, "kind doit valoir vod ou series")
        if not self.db.execute(f"SELECT 1 FROM {kind} WHERE id=?", (item_id,)).fetchone():
            raise ApiError(404, "titre inconnu")
        custom.rename_item(self.db, kind, item_id, body.get("name"))
        return {"ok": True}

    # ---------------------------------------------------------------- médiathèque

    @staticmethod
    def _media_url(f):
        """Chemin relatif : l'application y ajoute l'adresse du serveur et le jeton."""
        ext = os.path.splitext(f["path"])[1].lower() or ".mkv"
        return "/media/%d%s" % (f["id"], ext)

    def medias_roots(self, q):
        last = self.db.execute("SELECT v FROM meta WHERE k='medias_last'").fetchone()
        roots = [dict(r) for r in self.db.execute("SELECT * FROM media_root ORDER BY id")]
        fix = {}
        for f in self.db.execute("SELECT root, vcodec, acodec FROM media_file WHERE playable = 0 AND kind <> 'extra'"):
            if convert.fixable(f):
                fix[f["root"]] = fix.get(f["root"], 0) + 1
        on = convert.enabled(self.cfg)
        for r in roots:
            r["fixable"] = fix.get(r["id"], 0)
            r["writable"] = convert.writable(r["path"]) if on and os.path.isdir(r["path"]) else None
        return {"roots": roots,
                "convert": {"enabled": on, "ffmpeg": convert.have_ffmpeg() if on else False,
                            "keep": convert.keep_original(self.db)},
                "last": json.loads(last["v"]) if last else None,
                "tmdb": bool((self.cfg.get("medias") or {}).get("tmdb_key")),
                "ffprobe": medias.have_probe(),
                "running": bool(self.media_job and self.media_job.is_alive())}

    # ---------- démarrage automatique sur le téléviseur ----------
    def tv_status(self, q):
        out = tvwake.status(self.cfg, self.cfg["server"]["data_dir"], self.db, self.watcher)
        # l'adresse de qui demande : quand c'est le téléviseur lui-même, il peut la proposer
        out["client"] = q.get("_ip", "")
        return out

    def tv_set(self, q, body):
        vals = {}
        for k in ("host", "app", "nom"):
            if k in body:
                vals[k] = str(body[k] or "").strip()
        for k in ("delai", "essais"):
            if k in body:
                vals[k] = max(0 if k == "delai" else 1, to_int(body[k], 6))
        if "auto" in body:
            vals["auto"] = bool(body["auto"])
        if vals:
            tvwake.enregistrer(self.db, vals)
        if vals.get("auto") and not (self.watcher and self.watcher.is_alive()):
            self.start_watcher()
        return self.tv_status(q)

    def tv_pair(self, q, body):
        """Demande l'autorisation au téléviseur : une fenêtre s'affiche dessus."""
        tv = tvwake.Tv(self.cfg, self.cfg["server"]["data_dir"], self.db)
        if not tv.host:
            raise ApiError(400, "renseignez d'abord l'adresse du téléviseur")
        try:
            apps = tv.apps()
        except Exception as e:
            raise ApiError(502, "appairage impossible : %s" % tvwake._short(e))
        return {"paired": bool(tv.token()), "apps": sorted(apps, key=lambda a: (a["name"] or "").lower())}

    def tv_test(self, q, body):
        """Lance Luciole tout de suite, pour vérifier que la procédure marche."""
        tv = tvwake.Tv(self.cfg, self.cfg["server"]["data_dir"], self.db)
        if not tv.host or not tv.app:
            raise ApiError(400, "renseignez l'adresse du téléviseur et l'application")
        if tv.power_state() != "on":
            raise ApiError(409, "le téléviseur est éteint ou en veille")
        try:
            how = tv.launch()
        except Exception as e:
            raise ApiError(502, "lancement impossible : %s" % tvwake._short(e))
        return {"ok": True, "how": how, "front": tv.au_premier_plan()}

    def medias_add(self, q, body):
        path = (body.get("path") or "").strip()
        kind = body.get("kind") or "auto"
        if not path:
            raise ApiError(400, "chemin requis")
        if not os.path.isdir(path):
            raise ApiError(400, "dossier introuvable sur le serveur : " + path)
        try:
            rid = medias.add_root(self.db, path, kind, body.get("name") or "")
        except ValueError as e:
            raise ApiError(400, str(e))
        return {"ok": True, "id": rid}

    def medias_remove(self, q, body):
        medias.remove_root(self.db, to_int(body.get("id")))
        return {"ok": True}

    def medias_scan(self, q, body):
        if self.media_job and self.media_job.is_alive():
            return {"ok": True, "running": True}
        force = bool((body or {}).get("force"))

        def run():
            db = connect(self.cfg)
            try:
                medias.refresh(db, self.cfg, force)
            except Exception:
                log.exception("analyse de la médiathèque")
            finally:
                db.close()

        self.media_job = threading.Thread(target=run, name="medias", daemon=True)
        self.media_job.start()
        return {"ok": True, "running": True}

    def medias_items(self, q):
        kind = q.get("kind", "movie")
        if kind not in ("movie", "episode", "probleme"):
            raise ApiError(400, "kind doit valoir movie, episode ou probleme")
        term = norm(q.get("q", "")).strip()
        where, args = [], []
        if kind == "probleme":
            where.append("f.kind <> 'extra' AND (f.playable = 0 OR f.matched = 0)")
        else:
            where.append("f.kind = ?")
            args.append(kind)
        if to_int(q.get("root")):
            where.append("f.root = ?")
            args.append(to_int(q.get("root")))
        if term:
            where.append("(LOWER(f.title) LIKE ? OR LOWER(f.path) LIKE ?)")
            args += ["%" + term + "%", "%" + term + "%"]
        sql = ("SELECT f.*, s.name AS show_name,"
               " (SELECT v.name FROM vod v WHERE v.id = ? + COALESCE(f.grp, f.id)) AS vod_name,"
               " (SELECT COUNT(*) FROM media_file g WHERE f.kind = 'movie' AND g.grp = f.grp) AS nver,"
               " (SELECT p.file FROM media_pref p WHERE p.vod = ? + COALESCE(f.grp, f.id)) AS pref,"
               " (SELECT x.name FROM series x WHERE x.id = ? + f.show) AS serie_name"
               " FROM media_file f LEFT JOIN media_show s ON s.id = f.show"
               + (" WHERE " + " AND ".join(where) if where else "")
               + " ORDER BY f.title, f.season, f.episode LIMIT 400")
        args = [medias.BASE, medias.BASE, medias.BASE] + args
        out = []
        for r in self.db.execute(sql, args):
            out.append({"id": r["id"], "path": r["path"], "kind": r["kind"], "show": r["show"],
                        "title": r["show_name"] or r["title"], "year": r["year"],
                        "published": (r["serie_name"] if r["kind"] == "episode" else r["vod_name"]) or "",
                        "season": r["season"], "episode": r["episode"], "eptitle": r["eptitle"],
                        "matched": bool(r["matched"]), "tmdb": r["tmdb"],
                        "video": r["vcodec"] or "", "audio": r["acodec"] or "",
                        "height": r["height"], "playable": bool(r["playable"]), "note": r["note"] or "",
                        "fixable": not r["playable"] and convert.fixable(r),
                        "versions": r["nver"] or 1, "vod": medias.BASE + (r["grp"] or r["id"]) if r["kind"] == "movie" else 0,
                        "version_label": medias.version_label(r) if r["kind"] == "movie" else "",
                        "pref": bool(r["pref"]) and r["pref"] == r["id"], "has_pref": bool(r["pref"]),
                        "size": r["size"]})
        return {"items": out}

    def medias_titles(self, q):
        """Films ou séries publiés depuis les dossiers, avec leur place dans la Bibliothèque (page web)."""
        kind = q.get("kind", "movie")
        if kind not in library.KINDS:
            raise ApiError(400, "kind doit valoir movie ou series")
        root, term, state = to_int(q.get("root")) or None, norm(q.get("q", "")).strip(), q.get("state", "all")
        B = medias.BASE
        if kind == "movie":
            sql = ("SELECT v.id, v.name, v.poster, f.year,"
                   " (SELECT GROUP_CONCAT(DISTINCT g.root) FROM media_file g WHERE g.grp = f.id OR g.id = f.id) AS roots,"
                   " (SELECT COUNT(*) FROM media_file g WHERE g.grp = f.id OR g.id = f.id) AS files,"
                   " i.cat AS lib_cat, c.name AS lib_name, ic.json AS info"
                   " FROM media_file f JOIN vod v ON v.id = ? + f.id"
                   " LEFT JOIN lib_item i ON i.kind = 'movie' AND i.id = v.id LEFT JOIN lib_cat c ON c.id = i.cat"
                   " LEFT JOIN info_cache ic ON ic.kind = 'vod' AND ic.id = v.id"
                   " WHERE f.kind = 'movie'")
            args = [B]
            if root:
                sql += " AND EXISTS(SELECT 1 FROM media_file g WHERE (g.grp = f.id OR g.id = f.id) AND g.root = ?)"
                args.append(root)
        else:
            sql = ("SELECT x.id, x.name, x.poster, s.year, x.genre,"
                   " (SELECT GROUP_CONCAT(DISTINCT f.root) FROM media_file f WHERE f.show = s.id) AS roots,"
                   " (SELECT COUNT(*) FROM media_file f WHERE f.show = s.id) AS files,"
                   " i.cat AS lib_cat, c.name AS lib_name"
                   " FROM media_show s JOIN series x ON x.id = ? + s.id"
                   " LEFT JOIN lib_item i ON i.kind = 'series' AND i.id = x.id LEFT JOIN lib_cat c ON c.id = i.cat"
                   " WHERE 1")
            args = [B]
            if root:
                sql += " AND EXISTS(SELECT 1 FROM media_file f WHERE f.show = s.id AND f.root = ?)"; args.append(root)
        if term:
            sql += " AND " + ("v" if kind == "movie" else "x") + ".norm LIKE ?"; args.append("%" + term + "%")
        if state == "in":
            sql += " AND i.cat IS NOT NULL"
        elif state == "out":
            sql += " AND i.cat IS NULL"
        sql += " ORDER BY " + ("v" if kind == "movie" else "x") + ".norm LIMIT 3000"
        out = []
        for r in self.db.execute(sql, args):
            if kind == "movie":
                try:
                    genre = ((json.loads(r["info"] or "{}").get("info") or {}).get("genre") or "")
                except ValueError:
                    genre = ""
            else:
                genre = r["genre"] or ""
            out.append({"id": r["id"], "name": r["name"], "year": r["year"], "genre": genre,
                        "poster": self.img(r["poster"], 200), "files": r["files"],
                        "roots": [to_int(x) for x in str(r["roots"] or "").split(",") if x],
                        "lib_cat": r["lib_cat"], "lib_name": r["lib_name"] or ""})
        return {"kind": kind, "items": out, "cats": library.categories(self.db, kind)}

    # ---------- conversion du son (seulement si l'écriture est autorisée) ----------
    def _need_convert(self):
        if not convert.enabled(self.cfg):
            raise ApiError(403, "conversion désactivée : la médiathèque est en lecture seule")
        if not convert.have_ffmpeg():
            raise ApiError(400, "ffmpeg n'est pas installé sur le serveur")

    def medias_convert_state(self, q):
        out = self.converter.state()
        out["enabled"] = convert.enabled(self.cfg)
        out["keep"] = convert.keep_original(self.db)
        return out

    def medias_convert(self, q, body):
        """{ids: [fichiers]} ou {root: dossier} (0 : tous) : met en file les sons illisibles."""
        self._need_convert()
        if body.get("ids"):
            ids = [to_int(i) for i in body["ids"]][:2000]
            rows = [r for r in self.db.execute(
                "SELECT * FROM media_file WHERE id IN (%s)" % ",".join("?" * len(ids)), ids)] if ids else []
        else:
            root = to_int(body.get("root"))
            rows = list(self.db.execute("SELECT * FROM media_file WHERE playable = 0 AND kind <> 'extra'"
                                        + (" AND root = ?" if root else "") + " ORDER BY path",
                                        (root,) if root else ()))
        rows = [r for r in rows if convert.fixable(r)]
        added = self.converter.add(rows)
        out = self.medias_convert_state(q)
        out["added"] = added
        return out

    def medias_convert_cancel(self, q, body):
        self.converter.cancel()
        return self.medias_convert_state(q)

    def medias_convert_forget(self, q, body):
        self.converter.forget()
        return self.medias_convert_state(q)

    def medias_convert_keep(self, q, body):
        self._need_convert()
        convert.set_keep_original(self.db, bool(body.get("keep")))
        return self.medias_convert_state(q)

    def medias_search(self, q):
        """Recherche TMDB, pour corriger une fiche à la main."""
        tm = medias.Tmdb(self.cfg)
        if not tm.ready():
            raise ApiError(400, "aucune clé TMDB dans la configuration")
        term, kind = (q.get("q") or "").strip(), q.get("kind", "movie")
        if len(term) < 2:
            return {"results": []}
        try:
            res = tm.search_movie(term) if kind == "movie" else tm.search_tv(term)
        except medias.TmdbError as e:
            raise ApiError(502, str(e))
        return {"results": [{"id": to_int(r.get("id")),
                             "title": r.get("title") or r.get("name") or "",
                             "year": (r.get("release_date") or r.get("first_air_date") or "")[:4],
                             "poster": self.img(tm.poster(r.get("poster_path")), 240) if r.get("poster_path") else "",
                             "plot": (r.get("overview") or "")[:300]} for r in res[:12]]}

    def medias_match(self, q, body):
        """Force la fiche d'un film ou d'une série."""
        tmdb_id, kind = to_int(body.get("tmdb")), body.get("kind", "movie")
        tm = medias.Tmdb(self.cfg)
        if kind == "movie":
            f = self.db.execute("SELECT * FROM media_file WHERE id=?", (to_int(body.get("id")),)).fetchone()
            if not f:
                raise ApiError(404, "fichier inconnu")
            with self.db:
                self.db.execute("INSERT OR REPLACE INTO media_match(path, tmdb, kind) VALUES (?,?, 'movie')",
                                (f["path"], tmdb_id))
                self.db.execute("UPDATE media_file SET matched=0, tmdb=? WHERE id=?", (tmdb_id, f["id"]))
            medias.settle_movies(self.db, tm, force=False)
            custom.apply(self.db)
        else:
            show = to_int(body.get("show"))
            if not self.db.execute("SELECT 1 FROM media_show WHERE id=?", (show,)).fetchone():
                raise ApiError(404, "série inconnue")
            with self.db:
                self.db.execute("UPDATE media_show SET tmdb=?, matched=0 WHERE id=?", (tmdb_id, show))
            medias.publish_shows(self.db, tm, force=True)
        return {"ok": True}

    def items_admin(self, q):
        """Films ou séries, bouquets masqués compris (page de réglages)."""
        kind = q.get("kind", "vod")
        if kind not in ("vod", "series"):
            raise ApiError(400, "kind doit valoir vod ou series")
        cat, term = q.get("cat", "all"), norm(q.get("q", "")).strip()
        where, args = [], []
        if cat != "all":
            where.append("t.cat = ?"); args.append(cat)
        if term:
            where.append("(t.norm LIKE ? OR t.orig_name LIKE ?)"); args += ["%" + term + "%", "%" + term + "%"]
        sql = (f"SELECT t.id, t.name, t.orig_name, t.cat, t.poster, c.name AS cat_name, o.name AS manual, "
               f"(o.plot IS NOT NULL OR o.poster IS NOT NULL OR o.backdrop IS NOT NULL) AS edited "
               f"FROM {kind} t LEFT JOIN categories c ON c.kind = ? AND c.id = t.cat "
               f"LEFT JOIN item_override o ON o.kind = ? AND o.id = t.id "
               + ("WHERE " + " AND ".join(where) + " " if where else "")
               + "ORDER BY t.name LIMIT 400")
        rows = self.db.execute(sql, (kind, kind, *args))
        return {"items": [{"id": r["id"], "name": r["name"], "orig_name": r["orig_name"] or r["name"],
                           "cat": r["cat"], "cat_name": r["cat_name"] or "", "manual": bool(r["manual"]),
                           "poster": self.img(r["poster"], 240), "edited": bool(r["edited"]),
                           "local": r["id"] >= medias.BASE}
                          for r in rows]}

    def item_detail(self, q):
        """Fiche complète d'un film ou d'une série, pour l'éditeur de la page de réglages."""
        kind, item_id = q.get("kind", "vod"), to_int(q.get("id"))
        if kind not in ("vod", "series"):
            raise ApiError(400, "kind doit valoir vod ou series")
        r = self.db.execute(f"SELECT * FROM {kind} WHERE id=?", (item_id,)).fetchone()
        if not r:
            raise ApiError(404, "fiche inconnue")
        row = dict(r)
        plot = row.get("plot") or ""
        backdrop = row.get("backdrop")
        if kind == "vod" and (not plot or not backdrop):
            # comme la page du film sur la TV : la fiche du fournisseur complète ce qui manque
            try:
                info = self._info("vod", item_id).get("info") or {}
            except ApiError:
                info = {}
            plot = plot or info.get("plot") or info.get("description") or ""
            backdrop = backdrop or (info.get("backdrop_path") or [None])[0]
        over = custom.item_override(self.db, kind, item_id)
        return {"kind": kind, "id": item_id, "name": row.get("name") or "",
                "orig_name": row.get("orig_name") or "", "plot": plot,
                "orig_plot": row.get("orig_plot") or "",
                "poster": self.img(row.get("poster"), 320), "backdrop": self.img(backdrop, 640),
                "local": item_id >= medias.BASE,
                "manual": {k: bool(v) for k, v in over.items()}}

    def edit_item(self, q, body):
        """Corrige une fiche. Un champ absent n'est pas touché, un champ vide revient au fournisseur."""
        kind, item_id = body.get("kind", "vod"), to_int(body.get("id"))
        changes = {k: body[k] for k in ("name", "plot", "poster", "backdrop") if k in body}
        if not item_id:
            raise ApiError(400, "id est requis")
        try:
            custom.edit_item(self.db, kind, item_id, **changes)
        except ValueError as e:
            raise ApiError(400, str(e))
        for slot in ("poster", "backdrop"):
            if slot in changes and not (changes[slot] or "").strip():
                artwork.forget(self.cfg, kind, item_id, slot)
        return self.item_detail({"kind": kind, "id": item_id})

    # ---------- images choisies à la main ----------
    ART_WIDTH = {"poster": 320, "backdrop": 640, "logo": 128}

    def _art_now(self, kind, slot, item_id):
        """Ce qui s'affiche pour cette image après la modification."""
        if kind == "live":
            r = self.db.execute("SELECT logo, alt_logo FROM live WHERE id=?", (item_id,)).fetchone()
            src = (r["logo"] or r["alt_logo"]) if r else ""
        else:
            r = self.db.execute(f"SELECT {slot} AS src FROM {kind} WHERE id=?", (item_id,)).fetchone()
            src = r["src"] if r else ""
        if slot == "logo":
            return {"ok": True, "img": self.logo(src)}
        return {"ok": True, "img": self.img(src, self.ART_WIDTH[slot])}

    def _store_art(self, kind, item_id, slot, data):
        try:
            url = artwork.save(self.cfg, kind, item_id, slot, data)
        except ValueError as e:
            raise ApiError(400, str(e))
        if kind == "live":
            custom.set_channel_logo(self.db, item_id, url)
        else:
            custom.edit_item(self.db, kind, item_id, **{slot: url})
        return url

    def _art_target(self, kind, slot, item_id):
        try:
            artwork.check(kind, slot)
        except ValueError as e:
            raise ApiError(400, str(e))
        table = "live" if kind == "live" else kind
        if not item_id or not self.db.execute(f"SELECT 1 FROM {table} WHERE id=?", (item_id,)).fetchone():
            raise ApiError(404, "fiche inconnue")

    def art_upload(self, q, raw):
        """Image envoyée depuis le PC : le corps de la requête est le fichier lui-même."""
        kind, slot, item_id = q.get("kind", "vod"), q.get("slot", "poster"), to_int(q.get("id"))
        self._art_target(kind, slot, item_id)
        self._store_art(kind, item_id, slot, raw)
        return self._art_now(kind, slot, item_id)

    def art_fetch(self, q, body):
        """Image prise sur le web (adresse collée, ou vignette TMDB choisie)."""
        kind, slot, item_id = body.get("kind", "vod"), body.get("slot", "poster"), to_int(body.get("id"))
        self._art_target(kind, slot, item_id)
        try:
            data = artwork.fetch(body.get("url"), self.cfg["sync"]["timeout"])
        except ValueError as e:
            raise ApiError(400, str(e))
        self._store_art(kind, item_id, slot, data)
        return self._art_now(kind, slot, item_id)

    def art_reset(self, q, body):
        """Retour à l'image du fournisseur."""
        kind, slot, item_id = body.get("kind", "vod"), body.get("slot", "poster"), to_int(body.get("id"))
        self._art_target(kind, slot, item_id)
        if kind == "live":
            custom.set_channel_logo(self.db, item_id, None)
        else:
            custom.edit_item(self.db, kind, item_id, **{slot: None})
        artwork.forget(self.cfg, kind, item_id, slot)
        return self._art_now(kind, slot, item_id)

    def art_search(self, q):
        """Jaquettes et fonds proposés par TMDB pour un titre."""
        tm = medias.Tmdb(self.cfg)
        if not tm.ready():
            raise ApiError(400, "aucune clé TMDB dans la configuration")
        term = (q.get("q") or "").strip()
        kind = "movie" if q.get("kind", "vod") == "vod" else "tv"
        if len(term) < 2:
            return {"results": []}
        try:
            res = tm.search_movie(term) if kind == "movie" else tm.search_tv(term)
        except medias.TmdbError as e:
            raise ApiError(502, str(e))
        out = []
        for r in res[:12]:
            poster, back = tm.poster(r.get("poster_path")), tm.poster(r.get("backdrop_path"))
            out.append({"id": to_int(r.get("id")), "title": r.get("title") or r.get("name") or "",
                        "year": (r.get("release_date") or r.get("first_air_date") or "")[:4],
                        "plot": r.get("overview") or "",
                        "poster_url": poster, "backdrop_url": back,
                        "poster": self.img(poster, 240) if poster else "",
                        "backdrop": self.img(back, 480) if back else ""})
        return {"results": out}

    def art_images(self, q):
        """Toutes les images TMDB d'un titre, pour choisir un autre fond ou une autre jaquette."""
        tm = medias.Tmdb(self.cfg)
        if not tm.ready():
            raise ApiError(400, "aucune clé TMDB dans la configuration")
        tid = to_int(q.get("tmdb"))
        kind = "movie" if q.get("kind", "vod") == "vod" else "tv"
        slot = "backdrop" if q.get("slot") == "backdrop" else "poster"
        if not tid:
            raise ApiError(400, "titre TMDB manquant")
        try:
            data = tm.images(kind, tid)
        except medias.TmdbError as e:
            raise ApiError(502, str(e))
        lang = (tm.lang or "fr")[:2]
        if slot == "backdrop":       # un fond sans texte d'abord, puis la langue de l'interface
            order = {None: 0, lang: 1, "en": 2}
        else:                        # une jaquette dans la langue de l'interface d'abord
            order = {lang: 0, "en": 1, None: 2}
        imgs = sorted(data.get("backdrops" if slot == "backdrop" else "posters") or [],
                      key=lambda i: (order.get(i.get("iso_639_1"), 3), -(i.get("vote_average") or 0)))
        out = []
        for i in imgs[:48]:
            url = tm.poster(i.get("file_path"))
            if url:
                out.append({"url": url, "img": self.img(url, 480 if slot == "backdrop" else 240),
                            "lang": i.get("iso_639_1") or "", "w": i.get("width"), "h": i.get("height")})
        return {"images": out}

    # ---------- guide externe ----------
    def epg_sources(self, q):
        return {"sources": epg_ext.list_sources(self.db), "status": epg_ext.map_status(self.db)}

    def epg_source_add(self, q, body):
        try:
            sid = epg_ext.add_source(self.db, body.get("url"), body.get("name"))
        except ValueError as e:
            raise ApiError(400, str(e))
        return {"id": sid}

    def epg_source_set(self, q, body):
        epg_ext.set_source(self.db, to_int(body.get("id")), body.get("enabled"), body.get("name"), body.get("url"))
        return {"ok": True}

    def epg_source_delete(self, q, body):
        epg_ext.delete_source(self.db, to_int(q.get("id")))
        return {"ok": True}

    def epg_refresh(self, q, body):
        if self._sync_thread and self._sync_thread.is_alive():
            return {"syncing": True}
        hours = self.cfg["sync"]["epg_hours"]
        timeout = self.cfg["sync"]["timeout"] * 3
        cfg = self.cfg

        def run():
            db = connect(cfg)
            try:
                epg_ext.fetch_all(db, hours, timeout)
            finally:
                db.close()
        self._sync_thread = threading.Thread(target=run, daemon=True)
        self._sync_thread.start()
        return {"syncing": True}

    def epg_automap(self, q, body):
        return {"mapped": epg_ext.automap(self.db)}

    def epg_search(self, q):
        return {"results": epg_ext.search_channels(self.db, q.get("q", ""))}

    def epg_map_set(self, q, body):
        chan = to_int(body.get("chan"))
        if body.get("auto"):
            epg_ext.clear_map(self.db, chan)
        else:
            epg_ext.set_map(self.db, chan, body.get("src"), body.get("xid"))
        return {"ok": True}

    # ---------- replay ----------
    def replay(self, q):
        ch = self.db.execute("SELECT * FROM live WHERE id=?", (to_int(q.get("id")),)).fetchone()
        if not ch:
            raise ApiError(404, "chaîne inconnue")
        if not ch["archive"]:
            return {"now": now(), "days": 0, "programmes": []}
        days = max(1, min(14, ch["archive_days"] or 1))
        lo, t = now() - days * 86400, now()
        progs = {}
        # 1) guide complet du fournisseur (indique aussi ce qui est réellement enregistré)
        row = self.db.execute("SELECT json, fetched FROM info_cache WHERE kind='epgfull' AND id=?", (ch["id"],)).fetchone()
        data = json.loads(row["json"]) if row and t - row["fetched"] < 1200 else None
        if data is None:
            try:
                xt, raw, _ = self._resolve(ch["id"])
                data = xt.api("get_simple_data_table", stream_id=raw) or {}
                with self.db:
                    self.db.execute("INSERT OR REPLACE INTO info_cache VALUES ('epgfull', ?, ?, ?)",
                                    (ch["id"], json.dumps(data), t))
            except XtreamError:
                data = json.loads(row["json"]) if row else {}
        for p in (data.get("epg_listings") if isinstance(data, dict) else None) or []:
            start, stop = to_int(p.get("start_timestamp")), to_int(p.get("stop_timestamp"))
            if not start or stop <= lo or start > t:
                continue
            progs[start] = {"start": start, "stop": stop, "title": _b64(p.get("title")),
                            "desc": _b64(p.get("description"))[:600], "available": str(p.get("has_archive", "1")) != "0"}
        # 2) à défaut, notre propre guide
        if not progs and (ch["epg_key"] or ch["epg_id"]):
            for r in self.db.execute("SELECT start, stop, title, descr FROM epg WHERE channel=? AND stop > ? AND start <= ? "
                                     "ORDER BY start", (ch["epg_key"] or ch["epg_id"], lo, t)):
                progs[r["start"]] = {"start": r["start"], "stop": r["stop"], "title": r["title"], "desc": r["descr"],
                                     "available": True}
        items = sorted(progs.values(), key=lambda p: -p["start"])
        return {"now": t, "days": days, "programmes": items}

    def _replay_url(self, chan_id, start, stop):
        ch = self.db.execute("SELECT archive FROM live WHERE id=?", (chan_id,)).fetchone()
        if not ch:
            raise ApiError(404, "chaîne inconnue")
        if not ch["archive"]:
            raise ApiError(400, "pas de replay sur cette chaîne")
        if not start or start > now():
            raise ApiError(400, "début de programme invalide")
        stop = max(stop or 0, start + 60)
        minutes = (stop - start + 59) // 60 + 1
        xt, raw, src = self._resolve(chan_id)
        return xt.replay_url(raw, start, minutes, self._tz(src))

    def set_visibility(self, q, body):
        """{kind, ids: [...], hidden: true | false | null}  (null = revenir aux règles automatiques)"""
        kind, ids, hidden = body.get("kind"), body.get("ids"), body.get("hidden")
        if kind not in ("live", "vod", "series") or not isinstance(ids, list):
            raise ApiError(400, "kind (live|vod|series) et ids (liste) sont requis")
        ids = [str(i) for i in ids]
        with self.db:
            if hidden is None:
                self.db.executemany("DELETE FROM cat_override WHERE kind=? AND id=?", [(kind, i) for i in ids])
            else:
                self.db.executemany("INSERT OR REPLACE INTO cat_override VALUES (?,?,?)",
                                    [(kind, i, 1 if hidden else 0) for i in ids])
        filters.apply(self.db, self.cfg)
        return {"ok": True}

    def home(self, q):
        cont = []
        for r in self.db.execute("SELECT * FROM progress WHERE kind='movie' AND done=0 AND position > 30 "
                                 "ORDER BY updated DESC LIMIT 12"):
            v = self.db.execute("SELECT * FROM vod WHERE id=?", (r["id"],)).fetchone()
            if v:
                cont.append({"kind": "movie", "id": v["id"], "name": v["name"], "poster": self.img(v["poster"], 240),
                             "backdrop": self.img(v["poster"], 1280), "progress": self._prog(r),
                             "updated": r["updated"]})
        for r in self.db.execute("SELECT series_id, MAX(updated) AS u FROM progress WHERE kind='episode' "
                                 "GROUP BY series_id ORDER BY u DESC LIMIT 12"):
            s = self.db.execute("SELECT * FROM series WHERE id=?", (r["series_id"],)).fetchone()
            resume = s and self._series_resume(s["id"])
            if resume:
                cont.append({"kind": "series", "id": s["id"], "name": s["name"], "poster": self.img(s["poster"], 240),
                             "backdrop": self.img(s["backdrop"] or s["poster"], 1280), "resume": resume,
                             "progress": resume["progress"], "updated": resume["updated"]})
        cont.sort(key=lambda x: -x["updated"])
        fav = self.db.execute("SELECT l.* FROM live l JOIN fav_channels f ON f.id = l.id ORDER BY f.pos, l.num, l.src")
        return {"now": now(), "continue": cont[:12], "channels": self._channels(fav),
                "recent_movies": self._vod_items(self.db.execute(f"SELECT * FROM vod WHERE {visible('vod')} ORDER BY added DESC LIMIT 20")),
                "recent_series": self._series_items(
                    self.db.execute(f"SELECT * FROM series WHERE {visible('series')} ORDER BY updated DESC LIMIT 20"))}

    def _live_sql(self, cat, src=0):
        """Requête des chaînes d'une catégorie, d'un bouquet personnel ou de tout le direct.
        src : seulement les chaînes de cet abonnement (0 = tous, mélangés)."""
        only = " AND l.src = %d" % int(src) if src else ""
        order = "l.num, l.src, l.name"
        bq = bouquets.parse_id(cat)
        if bq is not None:
            # le numéro propre au bouquet passe avant le numéro habituel
            return ("SELECT l.*, COALESCE(i.num, l.num) AS bq_num FROM bouquet_items i JOIN live l ON l.id = i.chan "
                    "WHERE i.bouquet = ?" + only + " ORDER BY i.pos, " + order), (bq,)
        if cat == "fav":
            return ("SELECT l.* FROM live l JOIN fav_channels f ON f.id = l.id WHERE 1" + only +
                    " ORDER BY f.pos, " + order), ()
        if cat == "all":
            if not self.db.execute("SELECT 1 FROM categories WHERE kind='live' AND hidden=0 LIMIT 1").fetchone():
                # tous les bouquets du fournisseur sont masqués : on montre l'union des bouquets personnels
                return ("SELECT DISTINCT l.* FROM live l JOIN bouquet_items i ON i.chan = l.id WHERE 1" + only +
                        " ORDER BY " + order), ()
            return f"SELECT l.* FROM live l WHERE {visible('live', 'l.cat')}{only} ORDER BY {order}", ()
        if cat == "replay":
            return (f"SELECT l.* FROM live l WHERE l.archive = 1 AND {visible('live', 'l.cat')}{only} "
                    f"ORDER BY {order}"), ()
        return (f"SELECT l.* FROM live l WHERE l.cat=? AND {visible('live', 'l.cat')}{only} ORDER BY {order}",
                (str(cat),))

    def live(self, q):
        sql, args = self._live_sql(q.get("cat", "all"), to_int(q.get("src")))
        return {"now": now(), "channels": self._channels(self.db.execute(sql, args))}

    def guide(self, q):
        """Grille du guide : les chaînes d'une catégorie et leurs programmes sur une tranche d'heures."""
        start = to_int(q.get("start")) or (now() // 1800 * 1800)
        hours = min(8, max(1, to_int(q.get("hours"), 3)))
        end = start + hours * 3600
        limit = min(150, max(1, to_int(q.get("limit"), 60)))
        offset = max(0, to_int(q.get("offset")))
        sql, args = self._live_sql(q.get("cat", "all"), to_int(q.get("src")))
        total = self.db.execute(f"SELECT COUNT(*) FROM ({sql})", args).fetchone()[0]
        rows = list(self.db.execute(f"{sql} LIMIT ? OFFSET ?", (*args, limit, offset)))
        keys = sorted({(r["epg_key"] or r["epg_id"]) for r in rows if (r["epg_key"] or r["epg_id"])})
        progs = {}
        for i in range(0, len(keys), 400):
            chunk = keys[i:i + 400]
            for p in self.db.execute(
                    f"SELECT channel, start, stop, title, descr, icon, categ FROM epg "
                    f"WHERE channel IN ({','.join('?' * len(chunk))}) AND stop > ? AND start < ? "
                    "ORDER BY channel, start", (*chunk, start, end)):
                progs.setdefault(p["channel"], []).append(
                    {"start": p["start"], "stop": p["stop"], "title": p["title"], "desc": p["descr"],
                     "image": self.img(p["icon"], 480), "categ": p["categ"] or ""})
        favs = {r["id"] for r in self.db.execute("SELECT id FROM fav_channels")}
        out = []
        for r in rows:
            out.append({"id": r["id"], "num": r["bq_num"] if "bq_num" in r.keys() else r["num"],
                        "name": r["name"], "src": r["src"],
                        "logo": self.logo(r["logo"] or r["alt_logo"]), "fav": r["id"] in favs,
                        "archive": bool(r["archive"]), "archive_days": r["archive_days"] or 0,
                        "quality": _quality(r["orig_name"]), "orig_name": r["orig_name"], "orig_num": r["orig_num"],
                        "programmes": progs.get(r["epg_key"] or r["epg_id"], [])})
        return {"now": now(), "start": start, "hours": hours, "total": total, "channels": out}

    def channel(self, q):
        """Page d'une chaîne : description, programme en cours et suivant."""
        r = self.db.execute("SELECT * FROM live WHERE id=?", (to_int(q.get("id")),)).fetchone()
        if not r:
            raise ApiError(404, "chaîne inconnue")
        item = self._channels([r])[0]
        desc = self.db.execute("SELECT name FROM epg_chan c JOIN epg_map m ON m.src = c.src AND m.xid = c.xid "
                               "WHERE m.chan = ? LIMIT 1", (r["id"],)).fetchone()
        item["guide_name"] = desc["name"] if desc else ""
        cat = self.db.execute("SELECT name FROM categories WHERE kind='live' AND id=?", (r["cat"],)).fetchone()
        item["cat_name"] = cat["name"] if cat else ""
        # avec plusieurs abonnements, la page de la chaîne dit d'où elle vient
        if len(self.reg.items) > 1:
            p = self.db.execute("SELECT name FROM provider WHERE src=?", (r["src"],)).fetchone()
            item["provider"] = p["name"] if p else ""
        sql, args = self._live_sql(r["cat"])
        others = [c for c in self._channels(self.db.execute(f"{sql} LIMIT 14", args)) if c["id"] != r["id"]]
        item["others"] = others[:10]
        return item

    def epg(self, q):
        ch = self.db.execute("SELECT epg_id, epg_key FROM live WHERE id=?", (to_int(q.get("id")),)).fetchone()
        if not ch:
            raise ApiError(404, "chaîne inconnue")
        hours = min(48, max(1, to_int(q.get("hours"), 24)))
        back = min(12, max(0, to_int(q.get("back"))))
        rows = self.db.execute("SELECT start, stop, title, descr, icon, categ FROM epg "
                               "WHERE channel=? AND stop > ? AND start < ? ORDER BY start",
                               (ch["epg_key"] or ch["epg_id"], now() - back * 3600, now() + hours * 3600))
        return {"now": now(), "programmes": [{"start": r["start"], "stop": r["stop"], "title": r["title"],
                                              "desc": r["descr"], "image": self.img(r["icon"], 480),
                                              "categ": r["categ"] or ""} for r in rows]}

    def _paged(self, q, table, recent_col):
        cat = q.get("cat", "all")
        limit = min(200, max(1, to_int(q.get("limit"), 60)))
        offset = max(0, to_int(q.get("offset")))
        order = f"{recent_col} DESC" if q.get("sort", "recent") == "recent" else "norm"
        kind = "vod" if table == "vod" else "series"
        bid = bouquets.parse_id(cat)
        if bid is not None:
            if bouquets.kind_of(self.db, bid) != kind:
                raise ApiError(404, "bouquet inconnu")
            total = self.db.execute("SELECT COUNT(*) FROM bouquet_items i "
                                    f"JOIN {table} t ON t.id = i.chan WHERE i.bouquet = ?", (bid,)).fetchone()[0]
            rows = self.db.execute("SELECT t.* FROM bouquet_items i "
                                   f"JOIN {table} t ON t.id = i.chan WHERE i.bouquet = ? "
                                   "ORDER BY i.pos LIMIT ? OFFSET ?", (bid, limit, offset))
            return total, rows
        where, args = ((f"WHERE {visible(kind)}", ()) if cat in ("all", "recent")
                       else (f"WHERE cat = ? AND {visible(kind)}", (cat,)))
        total = self.db.execute(f"SELECT COUNT(*) FROM {table} {where}", args).fetchone()[0]
        rows = self.db.execute(f"SELECT * FROM {table} {where} ORDER BY {order} LIMIT ? OFFSET ?",
                               (*args, limit, offset))
        return total, rows

    def vod(self, q):
        total, rows = self._paged(q, "vod", "added")
        return {"total": total, "items": self._vod_items(rows)}

    def series_list(self, q):
        total, rows = self._paged(q, "series", "updated")
        return {"total": total, "items": self._series_items(rows)}

    def movie(self, q):
        mid = to_int(q.get("id"))
        v = self.db.execute("SELECT * FROM vod WHERE id=?", (mid,)).fetchone()
        if not v:
            raise ApiError(404, "film inconnu")
        info = (self._info("vod", mid).get("info") or {})
        # ce qui a été corrigé à la main passe devant la fiche du fournisseur
        backdrop = (v["backdrop"] or (info.get("backdrop_path") or [None])[0]
                    or info.get("cover_big") or v["poster"])
        item = self._vod_items([v])[0]
        item.update({"plot": v["plot"] or info.get("plot") or info.get("description") or "",
                     "genre": info.get("genre") or "",
                     "year": (info.get("releasedate") or info.get("release_date") or "")[:4],
                     "duration": to_int(info.get("duration_secs")) or None,
                     "director": info.get("director") or "", "cast": info.get("cast") or info.get("actors") or "",
                     "backdrop": self.img(backdrop, 1920), "trailer": _youtube_id(info.get("youtube_trailer")),
                     "library": library.entry(self.db, "movie", mid)})
        if mid >= medias.BASE:
            vers = medias.versions(self.db, mid)
            pref = medias.preferred(self.db, mid)
            best = medias.pick_version(vers, to_int(q.get("maxh")), pref)
            item["versions"] = [{"id": v["id"], "label": medias.version_label(v), "tier": medias.tier(v["width"], v["height"]),
                                 "size": v["size"], "playable": bool(v["playable"]), "note": v["note"] or "",
                                 "audio": v["acodec"] or ""} for v in vers]
            item["version"] = best["id"] if best else 0
            item["version_pref"] = pref if any(v["id"] == pref for v in vers) else 0
            # bonus et bandes-annonces posés à côté (Kodi, Plex, Jellyfin), logo du titre
            ex = medias.extras(self.db, sorted({os.path.dirname(v["path"]) for v in vers}))
            item["extras"] = [{"id": e["id"], "title": e["title"], "kind": e["eptitle"], "duration": int(e["dur"] or 0) or None,
                               "playable": bool(e["playable"])} for e in ex]
            tr_ = next((e for e in ex if e["eptitle"] == "trailer" and e["playable"]), None)
            item["local_trailer"] = tr_["id"] if tr_ else 0
            logo = next((medias.local_logo(v["path"]) for v in vers if medias.local_logo(v["path"])), "")
            item["logo"] = self.img(logo, 800) if logo else ""
        return item

    def movie_version(self, q, body):
        """La version qui démarre pour ce film ; file = 0 : la meilleure lisible (automatique)."""
        mid, fid = to_int(body.get("id")), to_int(body.get("file"))
        vers = medias.versions(self.db, mid)
        if not vers:
            raise ApiError(404, "film inconnu")
        if fid and not any(v["id"] == fid for v in vers):
            raise ApiError(400, "cette version n'appartient pas au film")
        medias.set_preferred(self.db, mid, fid)
        return {"ok": True, "version_pref": fid}

    def series(self, q):
        sid = to_int(q.get("id"))
        s = self.db.execute("SELECT * FROM series WHERE id=?", (sid,)).fetchone()
        if not s:
            raise ApiError(404, "série inconnue")
        data = self._info("series", sid)
        flat_ids = [to_int(ep.get("id")) for ep in self._episodes_flat(data)]
        prog = self._progress_map("episode", flat_ids)
        seasons = []
        for n, eps in self._seasons(data):
            seasons.append({"season": n, "episodes": [
                {"id": to_int(ep.get("id")), "episode": to_int(ep.get("episode_num")), "title": library.episode_title(ep.get("title")),
                 "plot": (ep.get("info") or {}).get("plot") or "",
                 "duration": to_int((ep.get("info") or {}).get("duration_secs")) or None,
                 "thumb": self.img((ep.get("info") or {}).get("movie_image") or "", 480),
                 "ext": _ext(ep.get("container_extension")),
                 "progress": self._prog(prog.get(to_int(ep.get("id"))))} for ep in eps]})
        item = self._series_items([s])[0]
        item.update({"plot": s["plot"], "backdrop": self.img(s["backdrop"] or s["poster"], 1920),
                     "seasons": seasons, "resume": self._series_resume(sid),
                     "trailer": _youtube_id((data.get("info") or {}).get("youtube_trailer")),
                     "library": library.entry(self.db, "series", sid)})
        if sid >= medias.BASE:
            # bonus de la série : dans son dossier, ou dans ceux des saisons
            show = self.db.execute("SELECT folder FROM media_show WHERE id=?", (sid - medias.BASE,)).fetchone()
            dirs = {os.path.dirname(r["path"]) for r in self.db.execute(
                "SELECT path FROM media_file WHERE kind='episode' AND show=?", (sid - medias.BASE,))}
            if show and show["folder"]:
                dirs.add(show["folder"])
            ex = medias.extras(self.db, sorted(dirs))
            item["extras"] = [{"id": e["id"], "title": e["title"], "kind": e["eptitle"], "duration": int(e["dur"] or 0) or None,
                               "playable": bool(e["playable"])} for e in ex]
            tr_ = next((e for e in ex if e["eptitle"] == "trailer" and e["playable"]), None)
            item["local_trailer"] = tr_["id"] if tr_ else 0
        return item

    def search(self, q):
        term = norm(q.get("q", "")).strip()
        if len(term) < 2:
            return {"live": [], "vod": [], "series": []}
        like = "%" + term.replace("%", "").replace("_", "") + "%"
        start = term.replace("%", "").replace("_", "") + "%"
        # visibles, ou rangés dans un de vos bouquets (même si la catégorie du fournisseur est masquée) ;
        # jamais les lignes de séparation des fournisseurs (« ▼--- |FR| V O D ---▼ », « ##### … »)
        mine = "id IN (SELECT chan FROM bouquet_items)"
        sep = ("name NOT LIKE '%---%' AND name NOT LIKE '%▼%' AND name NOT LIKE '%►%' AND name NOT LIKE '%###%'"
               " AND name NOT LIKE '%===%' AND name NOT LIKE '%***%' AND name NOT LIKE '%═%' AND name NOT LIKE '%~~%'"
               " AND name NOT LIKE '%●★%' AND name NOT LIKE '%★●%'")
        def q_(table, extra, order, limit):
            return self.db.execute(f"SELECT * FROM {table} WHERE norm LIKE ? AND ({visible(table)} OR {mine}) AND {sep}"
                                   f" ORDER BY (norm LIKE ?) DESC, {order} LIMIT {limit}", (like, start))
        return {"live": self._channels(q_("live", "", "num, src", 20)),
                "vod": self._vod_items(q_("vod", "", "added DESC", 40)),
                "series": self._series_items(q_("series", "", "updated DESC", 40))}

    def play(self, q):
        kind, item_id = q.get("kind"), to_int(q.get("id"))
        if kind == "live":
            if not self.db.execute("SELECT 1 FROM live WHERE id=?", (item_id,)).fetchone():
                raise ApiError(404, "chaîne inconnue")
            xt, raw, _ = self._resolve(item_id)
            return {"url": xt.live_url(raw)}
        if kind == "extra":
            f = self.db.execute("SELECT * FROM media_file WHERE id=? AND kind='extra'", (item_id,)).fetchone()
            if not f:
                raise ApiError(404, "fichier inconnu")
            return {"url": self._media_url(f), "local": True, "playable": bool(f["playable"]),
                    "note": f["note"] or "", "start": 0}
        if kind in ("movie", "episode") and item_id >= medias.BASE:
            out = {}
            if kind == "movie":
                # plusieurs versions : celle choisie, sinon la meilleure lisible sous la limite du téléviseur ;
                # « skip » : versions déjà essayées sans succès
                vers = medias.versions(self.db, item_id)
                skip = {to_int(x) for x in (q.get("skip") or "").split(",") if x}
                f = medias.pick_version(vers, to_int(q.get("maxh")), medias.preferred(self.db, item_id),
                                        skip if q.get("version") is None else ())
                if q.get("version"):
                    f = next((v for v in vers if v["id"] == to_int(q.get("version"))), f)
                if not f:
                    raise ApiError(404, "aucune autre version")
                out = {"version": f["id"], "version_label": medias.version_label(f), "versions": len(vers),
                       "left": len([v for v in vers if v["id"] not in skip and v["id"] != f["id"]])}
            else:
                f = medias.file_for(self.db, kind, item_id)
            if not f:
                raise ApiError(404, "fichier inconnu")
            p = self._prog(self._progress_map(kind, [item_id]).get(item_id))
            out.update({"url": self._media_url(f), "local": True, "playable": bool(f["playable"]),
                        "note": f["note"] or "", "start": p["position"] if p and not p["done"] else 0})
            return out
        if kind == "movie":
            v = self.db.execute("SELECT ext FROM vod WHERE id=?", (item_id,)).fetchone()
            if not v:
                raise ApiError(404, "film inconnu")
            p = self._prog(self._progress_map("movie", [item_id]).get(item_id))
            xt, raw, _ = self._resolve(item_id)
            return {"url": xt.movie_url(raw, _ext(v["ext"])),
                    "start": p["position"] if p and not p["done"] else 0}
        if kind == "episode":
            p = self._prog(self._progress_map("episode", [item_id]).get(item_id))
            xt, raw, _ = self._resolve(item_id)
            return {"url": xt.episode_url(raw, _ext(q.get("ext"))),
                    "start": p["position"] if p and not p["done"] else 0}
        if kind == "replay":
            start, stop = to_int(q.get("start")), to_int(q.get("stop"))
            return {"url": self._replay_url(item_id, start, stop), "start": 0}
        raise ApiError(400, "kind doit valoir live, movie, episode ou replay")

    def save_progress(self, q, body):
        kind, item_id = body.get("kind"), to_int(body.get("id"))
        pos, dur = to_float(body.get("position"), 0), to_float(body.get("duration"), 0)
        if kind not in ("movie", "episode") or not item_id:
            raise ApiError(400, "kind (movie|episode) et id sont requis")
        done = 1 if dur and pos / dur >= DONE_RATIO else 0
        series_id = season = episode = None
        title = ""
        if kind == "episode":
            series_id = to_int(body.get("series_id"))
            if not series_id:
                raise ApiError(400, "series_id est requis pour un épisode")
            try:
                data = self._info("series", series_id)
                for n, eps in self._seasons(data):
                    for ep in eps:
                        if to_int(ep.get("id")) == item_id:
                            season, episode, title = n, to_int(ep.get("episode_num")), ep.get("title") or ""
            except ApiError:
                pass
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO progress VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (kind, item_id, series_id, season, episode, title, pos, dur, done, now()))
        return {"done": bool(done)}

    def history(self, q):
        flt = q.get("filter", "all")
        items = []
        if flt in ("all", "progress", "done", "movies"):
            for r in self.db.execute("SELECT p.*, v.name, v.poster FROM progress p JOIN vod v ON v.id = p.id "
                                     "WHERE p.kind='movie' ORDER BY p.updated DESC LIMIT 300"):
                items.append({"kind": "movie", "id": r["id"], "name": r["name"], "poster": self.img(r["poster"], 240),
                              "progress": self._prog(r), "updated": r["updated"]})
        if flt in ("all", "progress", "done", "series"):
            for r in self.db.execute(
                    "SELECT p.*, s.name, s.poster FROM progress p JOIN series s ON s.id = p.series_id "
                    "WHERE p.kind='episode' AND p.updated = (SELECT MAX(updated) FROM progress p2 "
                    "WHERE p2.kind='episode' AND p2.series_id = p.series_id) ORDER BY p.updated DESC LIMIT 300"):
                items.append({"kind": "series", "id": r["series_id"], "name": r["name"],
                              "poster": self.img(r["poster"], 240), "episode_id": r["id"], "season": r["season"],
                              "episode": r["episode"], "episode_title": r["title"], "progress": self._prog(r),
                              "updated": r["updated"]})
        if flt == "progress":
            items = [i for i in items if not i["progress"]["done"]]
        elif flt == "done":
            items = [i for i in items if i["progress"]["done"]]
        items.sort(key=lambda i: -i["updated"])
        return {"now": now(), "items": items}

    def delete_history(self, q, body):
        kind, item_id = q.get("kind"), to_int(q.get("id"))
        with self.db:
            if not kind:
                self.db.execute("DELETE FROM progress")
            elif kind == "movie":
                self.db.execute("DELETE FROM progress WHERE kind='movie' AND id=?", (item_id,))
            elif kind == "series":
                self.db.execute("DELETE FROM progress WHERE kind='episode' AND series_id=?", (item_id,))
            else:
                raise ApiError(400, "kind doit valoir movie ou series")
        return {"ok": True}

    def watchlist(self, q):
        flt, sort = q.get("filter", "all"), q.get("sort", "added")
        items = []
        if flt in ("all", "fav", "movies"):
            for r in self.db.execute("SELECT w.*, v.name, v.norm, v.poster FROM watchlist w JOIN vod v ON v.id = w.id "
                                     "WHERE w.kind='movie'"):
                items.append({"kind": "movie", "id": r["id"], "name": r["name"], "norm": r["norm"],
                              "poster": self.img(r["poster"], 240), "fav": bool(r["fav"]), "added": r["added"]})
        if flt in ("all", "fav", "series"):
            for r in self.db.execute("SELECT w.*, s.name, s.norm, s.poster FROM watchlist w JOIN series s "
                                     "ON s.id = w.id WHERE w.kind='series'"):
                items.append({"kind": "series", "id": r["id"], "name": r["name"], "norm": r["norm"],
                              "poster": self.img(r["poster"], 240), "fav": bool(r["fav"]), "added": r["added"]})
        if flt == "fav":
            items = [i for i in items if i["fav"]]
        if sort == "name":
            items.sort(key=lambda i: i["norm"])
        else:
            items.sort(key=lambda i: -i["added"])
        for i in items:
            del i["norm"]
        return {"now": now(), "items": items}

    def add_watchlist(self, q, body):
        kind, item_id = body.get("kind"), to_int(body.get("id"))
        if kind not in ("movie", "series") or not item_id:
            raise ApiError(400, "kind (movie|series) et id sont requis")
        with self.db:
            self.db.execute("INSERT INTO watchlist VALUES (?,?,?,?) ON CONFLICT(kind, id) DO UPDATE SET fav=excluded.fav",
                            (kind, item_id, 1 if body.get("fav") else 0, now()))
        return {"ok": True}

    def delete_watchlist(self, q, body):
        with self.db:
            self.db.execute("DELETE FROM watchlist WHERE kind=? AND id=?", (q.get("kind"), to_int(q.get("id"))))
        return {"ok": True}

    # ---------- bibliothèque ----------
    def _guess_genres(self, kind, item_id):
        """Genres TMDB d'un titre : par TMDB si une clé est configurée, sinon d'après le fournisseur."""
        table = "vod" if kind == "movie" else "series"
        row = self.db.execute(f"SELECT * FROM {table} WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise ApiError(404, "titre inconnu")
        if item_id >= medias.BASE:              # médiathèque : la fiche déjà enregistrée suffit
            text = row["genre"] if kind == "series" else ""
            if not text:
                c = self.db.execute("SELECT json FROM info_cache WHERE kind='vod' AND id=?", (item_id,)).fetchone()
                try:
                    text = ((json.loads(c["json"]) if c else {}).get("info") or {}).get("genre") or ""
                except ValueError:
                    text = ""
            found = library.genres_from_text(text)
            if found:
                return found
        tm = medias.Tmdb(self.cfg)
        if tm.ready():
            title, year = library.clean_title(row["orig_name"] or row["name"])
            try:
                res = tm.search_movie(title, year) if kind == "movie" else tm.search_tv(title, year)
                if res and res[0].get("genre_ids"):
                    return [int(g) for g in res[0]["genre_ids"]]
            except medias.TmdbError as e:
                log.info("bibliothèque : TMDB ne répond pas (%s), genre du fournisseur", e)
        text = row["genre"] if kind == "series" else ""
        if not text:
            try:
                text = (self._info("vod" if kind == "movie" else "series", item_id).get("info") or {}).get("genre") or ""
            except ApiError:
                text = ""
        return library.genres_from_text(text)

    def _lib_items(self, rows):
        """Titres de la Bibliothèque, au format des cartes de l'appli (dans l'ordre reçu)."""
        movies = self._vod_items([r for k, r in rows if k == "movie"])
        series = self._series_items([r for k, r in rows if k == "series"])
        by = {("movie", m["id"]): m for m in movies}
        by.update({("series", x["id"]): x for x in series})
        out = []
        for k, r in rows:
            it = by.get((k, r["id"]))
            if it:
                it["lib_cat"] = r["lib_cat"]
                out.append(it)
        return out

    def library_list(self, q):
        kind = q.get("kind") if q.get("kind") in library.KINDS else None
        cat = to_int(q.get("cat")) or None
        rows = library.items(self.db, cat, kind, q.get("sort", "added"))
        return {"now": now(), "cats": library.categories(self.db, kind),
                "total": self.db.execute("SELECT COUNT(*) FROM lib_item" + (" WHERE kind=?" if kind else ""),
                                         (kind,) if kind else ()).fetchone()[0],
                "missing": library.orphans(self.db), "items": self._lib_items(rows)}

    def library_add(self, q, body):
        kind, item_id = body.get("kind"), to_int(body.get("id"))
        try:
            library.check_kind(kind)
            genres = [] if body.get("cat") else self._guess_genres(kind, item_id)
            res = library.add(self.db, kind, item_id, genres, body.get("lang", "fr"), to_int(body.get("cat")) or None)
        except ValueError as e:
            raise ApiError(400, str(e))
        res["cats"] = library.categories(self.db)
        return res

    def library_add_many(self, q, body):
        """Plusieurs titres d'un coup : dans une catégorie choisie, ou chacun selon son genre."""
        kind, cat = body.get("kind"), to_int(body.get("cat")) or None
        ids = [to_int(i) for i in (body.get("ids") or [])][:200]
        try:
            library.check_kind(kind)
            done, created = [], []
            for item_id in ids:
                try:
                    genres = [] if cat else self._guess_genres(kind, item_id)
                except ApiError:
                    continue                       # titre disparu entre-temps
                res = library.add(self.db, kind, item_id, genres, body.get("lang", "fr"), cat)
                done.append(item_id)
                if res.get("created"):
                    created.append(res["name"])
        except ValueError as e:
            raise ApiError(400, str(e))
        return {"added": len(done), "created": created, "cats": library.categories(self.db)}

    def library_remove_many(self, q, body):
        kind = body.get("kind")
        for item_id in (body.get("ids") or [])[:2000]:
            library.remove(self.db, kind, to_int(item_id))
        return {"ok": True}

    def library_remove(self, q, body):
        library.remove(self.db, body.get("kind"), to_int(body.get("id")))
        return {"ok": True}

    def library_move(self, q, body):
        try:
            library.move(self.db, body.get("kind"), to_int(body.get("id")), to_int(body.get("cat")))
        except ValueError as e:
            raise ApiError(400, str(e))
        return {"ok": True, "library": library.entry(self.db, body.get("kind"), to_int(body.get("id")))}

    def library_cat_create(self, q, body):
        try:
            cid = library.create_category(self.db, body.get("name"))
        except ValueError as e:
            raise ApiError(400, str(e))
        return {"id": cid, "cats": library.categories(self.db)}

    def library_cat_rename(self, q, body):
        try:
            library.rename_category(self.db, to_int(body.get("id")), body.get("name"))
        except ValueError as e:
            raise ApiError(400, str(e))
        return {"cats": library.categories(self.db)}

    def library_cat_move(self, q, body):
        library.move_category(self.db, to_int(body.get("id")), to_int(body.get("delta"), 1))
        return {"cats": library.categories(self.db)}

    def library_cat_delete(self, q, body):
        library.delete_category(self.db, to_int(q.get("id")), to_int(q.get("into")) or None)
        return {"cats": library.categories(self.db)}

    def fav_channel(self, q, body):
        item_id = to_int(body.get("id"))
        with self.db:
            if body.get("on", True):
                pos = self.db.execute("SELECT COALESCE(MAX(pos), 0) + 1 FROM fav_channels").fetchone()[0]
                self.db.execute("INSERT OR IGNORE INTO fav_channels VALUES (?, ?)", (item_id, pos))
            else:
                self.db.execute("DELETE FROM fav_channels WHERE id=?", (item_id,))
        return {"ok": True}


ROUTES = {
    ("GET", "/api/status"): "status",
    ("GET", "/api/providers"): "providers_list",
    ("POST", "/api/providers/set"): "provider_set",
    ("POST", "/api/sync"): "start_sync",
    ("GET", "/api/categories"): "categories",
    ("POST", "/api/categories/visibility"): "set_visibility",
    ("GET", "/api/items"): "items_admin",
    ("GET", "/api/tv"): "tv_status",
    ("POST", "/api/tv/set"): "tv_set",
    ("POST", "/api/tv/pair"): "tv_pair",
    ("POST", "/api/tv/test"): "tv_test",
    ("GET", "/api/medias"): "medias_roots",
    ("POST", "/api/medias/add"): "medias_add",
    ("POST", "/api/medias/remove"): "medias_remove",
    ("POST", "/api/medias/scan"): "medias_scan",
    ("GET", "/api/medias/items"): "medias_items",
    ("GET", "/api/medias/search"): "medias_search",
    ("GET", "/api/medias/titles"): "medias_titles",
    ("GET", "/api/medias/convert"): "medias_convert_state",
    ("POST", "/api/medias/convert"): "medias_convert",
    ("POST", "/api/medias/convert/cancel"): "medias_convert_cancel",
    ("POST", "/api/medias/convert/forget"): "medias_convert_forget",
    ("POST", "/api/medias/convert/keep"): "medias_convert_keep",
    ("POST", "/api/medias/match"): "medias_match",
    ("POST", "/api/items/rename"): "rename_item",
    ("GET", "/api/items/detail"): "item_detail",
    ("POST", "/api/items/edit"): "edit_item",
    ("GET", "/api/art/search"): "art_search",
    ("GET", "/api/art/images"): "art_images",
    ("POST", "/api/art/fetch"): "art_fetch",
    ("POST", "/api/art/reset"): "art_reset",
    ("GET", "/api/home"): "home",
    ("GET", "/api/live"): "live",
    ("GET", "/api/guide"): "guide",
    ("GET", "/api/channel"): "channel",
    ("GET", "/api/epg"): "epg",
    ("GET", "/api/vod"): "vod",
    ("GET", "/api/movie"): "movie",
    ("POST", "/api/movie/version"): "movie_version",
    ("GET", "/api/series"): "series_list",
    ("GET", "/api/series/detail"): "series",
    ("GET", "/api/search"): "search",
    ("GET", "/api/play"): "play",
    ("POST", "/api/progress"): "save_progress",
    ("GET", "/api/history"): "history",
    ("DELETE", "/api/history"): "delete_history",
    ("GET", "/api/watchlist"): "watchlist",
    ("POST", "/api/watchlist"): "add_watchlist",
    ("DELETE", "/api/watchlist"): "delete_watchlist",
    ("POST", "/api/favchannels"): "fav_channel",
    ("GET", "/api/library"): "library_list",
    ("POST", "/api/library/add"): "library_add",
    ("POST", "/api/library/remove"): "library_remove",
    ("POST", "/api/library/add_many"): "library_add_many",
    ("POST", "/api/library/remove_many"): "library_remove_many",
    ("POST", "/api/library/move"): "library_move",
    ("POST", "/api/library/cats"): "library_cat_create",
    ("POST", "/api/library/cats/rename"): "library_cat_rename",
    ("POST", "/api/library/cats/move"): "library_cat_move",
    ("DELETE", "/api/library/cats"): "library_cat_delete",
    ("GET", "/api/replay"): "replay",
    ("POST", "/api/categories/rename"): "rename_category",
    ("GET", "/api/channels/admin"): "channels_admin",
    ("POST", "/api/channels/edit"): "edit_channel",
    ("POST", "/api/channels/logo"): "set_channel_logo",
    ("GET", "/api/bouquets"): "bouquets_list",
    ("POST", "/api/bouquets/create"): "bouquet_create",
    ("POST", "/api/bouquets/rename"): "bouquet_rename",
    ("DELETE", "/api/bouquets"): "bouquet_delete",
    ("POST", "/api/bouquets/move"): "bouquet_move",
    ("POST", "/api/bouquets/items"): "bouquet_items",
    ("POST", "/api/bouquets/add"): "bouquet_add",
    ("POST", "/api/bouquets/remove"): "bouquet_remove",
    ("POST", "/api/bouquets/renumber"): "bouquet_renumber",
    ("POST", "/api/bouquets/number"): "bouquet_number",
    ("POST", "/api/numbers/reset"): "numbers_reset",
    ("GET", "/api/rules"): "rules_list",
    ("POST", "/api/rules"): "rules_set",
    ("DELETE", "/api/rules"): "rules_delete",
    ("POST", "/api/names/reset"): "names_reset",
    ("GET", "/api/epg/sources"): "epg_sources",
    ("POST", "/api/epg/sources"): "epg_source_add",
    ("POST", "/api/epg/sources/set"): "epg_source_set",
    ("DELETE", "/api/epg/sources"): "epg_source_delete",
    ("POST", "/api/epg/refresh"): "epg_refresh",
    ("POST", "/api/epg/automap"): "epg_automap",
    ("GET", "/api/epg/search"): "epg_search",
    ("POST", "/api/epg/map"): "epg_map_set",
}


PAGE = (Path(__file__).with_name("reglages.html")).read_text(encoding="utf-8")
HOME_PAGE = (Path(__file__).with_name("accueil.html")).read_text(encoding="utf-8")
PAGE_JS = (Path(__file__).with_name("reglages.js")).read_text(encoding="utf-8")
STATIC = {"/reglages.js": PAGE_JS, "/i18n.js": (Path(__file__).with_name("i18n.js")).read_text(encoding="utf-8")}
TRAILER_PAGE = (Path(__file__).with_name("trailer.html")).read_text(encoding="utf-8")


MEDIA_MIME = {".mkv": "video/x-matroska", ".mp4": "video/mp4", ".m4v": "video/mp4", ".avi": "video/x-msvideo",
              ".ts": "video/mp2t", ".mov": "video/quicktime", ".m2ts": "video/mp2t", ".mpg": "video/mpeg",
              ".mpeg": "video/mpeg", ".wmv": "video/x-ms-asf", ".webm": "video/webm"}


def make_handler(app):
    token = app.cfg["server"]["token"]

    class Handler(BaseHTTPRequestHandler):
        server_version = UA
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            log.debug("%s %s", self.address_string(), fmt % args)

        def _headers(self, status, ctype, length, extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Access-Control-Allow-Origin", "*")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()

        def _json(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
            extra = {"Cache-Control": "no-store"}
            if len(data) > 1024 and "gzip" in (self.headers.get("Accept-Encoding") or ""):
                data = gzip.compress(data, 5)
                extra["Content-Encoding"] = "gzip"
            self._headers(status, "application/json; charset=utf-8", len(data), extra)
            if self.command != "HEAD":
                self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Luciole-Token")
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _handle(self):
            url = urllib.parse.urlsplit(self.path)
            q = dict(urllib.parse.parse_qsl(url.query))
            q["_ip"] = self.client_address[0]
            if token and token not in (self.headers.get("X-Luciole-Token"), q.get("token")):
                return self._json(401, {"error": "jeton manquant ou incorrect"})
            if url.path == "/img" and self.command == "GET":
                return self._image(q)
            if url.path in ("/", "/accueil") and self.command == "GET":
                return self._page(HOME_PAGE)
            if url.path in ("/reglages", "/reglages/") and self.command == "GET":
                return self._page(PAGE)
            if url.path == "/favicon.ico":
                self._headers(204, "image/x-icon", 0)
                return
            if url.path in STATIC and self.command == "GET":
                data = STATIC[url.path].encode()
                self._headers(200, "application/javascript; charset=utf-8", len(data), {"Cache-Control": "no-store"})
                return self.wfile.write(data)
            if url.path == "/trailer" and self.command == "GET":
                return self._trailer(q)
            if url.path.startswith("/media/") and self.command in ("GET", "HEAD"):
                return self._media(url.path[7:])
            if url.path == "/api/art/upload" and self.command == "POST":
                return self._upload(q)
            name = ROUTES.get((self.command, url.path))
            if not name:
                return self._json(404, {"error": "inconnu"})
            try:
                if self.command in ("POST", "DELETE"):
                    length = to_int(self.headers.get("Content-Length"))
                    raw = self.rfile.read(length) if length else b""
                    body = json.loads(raw) if raw.strip() else {}
                    if not isinstance(body, dict):
                        raise ApiError(400, "corps JSON attendu")
                    result = getattr(app, name)(q, body)
                else:
                    result = getattr(app, name)(q)
                self._json(200, result)
            except ApiError as e:
                self._json(e.status, {"error": str(e)})
            except ValueError:
                self._json(400, {"error": "JSON invalide"})
            except Exception:
                log.exception("erreur sur %s %s", self.command, url.path)
                self._json(500, {"error": "erreur interne"})

        def _upload(self, q):
            """Le corps de la requête est l'image elle-même, telle que le navigateur l'envoie."""
            length = to_int(self.headers.get("Content-Length"))
            if not length:
                return self._json(400, {"error": "aucun fichier reçu"})
            if length > artwork.MAX:
                return self._json(413, {"error": "image trop lourde (maximum %d Mo)"
                                                 % (artwork.MAX // (1024 * 1024))})
            raw = self.rfile.read(length)
            try:
                self._json(200, app.art_upload(q, raw))
            except ApiError as e:
                self._json(e.status, {"error": str(e)})
            except Exception:
                log.exception("envoi d'image")
                self._json(500, {"error": "erreur interne"})

        def _trailer(self, q):
            vid = _youtube_id(q.get("v"))
            if not vid:
                return self._json(404, {"error": "bande-annonce inconnue"})
            data = TRAILER_PAGE.replace("__VIDEO__", vid).encode()
            self._headers(200, "text/html; charset=utf-8", len(data), {"Cache-Control": "no-store"})
            self.wfile.write(data)

        def _page(self, page):
            data = page.encode()
            self._headers(200, "text/html; charset=utf-8", len(data), {"Cache-Control": "no-store"})
            self.wfile.write(data)

        def _media(self, raw):
            """Sert un fichier de la médiathèque, en gérant les sauts dans le flux."""
            f = medias.file_for(app.db, "file", to_int(raw.split(".")[0]) + medias.BASE)
            if not f or not os.path.isfile(f["path"]):
                return self._json(404, {"error": "fichier introuvable"})
            path, size = f["path"], os.path.getsize(f["path"])
            mime = MEDIA_MIME.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
            start, end = 0, size - 1
            rng = self.headers.get("Range")
            if rng:
                m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
                if not m or (not m.group(1) and not m.group(2)):
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % size)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if m.group(1):
                    start = min(int(m.group(1)), size - 1)
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                else:                                   # bytes=-500 : les derniers octets
                    start = max(0, size - int(m.group(2)))
            length = end - start + 1
            extra = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
            if rng:
                extra["Content-Range"] = "bytes %d-%d/%d" % (start, end, size)
            self._headers(206 if rng else 200, mime, length, extra)
            if self.command == "HEAD":
                return
            try:
                with open(path, "rb") as fh:
                    fh.seek(start)
                    left = length
                    while left > 0:
                        chunk = fh.read(min(262144, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass                                    # le téléviseur a coupé : c'est normal

        def _image(self, q):
            res = app.images.get(q.get("u", ""), to_int(q.get("w"), 240), q.get("m", ""))
            if not res:
                return self._json(404, {"error": "image indisponible"})
            path, mime = res
            with open(path, "rb") as f:
                data = f.read()
            self._headers(200, mime, len(data), {"Cache-Control": "public, max-age=2592000, immutable"})
            self.wfile.write(data)

        do_GET = do_POST = do_DELETE = do_HEAD = _handle

    return Handler


NAMES_REV = "1.0"   # change quand la façon de calculer ce qui s'affiche évolue


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    cfg = load_config()
    app = Luciole(cfg)
    srv = ThreadingHTTPServer((cfg["server"]["listen"], int(cfg["server"]["port"])), make_handler(app))
    srv.daemon_threads = True
    # après une mise à jour, on recalcule une fois ce qui s'affiche
    rev = app.db.execute("SELECT v FROM meta WHERE k='names_rev'").fetchone()
    if not rev or rev[0] != NAMES_REV:
        custom.apply(app.db)
        with app.db:
            app.db.execute("INSERT OR REPLACE INTO meta VALUES ('names_rev', ?)", (NAMES_REV,))
        log.info("noms et images recalculés")
    try:                      # images d'anciennes fiches qui ne servent plus
        gone = artwork.sweep(app.db, cfg)
        if gone:
            log.info("%d image(s) personnelle(s) devenue(s) inutile(s) effacée(s)", gone)
    except OSError:
        pass
    log.info("Luciole écoute sur %s:%s", cfg["server"]["listen"], cfg["server"]["port"])
    tv = tvwake.reglages(cfg, app.db)
    if tv["auto"] and tv["host"]:
        app.start_watcher()
        log.info("démarrage automatique : %s sera réveillé sur %s", tv["app"], tv["host"])
    else:
        log.info("démarrage automatique : inactif (page de réglages, onglet Téléviseur)")
    if not app.status({})["catalog_sync"]:
        log.info("première mise en route : synchronisation du catalogue")
        app.start_sync({}, {})
    srv.serve_forever()


if __name__ == "__main__":
    main()
