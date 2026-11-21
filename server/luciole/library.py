"""Bibliothèque : la sélection personnelle de films et de séries, rangée dans vos catégories.

Le catalogue complet des fournisseurs reste dans Films et Séries. La Bibliothèque ne garde
que ce que vous y ajoutez, dans des catégories que vous créez (action, SF, comédie…).

À l'ajout, la catégorie est devinée à partir du genre : celui de TMDB si une clé est
configurée, sinon celui que donne le fournisseur. La catégorie correspondante est créée au
besoin, sous le nom du genre traduit dans la langue de l'interface. Vous pouvez ensuite
renommer les catégories, les réordonner, et déplacer chaque titre.
"""
import json
import re

from . import lock
from .common import norm, now

# Genres TMDB (films et séries) : identifiant -> (français, anglais)
GENRES = {
    28: ("Action", "Action"), 12: ("Aventure", "Adventure"), 16: ("Animation", "Animation"),
    35: ("Comédie", "Comedy"), 80: ("Policier", "Crime"), 99: ("Documentaire", "Documentary"),
    18: ("Drame", "Drama"), 10751: ("Famille", "Family"), 14: ("Fantastique", "Fantasy"),
    36: ("Histoire", "History"), 27: ("Horreur", "Horror"), 10402: ("Musique", "Music"),
    9648: ("Mystère", "Mystery"), 10749: ("Romance", "Romance"), 878: ("Science-fiction", "Science fiction"),
    10770: ("Téléfilm", "TV movie"), 53: ("Thriller", "Thriller"), 10752: ("Guerre", "War"),
    37: ("Western", "Western"), 10763: ("Actualités", "News"), 10764: ("Téléréalité", "Reality"),
    10766: ("Feuilleton", "Soap"), 10767: ("Talk-show", "Talk show"),
}
# genres propres aux séries, ramenés aux catégories des films pour ne pas tout dédoubler
TV_ALIAS = {10759: 28, 10762: 10751, 10765: 878, 10768: 10752}
OTHER = ("Divers", "Other")

# noms de genres tels que les écrivent les fournisseurs (français, anglais, quelques variantes)
_NAMES = {}
for _gid, (_fr, _en) in GENRES.items():
    for _n in (_fr, _en):
        _NAMES[norm(_n)] = _gid
_NAMES.update({norm(k): v for k, v in {
    "sci-fi": 878, "science fiction": 878, "sf": 878, "scifi": 878, "science-fiction": 878,
    "crime": 80, "criminel": 80, "polar": 80, "comedie": 35, "comedies": 35, "humour": 35,
    "aventures": 12, "animations": 16, "dessin anime": 16, "jeunesse": 10751, "familial": 10751, "kids": 10751,
    "enfants": 10751, "horreur": 27, "epouvante": 27, "epouvante-horreur": 27, "historique": 36,
    "guerre": 10752, "war": 10752, "action & adventure": 28, "action et aventure": 28,
    "sci-fi & fantasy": 878, "science-fiction et fantastique": 878, "war & politics": 10752,
    "guerre et politique": 10752, "musical": 10402, "biopic": 36, "biographie": 36, "documentaires": 99,
    "thrillers": 53, "suspense": 53, "romantique": 10749, "drames": 18, "telefilm": 10770, "fantasy": 14,
    "mystere": 9648, "policier": 80, "western": 37, "reality": 10764, "news": 10763,
}.items()})
# un genre très large ne l'emporte que s'il est seul
_BROAD = {18, 10770}

KINDS = ("movie", "series")
_TABLE = {"movie": "vod", "series": "series"}


def check_kind(kind):
    if kind not in KINDS:
        raise ValueError("kind doit valoir movie ou series")
    return kind


def genre_label(gid, lang="fr"):
    fr, en = GENRES.get(gid, OTHER)
    return en if lang == "en" else fr


def pick_genre(ids):
    """Le genre le plus parlant d'une liste d'identifiants TMDB (dans l'ordre de TMDB)."""
    ids = [TV_ALIAS.get(int(i), int(i)) for i in ids if str(i).lstrip("-").isdigit()]
    ids = [i for i in ids if i in GENRES]
    precise = [i for i in ids if i not in _BROAD]
    return (precise or ids or [None])[0]


def genres_from_text(text):
    """« Action, Aventure / Science-Fiction » -> [28, 12, 878] ; les inconnus sont ignorés."""
    out = []
    for part in re.split(r"[,/;|]| - ", text or ""):
        g = _NAMES.get(norm(part).strip())
        if g and g not in out:
            out.append(g)
    if not out:                                   # « Action & Aventure » écrit autrement
        whole = norm(text or "")
        for name, g in _NAMES.items():
            if len(name) > 3 and name in whole and g not in out:
                out.append(g)
    return out


_YEAR = re.compile(r"\s*[\(\[]((?:19|20)\d\d)[\)\]]\s*$")


def clean_title(name):
    """Titre du fournisseur sans préfixe de langue ni année, pour interroger TMDB."""
    t = re.sub(r"^\s*(?:\|?\s*[A-Z]{2,3}\s*[|:\-]\s*)", "", name or "")
    m = _YEAR.search(t)
    year = int(m.group(1)) if m else None
    t = _YEAR.sub("", t)
    t = re.sub(r"\s*\b(?:4K|UHD|FHD|HD|SD|MULTI|VOSTFR|VF|VO)\b\s*", " ", t, flags=re.I)
    return re.sub(r"\s{2,}", " ", t).strip(), year


# un « I » ou un « O » se glisse parfois à la place d'un chiffre (« S02E0I »)
_EPCODE = re.compile(r"(?i)\bS[\dO]{1,2}\s*E(?=[\dIO]*\d|[\dIO]*I)[\dIO]{1,3}\b|\b\d{1,2}x\d{2,3}\b")


def episode_title(raw):
    """Titre d'épisode du fournisseur, sans « |FR| Série (MULTi) S02E01 - » devant :
    il ne reste que le vrai titre (« Wanna Be Your Dog »), ou rien s'il n'y en a pas."""
    t = (raw or "").strip()
    m = None
    for m in _EPCODE.finditer(t):
        pass
    if m:
        t = t[m.end():]
        t = re.sub(r"^[\s\-–—:·|.]+", "", t)
    return re.sub(r"\s{2,}", " ", t).strip()


# ---------------------------------------------------------------- catégories

def categories(db, kind=None):
    """Catégories dans l'ordre choisi, avec le nombre de titres (de cette sorte, si précisée)."""
    where = "WHERE i.kind = ?" if kind else ""
    args = (kind,) if kind else ()
    counts = {r["cat"]: r["n"] for r in db.execute(
        f"SELECT i.cat, COUNT(*) AS n FROM lib_item i {where} GROUP BY i.cat", args)}
    return [{"id": r["id"], "name": r["name"], "genre": r["genre"], "count": counts.get(r["id"], 0)}
            for r in db.execute("SELECT * FROM lib_cat ORDER BY pos, id")]


def create_category(db, name, genre=None):
    name = (name or "").strip()
    if not name:
        raise ValueError("le nom ne peut pas être vide")
    with db:
        pos = db.execute("SELECT COALESCE(MAX(pos), 0) + 1 FROM lib_cat").fetchone()[0]
        cur = db.execute("INSERT INTO lib_cat(name, pos, genre) VALUES (?,?,?)", (name, pos, genre))
    return cur.lastrowid


def rename_category(db, cat_id, name):
    name = (name or "").strip()
    if not name:
        raise ValueError("le nom ne peut pas être vide")
    with db:
        db.execute("UPDATE lib_cat SET name=? WHERE id=?", (name, cat_id))


def move_category(db, cat_id, delta):
    rows = [r["id"] for r in db.execute("SELECT id FROM lib_cat ORDER BY pos, id")]
    if cat_id not in rows:
        return
    i = rows.index(cat_id)
    j = max(0, min(len(rows) - 1, i + int(delta)))
    rows.insert(j, rows.pop(i))
    with db:
        db.executemany("UPDATE lib_cat SET pos=? WHERE id=?", [(p, c) for p, c in enumerate(rows)])


def delete_category(db, cat_id, into=None):
    """Supprime une catégorie. Ses titres vont dans « into », ou quittent la Bibliothèque."""
    with db:
        if into:
            db.execute("UPDATE lib_item SET cat=? WHERE cat=?", (into, cat_id))
        else:
            db.execute("DELETE FROM lib_item WHERE cat=?", (cat_id,))
        db.execute("DELETE FROM lib_cat WHERE id=?", (cat_id,))


def _category_for(db, genre, lang):
    """Catégorie qui porte ce genre ; créée sous le nom du genre traduit si elle n'existe pas."""
    key = str(genre) if genre else "other"
    row = db.execute("SELECT id, name FROM lib_cat WHERE genre=? ORDER BY pos LIMIT 1", (key,)).fetchone()
    if row:
        return row["id"], row["name"], False
    label = genre_label(genre, lang)
    # une catégorie de ce nom existe déjà (créée à la main) : on la réutilise et on la relie au genre
    row = db.execute("SELECT id, name FROM lib_cat WHERE LOWER(name)=LOWER(?) LIMIT 1", (label,)).fetchone()
    if row:
        with db:
            db.execute("UPDATE lib_cat SET genre=? WHERE id=? AND genre IS NULL", (key, row["id"]))
        return row["id"], row["name"], False
    return create_category(db, label, key), label, True


# ---------------------------------------------------------------- titres

def entry(db, kind, item_id):
    r = db.execute("SELECT i.cat, c.name FROM lib_item i JOIN lib_cat c ON c.id = i.cat "
                   "WHERE i.kind=? AND i.id=?", (kind, item_id)).fetchone()
    return {"cat": r["cat"], "name": r["name"]} if r else None


def add(db, kind, item_id, genres, lang="fr", cat=None):
    """Ajoute un titre. genres : identifiants TMDB déjà trouvés (voir guess_genres)."""
    check_kind(kind)
    created = False
    if cat:
        row = db.execute("SELECT id, name FROM lib_cat WHERE id=?", (cat,)).fetchone()
        if not row:
            raise ValueError("catégorie inconnue")
        cat_id, name = row["id"], row["name"]
    else:
        cat_id, name, created = _category_for(db, pick_genre(genres), lang)
    with db:
        db.execute("INSERT INTO lib_item(kind, id, cat, added, genres) VALUES (?,?,?,?,?) "
                   "ON CONFLICT(kind, id) DO UPDATE SET cat=excluded.cat",
                   (kind, item_id, cat_id, now(), ",".join(str(g) for g in genres)))
    return {"cat": cat_id, "name": name, "created": created}


def move(db, kind, item_id, cat_id):
    if not db.execute("SELECT 1 FROM lib_cat WHERE id=?", (cat_id,)).fetchone():
        raise ValueError("catégorie inconnue")
    with db:
        db.execute("UPDATE lib_item SET cat=? WHERE kind=? AND id=?", (cat_id, kind, item_id))


def remove(db, kind, item_id):
    with db:
        db.execute("DELETE FROM lib_item WHERE kind=? AND id=?", (kind, item_id))


def items(db, cat=None, kind=None, sort="added"):
    """Titres de la Bibliothèque encore présents dans le catalogue (un titre retiré par le
    fournisseur réapparaît tout seul s'il revient)."""
    out = []
    for k in ([kind] if kind else KINDS):
        table = _TABLE[k]
        where, args = "i.kind = ?", [k]
        if cat:
            where += " AND i.cat = ?"
            args.append(cat)
        for r in db.execute(f"SELECT t.*, i.cat AS lib_cat, i.added AS lib_added FROM lib_item i "
                            f"JOIN {table} t ON t.id = i.id WHERE {where} AND {lock.sql(table, 't.cat')}", args):
            out.append((k, r))
    if sort == "name":
        out.sort(key=lambda x: x[1]["norm"] or "")
    elif sort == "year":
        # date de sortie, la plus récente d'abord ; puis l'ordre alphabétique
        years = _years(db, out)
        out.sort(key=lambda x: (-years.get((x[0], x[1]["id"]), 0), x[1]["norm"] or ""))
    else:
        out.sort(key=lambda x: -(x[1]["lib_added"] or 0))
    return out


_YEAR = re.compile(r"\((19\d\d|20\d\d)\)|\b(19[2-9]\d|20[0-4]\d)\b")


def _years(db, rows):
    """Année de sortie : dans le titre (« Titan (2018) »), sinon dans la fiche déjà téléchargée."""
    out = {}
    for k, r in rows:
        m = _YEAR.search(r["name"] or "")
        y = int(m.group(1) or m.group(2)) if m else 0
        if not y:
            c = db.execute("SELECT json FROM info_cache WHERE kind=? AND id=?", ("vod" if k == "movie" else "series", r["id"])).fetchone()
            if c:
                try:
                    d = json.loads(c["json"])
                    info = d.get("info") or d
                    txt = str(info.get("releasedate") or info.get("release_date") or info.get("releaseDate") or
                              info.get("year") or "")
                    y = int(txt[:4]) if txt[:4].isdigit() else 0
                except (ValueError, AttributeError):
                    y = 0
        out[(k, r["id"])] = y
    return out


def orphans(db):
    """Titres de la Bibliothèque que le catalogue n'a plus (le fournisseur les a retirés)."""
    n = 0
    for k, table in _TABLE.items():
        n += db.execute(f"SELECT COUNT(*) FROM lib_item i WHERE i.kind=? AND i.id NOT IN (SELECT id FROM {table})",
                        (k,)).fetchone()[0]
    return n


def search_text(row):
    return norm(row["name"] or "")
