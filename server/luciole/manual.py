"""Chaînes ajoutées à la main : un lien de flux (m3u8, ts…) ou une liste M3U collée.

Elles vivent dans la table manual_live et sont recopiées dans la table live, sous le
bouquet « Mes liens », avec des identifiants réservés entre MANUAL et medias.BASE :
aucun abonnement ne les touche, la synchronisation ne les efface pas.
Le nom, le numéro et le logo se corrigent ensuite comme pour les autres chaînes
(onglet Chaînes), et elles s'ajoutent aux bouquets personnels comme les autres.
"""
import re
import urllib.parse
import urllib.request

from . import UA
from .common import merge_hosts, norm

MANUAL = 8 * 10 ** 14          # au-dessus des abonnements, sous la médiathèque
CAT = "manual"                 # le bouquet qui les regroupe
CAT_NAME = "Mes liens"
MAX_IMPORT = 3000

_ATTR = re.compile(r'([a-zA-Z0-9_-]+)="([^"]*)"')


def is_manual(chan_id):
    return MANUAL <= int(chan_id or 0) < MANUAL + 10 ** 14


def check_url(url):
    url = (url or "").strip()
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ("http", "https", "rtmp", "rtsp", "udp", "rtp") or not p.netloc:
        raise ValueError("adresse du flux invalide (http://…, https://…)")
    return url


def _host(url):
    return urllib.parse.urlsplit(url or "").hostname


def publish(db):
    """Recopie les chaînes ajoutées à la main dans la table live (et leur bouquet)."""
    rows = list(db.execute("SELECT * FROM manual_live ORDER BY pos, id"))
    with db:
        db.execute("DELETE FROM live WHERE id >= ? AND id < ?", (MANUAL, MANUAL + 10 ** 14))
        if not rows:
            db.execute("DELETE FROM categories WHERE kind='live' AND id=?", (CAT,))
            return 0
        db.execute("INSERT OR IGNORE INTO categories(kind, id, name, pos, hidden, orig_name, src) "
                   "VALUES ('live', ?, ?, -1, 0, ?, 0)", (CAT, CAT_NAME, CAT_NAME))
        over = {r["id"]: r for r in db.execute("SELECT id, name, num, logo FROM chan_override WHERE id >= ? AND id < ?",
                                                (MANUAL, MANUAL + 10 ** 14))}
        out = []
        for r in rows:
            gid = MANUAL + r["id"]
            o = over.get(gid)
            name = (o["name"] if o and o["name"] else None) or r["name"]
            num = o["num"] if o and o["num"] is not None else r["num"]
            logo = (o["logo"] if o and o["logo"] else None) or r["logo"] or ""
            out.append((gid, num, name, norm(name), logo, CAT, "", 0, 0, r["name"], r["num"], r["logo"] or "", 0))
        db.executemany("INSERT OR REPLACE INTO live(id, num, name, norm, logo, cat, epg_id, archive, archive_days, "
                       "orig_name, orig_num, orig_logo, src) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", out)
        merge_hosts(db, {_host(r["logo"]) for r in rows if r["logo"]})
    return len(rows)


def _next_num(db):
    a = db.execute("SELECT MAX(num) AS n FROM live").fetchone()["n"] or 0
    b = db.execute("SELECT MAX(num) AS n FROM manual_live").fetchone()["n"] or 0
    return max(a, b) + 1


def add(db, name, url, logo="", num=None):
    url = check_url(url)
    name = (name or "").strip() or urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1] or "Chaîne"
    num = int(num) if num not in (None, "") else _next_num(db)
    pos = (db.execute("SELECT MAX(pos) AS p FROM manual_live").fetchone()["p"] or 0) + 1
    with db:
        cur = db.execute("INSERT INTO manual_live(name, url, logo, num, pos) VALUES (?,?,?,?,?)",
                         (name[:120], url, (logo or "").strip(), num, pos))
    return MANUAL + cur.lastrowid


def edit(db, chan_id, url=None, name=None):
    raw = int(chan_id) - MANUAL
    if url is not None:
        url = check_url(url)
    with db:
        if url is not None:
            db.execute("UPDATE manual_live SET url=? WHERE id=?", (url, raw))
        if name:
            db.execute("UPDATE manual_live SET name=? WHERE id=?", (name.strip()[:120], raw))


def remove(db, ids):
    ids = [int(i) for i in ids if is_manual(i)]
    with db:
        for gid in ids:
            db.execute("DELETE FROM manual_live WHERE id=?", (gid - MANUAL,))
            for table, col in (("bouquet_items", "chan"), ("fav_channels", "id"), ("chan_override", "id"),
                               ("epg_map", "chan")):
                db.execute(f"DELETE FROM {table} WHERE {col}=?", (gid,))
    return len(ids)


def url_of(db, chan_id):
    r = db.execute("SELECT url FROM manual_live WHERE id=?", (int(chan_id) - MANUAL,)).fetchone()
    return r["url"] if r else None


def listing(db):
    return [{"id": MANUAL + r["id"], "name": r["name"], "url": r["url"], "logo": r["logo"] or "", "num": r["num"]}
            for r in db.execute("SELECT * FROM manual_live ORDER BY pos, id")]


def parse_m3u(text):
    """Liste M3U étendue -> [(nom, adresse, logo, groupe)]."""
    out, info = [], None
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith("#EXTINF"):
            head, _, title = line.partition(",")
            attrs = dict(_ATTR.findall(head))
            info = (title.strip() or attrs.get("tvg-name", ""), attrs.get("tvg-logo", ""), attrs.get("group-title", ""))
        elif line.startswith("#"):
            continue
        else:
            name, logo, group = info or ("", "", "")
            try:
                out.append((name, check_url(line), logo, group))
            except ValueError:
                pass
            info = None
        if len(out) >= MAX_IMPORT:
            break
    return out


def fetch_m3u(url, timeout=20):
    req = urllib.request.Request(check_url(url), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(20 * 1024 * 1024).decode("utf-8", "replace")
