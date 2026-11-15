"""Image de présentation du dépôt GitHub (1280 × 640, le format de l'aperçu social).

    python3 outils/presentation.py            -> images/00-presentation.png (français)
    python3 outils/presentation.py en         -> images/00-presentation-en.png
Les captures d'écran sont reprises du dossier images/ : refaites-les d'abord (maquette/captures.py).
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
EN = {"slogan": "Small light,<br><em>big screen.</em>",
      "sub": "Live TV, movies and series from your IPTV subscriptions, on your Samsung TV.",
      "tags": "<span>Several subscriptions</span><span>Mosaic</span><span>Library</span><span>Catch-up</span><span>FR · EN</span>"}


async def main(lang):
    out = os.path.join(HERE, "..", "images", "00-presentation%s.png" % ("-en" if lang == "en" else ""))
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1280, "height": 640})
        await pg.goto("file://" + os.path.join(HERE, "presentation.html"))
        if lang == "en":
            await pg.evaluate("t => { for (const k in t) document.getElementById(k).innerHTML = t[k]; }", EN)
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=out)
        await b.close()
    print(out)


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "fr"))
