# La maquette

De quoi faire tourner Luciole sans vrai abonnement : pour essayer, développer, ou refaire les images de la documentation.

| Fichier | Rôle |
|---|---|
| `mock_xtream.py` | faux fournisseur Xtream : catégories, chaînes avec logos (PNG transparents et JPEG à fond noir), films, séries, guide XMLTV, replay, état de l'abonnement, et une vraie vidéo de démonstration avec requêtes partielles |
| `mock_tmdb.py` | faux TMDB : recherche de films et de séries avec genres, affiches et fonds |
| `captures.py` | démarre deux faux fournisseurs, le faux TMDB et un vrai serveur Luciole sur une base jetable, remplit favoris, Bibliothèque et reprises, puis photographie chaque écran dans `images/` |

```sh
pip install playwright           # une fois ; Chrome doit être dans /usr/bin/google-chrome
python3 maquette/captures.py     # toutes les images
python3 maquette/captures.py 08  # seulement l'image 08
python3 outils/presentation.py   # l'image de présentation, à partir des captures
```

Il faut aussi `ffmpeg` (la vidéo de démonstration est fabriquée la première fois, dans `maquette/.cache`).

Identifiants des faux fournisseurs : `demo` / `demo`.
