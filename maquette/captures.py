"""Refait toutes les images de la documentation, sans vrai abonnement.

    python3 maquette/captures.py            (depuis la racine du dépôt)
    python3 maquette/captures.py 08 21      (seulement les images 08 et 21)

Ce qu'il faut : Python 3.11+, Pillow, ffmpeg, Google Chrome (/usr/bin/google-chrome)
et le module Playwright pour Python (pip install playwright).

Le script démarre deux faux fournisseurs (mock_xtream.py), un faux TMDB (mock_tmdb.py),
un vrai serveur Luciole sur une base jetable, et sert l'appli TV comme une page web.
Il remplit quelques favoris, une Bibliothèque et une reprise de lecture, puis
photographie chaque écran à sa taille réelle : 1920 × 1080 pour le téléviseur,
1440 × 900 pour la page web, une section à la fois (pas de pages de 7000 pixels).

Dans un navigateur, le lecteur ne sait pas lire le .ts du direct : pendant les captures,
la vidéo de démonstration est servie en MP4 à la place.
"""
import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "images")
CHROME = "/usr/bin/google-chrome"
PORTS = {"a": 9101, "b": 9102, "tmdb": 9201, "srv": 8799, "tv": 8798}
SRV = "http://127.0.0.1:%d" % PORTS["srv"]
TV = "http://127.0.0.1:%d/index.html" % PORTS["tv"]


def wait_port(port, timeout=90):
    end = time.time() + timeout
    while time.time() < end:
        try:
            socket.create_connection(("127.0.0.1", port), 1).close()
            return
        except OSError:
            time.sleep(.4)
    raise SystemExit("le port %d ne répond pas" % port)


def call(method, path, body=None):
    req = urllib.request.Request(SRV + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def start(cmd, env=None, cwd=None):
    return subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def setup(tmp):
    procs = []
    py = sys.executable
    procs.append(start([py, os.path.join(HERE, "mock_xtream.py"), "--port", str(PORTS["a"]), "--nom", "Démo A", "--graine", "1"]))
    procs.append(start([py, os.path.join(HERE, "mock_xtream.py"), "--port", str(PORTS["b"]), "--nom", "Sport B",
                        "--graine", "2", "--jours", "12"]))
    procs.append(start([py, os.path.join(HERE, "mock_tmdb.py"), "--port", str(PORTS["tmdb"])]))
    for k in ("a", "b", "tmdb"):
        wait_port(PORTS[k])
    cfg = os.path.join(tmp, "config.toml")
    with open(cfg, "w") as f:
        f.write(f'''[[xtream]]
nom = "Maison"
id = "maison"
server = "http://127.0.0.1:{PORTS["a"]}"
username = "demo"
password = "demo"

[[xtream]]
nom = "Sport"
id = "sport"
server = "http://127.0.0.1:{PORTS["b"]}"
username = "demo"
password = "demo"
decalage = 1000

[server]
listen = "127.0.0.1"
port = {PORTS["srv"]}
data_dir = "{tmp}/data"

[medias]
tmdb_key = "demo"
tmdb_api = "http://127.0.0.1:{PORTS["tmdb"]}/3"
tmdb_img = "http://127.0.0.1:{PORTS["tmdb"]}/img"
ecriture = true

[tv]
host = "192.168.1.30"
''')
    # médiathèque de démonstration : la vidéo du faux fournisseur, copiée sous des noms de films et d'épisodes
    demo = os.path.join(HERE, ".cache", "demo.mp4")
    medias = os.path.join(tmp, "medias")
    for rel in ("Films/Le Phare (2021)/Le Phare (2021).mp4", "Films/Nuit d'orage (2019).mp4",
                "Films/Horizon.perdu.2023.1080p.mp4", "Séries/Station Orion (2022)/Saison 1/Station.Orion.S01E01.mp4",
                "Séries/Station Orion (2022)/Saison 1/Station.Orion.S01E02.mp4"):
        path = os.path.join(medias, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.exists(demo):
            shutil.copy(demo, path)
    # deux films au son DTS, que le téléviseur ne lit pas : de quoi montrer la conversion du son
    if os.path.exists(demo):
        for rel, extra in (("Films/Rivage (2018)/Rivage (2018).mkv", ["-ac", "6"]),
                           ("Films/Le Col (2016).mkv", ["-ac", "6"])):
            path = os.path.join(medias, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", demo, "-map", "0:v", "-map", "0:a", "-map", "0:a",
                            "-c:v", "copy", "-c:a:0", "dca", "-strict", "-2"] + extra +
                           ["-c:a:1", "aac", "-metadata:s:a:0", "language=fre", "-metadata:s:a:1", "language=eng",
                            path], check=False)
    # « Le Phare » en trois versions : 720p (ci-dessus), 1080p, et 4K au son DTS (illisible sur la TV)
    if os.path.exists(demo):
        for rel, vf, aud in (("Films/Le Phare (2021)/Le Phare (2021) - 1080p.mkv", "scale=1920:1080", ["-c:a", "aac"]),
                             ("Films/Le Phare (2021)/Le Phare (2021) - 4K.mkv", "scale=3840:2160",
                              ["-c:a", "dca", "-strict", "-2", "-ac", "6"])):
            path = os.path.join(medias, rel)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", demo, "-t", "8", "-vf", vf, "-c:v", "libx264",
                            "-preset", "ultrafast", "-crf", "40"] + aud + [path], check=False)
    # rangement Kodi / Plex / Jellyfin : images, logo, bande-annonce à côté du film, bonus en sous-dossiers
    if os.path.exists(demo):
        from PIL import Image, ImageDraw, ImageFont
        d1 = os.path.join(medias, "Films", "Drive (2011) {tmdb-64690}")
        d2 = os.path.join(medias, "Films", "Eden (2014) {tmdb-283330}")
        for d, stem in ((d1, "Drive (2011) {tmdb-64690}"), (d2, "Eden (2014) {tmdb-283330}")):
            os.makedirs(d, exist_ok=True)
            shutil.copy(demo, os.path.join(d, stem + (".m4v" if d == d1 else ".mkv")))
            Image.new("RGB", (400, 600), (40, 70, 140) if d == d1 else (150, 40, 90)).save(os.path.join(d, stem + "-poster.jpg"))
            Image.new("RGB", (1280, 720), (20, 30, 60) if d == d1 else (60, 20, 40)).save(os.path.join(d, stem + "-fanart.jpg"))
        logo = Image.new("RGBA", (800, 300), (0, 0, 0, 0))
        dr = ImageDraw.Draw(logo)
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", 200)
        except OSError:
            font = ImageFont.load_default()
        dr.text((20, 30), "Drive", font=font, fill=(236, 72, 153, 255))
        logo.save(os.path.join(d1, "Drive (2011) {tmdb-64690}-clearlogo.png"))
        shutil.copy(demo, os.path.join(d1, "Drive (2011) {tmdb-64690}-trailer.mp4"))
        for sub, fn in (("Deleted Scenes", "Deleted Scenes.mkv"), ("Interviews", "The Director.mkv")):
            os.makedirs(os.path.join(d2, sub), exist_ok=True)
            shutil.copy(demo, os.path.join(d2, sub, fn))
    os.environ["LUCIOLE_MEDIAS"] = medias
    env = dict(os.environ, LUCIOLE_CONFIG=cfg, PYTHONPATH=os.path.join(ROOT, "server"))
    subprocess.run([py, "-m", "luciole.sync"], env=env, check=True, cwd=os.path.join(ROOT, "server"),
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    procs.append(start([py, "-m", "luciole.server"], env=env, cwd=os.path.join(ROOT, "server")))
    procs.append(start([py, "-m", "http.server", str(PORTS["tv"]), "--bind", "127.0.0.1",
                        "--directory", os.path.join(ROOT, "tv")]))
    wait_port(PORTS["srv"])
    wait_port(PORTS["tv"])
    seed()
    return procs


def seed():
    """Des favoris, une Bibliothèque, des reprises : des écrans habités, pas vides."""
    live = call("GET", "/api/live?cat=all")["channels"]
    by_num = {c["num"]: c for c in live}
    for n in (1, 7, 8, 13, 1012, 1017, 2):
        if n in by_num:
            call("POST", "/api/favchannels", {"id": by_num[n]["id"]})
    movies = call("GET", "/api/vod?cat=all&limit=40")["items"]
    series = call("GET", "/api/series?cat=all&limit=20")["items"]
    for m in movies[:9]:
        call("POST", "/api/library/add", {"kind": "movie", "id": m["id"], "lang": "fr"})
    for s in series[:4]:
        call("POST", "/api/library/add", {"kind": "series", "id": s["id"], "lang": "fr"})
    call("POST", "/api/progress", {"kind": "movie", "id": movies[2]["id"], "position": 31, "duration": 60})
    d = call("GET", "/api/series/detail?id=%d" % series[0]["id"])
    ep = d["seasons"][0]["episodes"][2]
    call("POST", "/api/progress", {"kind": "episode", "id": ep["id"], "series_id": series[0]["id"],
                                   "position": 22, "duration": 60})
    call("POST", "/api/watchlist", {"kind": "movie", "id": movies[5]["id"], "fav": True})
    call("POST", "/api/tv/set", {"host": "192.168.1.30", "auto": False})
    # un bouquet personnel
    b = call("POST", "/api/bouquets/create", {"name": "Mes chaînes", "kind": "live"})
    call("POST", "/api/bouquets/add", {"id": b["id"], "channels": [c["id"] for c in live[:6]] + [c["id"] for c in live[40:44]]})
    call("POST", "/api/bouquets/create", {"name": "Sport du week-end", "kind": "live"})
    call("POST", "/api/bouquets/create", {"name": "Films des enfants", "kind": "vod"})
    # une source de guide externe (le guide du faux fournisseur A, servi comme un fichier XMLTV public)
    call("POST", "/api/epg/sources", {"url": "http://127.0.0.1:%d/xmltv.php?username=demo&password=demo" % PORTS["a"],
                                      "name": "Guide public de démonstration"})
    call("POST", "/api/epg/refresh", {})
    # une petite médiathèque : quelques fichiers vidéo de démonstration
    root = os.environ.get("LUCIOLE_MEDIAS")
    if root:
        call("POST", "/api/medias/add", {"path": os.path.join(root, "Films"), "kind": "films", "name": "Films du NAS"})
        call("POST", "/api/medias/add", {"path": os.path.join(root, "Séries"), "kind": "series", "name": "Séries du NAS"})
        call("POST", "/api/medias/scan", {})
    time.sleep(6)


# ------------------------------------------------------------------ les images
# numéro, fichier, (« tv » | « web »), réglages, actions
TV_SHOTS = [
    ("01", "accueil-tv", {}, ["go:live", "wait:2400", "key:Enter", "wait:2600", "key:Enter", "wait:1500",
                              "go:home", "wait:1800"]),
    ("02", "guide-direct", {}, ["go:live", "wait:2600"]),
    ("03", "mosaique", {}, ["go:live", "wait:2400", "key:Enter", "wait:2500", "key:ArrowRight", "wait:2600"]),
    ("04", "bibliotheque", {}, ["go:library", "wait:2000"]),
    ("06", "premier-lancement", {"server": ""}, ["wait:1200"]),
    ("07", "guide-filtre-serveur", {"liveSrc": 2}, ["go:live", "wait:2600",
                                                     "js:Focus.set(document.querySelector('[data-act=srcsel]'))", "wait:600"]),
    ("08", "lecteur-direct", {}, ["go:live", "wait:2400", "key:Enter", "wait:2600", "key:Enter", "wait:900"]),
    ("09", "menu-rapide", {}, ["go:live", "wait:2400", "key:Enter", "wait:2600", "key:ArrowLeft", "wait:1200"]),
    ("10", "page-chaine", {}, ["js:App.open('channel', ch(4))", "wait:2000"]),
    ("11", "replay", {}, ["js:Router.push(ReplayScreen(chArch()))", "wait:2600"]),
    ("12", "films", {}, ["go:vod", "wait:2200"]),
    ("13", "fiche-film", {}, ["js:App.open('movie', movie(0))", "wait:2200"]),
    ("14", "categorie-bibliotheque", {}, ["js:App.open('movie', movie(0))", "wait:2200",
                                          "js:document.querySelector('[data-act=library]').click()", "wait:1500"]),
    ("15", "fiche-serie", {}, ["js:App.open('series', serie(0))", "wait:2400"]),
    ("16", "recherche", {}, ["go:search", "wait:800", "key:Enter", "type:mé", "wait:1800", "key:ArrowDown", "wait:500"]),
    ("17", "reglages-tv", {}, ["go:settings", "wait:2000"]),
    ("18", "demarrage-auto-tv", {}, ["js:Router.push(AutostartScreen())", "wait:2000"]),
    ("19", "theme-ambre", {"theme": "ambre"}, ["go:home", "wait:1800"]),
    ("20", "anglais", {"lang": "en"}, ["go:live", "wait:2600"]),
    ("35", "fiche-film-versions", {}, ["js:App.open('movie', localPhare())", "wait:2200"]),
    ("36", "fiche-film-choix-version", {}, ["js:App.open('movie', localPhare())", "wait:2200",
                                         "js:Router.screen().onEnter(Router.screen().el.querySelector('[data-act=version]'))", "wait:1200"]),
    ("37", "fiche-film-logo", {}, ["js:App.open('movie', localMovie('Drive'))", "wait:2600"]),
    ("38", "fiche-film-bonus", {}, ["js:App.open('movie', localMovie('Eden'))", "wait:2200",
                                     "js:Router.screen().onEnter(Router.screen().el.querySelector('[data-act=extras]'))", "wait:1200"]),
    ("32", "lecteur-film-resume", {}, ["js:App.open('movie', movie(0))", "wait:2200", "key:Enter", "wait:7500",
                                       "key:ArrowDown", "wait:1200"]),
]
WEB_SHOTS = [
    ("05", "page-accueil-web", "/", None, []),
    ("21", "web-abonnements", "/reglages#subs", "#t-subs", []),
    ("22", "web-bibliotheque", "/reglages#lib", "#t-lib", []),
    ("23", "web-mes-bouquets", "/reglages#bq", "#t-bq", []),
    ("24", "web-chaines", "/reglages#chans", "#t-chans", []),
    ("25", "web-logo", "/reglages#chans", "dialog#dlg", ["click:#clist li:nth-child(4) .btn.small"]),
    ("26", "web-fiche", "/reglages#items", "dialog#dlg", ["click:#ilist li:nth-child(2) .btn.small", "blur"]),
    ("27", "web-noms", "/reglages#names", "#t-names", []),
    ("28", "web-guide", "/reglages#guide", "#t-guide", []),
    ("29", "web-bouquets-fournisseur", "/reglages#cats", "#t-cats", []),
    ("30", "web-televiseur", "/reglages#tv", "#t-tv", []),
    ("31", "web-mediatheque", "/reglages#medias", "#t-medias", []),
    ("34", "web-conversion-son", "/reglages#medias", "#t-medias", ["click:[data-mk=probleme]"]),
    ("33", "web-choisir-bibliotheque", "/reglages#medias", "#mpick", ["click:#pgrid li:nth-child(1)", "click:#pgrid li:nth-child(3)"]),
]

HELPERS = """
window.__live = null;
function ch(i) { return window.__live[i].id; }
function chObj(i) { return window.__live[i]; }
function chArch() { return window.__live.filter(function (c) { return c.archive; })[1]; }
function movie(i) { return window.__vod[i].id; }
function serie(i) { return window.__series[i].id; }
function localPhare() { return window.__phare; }
function localMovie(n) { return (window.__local.find(function (x) { return x.name.indexOf(n) === 0; }) || {}).id; }
"""


async def tv_shot(pg, num, name, prefs, actions):
    store = {"server": SRV, "lang": "fr", "theme": "luciole", "liveCat": "all", "liveSrc": 0, "preview": False}
    store.update(prefs)
    await pg.goto(TV)
    await pg.evaluate("(s) => { localStorage.clear(); for (const k in s) if (s[k] !== '' ) "
                      "localStorage.setItem('luciole.' + k, JSON.stringify(s[k])); }", store)
    await pg.reload()
    await pg.wait_for_timeout(900)
    # dans un navigateur, le direct passe par le MP4 de démonstration
    await pg.evaluate("""() => { if (window.Player) { const o = Player.play;
        Player.play = function (u, opts) { return o.call(this, 'http://127.0.0.1:%d/demo.mp4', opts); }; } }""" % PORTS["a"])
    await pg.evaluate(HELPERS)
    await pg.evaluate("""async (srv) => {
        window.__live = (await (await fetch(srv + '/api/live?cat=all')).json()).channels;
        window.__vod = (await (await fetch(srv + '/api/library?kind=movie')).json()).items;
        window.__series = (await (await fetch(srv + '/api/library?kind=series')).json()).items;
        for (let i = 0; i < 60 && !window.__phare; i++) {     // l'analyse de la médiathèque peut finir après
          const t = (await (await fetch(srv + '/api/medias/titles?kind=movie')).json()).items;
          window.__phare = (t.find(function (x) { return x.files > 2; }) || {}).id; window.__local = t;
          if (!window.__phare) await new Promise(function (r) { setTimeout(r, 500); });
        } }""", SRV)
    for a in actions:
        kind, _, arg = a.partition(":")
        if kind == "wait":
            await pg.wait_for_timeout(int(arg))
        elif kind == "go":
            await pg.evaluate("App.go(%s)" % json.dumps(arg))
        elif kind == "key":
            await pg.keyboard.press(arg)
            await pg.wait_for_timeout(260)
        elif kind == "type":
            await pg.keyboard.type(arg, delay=80)
        elif kind == "js":
            await pg.evaluate(arg)
    await pg.screenshot(path=os.path.join(OUT, "%s-%s.png" % (num, name)))


async def web_shot(pg, num, name, path, sel, actions):
    base, _, frag = path.partition("#")
    url = SRV + base + "?c=" + num + ("#" + frag if frag else "")     # une vraie page neuve à chaque fois
    await pg.goto(SRV + "/")
    await pg.evaluate("localStorage.setItem('luciole.web.lang', '\"fr\"'); localStorage.setItem('luciole.web.theme', '\"luciole\"')")
    await pg.goto(url)
    await pg.wait_for_timeout(1500)
    if sel and sel.startswith("dialog"):
        await pg.set_viewport_size({"width": 1440, "height": 1300})     # une fenêtre entière, sans défilement
    for a in actions:
        kind, _, arg = a.partition(":")
        if kind == "click":
            await pg.click(arg)
            await pg.wait_for_timeout(1500)
        elif kind == "blur":
            await pg.evaluate("document.activeElement && document.activeElement.blur()")
        elif kind == "type":
            await pg.keyboard.type(arg, delay=60)
        elif kind == "wait":
            await pg.wait_for_timeout(int(arg))
    target = os.path.join(OUT, "%s-%s.png" % (num, name))
    if sel is None:
        await pg.screenshot(path=target)
        return
    if sel.startswith("dialog"):
        await pg.locator(sel).screenshot(path=target)
        await pg.set_viewport_size({"width": 1440, "height": 900})
        return
    box = await pg.locator(sel).bounding_box()
    # l'en-tête, puis la section seule, coupée à 1100 pixels au plus
    top = 0 if sel.startswith("#t-") else max(0, box["y"] - 20)
    h = min(1100, box["y"] + box["height"] + 24 - top) if sel.startswith("#t-") else box["height"] + 40
    await pg.set_viewport_size({"width": 1440, "height": int(max(700, top + h))})
    await pg.screenshot(path=target, clip={"x": 0 if sel.startswith("#t-") else box["x"] - 20, "y": top,
                                           "width": 1440 if sel.startswith("#t-") else box["width"] + 40,
                                           "height": h})
    await pg.set_viewport_size({"width": 1440, "height": 900})


async def shoot(only):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=["--autoplay-policy=no-user-gesture-required"])
        tv = await b.new_page(viewport={"width": 1920, "height": 1080})
        web = await b.new_page(viewport={"width": 1440, "height": 900})
        for num, name, prefs, actions in TV_SHOTS:
            if not only or num in only:
                await tv_shot(tv, num, name, prefs, actions)
                print("  ", num, name)
        for num, name, path, sel, actions in WEB_SHOTS:
            if not only or num in only:
                await web_shot(web, num, name, path, sel, actions)
                print("  ", num, name)
        await b.close()


def main():
    only = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="luciole-captures-")
    procs = []
    try:
        print("mise en place de la maquette…")
        procs = setup(tmp)
        print("captures :")
        asyncio.run(shoot(only))
    finally:
        for pr in procs:
            pr.terminate()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
