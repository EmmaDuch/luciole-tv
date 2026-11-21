"""Médiathèque personnelle : fichiers vidéo d'un partage réseau, montés sur le serveur.

Le serveur parcourt les dossiers déclarés, déduit un titre et une année du nom de
fichier, va chercher la fiche sur TMDB, puis publie le résultat dans les mêmes
tables que le catalogue du fournisseur. L'application TV n'a rien à savoir de tout
cela : pour elle, ce sont des films et des séries comme les autres.
"""
import json
import logging
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from . import UA
from .common import norm, now, to_int

log = logging.getLogger("luciole.medias")

# Les identifiants locaux vivent au-dessus de ceux du fournisseur, qui sont bien plus petits.
BASE = 9 * 10 ** 14     # au-dessus de tous les identifiants des abonnements (voir providers.py)

EXTS = (".mkv", ".mp4", ".m4v", ".avi", ".ts", ".mov", ".m2ts", ".mpg", ".mpeg", ".wmv", ".webm")
SUB_EXTS = (".srt", ".ass", ".ssa", ".sub", ".vtt")
ART_EXTS = (".jpg", ".jpeg", ".png", ".webp")

# Identifiant TMDB déposé dans le nom par les gestionnaires de médiathèque
# (tinyMediaManager, Jellyfin, Kodi) : « Film (2002) {tmdb-170} ».
_TMDB_TAG = re.compile(r"[{\[]\s*(?:tmdb(?:id)?|id)\s*[-_=: ]?\s*(\d+)\s*[}\]]", re.I)
# toutes les étiquettes entre accolades ou crochets : « {tmdb-170} », « [imdbid-tt0120737] »…
_ANY_TAG = re.compile(r"\s*[{\[][^{}\[\]]*[}\]]")


def tmdb_tag(path):
    """Identifiant TMDB lu dans le nom du fichier ou d'un dossier parent."""
    cur = os.path.abspath(path)
    for _ in range(3):
        m = _TMDB_TAG.search(os.path.basename(cur))
        if m:
            return to_int(m.group(1))
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return None


# ---------------------------------------------------------------- bonus et bandes-annonces
# Conventions Kodi, Plex et Jellyfin : « Film (2011)-trailer.mp4 » à côté du film,
# ou un sous-dossier « Trailers », « Deleted Scenes », « Interviews »… dans le dossier du film.
EXTRA_KINDS = {
    "trailer": "trailer", "trailers": "trailer", "teaser": "trailer", "bande-annonce": "trailer",
    "bandes-annonces": "trailer", "bandeannonce": "trailer",
    "sample": "sample", "samples": "sample",
    "featurette": "featurette", "featurettes": "featurette",
    "behindthescenes": "behindthescenes", "behind the scenes": "behindthescenes", "making of": "behindthescenes",
    "making-of": "behindthescenes", "makingof": "behindthescenes",
    "deleted": "deleted", "deletedscene": "deleted", "deletedscenes": "deleted", "deleted scenes": "deleted",
    "scenes coupees": "deleted",
    "interview": "interview", "interviews": "interview",
    "scene": "scene", "scenes": "scene", "clip": "scene", "clips": "scene",
    "short": "short", "shorts": "short",
    "extra": "extra", "extras": "extra", "bonus": "extra", "bonus features": "extra", "other": "extra", "others": "extra",
}
EXTRA_LABEL = {"trailer": "Bande-annonce", "sample": "Extrait", "featurette": "Making-of",
               "behindthescenes": "Coulisses", "deleted": "Scène coupée", "interview": "Interview",
               "scene": "Scène", "short": "Court métrage", "extra": "Bonus"}
_EXTRA_SUFFIX = re.compile(r"[-_.](trailer|teaser|sample|featurette|behindthescenes|deleted|deletedscene|"
                           r"interview|scene|clip|short|other|extra|bonus|bande-annonce)\d*$", re.I)


_SEASON_DIR = re.compile(r"(?i)^(saison|season|series|staffel|temporada|s)\s*\d+\b|^specials?$")


def _has_movie(folder, cache):
    """Le dossier contient-il directement une vidéo qui n'est pas un bonus ? (un vrai dossier de film)"""
    if folder not in cache:
        found = False
        try:
            for fn in os.listdir(folder):
                stem, ext = os.path.splitext(fn)
                if ext.lower() in EXTS and not fn.startswith(".") and not _EXTRA_SUFFIX.search(stem) \
                        and stem.lower() not in EXTRA_KINDS:
                    found = True
                    break
                # dossier d'une série : ses saisons sont des sous-dossiers
                if _SEASON_DIR.match(fn) and os.path.isdir(os.path.join(folder, fn)):
                    found = True
                    break
        except OSError:
            pass
        cache[folder] = found
    return cache[folder]


def extra_of(root_path, path, cache):
    """(sorte, dossier du film, titre) si le fichier est un bonus ; None pour un film ou un épisode."""
    stem = os.path.splitext(os.path.basename(path))[0]
    folder = os.path.dirname(path)
    # d'abord un sous-dossier de bonus, à l'intérieur du dossier d'un film
    root = os.path.abspath(root_path).rstrip("/")
    cur = folder
    while cur.startswith(root + "/"):
        name = norm(os.path.basename(cur)).strip()
        parent = os.path.dirname(cur)
        if name in EXTRA_KINDS and parent != root and _has_movie(parent, cache):
            kind = EXTRA_KINDS[name]
            return kind, parent, _clean_title(stem) or EXTRA_LABEL[kind]
        cur = parent
    # puis un fichier posé à côté du film : « Film (2011)-trailer.mp4 », « trailer.mkv »
    m = _EXTRA_SUFFIX.search(stem)
    if m or stem.lower() in EXTRA_KINDS:
        kind = EXTRA_KINDS.get((m.group(1) if m else stem).lower(), "extra")
        num = re.search(r"(\d+)$", stem) if m else None
        return kind, folder, EXTRA_LABEL[kind] + (" " + num.group(1) if num else "")
    return None


def extras(db, folders):
    """Bonus rattachés aux dossiers donnés, bandes-annonces d'abord."""
    if not folders:
        return []
    rows = [dict(r) for r in db.execute(
        "SELECT * FROM media_file WHERE kind='extra' AND owner IN (%s)" % ",".join("?" * len(folders)), list(folders))]
    order = list(EXTRA_LABEL)
    rows.sort(key=lambda r: (order.index(r["eptitle"]) if r["eptitle"] in order else 99, r["title"] or "", r["path"]))
    return rows


def _art_near(stem, suffixes, folder_names=()):
    """Cherche une image : « <fichier>-poster.jpg », puis « poster.jpg » dans le dossier."""
    for suf in suffixes:
        for ext in ART_EXTS:
            p = stem + suf + ext
            if os.path.isfile(p):
                return p
    folder = os.path.dirname(stem)
    for name in folder_names:
        for ext in ART_EXTS:
            p = os.path.join(folder, name + ext)
            if os.path.isfile(p):
                return p
    return None


def local_art(path, kind):
    """(affiche, image large) déjà présentes à côté du fichier, en adresses file://."""
    stem = os.path.splitext(path)[0]
    if kind == "episode":
        thumb = _art_near(stem, ("-thumb", "-landscape", ""), ())
        return None, _file_url(thumb)
    poster = _art_near(stem, ("-poster", "-thumb", ""), ("poster", "folder", "cover"))
    back = _art_near(stem, ("-fanart", "-backdrop", "-landscape"), ("fanart", "backdrop", "landscape"))
    return _file_url(poster), _file_url(back)


def local_logo(path):
    """Logo du titre, transparent (« Film-clearlogo.png », « clearlogo.png », « logo.png »)."""
    return _file_url(_art_near(os.path.splitext(path)[0], ("-clearlogo", "-logo"), ("clearlogo", "logo")))


def show_art(folder):
    """Affiche et fond d'une série, au niveau du dossier de la série."""
    poster = back = None
    try:
        names = os.listdir(folder)
    except OSError:
        return None, None
    for fn in names:
        low = fn.lower()
        if os.path.splitext(low)[1] not in ART_EXTS:
            continue
        full = os.path.join(folder, fn)
        if poster is None and ("poster" in low or low.startswith("folder") or low.startswith("cover")):
            poster = full
        elif back is None and ("fanart" in low or "backdrop" in low):
            back = full
    return _file_url(poster), _file_url(back)


def _file_url(path):
    """Adresse interne d'une image locale, comprise par le cache d'images."""
    if not path:
        return ""
    return "file://" + urllib.parse.quote(os.path.abspath(path))


# ---------------------------------------------------------------- fichiers .nfo

def _text(node, tag):
    el = node.find(tag) if node is not None else None
    return (el.text or "").strip() if el is not None and el.text else ""


def read_nfo(video_path):
    """Fiche Kodi/tinyMediaManager déposée à côté du fichier, si elle existe."""
    nfo = os.path.splitext(video_path)[0] + ".nfo"
    if not os.path.isfile(nfo):
        return None
    try:
        root = ET.parse(nfo).getroot()
    except Exception:
        return None
    if root.tag not in ("movie", "tvshow", "episodedetails"):
        return None
    out = {"title": _text(root, "title") or _text(root, "originaltitle"),
           "plot": _text(root, "plot") or _text(root, "outline"),
           "year": to_int(_text(root, "year")) or to_int((_text(root, "premiered") or "")[:4]),
           "genres": [g.text.strip() for g in root.findall("genre") if g is not None and g.text],
           "rating": 0.0, "runtime": to_int(_text(root, "runtime")),
           "director": _text(root, "director"),
           "cast": ", ".join(filter(None, [_text(a, "name") for a in root.findall("actor")][:10])),
           "tmdb": to_int(_text(root, "tmdbid")) or to_int(_text(root, "id")),
           "trailer": _text(root, "trailer")}
    for tag in ("rating", "userrating"):
        v = _text(root, tag)
        try:
            out["rating"] = float(v)
            break
        except ValueError:
            pass
    r = root.find("ratings/rating/value")
    if not out["rating"] and r is not None and r.text:
        try:
            out["rating"] = float(r.text)
        except ValueError:
            pass
    return out

# Ce que le téléviseur sait lire sans transcodage.
OK_VIDEO = {"h264", "avc", "hevc", "h265", "mpeg2video", "mpeg4", "vp9", "av1"}
OK_AUDIO = {"aac", "ac3", "eac3", "mp3", "mp2", "opus", "vorbis", "flac", "pcm_s16le", "pcm_s24le"}

TMDB_API = "https://api.themoviedb.org/3"
TMDB_IMG = "https://image.tmdb.org/t/p/original"
TMDB_HOST = "image.tmdb.org"


# ---------------------------------------------------------------- noms de fichiers

# marqueurs de saison et d'épisode, du plus explicite au plus approximatif
_EP_PATTERNS = (
    re.compile(r"[sS](\d{1,2})[\s._-]*[eE][pP]?(\d{1,3})"),        # S01E02, s1e2, S01 E02
    re.compile(r"(?<![\dxX])(\d{1,2})[xX](\d{1,3})(?![\dxX])"),    # 1x02
    re.compile(r"[sS]aison[\s._-]*(\d{1,2}).*?[eÉée]pisode[\s._-]*(\d{1,3})", re.I),
)
_SEASON_DIR = re.compile(r"^(?:s|saison|season|série|serie|livre|partie|vol)[\s._-]*(\d{1,2}|[ivxIVX]{1,5})$", re.I)
_ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10}
_YEAR = re.compile(r"[(\[]?((?:19|20)\d{2})[)\]]?")

# bruit habituel des noms de fichiers : tout ce qui suit le premier de ces mots est jeté
_JUNK = (
    "2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10|hdr|dolby ?vision|dv|sdr"
    "|bluray|blu ray|brrip|bdrip|bdremux|remux|web ?dl|web ?rip|webrip|web"
    "|hdtv|dvdrip|dvd|hdlight|vostfr|vost|multi|truefrench|french|vff|vfq|vfi|vo"
    "|x264|x265|h264|h265|hevc|avc|xvid|divx"
    "|aac|ac3|eac3|dts ?hd|dts|ddp?5 1|dd5 1|atmos|flac|mp3|7 1|5 1|2 0"
    "|integrale|intégrale|saison ?complete|complete"
)
_JUNK_RE = re.compile(r"[\s._-]+(?:" + _JUNK + r")(?:[\s._-]|$)", re.I)
_BRACKETS = re.compile(r"[\[{(][^\])}]*[\])}]")
_SEPS = re.compile(r"[._]+")
_SPACES = re.compile(r"\s{2,}")


def _clean_title(raw):
    """Transforme « Le.Film.2021.MULTi.1080p.BluRay.x264-GRP » en « Le Film »."""
    t = _SEPS.sub(" ", raw)
    t = _BRACKETS.sub(" ", t)
    m = _JUNK_RE.search(" " + t)
    if m:
        t = (" " + t)[:m.start()]
    t = re.sub(r"[\s-]+$", "", t)
    t = _SPACES.sub(" ", t).strip(" -_")
    return t.strip(" -_([{")          # parenthèse ouvrante laissée par le retrait de l'année


def _season_num(raw):
    """« Saison 2 », « Season 02 », « Livre III » : renvoie le numéro."""
    v = raw.strip()
    return _ROMAN.get(v.lower(), None) or to_int(v) or None


def parse_movie(path):
    """(titre, année) à partir du chemin d'un film."""
    base = os.path.splitext(os.path.basename(path))[0]
    parent = os.path.basename(os.path.dirname(path))
    # « Dune (2021)/Dune (2021).mkv » : le dossier porte souvent le nom le plus propre
    cand = base if len(base) >= len(parent) else parent
    year = None
    hits = _YEAR.findall(cand)
    if hits:
        year = to_int(hits[-1])
        cut = cand.rfind(hits[-1])
        if cut > 2:
            cand = cand[:cut]
    title = _clean_title(cand)
    if not title:
        title = _clean_title(base) or base
    return title, year


def parse_episode(path):
    """(série, saison, épisode, titre d'épisode) ou None si ce n'en est pas un."""
    base = os.path.splitext(os.path.basename(path))[0]
    season = episode = None
    head, tail = base, ""
    for rx in _EP_PATTERNS:
        m = rx.search(base)
        if m:
            season, episode = to_int(m.group(1)), to_int(m.group(2))
            head, tail = base[:m.start()], base[m.end():]
            break
    parent = os.path.basename(os.path.dirname(path))
    grand = os.path.basename(os.path.dirname(os.path.dirname(path)))
    sd = _SEASON_DIR.match(parent.strip())
    if season is None and sd:
        season = _season_num(sd.group(1))
        m = re.search(r"(?:^|[\s._-])(?:[eEéÉ]pisode[\s._-]*|[eE][pP]?)(\d{1,3})(?![\d])", base)
        if m:
            episode = to_int(m.group(1))
            head, tail = base[:m.start()], base[m.end():]
    if season is None or episode is None:
        return None
    # nom de la série : le dossier de la série si on est dans un dossier de saison
    show_raw = grand if sd else (parent if parent and not _SEASON_DIR.match(parent) else "")
    if not show_raw:
        show_raw = head
    year = None                                   # l'année se lit avant le nettoyage, qui ôte les parenthèses
    hits = _YEAR.findall(show_raw)
    if hits:
        year = to_int(hits[-1])
        cut = show_raw.rfind(hits[-1])
        if cut > 2:
            show_raw = show_raw[:cut]
    show = _clean_title(show_raw) or _clean_title(head) or show_raw
    return show, season, episode, _clean_title(tail), year


# ---------------------------------------------------------------- lecture des pistes

_PROBE = None


def have_probe():
    global _PROBE
    if _PROBE is None:
        try:
            subprocess.run(["ffprobe", "-version"], capture_output=True, timeout=5)
            _PROBE = True
        except Exception:
            _PROBE = False
    return _PROBE


def probe(path):
    """Pistes du fichier, si ffprobe est installé. Sinon on ne présume rien."""
    out = {"vcodec": "", "acodec": "", "width": 0, "height": 0, "dur": 0.0, "playable": 1, "note": ""}
    if not have_probe():
        return out
    try:
        r = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json",
                            "-show_format", "-show_streams", path],
                           capture_output=True, timeout=60)
        d = json.loads(r.stdout or b"{}")
    except Exception as e:
        out["note"] = "analyse impossible (%s)" % e.__class__.__name__
        return out
    for s in d.get("streams", []):
        if s.get("codec_type") == "video" and not out["vcodec"]:
            out["vcodec"] = (s.get("codec_name") or "").lower()
            out["width"], out["height"] = to_int(s.get("width")), to_int(s.get("height"))
        elif s.get("codec_type") == "audio" and not out["acodec"]:
            out["acodec"] = (s.get("codec_name") or "").lower()
    try:
        out["dur"] = float((d.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        out["dur"] = 0.0
    gripes = []
    if out["vcodec"] and out["vcodec"] not in OK_VIDEO:
        gripes.append("vidéo %s" % out["vcodec"])
    if out["acodec"] and out["acodec"] not in OK_AUDIO:
        gripes.append("son %s" % out["acodec"])
    if gripes:
        out["playable"] = 0
        out["note"] = "le téléviseur ne lit pas : " + ", ".join(gripes)
    return out


# ---------------------------------------------------------------- TMDB

class TmdbError(Exception):
    pass


class Tmdb:
    def __init__(self, cfg):
        m = cfg.get("medias", {})
        self.key = (m.get("tmdb_key") or "").strip()
        self.lang = m.get("langue") or "fr-FR"
        self.base = (m.get("tmdb_api") or TMDB_API).rstrip("/")
        self.img = (m.get("tmdb_img") or TMDB_IMG).rstrip("/")
        self.timeout = to_int(m.get("timeout"), 20)
        self._last = 0.0
        self._lock = threading.Lock()

    def ready(self):
        return bool(self.key)

    def _get(self, path, **params):
        if not self.key:
            raise TmdbError("aucune clé TMDB dans la configuration")
        params["api_key"] = self.key
        params.setdefault("language", self.lang)
        url = self.base + path + "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
        with self._lock:                       # TMDB n'aime pas les rafales
            wait = 0.12 - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            raise TmdbError("TMDB a répondu %s" % e.code)
        except Exception as e:
            raise TmdbError(str(e) or e.__class__.__name__)

    def poster(self, path):
        return (self.img + path) if path else ""

    def search_movie(self, title, year=None):
        d = self._get("/search/movie", query=title, year=year, include_adult="false")
        res = d.get("results") or []
        if not res and year:                   # l'année du fichier est parfois fausse
            res = (self._get("/search/movie", query=title, include_adult="false").get("results") or [])
        return res

    def search_tv(self, title, year=None):
        d = self._get("/search/tv", query=title, first_air_date_year=year, include_adult="false")
        res = d.get("results") or []
        if not res and year:
            res = (self._get("/search/tv", query=title, include_adult="false").get("results") or [])
        return res

    def movie(self, tid):
        return self._get("/movie/%d" % tid, append_to_response="credits,videos")

    def tv(self, tid):
        return self._get("/tv/%d" % tid, append_to_response="credits,videos")

    def season(self, tid, n):
        return self._get("/tv/%d/season/%d" % (tid, n))

    def images(self, kind, tid):
        """Toutes les jaquettes et tous les fonds d'un titre (kind : movie ou tv)."""
        # sans « language », TMDB renvoie toutes les langues retenues ici ; null = image sans texte
        return self._get("/%s/%d/images" % (kind, tid), language="",
                         include_image_language="%s,en,null" % (self.lang or "fr")[:2])


def pick_logo(data, lang="fr"):
    """Le meilleur logo d'un titre dans la réponse /images : la langue de l'interface, puis l'anglais,
    puis sans texte ; à égalité, le mieux noté. '' s'il n'y en a pas."""
    order = {lang[:2]: 0, "en": 1, None: 2}
    logos = sorted((data or {}).get("logos") or [],
                   key=lambda i: (order.get(i.get("iso_639_1"), 3), -(i.get("vote_average") or 0)))
    return logos[0].get("file_path") or "" if logos else ""


def _trailer(data):
    """Identifiant YouTube de la bande-annonce, si TMDB en propose une."""
    for v in ((data.get("videos") or {}).get("results") or []):
        if v.get("site") == "YouTube" and v.get("type") in ("Trailer", "Teaser") and v.get("key"):
            return "https://www.youtube.com/watch?v=" + v["key"]
    return ""


def _people(data):
    c = data.get("credits") or {}
    direct = [p.get("name") for p in (c.get("crew") or []) if p.get("job") in ("Director", "Realisator")]
    if not direct:
        direct = [p.get("name") for p in (data.get("created_by") or [])]
    cast = [p.get("name") for p in (c.get("cast") or [])[:10]]
    return ", ".join(filter(None, direct)), ", ".join(filter(None, cast))


# ---------------------------------------------------------------- analyse des dossiers

def roots(db):
    return [dict(r) for r in db.execute("SELECT * FROM media_root ORDER BY id")]


def add_root(db, path, kind, name=""):
    path = os.path.normpath(path)
    if kind not in ("films", "series", "auto"):
        raise ValueError("kind doit valoir films, series ou auto")
    with db:
        db.execute("INSERT OR IGNORE INTO media_root(path, kind, name, enabled) VALUES (?,?,?,1)",
                   (path, kind, name or os.path.basename(path) or path))
    publish_paths(db)
    return db.execute("SELECT * FROM media_root WHERE path=?", (path,)).fetchone()["id"]


def remove_root(db, rid):
    with db:
        files = [r["id"] for r in db.execute("SELECT id FROM media_file WHERE root=?", (rid,))]
        db.execute("DELETE FROM media_file WHERE root=?", (rid,))
        db.execute("DELETE FROM media_root WHERE id=?", (rid,))
    _forget(db, files)


def _forget(db, file_ids):
    """Retire du catalogue les films et épisodes dont le fichier a disparu."""
    with db:
        for fid in file_ids:
            db.execute("DELETE FROM vod WHERE id=?", (BASE + fid,))
            db.execute("DELETE FROM info_cache WHERE kind='vod' AND id=?", (BASE + fid,))
        db.execute("DELETE FROM media_show WHERE id NOT IN (SELECT DISTINCT show FROM media_file WHERE show IS NOT NULL)")
        db.execute("DELETE FROM series WHERE id >= ? AND id NOT IN "
                   "(SELECT ? + id FROM media_show)", (BASE, BASE))


def _walk(root_path):
    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d.lower() not in
                       ("@eadir", "#recycle", "$recycle.bin", "system volume information")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            if os.path.splitext(fn)[1].lower() in EXTS:
                yield os.path.join(dirpath, fn)


def _show_id(db, name, year, folder=None, tmdb=None):
    n = norm(name)
    row = db.execute("SELECT id, tmdb, folder FROM media_show WHERE norm=?", (n,)).fetchone()
    if row:
        # le dossier et l'identifiant se complètent au fil des épisodes rencontrés
        if (tmdb and not row["tmdb"]) or (folder and not row["folder"]):
            with db:
                db.execute("UPDATE media_show SET tmdb = COALESCE(?, tmdb), folder = COALESCE(?, folder) WHERE id=?",
                           (tmdb or None, folder or None, row["id"]))
        return row["id"]
    with db:
        db.execute("INSERT INTO media_show(name, norm, year, folder, tmdb) VALUES (?,?,?,?,?)",
                   (name, n, year, folder, tmdb))
    return db.execute("SELECT id FROM media_show WHERE norm=?", (n,)).fetchone()["id"]


def scan(db, cfg, progress=None):
    """Parcourt les dossiers déclarés et met la table des fichiers à jour."""
    seen, added, gone = 0, 0, 0
    for root in roots(db):
        if not root["enabled"]:
            continue
        path = root["path"]
        if not os.path.isdir(path):
            with db:
                db.execute("UPDATE media_root SET status=?, last=? WHERE id=?",
                           ("dossier introuvable", now(), root["id"]))
            continue
        known = {r["path"]: r for r in db.execute("SELECT * FROM media_file WHERE root=?", (root["id"],))}
        live = set()
        movie_dirs = {}
        for fp in _walk(path):
            live.add(fp)
            seen += 1
            try:
                st = os.stat(fp)
            except OSError:
                continue
            old = known.get(fp)
            extra = extra_of(path, fp, movie_dirs)
            if old and old["size"] == st.st_size and old["mtime"] == int(st.st_mtime) \
                    and (old["kind"] == "extra") == bool(extra) and (not extra or old["owner"] == extra[1]):
                continue
            tag = tmdb_tag(fp)
            ep = parse_episode(fp) if root["kind"] in ("series", "auto") and not extra else None
            if extra:
                row = ("extra", extra[2], None, None, None, extra[0], None)
                tag = None
            elif ep and root["kind"] != "films":
                show, season, episode, eptitle, year = ep
                # dossier de la série : celui qui porte l'étiquette, sinon le parent du dossier de saison
                folder = os.path.dirname(os.path.dirname(fp))
                if not _TMDB_TAG.search(os.path.basename(folder)) and _TMDB_TAG.search(
                        os.path.basename(os.path.dirname(fp))):
                    folder = os.path.dirname(fp)
                show_id = _show_id(db, show or os.path.basename(folder), year, folder, tag)
                row = ("episode", show or "", year, season, episode, eptitle, show_id)
            else:
                title, year = parse_movie(fp)
                row = ("movie", title, year, None, None, "", None)
            info = probe(fp)
            with db:
                db.execute(
                    "INSERT INTO media_file(root, path, size, mtime, kind, title, year, season, episode, eptitle, show,"
                    " vcodec, acodec, width, height, dur, playable, note, scanned, owner)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
                    " ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, kind=excluded.kind,"
                    " title=excluded.title, year=excluded.year, season=excluded.season, episode=excluded.episode,"
                    " eptitle=excluded.eptitle, show=excluded.show, vcodec=excluded.vcodec, acodec=excluded.acodec,"
                    " width=excluded.width, height=excluded.height, dur=excluded.dur, playable=excluded.playable,"
                    " note=excluded.note, scanned=excluded.scanned, owner=excluded.owner",
                    (root["id"], fp, st.st_size, int(st.st_mtime), row[0], row[1], row[2], row[3], row[4], row[5],
                     row[6], info["vcodec"], info["acodec"], info["width"], info["height"], info["dur"],
                     info["playable"], info["note"], now(), extra[1] if extra else None))
                if extra and old and old["kind"] != "extra":
                    # un ancien « film » qui était une bande-annonce ou un bonus : il quitte le catalogue
                    db.execute("UPDATE media_file SET tmdb=NULL, grp=NULL, matched=0 WHERE id=?", (old["id"],))
                    db.execute("DELETE FROM vod WHERE id=?", (BASE + old["id"],))
                    db.execute("DELETE FROM info_cache WHERE kind='vod' AND id=?", (BASE + old["id"],))
            if tag and row[0] == "movie":
                db.execute("UPDATE media_file SET tmdb=? WHERE path=?", (tag, fp))
            added += 1
            if progress:
                progress(seen, added)
        # garde-fou : un partage réseau décroché apparaît comme un dossier vide.
        # On ne vide jamais le catalogue sur cette seule foi.
        if known and not live:
            with db:
                db.execute("UPDATE media_root SET status=?, last=? WHERE id=?",
                           ("dossier vide : partage décroché ?", now(), root["id"]))
            log.warning("médiathèque : %s est vide alors qu'il contenait %d fichiers, rien n'est retiré",
                        path, len(known))
            continue
        missing = [known[p]["id"] for p in known if p not in live]
        if missing:
            gone += len(missing)
            with db:
                db.executemany("DELETE FROM media_file WHERE id=?", [(i,) for i in missing])
            _forget(db, missing)
        with db:
            db.execute("UPDATE media_root SET status=?, last=?, count=? WHERE id=?",
                       ("", now(), len(live), root["id"]))
    log.info("médiathèque : %d fichiers vus, %d ajoutés ou modifiés, %d disparus", seen, added, gone)
    return {"seen": seen, "added": added, "gone": gone}


# ---------------------------------------------------------------- fiches et publication

def _subs(path):
    """Sous-titres déposés à côté du fichier."""
    stem = os.path.splitext(path)[0]
    out = []
    try:
        for fn in os.listdir(os.path.dirname(path)):
            full = os.path.join(os.path.dirname(path), fn)
            if full.startswith(stem) and os.path.splitext(fn)[1].lower() in SUB_EXTS:
                out.append(full)
    except OSError:
        pass
    return sorted(out)


def _movie_info(f, data, nfo, tmdb, poster, back):
    """Fiche au format attendu par le reste du serveur (celui du fournisseur)."""
    data = data or {}
    nfo = nfo or {}
    direct, cast = _people(data) if data else (nfo.get("director", ""), nfo.get("cast", ""))
    genres = ", ".join(g.get("name", "") for g in data.get("genres") or []) or ", ".join(nfo.get("genres") or [])
    date = data.get("release_date") or ""
    if not date:
        y = nfo.get("year") or f["year"]
        date = "%d-01-01" % y if y else ""
    secs = int(f["dur"] or 0) or (data.get("runtime") or nfo.get("runtime") or 0) * 60
    return {"info": {
        "plot": data.get("overview") or nfo.get("plot") or "",
        "genre": genres,
        "releasedate": date,
        "duration_secs": secs,
        "director": direct, "cast": cast,
        "cover_big": poster, "backdrop_path": [back] if back else [],
        "rating": data.get("vote_average") or nfo.get("rating") or "",
        "youtube_trailer": _trailer(data) if data else (nfo.get("trailer") or ""),
    }, "movie_data": {"name": f["title"], "stream_id": BASE + f["id"]}}


def _movie_data(db, f, tmdb, nfo):
    """Fiche TMDB d'un film : identifiant forcé, puis étiquette du nom, puis .nfo, puis recherche."""
    forced = db.execute("SELECT tmdb FROM media_match WHERE path=?", (f["path"],)).fetchone()
    tid = (forced["tmdb"] if forced else None) or f["tmdb"] or (nfo or {}).get("tmdb")
    if not tmdb.ready():
        return None, tid
    if tid:
        return tmdb.movie(tid), tid
    res = tmdb.search_movie(f["title"], f["year"])
    if not res:
        return None, None
    d = tmdb.movie(to_int(res[0].get("id")))
    return d, to_int(res[0].get("id"))


# ---------------------------------------------------------------- versions d'un même film

def tier(width, height):
    """Définition d'une vidéo : 2160, 1080, 720 ou 480. La largeur compte (un 1920 × 800 est un 1080p)."""
    w, h = to_int(width), to_int(height)
    if w >= 3200 or h >= 1700:
        return 2160
    if w >= 1700 or h >= 950:
        return 1080
    if w >= 1100 or h >= 650:
        return 720
    return 480 if (w or h) else 0


TIER_LABEL = {2160: "4K", 1080: "1080p", 720: "720p", 480: "SD", 0: ""}
_CODEC_LABEL = {"hevc": "HEVC", "h265": "HEVC", "h264": "H.264", "avc": "H.264", "av1": "AV1", "vp9": "VP9",
                "mpeg2video": "MPEG-2", "mpeg4": "MPEG-4"}
# l'édition suit l'année, à la façon de Plex et Jellyfin : « Film (2002) - Director's Cut ».
# Sans année devant, le tiret fait partie du titre (« Alien - Romulus (2024) »).
_VERSION_TAG = re.compile(r"\(\d{4}\)\s*-\s+([^-]{1,40})$")
# l'étiquette d'édition de Plex et Jellyfin : « Film (2002) {edition-Director's Cut} »
_EDITION_TAG = re.compile(r"\{\s*edition\s*[-_=: ]\s*([^{}]{1,60})\}", re.I)
# ce qui, entre parenthèses ou crochets, n'est pas une édition : année, identifiants, mentions techniques
_TECH_WORDS = re.compile(r"(?i)(?<![a-z0-9])(?:" + _JUNK + r"|fhd|hd|sd|10 ?bits?|8 ?bits?|vf|fr|en|eng|ita|subs?|vostf?)(?![a-z0-9])")
_ID_TAG = re.compile(r"(?i)^\s*(?:tmdb|imdb|tvdb|tt\d|id\b)")


def edition(path):
    """Le nom de l'édition lu dans le nom du fichier : « The Remus Cut », « Version 35 MM »…
    Accepte {edition-…}, « (année) - Édition », et ce qui est entre parenthèses ou crochets
    quand ce n'est ni l'année, ni un identifiant, ni une mention technique (1080p, MULTi…)."""
    base = os.path.splitext(os.path.basename(path or ""))[0]
    m = _EDITION_TAG.search(base)
    if m:
        return m.group(1).strip()
    m = _VERSION_TAG.search(_ANY_TAG.sub("", base).strip())
    if m and _TECH_WORDS.sub("", m.group(1)).strip(" -._"):
        return m.group(1).strip()
    found = []
    for t in re.findall(r"[(\[]([^()\[\]]{1,60})[)\]]", base):
        t = t.strip()
        if re.fullmatch(r"(?:19|20)\d{2}", t) or _ID_TAG.match(t):
            continue
        if not re.search(r"[^\W\d_]", _TECH_WORDS.sub(" ", t)):
            continue                                   # rien que du technique
        found.append(t)
    return " · ".join(found)


def duration_label(sec):
    """« 2 h 14 », « 52 min »."""
    m = int(round((sec or 0) / 60))
    if m <= 0:
        return ""
    return "%d h %02d" % (m // 60, m % 60) if m >= 60 else "%d min" % m


def _field(f, k):
    try:
        return f[k]
    except (KeyError, IndexError):
        return None


def version_label(f, dur=True):
    """« 4K · HEVC · 2 h 14 », « 1080p · H.264 · The Remus Cut · 2 h 18 »…
    Le nom donné à la main (vlabel) remplace l'édition lue dans le nom du fichier."""
    bits = [TIER_LABEL.get(tier(f["width"], f["height"]), "")]
    bits.append(_CODEC_LABEL.get((f["vcodec"] or "").lower(), (f["vcodec"] or "").upper()))
    bits.append((_field(f, "vlabel") or "").strip() or edition(f["path"]))
    if dur:
        bits.append(duration_label(_field(f, "dur")))
    return " · ".join(b for b in bits if b) or os.path.basename(f["path"])


def set_label(db, file_id, label):
    with db:
        db.execute("UPDATE media_file SET vlabel=? WHERE id=? AND kind='movie'", ((label or "").strip()[:60] or None, file_id))


def _vkey(f):
    """Ordre des versions : lisibles d'abord, puis la plus haute définition, puis la plus lourde."""
    return (-(1 if f["playable"] else 0), -tier(f["width"], f["height"]), -(f["size"] or 0), f["id"])


def versions(db, vod_id):
    """Fichiers d'un film local, du meilleur au moins bon."""
    fid = vod_id - BASE
    rows = [dict(r) for r in db.execute("SELECT * FROM media_file WHERE kind='movie' AND (id=? OR grp=?)", (fid, fid))]
    return sorted(rows, key=_vkey)


def preferred(db, vod_id):
    r = db.execute("SELECT file FROM media_pref WHERE vod=?", (vod_id,)).fetchone()
    return r["file"] if r else 0


def set_preferred(db, vod_id, file_id):
    with db:
        if file_id:
            db.execute("INSERT OR REPLACE INTO media_pref VALUES (?, ?)", (vod_id, file_id))
        else:
            db.execute("DELETE FROM media_pref WHERE vod=?", (vod_id,))


def pick_version(vers, maxh=0, pref=0, skip=()):
    """La version qui démarre : celle choisie à la main, sinon la meilleure lisible sous la limite."""
    vers = [v for v in vers if v["id"] not in skip]
    if not vers:
        return None
    for v in vers:
        if pref and v["id"] == pref:
            return v
    ok = [v for v in vers if v["playable"]]
    under = [v for v in ok if not maxh or tier(v["width"], v["height"]) <= maxh]
    if under:
        return under[0]
    if ok:                                       # la limite est trop basse : la plus petite lisible
        return min(ok, key=lambda v: (tier(v["width"], v["height"]), v["size"] or 0))
    return vers[0]


def _move_user_data(db, old, new):
    """Reprise, Bibliothèque, « plus tard », fiche corrigée : suivent le film quand son représentant change."""
    for table, kind in (("progress", "movie"), ("watchlist", "movie"), ("lib_item", "movie"), ("item_override", "vod")):
        db.execute(f"UPDATE OR IGNORE {table} SET id=? WHERE kind=? AND id=?", (new, kind, old))
        db.execute(f"DELETE FROM {table} WHERE kind=? AND id=?", (kind, old))
    db.execute("UPDATE OR IGNORE media_pref SET vod=? WHERE vod=?", (new, old))
    db.execute("DELETE FROM media_pref WHERE vod=?", (old,))


def group_movies(db):
    """Regroupe les versions d'un même film : même identifiant TMDB, ou même titre et année dans le même dossier.
    Une seule fiche par film, au nom du représentant. Retourne les représentants qui n'ont pas encore de fiche."""
    rows = [dict(r) for r in db.execute("SELECT id, tmdb, title, year, grp, path FROM media_file "
                                        "WHERE kind='movie' ORDER BY id")]
    # deux liens possibles : le même identifiant TMDB, ou le même titre et la même année dans le même dossier
    # (« Dune (2021).mkv », « Dune (2021) - 4K.mkv »). Jamais deux identifiants TMDB différents ensemble :
    # c'est ainsi qu'une « Corriger la fiche » sépare deux fichiers.
    parent = {r["id"]: r["id"] for r in rows}
    tm = {r["id"]: r["tmdb"] or None for r in rows}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb or (tm[ra] and tm[rb] and tm[ra] != tm[rb]):
            return
        parent[rb] = ra
        tm[ra] = tm[ra] or tm[rb]

    by_tmdb, by_name = {}, {}
    for r in rows:
        if r["tmdb"]:
            by_tmdb.setdefault(r["tmdb"], []).append(r["id"])
        by_name.setdefault((os.path.dirname(r["path"]), norm(r["title"] or ""), r["year"] or 0), []).append(r["id"])
    for ids in list(by_tmdb.values()) + list(by_name.values()):
        for other in ids[1:]:
            union(ids[0], other)
    groups = {}
    for r in rows:
        groups.setdefault(find(r["id"]), []).append(r)
    canon_of, olds = {}, {}
    for members in groups.values():
        ids = [m["id"] for m in members]
        prev = [m["grp"] for m in members if m["grp"] in ids]
        if prev:
            # le représentant le plus partagé ; à égalité, celui qui a déjà sa fiche au catalogue, puis le plus ancien
            has = {g: bool(db.execute("SELECT 1 FROM vod WHERE id=?", (BASE + g,)).fetchone()) for g in set(prev)}
            canon = max(set(prev), key=lambda g: (prev.count(g), has[g], -g))
        else:
            canon = min(ids)
        for m in members:
            canon_of[m["id"]] = canon
            if m["grp"]:
                olds.setdefault(canon, set()).add(m["grp"])
            olds.setdefault(canon, set()).add(m["id"])
    canons = set(canon_of.values())
    missing = []
    with db:
        for fid, canon in canon_of.items():
            db.execute("UPDATE media_file SET grp=? WHERE id=? AND (grp IS NULL OR grp<>?)", (canon, fid, canon))
        for canon, prevs in olds.items():
            for old in prevs:
                if old == canon or old in canons:
                    continue                         # l'ancien représentant est devenu celui d'un autre film
                _move_user_data(db, BASE + old, BASE + canon)
                db.execute("DELETE FROM vod WHERE id=?", (BASE + old,))
                db.execute("DELETE FROM info_cache WHERE kind='vod' AND id=?", (BASE + old,))
        for canon in canons:
            if not db.execute("SELECT 1 FROM vod WHERE id=?", (BASE + canon,)).fetchone():
                missing.append(canon)
    return missing


def settle_movies(db, tmdb, force=False):
    """Fiches des films, versions regroupées : regrouper, publier les représentants, regrouper encore
    (un fichier non balisé ne connaît son identifiant TMDB qu'après publication)."""
    group_movies(db)
    done, miss = publish_movies(db, tmdb, force)
    again = group_movies(db)
    if again:
        d2, m2 = publish_movies(db, tmdb, False, only=again)
        done, miss = done + d2, miss + m2
    return done, miss


def publish_movies(db, tmdb, force=False, only=None):
    """Associe chaque film à une fiche et l'ajoute au catalogue (un seul fichier par film : le représentant)."""
    done = miss = 0
    if only is not None:
        rows = db.execute("SELECT * FROM media_file WHERE kind='movie' AND id IN (%s)" % ",".join("?" * len(only)),
                          list(only)) if only else []
    else:
        rows = db.execute("SELECT * FROM media_file WHERE kind='movie' AND (grp IS NULL OR grp=id)"
                          + ("" if force else " AND (matched IS NULL OR matched=0 OR id + ? NOT IN (SELECT id FROM vod))"),
                          () if force else (BASE,))
    for f in [dict(r) for r in rows]:
        nfo = read_nfo(f["path"])
        data, tid = None, None
        try:
            data, tid = _movie_data(db, f, tmdb, nfo)
        except TmdbError as e:
            log.warning("TMDB (%s) : %s", f["title"], e)
            tid = f["tmdb"] or (nfo or {}).get("tmdb")
        poster, back = local_art(f["path"], "movie")
        if not poster and data:
            poster = tmdb.poster(data.get("poster_path"))
        if not back and data:
            back = tmdb.poster(data.get("backdrop_path"))
        name = (data or {}).get("title") or (nfo or {}).get("title") or f["title"]
        year = ((data or {}).get("release_date") or "")[:4] or str((nfo or {}).get("year") or f["year"] or "")
        label = "%s (%s)" % (name, year) if year and year != "0" else name
        rating = (data or {}).get("vote_average") or (nfo or {}).get("rating") or 0
        with db:
            db.execute("INSERT OR REPLACE INTO vod(id, name, norm, poster, cat, rating, added, ext, orig_name,"
                       " orig_poster) VALUES (?,?,?,?,?,?,?,?,?,?)",
                       (BASE + f["id"], label, norm(label), poster or "", "local", rating, f["mtime"] or now(),
                        os.path.splitext(f["path"])[1].lstrip(".").lower() or "mkv", label, poster or ""))
            db.execute("INSERT OR REPLACE INTO info_cache VALUES ('vod', ?, ?, ?)",
                       (BASE + f["id"],
                        json.dumps(_movie_info(f, data, nfo, tmdb, poster, back), ensure_ascii=False), now()))
            db.execute("UPDATE media_file SET matched=?, tmdb=? WHERE id=?",
                       (1 if (data or nfo) else 0, tid or f["tmdb"], f["id"]))
        done += 1
        if not (data or nfo):
            miss += 1
    return done, miss


def publish_shows(db, tmdb, force=False):
    """Même chose pour les séries : une fiche par série, les épisodes depuis les fichiers."""
    done = miss = 0
    for show in [dict(r) for r in db.execute("SELECT * FROM media_show")]:
        files = [dict(r) for r in db.execute(
            "SELECT * FROM media_file WHERE show=? ORDER BY season, episode", (show["id"],))]
        if not files:
            continue
        if show["matched"] and not force and not show["tmdb"]:
            if db.execute("SELECT 1 FROM info_cache WHERE kind='series' AND id=?",
                          (BASE + show["id"],)).fetchone():
                done += 1
                continue
        folder = show["folder"] or os.path.dirname(os.path.dirname(files[0]["path"]))
        nfo = read_nfo(os.path.join(folder, "tvshow")) or None
        tid = show["tmdb"] or (nfo or {}).get("tmdb")
        data = None
        try:
            if tmdb.ready() and tid:
                data = tmdb.tv(tid)
            elif tmdb.ready():
                res = tmdb.search_tv(show["name"], show["year"])
                if res:
                    tid = to_int(res[0].get("id"))
                    data = tmdb.tv(tid)
        except TmdbError as e:
            log.warning("TMDB (%s) : %s", show["name"], e)
        name = (data or {}).get("name") or (nfo or {}).get("title") or show["name"]
        poster, back = show_art(folder)
        if not poster and data:
            poster = tmdb.poster(data.get("poster_path"))
        if not back and data:
            back = tmdb.poster(data.get("backdrop_path"))
        direct, cast = _people(data) if data else ((nfo or {}).get("director", ""), (nfo or {}).get("cast", ""))
        genres = (", ".join(g.get("name", "") for g in (data or {}).get("genres") or [])
                  or ", ".join((nfo or {}).get("genres") or []))
        plot = (data or {}).get("overview") or (nfo or {}).get("plot") or ""
        # résumés d'épisodes : une requête par saison présente sur le disque
        seasons_meta = {}
        if data and tid:
            for n in sorted({f["season"] for f in files if f["season"] is not None}):
                try:
                    sd = tmdb.season(tid, n)
                    seasons_meta[n] = {to_int(e.get("episode_number")): e for e in (sd.get("episodes") or [])}
                except TmdbError:
                    seasons_meta[n] = {}
        episodes = {}
        for f in files:
            meta = seasons_meta.get(f["season"], {}).get(f["episode"]) or {}
            enfo = read_nfo(f["path"]) or {}
            _, thumb = local_art(f["path"], "episode")
            if not thumb and meta.get("still_path"):
                thumb = tmdb.poster(meta["still_path"])
            episodes.setdefault(str(f["season"]), []).append({
                "id": BASE + f["id"],
                "season": f["season"],
                "episode_num": f["episode"],
                "title": meta.get("name") or enfo.get("title") or f["eptitle"] or ("Épisode %s" % f["episode"]),
                "container_extension": os.path.splitext(f["path"])[1].lstrip(".").lower() or "mkv",
                "info": {"plot": meta.get("overview") or enfo.get("plot") or "",
                         "duration_secs": int(f["dur"] or 0),
                         "movie_image": thumb or ""},
            })
        payload = {"info": {"name": name, "plot": plot, "genre": genres,
                            "cover": poster or "", "backdrop_path": [back] if back else [],
                            "director": direct, "cast": cast,
                            "rating": (data or {}).get("vote_average") or (nfo or {}).get("rating") or "",
                            "youtube_trailer": _trailer(data) if data else ((nfo or {}).get("trailer") or "")},
                   "episodes": episodes}
        with db:
            db.execute("INSERT OR REPLACE INTO series(id, name, norm, poster, backdrop, cat, plot, genre, rating,"
                       " updated, orig_name, orig_poster, orig_backdrop, orig_plot)"
                       " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (BASE + show["id"], name, norm(name), poster or "", back or "", "local", plot, genres,
                        (data or {}).get("vote_average") or (nfo or {}).get("rating") or 0, now(), name,
                        poster or "", back or "", plot))
            db.execute("INSERT OR REPLACE INTO info_cache VALUES ('series', ?, ?, ?)",
                       (BASE + show["id"], json.dumps(payload, ensure_ascii=False), now()))
            db.execute("UPDATE media_show SET matched=?, tmdb=? WHERE id=?",
                       (1 if (data or nfo or poster) else 0, tid or show["tmdb"], show["id"]))
            db.executemany("UPDATE media_file SET matched=1 WHERE id=?", [(f["id"],) for f in files])
        done += 1
        if not (data or nfo):
            miss += 1
    return done, miss


def ensure_categories(db):
    """Les deux bouquets de la médiathèque, créés une fois pour toutes."""
    with db:
        for kind, label in (("vod", "Mes films"), ("series", "Mes séries")):
            db.execute("INSERT OR IGNORE INTO categories(kind, id, name, pos, hidden, orig_name)"
                       " VALUES (?, 'local', ?, -1, 0, ?)", (kind, label, label))


def allow_tmdb_images(db, cfg=None):
    """Autorise le cache d'images à charger les affiches TMDB."""
    want = {TMDB_HOST}
    custom = ((cfg or {}).get("medias") or {}).get("tmdb_img")
    if custom:
        h = urllib.parse.urlsplit(custom).hostname
        if h:
            want.add(h)
    row = db.execute("SELECT v FROM meta WHERE k='image_hosts'").fetchone()
    hosts = set(json.loads(row["v"])) if row else set()
    if want - hosts:
        with db:
            db.execute("INSERT OR REPLACE INTO meta VALUES ('image_hosts', ?)",
                       (json.dumps(sorted(hosts | want)),))


def publish_paths(db):
    """Liste des dossiers autorisés pour les images locales."""
    paths = [r["path"] for r in db.execute("SELECT path FROM media_root")]
    with db:
        db.execute("INSERT OR REPLACE INTO meta VALUES ('media_paths', ?)", (json.dumps(paths),))


def refresh(db, cfg, force=False):
    """Analyse complète : fichiers, fiches, publication."""
    ensure_categories(db)
    allow_tmdb_images(db, cfg)
    publish_paths(db)
    tmdb = Tmdb(cfg)
    stats = scan(db, cfg)
    m_done, m_miss = settle_movies(db, tmdb, force)
    s_done, s_miss = publish_shows(db, tmdb, force)
    stats.update({"films": m_done, "films_sans_fiche": m_miss,
                  "series": s_done, "series_sans_fiche": s_miss,
                  "tmdb": tmdb.ready(), "ffprobe": have_probe()})
    with db:
        db.execute("INSERT OR REPLACE INTO meta VALUES ('medias_last', ?)", (json.dumps(stats),))
    # les fiches corrigées à la main reprennent le dessus sur ce qui vient d'être publié
    from . import custom
    custom.apply(db)
    log.info("médiathèque : %s films et %s séries publiés", m_done, s_done)
    return stats


def file_for(db, kind, item_id):
    """Fichier correspondant à un identifiant local, ou None."""
    if item_id < BASE:
        return None
    row = db.execute("SELECT * FROM media_file WHERE id=?", (item_id - BASE,)).fetchone()
    return dict(row) if row else None
