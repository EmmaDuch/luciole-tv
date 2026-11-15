"""Logos de chaînes : fond retiré, rognés, posés sur un carré transparent de taille fixe.

Les fournisseurs livrent des logos de toutes les formes : PNG transparents, JPEG avec
un fond noir incrusté, images très larges ou presque carrées, avec ou sans marges.
Pour qu'ils aient tous la même présence à l'écran :

1. si l'image a déjà de la transparence, on la garde telle quelle ;
2. sinon, si le bord de l'image est d'une couleur sombre et uniforme, ce fond est retiré
   par remplissage depuis les bords : le noir à l'intérieur du logo (lettres, contours
   fermés) n'est pas touché, et les bords adoucis sont « démêlés » du fond ;
3. l'image est rognée au plus près de ce qui reste visible ;
4. elle est réduite pour occuper une surface comparable d'un logo à l'autre, centrée
   dans un carré transparent ;
5. un logo presque entièrement sombre recevrait un fond invisible sur l'interface :
   il est posé sur une plaque claire arrondie.

Ce traitement réussit sur la grande majorité des logos. Les ratés se corrigent à la main
depuis la page web (éditeur de logos), ce qui reste la bonne réponse aux cas tordus.
"""
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

VERSION = "1"            # à changer si le traitement change : les caches sont alors refaits
WORK = 360               # taille de travail : le remplissage est fait sur une image réduite
DARK = 70                # luminance maximale d'un fond considéré comme sombre (0-255)
TOL = 38                 # écart toléré avec la couleur du fond
SOFT = 90                # au-delà de TOL et jusqu'ici : bord adouci, partiellement transparent
FILL = 0.46              # surface visée du logo dans le carré (fraction)
MARGIN = 0.90            # le logo ne dépasse jamais 90 % du côté


def _lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def _border(img):
    w, h = img.size
    px = img.load()
    step = max(1, min(w, h) // 60)
    pts = [(x, 0) for x in range(0, w, step)] + [(x, h - 1) for x in range(0, w, step)]
    pts += [(0, y) for y in range(0, h, step)] + [(w - 1, y) for y in range(0, h, step)]
    return pts, [px[p][:3] for p in pts]


def _has_alpha(img):
    if img.mode not in ("RGBA", "LA", "PA") and not (img.mode == "P" and "transparency" in img.info):
        return False
    a = img.convert("RGBA").getchannel("A")
    lo, _ = a.getextrema()
    return lo < 250


def _uniform_dark_bg(img):
    """Couleur du fond si le pourtour est sombre et uniforme, sinon None."""
    pts, cols = _border(img)
    if not cols:
        return None
    med = tuple(sorted(c[i] for c in cols)[len(cols) // 2] for i in range(3))
    close = sum(1 for c in cols if max(abs(c[i] - med[i]) for i in range(3)) <= TOL)
    if close < 0.85 * len(cols) or _lum(med) > DARK:
        return None
    return med


def _remove_bg(rgb, bg):
    """Masque du fond par remplissage depuis les bords, puis alpha adouci sur la lisière."""
    w, h = rgb.size
    probe = rgb.copy()
    mark = (bg[0] ^ 0x5A, 255 - bg[1], bg[2] ^ 0xA5)           # couleur témoin, loin du fond
    pts, cols = _border(rgb)
    for p, c in zip(pts, cols):
        if max(abs(c[i] - bg[i]) for i in range(3)) <= TOL and probe.getpixel(p) != mark:
            ImageDraw.floodfill(probe, p, mark, thresh=TOL)
    flooded = ImageChops.difference(probe, Image.new("RGB", (w, h), mark)).convert("L")
    bgmask = flooded.point(lambda v: 255 if v == 0 else 0)      # 255 = fond
    # lisière : quelques pixels autour du fond, où l'alpha dépend de l'écart avec le fond
    edge = bgmask.filter(ImageFilter.MaxFilter(5))
    diff = ImageChops.difference(rgb, Image.new("RGB", (w, h), bg))
    dist = _maxchannel(diff)
    alpha = Image.new("L", (w, h), 255)
    a_px, m_px, e_px, d_px, c_px = alpha.load(), bgmask.load(), edge.load(), dist.load(), rgb.load()
    out = Image.new("RGBA", (w, h))
    o_px = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = c_px[x, y]
            if m_px[x, y]:
                o_px[x, y] = (r, g, b, 0)
                continue
            a = 255
            if e_px[x, y]:
                d = d_px[x, y]
                if d <= TOL:
                    a = 0
                elif d < SOFT:
                    a = int(255 * (d - TOL) / (SOFT - TOL))
            if 0 < a < 255:
                # on retire la part du fond mélangée à la couleur du bord
                k = a / 255.0
                r = max(0, min(255, int((r - bg[0] * (1 - k)) / k)))
                g = max(0, min(255, int((g - bg[1] * (1 - k)) / k)))
                b = max(0, min(255, int((b - bg[2] * (1 - k)) / k)))
            o_px[x, y] = (r, g, b, a)
    return out


def _maxchannel(img):
    r, g, b = img.split()
    return ImageChops.lighter(ImageChops.lighter(r, g), b)


def process(img, size):
    """Image PIL quelconque -> carré RGBA de size × size."""
    img.load()
    if _has_alpha(img):
        work = img.convert("RGBA")
    else:
        rgb = img.convert("RGB")
        if max(rgb.size) > WORK:
            rgb.thumbnail((WORK, WORK), Image.LANCZOS)
        bg = _uniform_dark_bg(rgb)
        work = _remove_bg(rgb, bg) if bg else rgb.convert("RGBA")
    # rognage au plus près de ce qui est visible
    box = work.getchannel("A").point(lambda v: 255 if v > 16 else 0).getbbox()
    if box:
        work = work.crop(box)
    w, h = work.size
    if not w or not h:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = min(MARGIN * size / w, MARGIN * size / h, (FILL * size * size / (w * h)) ** 0.5)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    work = work.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if _too_dark(work):
        pad = max(2, size // 14)
        plate = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(plate).rounded_rectangle(
            ((size - nw) // 2 - pad, (size - nh) // 2 - pad, (size + nw) // 2 + pad, (size + nh) // 2 + pad),
            radius=pad * 2, fill=(232, 236, 242, 255))
        canvas = Image.alpha_composite(canvas, plate)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.paste(work, ((size - nw) // 2, (size - nh) // 2))
    return Image.alpha_composite(canvas, layer)


def _too_dark(img):
    """Vrai si ce qui est visible est presque noir : illisible sur l'interface sombre."""
    a = img.getchannel("A")
    if not a.getbbox():
        return False
    lum = img.convert("RGB").convert("L")
    st = ImageStat.Stat(lum, a.point(lambda v: 255 if v > 128 else 0))
    return bool(st.count[0]) and st.mean[0] < 48
