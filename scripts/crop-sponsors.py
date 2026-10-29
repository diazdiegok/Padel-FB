from pathlib import Path
from PIL import Image

src = Path("public/images/sponsors/_banner-source.png")
out = Path("public/images/sponsors")
out.mkdir(parents=True, exist_ok=True)

im = Image.open(src).convert("RGB")

# Recortes afinados sobre el banner 660x230
crops = {
    "evoxx": (52, 50, 128, 126),
    "teccell": (128, 48, 238, 128),
    "abba": (238, 46, 368, 128),
    "horax": (368, 48, 498, 128),
    "lcdp": (10, 128, 132, 220),
    "padel-pai": (132, 128, 252, 220),
    "mundo-medias": (260, 128, 372, 220),
    "open-padel-fb": (378, 128, 498, 220),
    "el-viejo-matero": (508, 44, 650, 136),
    "grupo-alfa": (508, 136, 650, 224),
}

for name, box in crops.items():
    c = im.crop(box)
    c.save(out / f"{name}.png", optimize=True)
    print(name, c.size)
