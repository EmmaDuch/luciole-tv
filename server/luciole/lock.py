"""Code parental : des bouquets (catégories du fournisseur ou bouquets personnels) fermés par un code.

Un bouquet verrouillé reste visible avec un cadenas, mais ses titres n'apparaissent nulle part
(listes, recherche, accueil, reprise, favoris) et ne se lisent pas tant que le téléviseur
n'a pas envoyé un jeton d'ouverture, obtenu en tapant le code.

C'est un contrôle parental, pas une protection forte : il empêche un enfant d'y arriver avec la
télécommande. La page des réglages (en-tête X-Luciole-Admin) voit tout, pour pouvoir tout régler.
"""
import hashlib
import hmac
import os
import secrets
import threading
import time

ITER = 120_000
_tokens = set()           # jetons d'ouverture : en mémoire, perdus au redémarrage du serveur
_state = threading.local()


# ---------- état de la requête en cours ----------
def begin(open_):
    """Appelé au début de chaque requête : True si les bouquets verrouillés sont ouverts."""
    _state.open = bool(open_)


def is_open():
    return getattr(_state, "open", True)


def token_ok(token):
    return bool(token) and token in _tokens


# ---------- le code ----------
def _hash(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, ITER).hex()


def has_pin(db):
    r = db.execute("SELECT v FROM meta WHERE k='lock_pin'").fetchone()
    return bool(r and r["v"])


def valid_pin(pin):
    return isinstance(pin, str) and pin.isdigit() and 4 <= len(pin) <= 8


def set_pin(db, pin):
    """Enregistre un nouveau code (4 à 8 chiffres). None ou "" retire le code et tous les verrous."""
    with db:
        if not pin:
            db.execute("DELETE FROM meta WHERE k='lock_pin'")
            db.execute("DELETE FROM locked")
            _tokens.clear()
            return
        salt = os.urandom(16)
        db.execute("INSERT OR REPLACE INTO meta(k, v) VALUES('lock_pin', ?)", (salt.hex() + "$" + _hash(pin, salt),))
    _tokens.clear()        # un nouveau code referme tous les téléviseurs


def check_pin(db, pin):
    r = db.execute("SELECT v FROM meta WHERE k='lock_pin'").fetchone()
    if not r or not r["v"] or not isinstance(pin, str):
        return False
    salt, digest = r["v"].split("$", 1)
    ok = hmac.compare_digest(_hash(pin, bytes.fromhex(salt)), digest)
    if not ok:
        time.sleep(1)      # essayer les 10 000 codes à la suite prendrait des heures
    return ok


def unlock(db, pin):
    """Le bon code donne un jeton d'ouverture, à renvoyer dans l'en-tête X-Luciole-Unlock."""
    if not check_pin(db, pin):
        return None
    tok = secrets.token_urlsafe(24)
    _tokens.add(tok)
    return tok


def forget(token):
    _tokens.discard(token)


# ---------- ce qui est verrouillé ----------
def bouquet_ref(bid):
    return "b%d" % int(bid)


def refs(db, kind):
    return {r["ref"] for r in db.execute("SELECT ref FROM locked WHERE kind=?", (kind,))}


def set_locked(db, kind, ref, on):
    with db:
        if on:
            db.execute("INSERT OR IGNORE INTO locked(kind, ref) VALUES(?, ?)", (kind, str(ref)))
        else:
            db.execute("DELETE FROM locked WHERE kind=? AND ref=?", (kind, str(ref)))


def sql(kind, column="cat"):
    """Fragment SQL : rien de ce qui est verrouillé, sauf si le téléviseur a ouvert les verrous.
    column est la colonne de la catégorie (« cat », « l.cat ») ; l'identifiant se trouve à côté (« id », « l.id »)."""
    if is_open():
        return "1"
    assert kind in ("live", "vod", "series")
    idcol = column[:-3] + "id"
    return (f"({column} NOT IN (SELECT ref FROM locked WHERE kind='{kind}') AND "
            f"{idcol} NOT IN (SELECT i.chan FROM bouquet_items i JOIN locked k "
            f"ON k.kind='{kind}' AND k.ref = 'b' || i.bouquet))")


def blocked(db, kind, item_id, cat=None):
    """Un titre précis est-il fermé pour cette requête ?"""
    if is_open() or not item_id:
        return False
    table = {"live": "live", "vod": "vod", "series": "series"}[kind]
    if cat is None:
        r = db.execute(f"SELECT cat FROM {table} WHERE id=?", (item_id,)).fetchone()
        cat = r["cat"] if r else None
    if cat is not None and db.execute("SELECT 1 FROM locked WHERE kind=? AND ref=?", (kind, str(cat))).fetchone():
        return True
    return bool(db.execute("SELECT 1 FROM bouquet_items i JOIN locked k ON k.kind=? AND k.ref = 'b' || i.bouquet "
                           "WHERE i.chan=? LIMIT 1", (kind, item_id)).fetchone())


def bouquet_closed(db, kind, bid):
    if is_open():
        return False
    return bool(db.execute("SELECT 1 FROM locked WHERE kind=? AND ref=?", (kind, bouquet_ref(bid))).fetchone())
