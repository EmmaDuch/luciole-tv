"""Faux TMDB pour la maquette : recherche de films et de séries, avec genres et images.

    python3 mock_tmdb.py --port 9201
Dans config.toml : [medias] tmdb_key = "demo", tmdb_api = "http://127.0.0.1:9201/3",
                   tmdb_img = "http://127.0.0.1:9201/img"
"""
import argparse
import io
import json
import random
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw

GENRES = [28, 12, 16, 35, 80, 99, 18, 14, 27, 878, 53, 10749]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, ctype, data):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.path.startswith("/img/"):
            rnd = random.Random(u.path)
            w, h = (500, 750) if "p" in u.path.rsplit("/", 1)[-1][:2] else (1280, 720)
            img = Image.new("RGB", (w, h), tuple(rnd.randrange(40, 200) for _ in range(3)))
            ImageDraw.Draw(img).ellipse((w * .2, h * .2, w * .8, h * .8), fill=tuple(rnd.randrange(0, 255) for _ in range(3)))
            buf = io.BytesIO(); img.save(buf, "JPEG")
            return self.send("image/jpeg", buf.getvalue())
        if u.path in ("/3/search/movie", "/3/search/tv"):
            term = q.get("query", "")
            rnd = random.Random(term.lower())
            res = []
            for i in range(3):
                g = rnd.sample(GENRES, 2)
                res.append({"id": rnd.randrange(1000, 99999), "title": term, "name": term,
                            "release_date": "20%02d-05-01" % rnd.randrange(0, 25), "genre_ids": g,
                            "overview": "Résumé TMDB de « %s »." % term,
                            "poster_path": "/p%d.jpg" % rnd.randrange(1, 999), "backdrop_path": "/b%d.jpg" % rnd.randrange(1, 999)})
            return self.send("application/json", json.dumps({"results": res}).encode())
        if u.path.endswith("/images"):
            rnd = random.Random(u.path)
            langs = [None, "fr", "en"]
            return self.send("application/json", json.dumps({
                "backdrops": [{"file_path": "/b%d.jpg" % rnd.randrange(1, 999), "width": 1920, "height": 1080,
                               "iso_639_1": langs[i % 3], "vote_average": rnd.random() * 10} for i in range(9)],
                "posters": [{"file_path": "/p%d.jpg" % rnd.randrange(1, 999), "width": 1000, "height": 1500,
                             "iso_639_1": langs[i % 3], "vote_average": rnd.random() * 10} for i in range(12)]}).encode())
        self.send("application/json", b"{}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9201)
    a = ap.parse_args()
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
