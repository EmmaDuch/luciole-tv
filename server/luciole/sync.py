"""Synchronisation : catalogue Xtream + guide des programmes (XMLTV).

Lancement : python3 -m luciole.sync   (le timer systemd le fait toutes les 6 h)
Chaque abonnement de la configuration est synchronisé à son tour ; un abonnement
qui ne répond pas garde son ancien catalogue sans gêner les autres.
"""
import fcntl
import gzip
import json
import logging
import os
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET

from . import custom, epg_ext, filters, images, medias, providers
from .common import connect, load_config, merge_hosts, norm, now, to_float, to_int, xmltv_time
from .xtream import XtreamError

log = logging.getLogger("luciole.sync")

def _first(value):
    if isinstance(value, list):
        return value[0] if value else ""
    return value or ""


def _host(url):
    try:
        return urllib.parse.urlsplit(url).hostname
    except ValueError:
        return None


def sync_catalog(db, xt, p):
    """Catalogue d'un fournisseur. Seules ses propres lignes sont remplacées."""
    src, shift = p["src"], p["decalage"]
    info = xt.login()
    providers.save_info(db, src, info)
    hosts = set()
    cats = []
    for kind, action in (("live", "get_live_categories"), ("vod", "get_vod_categories"),
                         ("series", "get_series_categories")):
        for pos, c in enumerate(xt.api(action) or []):
            name = c.get("category_name") or ""
            cats.append((kind, providers.cat_id(src, c.get("category_id")), name, pos, name, src))

    def cat(s):
        return providers.cat_id(src, s.get("category_id"))

    live = []
    for s in xt.api("get_live_streams") or []:
        logo = s.get("stream_icon") or ""
        hosts.add(_host(logo))
        archive = 1 if str(s.get("tv_archive")) == "1" else 0
        num = to_int(s.get("num")) + shift
        live.append((providers.gid(src, to_int(s.get("stream_id"))), num, s.get("name") or "", norm(s.get("name")),
                     logo, cat(s), providers.epg_key(src, s.get("epg_channel_id") or ""),
                     archive, to_int(s.get("tv_archive_duration")) if archive else 0,
                     s.get("name") or "", num, logo, src))

    vod = []
    for s in xt.api("get_vod_streams") or []:
        poster = s.get("stream_icon") or ""
        hosts.add(_host(poster))
        vod.append((providers.gid(src, to_int(s.get("stream_id"))), s.get("name") or "", norm(s.get("name")), poster,
                    cat(s), to_float(s.get("rating")), to_int(s.get("added")),
                    s.get("container_extension") or "mp4", s.get("name") or "", poster, src))

    series = []
    for s in xt.api("get_series") or []:
        poster = s.get("cover") or ""
        backdrop = _first(s.get("backdrop_path"))
        hosts.update((_host(poster), _host(backdrop)))
        series.append((providers.gid(src, to_int(s.get("series_id"))), s.get("name") or "", norm(s.get("name")),
                       poster, backdrop, cat(s), s.get("plot") or "", s.get("genre") or "",
                       to_float(s.get("rating")), to_int(s.get("last_modified")), s.get("name") or "",
                       poster, backdrop, s.get("plot") or "", src))

    lo, hi = providers.id_range(src)
    with db:
        db.execute("DELETE FROM categories WHERE src=?", (src,))
        db.executemany("INSERT OR REPLACE INTO categories(kind, id, name, pos, orig_name, src) VALUES (?,?,?,?,?,?)",
                       cats)
        db.execute("DELETE FROM live WHERE src=?", (src,))
        db.executemany("INSERT OR REPLACE INTO live(id, num, name, norm, logo, cat, epg_id, archive, archive_days, "
                       "orig_name, orig_num, orig_logo, src) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", live)
        db.execute("DELETE FROM vod WHERE src=?", (src,))
        db.executemany("INSERT OR REPLACE INTO vod(id, name, norm, poster, cat, rating, added, ext, orig_name, "
                       "orig_poster, src) VALUES (?,?,?,?,?,?,?,?,?,?,?)", vod)
        db.execute("DELETE FROM series WHERE src=?", (src,))
        db.executemany("INSERT OR REPLACE INTO series(id, name, norm, poster, backdrop, cat, plot, genre, rating, "
                       "updated, orig_name, orig_poster, orig_backdrop, orig_plot, src) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", series)
        # les fiches détaillées seront relues à la demande (sauf les séries en cours de visionnage)
        db.execute("DELETE FROM info_cache WHERE id >= ? AND id < ? AND fetched < ? AND NOT (kind = 'series' AND "
                   "id IN (SELECT series_id FROM progress WHERE kind = 'episode'))", (lo, hi, now() - 86400))
        hosts.discard(None)
        hosts.discard("")
        merge_hosts(db, hosts)
    log.info("%s : %d chaînes, %d films, %d séries", p["nom"], len(live), len(vod), len(series))


def sync_epg(db, xt, p, hours):
    """Guide d'un fournisseur ; ses programmes portent src = -src dans la table epg."""
    src = p["src"]
    prefix = providers.epg_key(src, "x")[:-1]
    wanted = {r["epg_id"][len(prefix):] for r in db.execute(
        f"SELECT DISTINCT epg_id FROM live WHERE src = ? AND epg_id != '' AND ({filters.visible('live')} "
        "OR id IN (SELECT id FROM fav_channels))", (src,))}
    if not wanted:
        log.info("%s, guide : aucune chaîne n'a d'identifiant de guide, rien à faire", p["nom"])
        return
    lo, hi = now() - 3 * 3600, now() + hours * 3600
    # chaînes avec replay : on garde aussi les programmes passés (7 jours au plus)
    past = {r["epg_id"][len(prefix):]: now() - min(7, max(1, r["d"])) * 86400 for r in db.execute(
        "SELECT epg_id, MAX(archive_days) AS d FROM live WHERE src = ? AND archive = 1 AND epg_id != '' "
        "GROUP BY epg_id", (src,))}
    rows = []
    with xt.open_epg() as r:
        stream = r
        head = r.peek(2) if hasattr(r, "peek") else b""
        if head[:2] == b"\x1f\x8b":
            stream = gzip.GzipFile(fileobj=r)
        for _, el in ET.iterparse(stream, events=("end",)):
            if el.tag != "programme":
                if el.tag == "channel":
                    el.clear()
                continue
            ch = el.get("channel")
            if ch in wanted:
                start, stop = xmltv_time(el.get("start")), xmltv_time(el.get("stop"))
                if start and stop and stop > past.get(ch, lo) and start < hi:
                    rows.append((prefix + ch, start, stop, (el.findtext("title") or "").strip(),
                                 (el.findtext("desc") or "").strip()[:600], -src))
            el.clear()
    with db:
        db.execute("DELETE FROM epg WHERE src = ?", (-src,))
        db.executemany("INSERT INTO epg(channel, start, stop, title, descr, src) VALUES (?,?,?,?,?,?)", rows)
    log.info("%s, guide : %d programmes", p["nom"], len(rows))


def run(cfg, only=None):
    """Synchronise tous les fournisseurs (ou seulement le numéro « only »)."""
    lock_path = os.path.join(cfg["server"]["data_dir"], "sync.lock")
    with open(lock_path, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log.info("une synchronisation est déjà en cours")
            return True
        db = connect(cfg)
        reg = providers.Registry(cfg, db)
        ok, any_catalog = True, False
        for p in reg.items:
            if only is not None and p["src"] != only:
                continue
            xt = reg.client(p["src"])
            try:
                sync_catalog(db, xt, p)
                any_catalog = True
            except XtreamError as e:
                log.error("%s : catalogue non mis à jour (l'ancien est conservé) : %s", p["nom"], e)
                providers.set_status(db, p["src"], "erreur : %s" % str(e)[:200])
                ok = False
                continue
            try:
                sync_epg(db, xt, p, cfg["sync"]["epg_hours"])
                providers.set_status(db, p["src"], "ok", synced=True)
            except Exception as e:
                log.error("%s : guide non mis à jour : %s", p["nom"], e)
                providers.set_status(db, p["src"], "guide : %s" % str(e)[:200], synced=True)
                ok = False
        providers.purge_absent(db, cfg, log)
        if any_catalog:
            with db:
                db.execute("INSERT OR REPLACE INTO meta VALUES ('catalog_sync', ?)", (str(now()),))
            filters.apply(db, cfg)
            custom.apply(db)
            epg_ext.apply_map(db)
        try:
            total, errors = epg_ext.fetch_all(db, cfg["sync"]["epg_hours"], cfg["sync"]["timeout"] * 3)
            if total:
                log.info("guide externe : %d programmes", total)
            if errors:
                ok = False
        except Exception as e:
            log.error("guide externe non mis à jour : %s", e)
            ok = False
        with db:
            db.execute("INSERT OR REPLACE INTO meta VALUES ('epg_sync', ?)", (str(now()),))
        try:
            if db.execute("SELECT 1 FROM media_root WHERE enabled=1 LIMIT 1").fetchone():
                medias.refresh(db, cfg)
        except Exception as e:
            log.error("médiathèque non mise à jour : %s", e)
            ok = False
        try:
            n, size = images.prune(cfg["server"]["data_dir"])
            if n:
                log.info("cache d'images : %d images inutilisées effacées (%d Mo)", n, size // (1024 * 1024))
        except Exception as e:
            log.error("cache d'images non nettoyé : %s", e)
        db.close()
        return ok


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    sys.exit(0 if run(load_config()) else 1)


if __name__ == "__main__":
    main()
