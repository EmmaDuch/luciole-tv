"""Faux fournisseur Xtream, pour essayer Luciole et refaire les captures sans vrai abonnement.

    python3 mock_xtream.py --port 9101 --nom "Démo A" --graine 1
    python3 mock_xtream.py --port 9102 --nom "Démo B" --graine 2 --jours 3

Il sert : player_api.php (connexion, catégories, chaînes, films, séries, fiches,
guide complet), xmltv.php, des logos et des affiches plausibles fabriqués à la volée,
et une vraie vidéo de démonstration (fabriquée une fois avec ffmpeg) pour le direct,
les films, les épisodes et le replay, avec gestion des requêtes partielles.
Identifiants acceptés : demo / demo.
"""
import argparse
import hashlib
import io
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.parse
from xml.sax.saxutils import escape as esc
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

CHANNELS = [
    ("Info", ["Franceinfo", "BFM TV", "LCI", "Euronews", "CNews", "RTL Info"]),
    ("Généralistes", ["TF1", "France 2", "France 3", "M6", "Arte", "La Une", "Tipik", "RTL TVI", "C8", "W9"]),
    ("Sport", ["Eurosport 1", "Eurosport 2", "RMC Sport 1", "beIN Sports 1", "L'Équipe", "Canal+ Sport"]),
    ("Cinéma", ["Ciné+ Premier", "Ciné+ Frisson", "OCS Max", "TCM Cinéma", "Paramount Channel"]),
    ("Jeunesse", ["Gulli", "Canal J", "Disney Junior", "Boomerang", "Tiji"]),
    ("Découverte", ["National Geographic", "Discovery", "Ushuaïa TV", "Planète+", "Histoire TV", "Science & Vie"]),
]
MOVIE_CATS = ["Action", "Comédie", "Science-fiction", "Drame", "Animation", "Thriller"]
WORDS = ["Nuit", "Écho", "Horizon", "Dernier", "Rivière", "Ombre", "Lumière", "Voyage", "Secret", "Orage",
         "Cité", "Frontière", "Silence", "Matin", "Phare", "Désert", "Mémoire", "Signal", "Givre", "Ailes"]
SHOWS = ["Le Phare", "Station Orion", "Les Héritiers", "Brigade 9", "Terres Froides", "Code Rouge",
         "La Maison du Lac", "Après la Pluie"]
PROG = ["Journal", "Le Grand Débat", "Météo", "Documentaire : les volcans", "Magazine auto", "Série : Brigade 9",
        "Film : Horizon perdu", "Football : Ligue 1", "Tennis : Masters", "Dessins animés", "Jeu : Questions pour un soir",
        "Talk-show", "Reportage : la mer du Nord", "Cuisine du terroir", "Concert classique", "Les infos du soir"]
PALETTE = [(229, 57, 53), (30, 136, 229), (67, 160, 71), (251, 140, 0), (142, 36, 170), (0, 172, 193),
           (255, 202, 40), (216, 27, 96), (84, 110, 122), (124, 179, 66)]


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


class Catalog:
    def __init__(self, seed, name, days):
        self.rnd = random.Random(seed)
        self.name, self.days, self.seed = name, days, seed
        self.cats, self.live, self.vod, self.series = [], [], [], []
        base = 100 * seed
        sid = 1000 * seed
        for ci, (cat, names) in enumerate(CHANNELS):
            cid = str(base + ci + 1)
            self.cats.append({"category_id": cid, "category_name": "FR | " + cat, "parent_id": 0})
            for n in names:
                sid += 1
                self.live.append({"num": len(self.live) + 1, "name": "FR | " + n + (" HD" if self.rnd.random() < .5 else ""),
                                  "stream_type": "live", "stream_id": sid, "stream_icon": "/img/logo/%d.%s" % (
                                      sid, "jpg" if sid % 3 == 0 else "png"),
                                  "epg_channel_id": re.sub(r"[^a-z0-9]", "", n.lower()) + ".fr",
                                  "category_id": cid, "tv_archive": 1 if sid % 4 == 0 else 0,
                                  "tv_archive_duration": 7 if sid % 4 == 0 else 0, "added": "1700000000"})
        self.vcats = [{"category_id": str(base + 50 + i), "category_name": c, "parent_id": 0}
                      for i, c in enumerate(MOVIE_CATS)]
        vid = 5000 * seed
        for i in range(60):
            vid += 1
            title = "%s %s" % (self.rnd.choice(WORDS), self.rnd.choice(WORDS).lower())
            self.vod.append({"num": i + 1, "name": title + " (%d)" % self.rnd.randint(1985, 2026), "stream_id": vid,
                             "stream_icon": "/img/poster/m%d.jpg" % vid, "rating": round(self.rnd.uniform(5, 8.8), 1),
                             "added": str(int(time.time()) - i * 86400 * 2), "category_id": self.vcats[i % 6]["category_id"],
                             "container_extension": "mp4"})
        self.scats = [{"category_id": str(base + 80 + i), "category_name": c, "parent_id": 0}
                      for i, c in enumerate(["Policier", "Science-fiction", "Drame"])]
        serid = 7000 * seed
        for i, t in enumerate(SHOWS):
            serid += 1
            self.series.append({"num": i + 1, "name": t, "series_id": serid, "cover": "/img/poster/s%d.jpg" % serid,
                                "plot": "Une série de démonstration, pour essayer Luciole.", "genre": "Drame, Policier",
                                "rating": "7.%d" % i, "last_modified": str(int(time.time()) - i * 3600 * 20),
                                "backdrop_path": ["/img/backdrop/s%d.jpg" % serid], "category_id": self.scats[i % 3]["category_id"]})

    def programmes(self, ch, lo, hi):
        rnd = random.Random("%s-%s" % (self.seed, ch["stream_id"]))
        t = lo - lo % 1800 - 3600 * rnd.randint(0, 2)
        out = []
        while t < hi:
            d = rnd.choice((1800, 2700, 3600, 3600, 5400))
            out.append((t, t + d, rnd.choice(PROG)))
            t += d
        return out


def make_image(kind, ident, w, h):
    rnd = random.Random(ident)
    c = PALETTE[rnd.randrange(len(PALETTE))]
    if kind == "logo":
        dark_bg = ident.endswith("jpg")
        img = Image.new("RGB" if dark_bg else "RGBA", (w, h), (5, 5, 7) if dark_bg else (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        shape = rnd.randrange(3)
        if shape == 0:
            d.rounded_rectangle((w * .08, h * .22, w * .92, h * .78), radius=h * .12, fill=c)
            d.text((w / 2, h / 2), rnd.choice(["TV", "HD", "24", "+", "1", "INFO"]), fill="white", font=font(int(h * .3)), anchor="mm")
        elif shape == 1:
            d.ellipse((w * .3, h * .15, w * .7, h * .85), fill=c)
            d.text((w / 2, h / 2), str(rnd.randint(1, 9)), fill="white", font=font(int(h * .4)), anchor="mm")
        else:
            d.text((w / 2, h / 2), rnd.choice(["ZAP", "ÉTÉ", "NOVA", "ARC", "MAX"]), fill=c, font=font(int(h * .36)), anchor="mm")
        return img
    img = Image.new("RGB", (w, h), tuple(int(x * .35) for x in c))
    d = ImageDraw.Draw(img)
    for i in range(6):
        cc = tuple(min(255, int(x * rnd.uniform(.4, 1.1))) for x in c)
        r = rnd.uniform(.2, .7) * max(w, h)
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        d.ellipse((x - r, y - r, x + r, y + r), fill=cc)
    if kind == "poster":
        d.rectangle((0, h * .7, w, h), fill=(10, 12, 18))
        d.text((w * .06, h * .78), rnd.choice(WORDS).upper(), fill="white", font=font(int(w * .11)))
    return img


def demo_video(cache, ext="ts"):
    """Une vraie vidéo de 60 s, fabriquée une seule fois : un paysage animé (ciel, collines, lucioles),
    plus agréable qu'une mire sur les captures. En .ts pour le téléviseur, en .mp4 pour un navigateur."""
    path = os.path.join(cache, "demo." + ext)
    if not os.path.exists(path):
        os.makedirs(cache, exist_ok=True)
        scene = ("gradients=size=1280x720:c0=0x0b1030:c1=0x3a2a6a:x0=0:y0=0:x1=0:y1=720:speed=0.002,"
                 "drawbox=x=0:y=520:w=1280:h=200:color=0x101826:t=fill,"
                 "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='LUCIOLE':"
                 "fontcolor=0xB6F23A@0.9:fontsize=96:x=(w-tw)/2:y=260+20*sin(t)")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", scene + ",format=yuv420p",
                        "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000", "-t", "60", "-r", "25",
                        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-g", "50",
                        "-c:a", "aac", "-b:a", "96k"] + (["-f", "mpegts"] if ext == "ts" else ["-movflags", "+faststart"])
                       + [path], check=True)
    return path


def handler_for(cat, cache):
    video = demo_video(cache)
    video_mp4 = demo_video(cache, "mp4")

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def send(self, code, ctype, data, extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

        def json(self, obj):
            self.send(200, "application/json", json.dumps(obj).encode())

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            host = "http://%s" % self.headers.get("Host")
            if u.path == "/player_api.php":
                if q.get("username") != "demo" or q.get("password") != "demo":
                    return self.json({"user_info": {"auth": 0}})
                return self.api(q, host)
            if u.path == "/xmltv.php":
                return self.xmltv(host)
            m = re.match(r"^/img/(logo|poster|backdrop)/(\w+)\.(png|jpg)$", u.path)
            if m:
                kind, ident, ext = m.groups()
                size = {"logo": (300, 168) if ext == "jpg" else (256, 256), "poster": (400, 600), "backdrop": (1280, 720)}[kind]
                img = make_image(kind, ident + "." + ext, *size)
                buf = io.BytesIO()
                img.save(buf, "PNG" if ext == "png" else "JPEG", quality=88)
                return self.send(200, "image/png" if ext == "png" else "image/jpeg", buf.getvalue(),
                                 {"Cache-Control": "max-age=86400"})
            if u.path == "/demo.mp4":
                return self.stream(video_mp4, "video/mp4")
            if re.match(r"^/(live|movie|series|timeshift)/", u.path) or u.path == "/streaming/timeshift.php":
                return self.stream()
            self.send(404, "text/plain", b"inconnu")

        do_HEAD = do_GET

        def stream(self, path=None, ctype="video/mp2t"):
            path = path or video
            size = os.path.getsize(path)
            start, end = 0, size - 1
            rng = self.headers.get("Range")
            if rng:
                m = re.match(r"bytes=(\d*)-(\d*)", rng)
                if m and m.group(1):
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else end
            with open(path, "rb") as f:
                f.seek(start)
                data = f.read(end - start + 1)
            extra = {"Accept-Ranges": "bytes"}
            if rng:
                extra["Content-Range"] = "bytes %d-%d/%d" % (start, end, size)
            self.send(206 if rng else 200, ctype, data, extra)

        def api(self, q, host):
            a = q.get("action")
            fix = lambda items, key: [dict(i, **{key: host + i[key]}) if i.get(key, "").startswith("/") else i for i in items]  # noqa: E731
            if not a:
                now = int(time.time())
                return self.json({"user_info": {"username": "demo", "password": "demo", "auth": 1, "status": "Active",
                                                "exp_date": str(now + cat.days * 86400), "is_trial": "0",
                                                "active_cons": "1", "created_at": str(now - 200 * 86400),
                                                "max_connections": "2" if cat.seed % 2 else "1",
                                                "allowed_output_formats": ["ts", "m3u8"]},
                                  "server_info": {"url": "localhost", "port": "80", "timezone": "Europe/Brussels",
                                                  "timestamp_now": now, "server_protocol": "http"}})
            if a == "get_live_categories":
                return self.json(cat.cats)
            if a == "get_vod_categories":
                return self.json(cat.vcats)
            if a == "get_series_categories":
                return self.json(cat.scats)
            if a == "get_live_streams":
                return self.json(fix(cat.live, "stream_icon"))
            if a == "get_vod_streams":
                return self.json(fix(cat.vod, "stream_icon"))
            if a == "get_series":
                out = []
                for s in cat.series:
                    s = dict(s, cover=host + s["cover"], backdrop_path=[host + b for b in s["backdrop_path"]])
                    out.append(s)
                return self.json(out)
            if a == "get_vod_info":
                v = next((x for x in cat.vod if str(x["stream_id"]) == q.get("vod_id")), None)
                if not v:
                    return self.json({})
                genre = next((c["category_name"] for c in cat.vcats if c["category_id"] == v["category_id"]), "")
                return self.json({"info": {"plot": "Un film de démonstration : l'histoire tient en une ligne, "
                                                   "l'image en une mire.", "genre": genre + ", Drame", "duration_secs": 60,
                                           "releasedate": v["name"][-5:-1] + "-01-01", "director": "Maquette",
                                           "cast": "Acteur A, Actrice B", "backdrop_path": [host + "/img/backdrop/m%s.jpg" % v["stream_id"]]},
                                  "movie_data": {"stream_id": v["stream_id"], "name": v["name"], "container_extension": "mp4"}})
            if a == "get_series_info":
                sid = int(q.get("series_id", 0))
                eps = {}
                for season in (1, 2):
                    eps[str(season)] = [{"id": str(sid * 100 + season * 10 + e), "episode_num": e, "season": season,
                                         "title": "Épisode %d" % e, "container_extension": "mp4",
                                         "info": {"plot": "Résumé de l'épisode %d." % e, "duration_secs": 60,
                                                  "movie_image": host + "/img/backdrop/e%d.jpg" % (sid * 100 + season * 10 + e)}}
                                        for e in range(1, 7)]
                return self.json({"info": {"name": "Série", "plot": "Une série de démonstration.", "director": "Maquette", "cast": "Actrice C, Acteur D"}, "episodes": eps})
            if a == "get_simple_data_table":
                ch = next((x for x in cat.live if str(x["stream_id"]) == q.get("stream_id")), None)
                if not ch:
                    return self.json({"epg_listings": []})
                now = int(time.time())
                import base64
                lst = [{"start_timestamp": a, "stop_timestamp": b, "title": base64.b64encode(t.encode()).decode(),
                        "description": base64.b64encode(("Résumé : " + t).encode()).decode(), "has_archive": 1}
                       for a, b, t in cat.programmes(ch, now - 3 * 86400, now)]
                return self.json({"epg_listings": lst})
            self.json([])

        def xmltv(self, host):
            now = int(time.time())
            parts = ['<?xml version="1.0" encoding="UTF-8"?><tv>']
            for ch in cat.live:
                parts.append('<channel id="%s"><display-name>%s</display-name></channel>' % (ch["epg_channel_id"], esc(ch["name"])))
            fmt = lambda t: time.strftime("%Y%m%d%H%M%S +0000", time.gmtime(t))  # noqa: E731
            for ch in cat.live:
                for a, b, t in cat.programmes(ch, now - 2 * 86400, now + 36 * 3600):
                    # deux programmes sur trois ont une vignette, comme un vrai guide XMLTV : les deux cas se voient
                    icon = ('<icon src="%s/img/backdrop/p%d.jpg"/>' % (host, (a // 60 + ch["stream_id"]) % 100000)
                            if (a // 1800 + ch["stream_id"]) % 3 else "")
                    parts.append('<programme start="%s" stop="%s" channel="%s"><title>%s</title><desc>%s</desc>%s</programme>'
                                 % (fmt(a), fmt(b), ch["epg_channel_id"], esc(t), esc("Programme de démonstration : " + t), icon))
            parts.append("</tv>")
            self.send(200, "application/xml", "".join(parts).encode())

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9101)
    ap.add_argument("--nom", default="Démo")
    ap.add_argument("--graine", type=int, default=1)
    ap.add_argument("--jours", type=int, default=143, help="jours restants avant l'expiration de l'abonnement")
    ap.add_argument("--cache", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache"))
    a = ap.parse_args()
    cat = Catalog(a.graine, a.nom, a.jours)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), handler_for(cat, a.cache))
    print("faux fournisseur « %s » sur http://127.0.0.1:%d (demo / demo)" % (a.nom, a.port), file=sys.stderr)
    srv.serve_forever()


if __name__ == "__main__":
    main()
