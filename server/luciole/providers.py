"""Plusieurs abonnements IPTV (fournisseurs Xtream) dans une seule installation.

Chaque fournisseur déclaré dans config.toml ([[xtream]]) reçoit un numéro interne,
« src », gardé dans la table provider. Ce numéro ne change jamais tant que l'« id »
du fournisseur reste le même dans la configuration.

Les identifiants du fournisseur (chaînes, films, séries, épisodes) se télescopent
d'un abonnement à l'autre : la chaîne 120 de l'un n'est pas la chaîne 120 de l'autre.
Luciole leur donne donc un identifiant global :

    identifiant global = src × STRIDE + identifiant du fournisseur

Les catégories deviennent « src:id » et les clés du guide « p<src>:<clé> ».
Les fichiers de la médiathèque personnelle restent au-dessus de medias.BASE.
"""
import json
import re

from .common import norm, now
from .xtream import Xtream

STRIDE = 10 ** 10          # identifiants du fournisseur : jusqu'à dix chiffres

# couleurs des pastilles, lisibles sur fond sombre avec une lettre blanche
PALETTE = ["#2F6FD6", "#C2410C", "#7C3AED", "#0F8A5F", "#B42363", "#8A6A00", "#0E7490", "#6B7280"]


def gid(src, raw):
    return int(src) * STRIDE + int(raw)


def split(global_id):
    """Identifiant global -> (src, identifiant du fournisseur)."""
    return divmod(int(global_id), STRIDE)


def cat_id(src, raw):
    return "%d:%s" % (int(src), raw)


def epg_key(src, raw):
    return "p%d:%s" % (int(src), raw) if raw else ""


def id_range(src):
    """Bornes des identifiants globaux d'un fournisseur, pour les requêtes SQL."""
    return int(src) * STRIDE, (int(src) + 1) * STRIDE


def slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", norm(text or "")).strip("-")
    return s[:32]


def _letter(name, taken):
    """Première lettre libre du nom ; sinon la première lettre libre de l'alphabet."""
    for c in norm(name or "").upper():
        if c.isalnum() and c not in taken:
            return c
    for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        if c not in taken:
            return c
    return "?"


def _color(value):
    value = (value or "").strip()
    return value if re.fullmatch(r"#[0-9A-Fa-f]{6}", value) else ""


def register(db, cfg):
    """Range les fournisseurs de la configuration dans la base et leur attribue un numéro.

    Renvoie la liste ordonnée des fournisseurs (dictionnaires de la configuration
    complétés par src, letter, color)."""
    known = {r["slug"]: dict(r) for r in db.execute("SELECT * FROM provider")}
    out = []
    with db:
        for pos, p in enumerate(cfg["xtream"]):
            row = known.get(p["id"])
            if row is None:
                nxt = db.execute("SELECT COALESCE(MAX(src), 0) + 1 FROM provider").fetchone()[0]
                db.execute("INSERT INTO provider(src, slug, name, pos) VALUES (?,?,?,?)", (nxt, p["id"], p["nom"], pos))
                row = {"src": nxt, "letter_set": None, "color_set": None}
            else:
                db.execute("UPDATE provider SET name=?, pos=? WHERE src=?", (p["nom"], pos, row["src"]))
            out.append(dict(p, src=row["src"], letter_set=row.get("letter_set"), color_set=row.get("color_set")))
    # lettres et couleurs : celles choisies à la main d'abord, puis la configuration, puis automatiques
    taken = {(p["letter_set"] or "").upper() for p in out if p["letter_set"]}
    for i, p in enumerate(out):
        letter = (p["letter_set"] or p.get("lettre") or "").strip().upper()[:2]
        if not letter:
            letter = _letter(p["nom"], taken)
        taken.add(letter)
        p["letter"] = letter
        p["color"] = _color(p["color_set"]) or _color(p.get("couleur")) or PALETTE[i % len(PALETTE)]
    return out


def configured_srcs(db, cfg):
    return [p["src"] for p in register(db, cfg)]


def listing(db, cfg):
    """Fournisseurs pour l'appli et la page web : jamais d'identifiants ni de mots de passe."""
    counts = {}
    for table in ("live", "vod", "series"):
        for r in db.execute(f"SELECT src, COUNT(*) AS n FROM {table} WHERE src > 0 GROUP BY src"):
            counts.setdefault(r["src"], {})[table] = r["n"]
    rows = {r["src"]: r for r in db.execute("SELECT * FROM provider")}
    out = []
    for p in register(db, cfg):
        r = rows.get(p["src"])
        info = None
        if r is not None and r["info"]:
            try:
                info = json.loads(r["info"])
            except ValueError:
                info = None
        c = counts.get(p["src"], {})
        out.append({"src": p["src"], "id": p["id"], "name": p["nom"], "letter": p["letter"], "color": p["color"],
                    "letter_set": bool(p["letter_set"]), "color_set": bool(p["color_set"]),
                    "live": c.get("live", 0), "vod": c.get("vod", 0), "series": c.get("series", 0),
                    "last_sync": r["last_sync"] if r is not None else None,
                    "status": (r["status"] if r is not None else "") or "",
                    "account": account(info, r["info_at"] if r is not None else None)})
    return out


def account(info, fetched=None):
    """État de l'abonnement, tiré de user_info de l'API Xtream. Rien de secret n'en sort."""
    if not info:
        return None
    u = info.get("user_info") or {}

    def num(v):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return None
    exp = num(u.get("exp_date"))
    return {"status": str(u.get("status") or ""), "expires": exp or None,
            "days_left": max(0, (exp - now()) // 86400) if exp else None,
            "active_cons": num(u.get("active_cons")), "max_connections": num(u.get("max_connections")),
            "trial": str(u.get("is_trial") or "0") == "1", "created": num(u.get("created_at")),
            "fetched": fetched}


def save_info(db, src, info, status="ok"):
    """Garde la réponse de connexion, sans le nom d'utilisateur ni le mot de passe."""
    info = json.loads(json.dumps(info or {}))
    u = info.get("user_info") or {}
    for secret in ("username", "password"):
        u.pop(secret, None)
    s = info.get("server_info") or {}
    for secret in ("url", "port", "https_port", "server_protocol", "rtmp_port"):
        s.pop(secret, None)
    with db:
        db.execute("UPDATE provider SET info=?, info_at=?, tz=?, status=? WHERE src=?",
                   (json.dumps(info), now(), s.get("timezone") or "", status, src))


def set_status(db, src, status, synced=False):
    with db:
        if synced:
            db.execute("UPDATE provider SET status=?, last_sync=? WHERE src=?", (status, now(), src))
        else:
            db.execute("UPDATE provider SET status=? WHERE src=?", (status, src))


def customize(db, src, letter=None, color=None):
    """Lettre et couleur choisies sur la page web ; vide = valeur automatique."""
    with db:
        if letter is not None:
            letter = re.sub(r"[^0-9A-Za-z]", "", letter).upper()[:2] or None
            db.execute("UPDATE provider SET letter_set=? WHERE src=?", (letter, src))
        if color is not None:
            db.execute("UPDATE provider SET color_set=? WHERE src=?", (_color(color) or None, src))


def purge_absent(db, cfg, log=None):
    """Un fournisseur retiré de la configuration : ses chaînes, films et séries disparaissent.
    Son numéro est gardé : s'il revient avec le même id, favoris, historique et bouquets
    retrouvent leurs chaînes."""
    keep = set(configured_srcs(db, cfg))
    gone = [r["src"] for r in db.execute("SELECT src FROM provider WHERE COALESCE(status, '') != 'retiré'")
            if r["src"] not in keep]
    for src in gone:
        lo, hi = id_range(src)
        with db:
            for table in ("live", "vod", "series"):
                db.execute(f"DELETE FROM {table} WHERE src=?", (src,))
            db.execute("DELETE FROM categories WHERE src=?", (src,))
            db.execute("DELETE FROM epg WHERE src=?", (-src,))
            db.execute("DELETE FROM info_cache WHERE id >= ? AND id < ?", (lo, hi))
            db.execute("UPDATE provider SET status='retiré', info=NULL WHERE src=?", (src,))
        if log:
            log.info("fournisseur n°%d retiré de la configuration : ses données sont effacées", src)
    return gone


class Registry:
    """Un client Xtream par fournisseur, retrouvé à partir d'un identifiant global."""

    def __init__(self, cfg, db):
        self.cfg = cfg
        self.refresh(db)

    def refresh(self, db):
        self.items = register(db, self.cfg)
        self.by_src = {p["src"]: p for p in self.items}
        self.clients = {p["src"]: Xtream(p, self.cfg["sync"]["timeout"]) for p in self.items}
        self.tz = {r["src"]: r["tz"] or "" for r in db.execute("SELECT src, tz FROM provider")}

    def client(self, src):
        xt = self.clients.get(int(src))
        if xt is None:
            raise KeyError(src)
        return xt

    def resolve(self, global_id):
        """(client Xtream, identifiant du fournisseur, src) ; KeyError si inconnu."""
        src, raw = split(global_id)
        return self.client(src), raw, src
