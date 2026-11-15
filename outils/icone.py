"""Fabrique l'icône de l'appli TV (512 × 512) : un point vert lumineux, le mot « luciole » dessous.

    python3 outils/icone.py tv/icon.png
"""
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf"
GREEN = (182, 242, 58)
S = 512 * 2                      # dessin à double taille, réduit à la fin : bords nets


def main(out):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(bg).rounded_rectangle((0, 0, S - 1, S - 1), radius=S * 0.22, fill=(13, 16, 23, 255))
    img = Image.alpha_composite(img, bg)
    cx, cy, r = S / 2, S * 0.42, S * 0.12
    # halo : plusieurs disques flous, du plus large au plus serré
    for rad, alpha, blur in ((r * 3.2, 46, r * 1.4), (r * 2.0, 90, r * 0.7), (r * 1.35, 150, r * 0.3)):
        glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=GREEN + (alpha,))
        img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(blur)))
    d = ImageDraw.Draw(img)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=GREEN + (255,))
    d.ellipse((cx - r * .45, cy - r * .55, cx + r * .05, cy - r * .05), fill=(236, 255, 190, 200))   # reflet
    try:
        font = ImageFont.truetype(FONT, int(S * 0.15))
    except OSError:
        font = ImageFont.load_default()
    d.text((cx, S * 0.76), "luciole", fill=(242, 244, 248, 255), font=font, anchor="mm")
    # on garde la forme arrondie : ce qui déborde du fond est effacé
    mask = bg.getchannel("A")
    img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", (S, S), 0), mask))
    img.resize((512, 512), Image.LANCZOS).save(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "icon.png")
