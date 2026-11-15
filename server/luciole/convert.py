"""Conversion du son des fichiers de la médiathèque.

Le téléviseur ne lit pas certains sons (DTS, Dolby TrueHD…). On les convertit en AC3,
que le téléviseur lit et transmet à la barre de son. L'image, les sous-titres et les
chapitres sont recopiés tels quels : rien n'est réencodé côté vidéo.

Ne sert que si la configuration l'autorise ([medias] ecriture = true) : Luciole réécrit
alors les fichiers. Un fichier dont la vidéo n'est pas lisible se convertit en dehors
de Luciole (HandBrake, par exemple).

Déroulé pour chaque fichier, l'un après l'autre :
  1. copie convertie à côté de l'original, sous un nom caché (.luciole-conversion-…) ;
  2. vérification : même durée, même nombre de pistes son, plus aucun son illisible ;
  3. l'original est supprimé, ou rangé dans <dossier>/.luciole-originaux/ si on l'a demandé ;
  4. la copie prend le nom de l'original.
"""
import json
import logging
import os
import shutil
import subprocess
import threading

from . import medias
from .common import connect, now, to_int

log = logging.getLogger("luciole.convert")

KEEP_DIR = ".luciole-originaux"
TMP_PREFIX = ".luciole-conversion-"
_FFMPEG = None


def enabled(cfg):
    return bool((cfg.get("medias") or {}).get("ecriture"))


def have_ffmpeg():
    global _FFMPEG
    if _FFMPEG is None:
        try:
            subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
            _FFMPEG = True
        except Exception:
            _FFMPEG = False
    return _FFMPEG


def fixable(row):
    """Vrai si seul le son pose problème (la vidéo, elle, passe)."""
    v, a = (row["vcodec"] or "").lower(), (row["acodec"] or "").lower()
    return bool(a) and a not in medias.OK_AUDIO and (not v or v in medias.OK_VIDEO)


def writable(path):
    """Le dossier d'un fichier (ou un dossier) accepte-t-il l'écriture ?"""
    folder = path if os.path.isdir(path) else os.path.dirname(path)
    return os.access(folder, os.W_OK | os.X_OK)


def keep_original(db):
    r = db.execute("SELECT v FROM meta WHERE k='convert_keep'").fetchone()
    return bool(r and r["v"] == "1")


def set_keep_original(db, keep):
    with db:
        db.execute("INSERT OR REPLACE INTO meta VALUES ('convert_keep', ?)", ("1" if keep else "0",))


def _streams(path):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
                       capture_output=True, timeout=120)
    d = json.loads(r.stdout or b"{}")
    try:
        dur = float((d.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        dur = 0.0
    audio = [s for s in d.get("streams", []) if s.get("codec_type") == "audio"]
    return audio, dur


def command(src, dst, audio):
    """La commande ffmpeg : tout recopier, sauf les pistes son illisibles, converties en AC3."""
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
           "-map", "0", "-map", "-0:d", "-c", "copy", "-map_metadata", "0", "-map_chapters", "0"]
    for k, s in enumerate(audio):
        if (s.get("codec_name") or "").lower() in medias.OK_AUDIO:
            continue
        ch = to_int(s.get("channels"), 2)
        cmd += ["-c:a:%d" % k, "ac3", "-b:a:%d" % k, "640k" if ch > 2 else "256k"]
        if ch > 6:                                   # l'AC3 s'arrête au 5.1
            cmd += ["-ac:a:%d" % k, "6"]
    cmd += ["-progress", "pipe:1", "-nostats", dst]
    return cmd


class ConvertError(Exception):
    pass


class Converter:
    """File d'attente, traitée par un seul fil à la fois (le NAS n'aime pas les écritures en parallèle)."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.lock = threading.Lock()
        self.jobs = []                  # {id, title, state, pct, msg, at}
        self.thread = None
        self.proc = None
        self.stop = False

    # ---------- ce que voit la page web ----------
    def state(self):
        with self.lock:
            jobs = [dict(j) for j in self.jobs[-60:]]
        return {"jobs": jobs, "running": bool(self.thread and self.thread.is_alive()),
                "waiting": sum(1 for j in jobs if j["state"] == "attente")}

    def add(self, files):
        """files : lignes media_file. Retourne le nombre de fichiers ajoutés à la file."""
        added = 0
        with self.lock:
            busy = {j["id"] for j in self.jobs if j["state"] in ("attente", "en cours")}
            for f in files:
                if f["id"] in busy:
                    continue
                self.jobs.append({"id": f["id"], "title": f["title"] or os.path.basename(f["path"]),
                                  "state": "attente", "pct": 0, "msg": "", "at": now()})
                added += 1
            # on oublie les anciens résultats
            done = [j for j in self.jobs if j["state"] not in ("attente", "en cours")]
            if len(done) > 200:
                drop = {id(j) for j in done[:len(done) - 200]}
                self.jobs = [j for j in self.jobs if id(j) not in drop]
            self.stop = False
            if added and not (self.thread and self.thread.is_alive()):
                self.thread = threading.Thread(target=self._run, name="conversion", daemon=True)
                self.thread.start()
        return added

    def cancel(self):
        with self.lock:
            self.stop = True
            for j in self.jobs:
                if j["state"] == "attente":
                    j["state"], j["msg"] = "annulé", ""
            proc = self.proc
        if proc and proc.poll() is None:
            proc.kill()

    def forget(self):
        with self.lock:
            self.jobs = [j for j in self.jobs if j["state"] in ("attente", "en cours")]

    # ---------- le travail ----------
    def _next(self):
        with self.lock:
            for j in self.jobs:
                if j["state"] == "attente":
                    j["state"] = "en cours"
                    return j
        return None

    def _run(self):
        db = connect(self.cfg)
        try:
            while True:
                job = self._next()
                if not job:
                    return
                try:
                    job["msg"] = self._one(db, job) or ""
                    job["state"], job["pct"] = "fait", 100
                except ConvertError as e:
                    job["state"], job["msg"] = ("annulé", "") if self.stop else ("erreur", str(e))
                except Exception as e:                          # pragma: no cover
                    log.exception("conversion")
                    job["state"], job["msg"] = "erreur", "%s : %s" % (e.__class__.__name__, e)
                job["at"] = now()
                log.info("conversion %s : %s %s", job["title"], job["state"], job["msg"])
        finally:
            db.close()

    def _one(self, db, job):
        f = db.execute("SELECT f.*, r.path AS root_path FROM media_file f LEFT JOIN media_root r ON r.id = f.root "
                       "WHERE f.id=?", (job["id"],)).fetchone()
        if not f:
            raise ConvertError("fichier inconnu (retiré de la médiathèque ?)")
        src = f["path"]
        if not os.path.isfile(src):
            raise ConvertError("fichier introuvable : le NAS est-il allumé ?")
        if not writable(src):
            raise ConvertError("dossier en lecture seule pour Luciole")
        if not have_ffmpeg():
            raise ConvertError("ffmpeg n'est pas installé sur le serveur")
        audio, dur = _streams(src)
        bad = [s for s in audio if (s.get("codec_name") or "").lower() not in medias.OK_AUDIO]
        if not bad:
            self._refresh(db, f["id"], src)
            return "rien à convertir"
        size = os.path.getsize(src)
        free = shutil.disk_usage(os.path.dirname(src)).free
        if free < size * 1.05 + 200 * 1024 * 1024:
            raise ConvertError("pas assez de place libre à côté du fichier (%d Go nécessaires)"
                               % round(size / 1e9 + 1))
        tmp = os.path.join(os.path.dirname(src), TMP_PREFIX + os.path.basename(src))
        try:
            self._ffmpeg(command(src, tmp, audio), dur, job)
            if self.stop:
                raise ConvertError("annulé")
            # vérification avant de toucher à l'original
            out, odur = _streams(tmp)
            if len(out) != len(audio):
                raise ConvertError("vérification : il manque des pistes son")
            if any((s.get("codec_name") or "").lower() not in medias.OK_AUDIO for s in out):
                raise ConvertError("vérification : un son reste illisible")
            if dur and abs(odur - dur) > max(2.0, dur * 0.005):
                raise ConvertError("vérification : durée différente (%d s au lieu de %d s)" % (odur, dur))
            try:
                shutil.copymode(src, tmp)
            except OSError:
                pass
            kept = ""
            if keep_original(db):
                root = f["root_path"] or os.path.dirname(src)
                rel = os.path.relpath(src, root) if src.startswith(root.rstrip("/") + "/") else os.path.basename(src)
                dest = os.path.join(root, KEEP_DIR, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.move(src, dest)
                kept = dest
            try:
                os.replace(tmp, src)
            except OSError:
                if os.path.exists(src):
                    os.remove(src)
                os.rename(tmp, src)
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
        self._refresh(db, f["id"], src)
        names = ", ".join(sorted({(s.get("codec_name") or "?").lower() for s in bad}))
        return ("son %s converti en AC3" % names) + (" · original gardé" if kept else "")

    def _ffmpeg(self, cmd, dur, job):
        with self.lock:
            if self.stop:
                raise ConvertError("annulé")
            self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        proc = self.proc
        try:
            for line in proc.stdout:
                k, _, v = line.strip().partition("=")
                if k in ("out_time_us", "out_time_ms") and dur:
                    try:
                        job["pct"] = max(0, min(99, int(int(v) / 1e6 / dur * 100)))
                    except ValueError:
                        pass
            proc.wait()
            if proc.returncode != 0:
                err = (proc.stderr.read() or "").strip().splitlines()
                raise ConvertError("ffmpeg a échoué" + (" : " + err[-1][:200] if err else ""))
        finally:
            with self.lock:
                self.proc = None

    @staticmethod
    def _refresh(db, file_id, path):
        """Nouvelle lecture des pistes, pour que « illisible » disparaisse tout de suite."""
        p = medias.probe(path)
        st = os.stat(path)
        with db:
            db.execute("UPDATE media_file SET vcodec=?, acodec=?, width=?, height=?, dur=?, playable=?, note=?,"
                       " size=?, mtime=?, scanned=? WHERE id=?",
                       (p["vcodec"], p["acodec"], p["width"], p["height"], p["dur"], p["playable"], p["note"],
                        st.st_size, int(st.st_mtime), now(), file_id))
