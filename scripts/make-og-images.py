#!/usr/bin/env python3
"""くじ別ページの画像（static/og/*.png）を作る。自動更新では使わない、手で動かす道具です。

検索（Google Discover）と SNS のシェアで使う、くじごとの横長（16:9・1200×675）の画像です。
Google の案内（Discover・2026年3月9日更新）に合わせて、くじの絵を主にして、文字はくじの名前とサイト名だけにしています。
シェアのときに上下が少し切られても（X は 2:1、Facebook は 1.91:1）、名前と絵が欠けないように、上下に余白を取っています。

使い方（Python 3 と Pillow。フォントは Dela Gothic One。README の「くじ別ページの画像を作り直すとき」）：
    pip install pillow
    python3 scripts/make-og-images.py DelaGothicOne-Regular.ttf            # 全部
    python3 scripts/make-og-images.py DelaGothicOne-Regular.ttf loto6 big  # 指定したものだけ

画像を足すときは、下の IMAGES に1行足します。キーがくじの ID（data/games.json）と同じなら、
そのくじのページに自動で使われます。ジャンボは jumbo-<季節>（年末なら jumbo-nenmatsu）、なければ jumbo を使います。
"""
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 675
S = 2  # 2倍の大きさで描いてから縮める（線のふちをなめらかにするため）
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'static', 'og')

RED, RED_DK, GOLD, GOLD_SOFT, NAVY, INK, WHITE = '#d7000f', '#a1000b', '#f2b100', '#fff5d1', '#22324f', '#222222', '#ffffff'
PITCH, PITCH_DK, COURT, ORANGE = '#0c873d', '#08672e', '#1b2a45', '#f08a24'

# キー: (名前の行, 絵の種類, 絵の数・設定, 背景)
IMAGES = {
    'loto6': (['ロト6'], 'balls', 6, 'red'),
    'loto7': (['ロト7'], 'balls', 7, 'red'),
    'miniloto': (['ミニロト'], 'balls', 5, 'red'),
    'bingo5': (['ビンゴ5'], 'bingo', 3, 'red'),
    'numbers4': (['ナンバーズ4'], 'tiles', 4, 'red'),
    'numbers3': (['ナンバーズ3'], 'tiles', 3, 'red'),
    'big': (['BIG'], 'soccer', (14, 3), 'pitch'),
    'megabig': (['MEGA', 'BIG'], 'soccer', (12, 4), 'pitch'),
    'big100': (['100円', 'BIG'], 'soccer', (14, 3), 'pitch'),
    'big1000': (['BIG', '1000'], 'soccer', (11, 3), 'pitch'),
    'minibig': (['mini', 'BIG'], 'soccer', (9, 3), 'pitch'),
    'dunk10': (['DUNK10'], 'basket', 10, 'court'),
    'dunk6a': (['DUNK6-A'], 'basket', 6, 'court'),
    'dunk6b': (['DUNK6-B'], 'basket', 6, 'court'),
    'dunk': (['DUNK'], 'basket', 0, 'court'),
    'jumbo': (['ジャンボ', '宝くじ'], 'tickets', None, 'gold'),
    'jumbo-nenmatsu': (['年末', 'ジャンボ'], 'tickets', None, 'gold'),
    'jumbo-halloween': (['ハロウィン', 'ジャンボ'], 'tickets', None, 'gold'),
    'jumbo-summer': (['サマー', 'ジャンボ'], 'tickets', None, 'gold'),
    'jumbo-dream': (['ドリーム', 'ジャンボ'], 'tickets', None, 'gold'),
    'jumbo-valentine': (['バレンタイン', 'ジャンボ'], 'tickets', None, 'gold'),
    'quickone': (['クイック', 'ワン'], 'phone', None, 'red'),
}

CX = 915  # 絵の真ん中（横）

BG = {
    'red': (RED, RED_DK, WHITE, GOLD),
    'pitch': (PITCH, PITCH_DK, WHITE, GOLD),
    'court': (COURT, NAVY, WHITE, ORANGE),
    'gold': (GOLD, '#e09f00', INK, RED),
}


def s(v):
    return int(round(v * S))


def font(path, size):
    return ImageFont.truetype(path, s(size))


def layer():
    return Image.new('RGBA', (s(W), s(H)), (0, 0, 0, 0))


def shadow(img, shape_fn, blur=10, offset=(6, 10), alpha=70):
    """shape_fn(draw, fill) で描いた形の影を、ぼかして下に敷く"""
    sh = layer()
    d = ImageDraw.Draw(sh)
    shape_fn(d, (0, 0, 0, alpha))
    sh = sh.filter(ImageFilter.GaussianBlur(s(blur)))
    img.alpha_composite(sh, (s(offset[0]), s(offset[1])))


def background(img, kind):
    base, dark, _, _ = BG[kind]
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, s(W), s(H)], fill=base)
    pat = layer()
    p = ImageDraw.Draw(pat)
    if kind == 'pitch':
        for i in range(0, W, 120):  # 芝の縞
            if (i // 120) % 2:
                p.rectangle([s(i), 0, s(i + 120), s(H)], fill=(0, 0, 0, 22))
        line = (255, 255, 255, 60)
        p.ellipse([s(760), s(170), s(1100), s(510)], outline=line, width=s(5))
        p.line([s(930), 0, s(930), s(H)], fill=line, width=s(5))
    elif kind == 'court':
        line = (240, 138, 36, 70)
        p.ellipse([s(700), s(150), s(1160), s(610)], outline=line, width=s(6))
        p.arc([s(520), s(-260), s(1360), s(580)], 20, 160, fill=line, width=s(6))
        p.line([s(930), 0, s(930), s(H)], fill=line, width=s(6))
    else:
        for i in range(-H, W + H, 44):  # ななめの細い縞
            p.line([s(i), 0, s(i + H), s(H)], fill=(255, 255, 255, 18) if kind == 'red' else (255, 255, 255, 40), width=s(14))
        p.ellipse([s(660), s(60), s(1220), s(620)], fill=(0, 0, 0, 26) if kind == 'red' else (255, 255, 255, 60))
    img.alpha_composite(pat)
    d.rectangle([0, s(H - 14), s(W), s(H)], fill=dark)


def crown(d, x, y, size, fill):
    k = size / 24
    pts = [(2.3, 7.4), (7.4, 11.5), (12, 4.3), (16.6, 11.5), (21.7, 7.4), (19.6, 19), (4.4, 19)]
    d.polygon([(s(x + px * k), s(y + py * k)) for px, py in pts], fill=fill)
    d.rounded_rectangle([s(x + 4.4 * k), s(y + 20 * k), s(x + 19.6 * k), s(y + 22.3 * k)], radius=s(0.6 * k), fill=fill)


def brand(img, kind, fpath):
    _, _, fg, accent = BG[kind]
    d = ImageDraw.Draw(img)
    crown(d, 64, 52, 40, GOLD if kind != 'gold' else RED)
    d.text((s(114), s(74)), '宝くじ還元率ランキング', font=font(fpath, 30), fill=fg, anchor='lm')


def title(img, kind, lines, fpath):
    _, _, fg, accent = BG[kind]
    d = ImageDraw.Draw(img)
    maxw = 520
    size = 150
    for line in lines:  # いちばん長い行が幅に収まる大きさ
        while size > 60 and d.textlength(line, font=font(fpath, size)) > s(maxw):
            size -= 4
    f = font(fpath, size)
    gap = size * 1.12
    total = gap * (len(lines) - 1)
    y0 = 360 - total / 2
    for i, line in enumerate(lines):
        y = y0 + gap * i
        d.text((s(64), s(y)), line, font=f, fill=fg, anchor='lm')
    bar_y = y0 + total + size * 0.62 + 18
    d.rounded_rectangle([s(66), s(bar_y), s(66 + 132), s(bar_y + 14)], radius=s(7), fill=accent)


def mix(hex_color, other, k):
    """色を other（'#ffffff' や '#000000'）に k の割合で近づける"""
    a = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(other[i:i + 2], 16) for i in (1, 3, 5)]
    return tuple(int(round(x + (y - x) * k)) for x, y in zip(a, b)) + (255,)


def ball(img, cx, cy, r, color):
    """抽せんの球：色の球に白い丸。左上が明るい"""
    shadow(img, lambda d, f: d.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=f), blur=9, offset=(6, 12), alpha=90)
    body = layer()
    d = ImageDraw.Draw(body)
    steps = 18
    for i in range(steps):
        k = 1 - i / (steps + 2)
        t = i / (steps - 1)
        ox, oy = -r * 0.22 * t, -r * 0.26 * t
        c = mix(color, '#000000', 0.28 * (1 - t)) if t < 0.5 else mix(color, '#ffffff', 0.32 * (t - 0.5) * 2)
        d.ellipse([s(cx + ox - r * k), s(cy + oy - r * k), s(cx + ox + r * k), s(cy + oy + r * k)], fill=c)
    rw = r * 0.5
    d.ellipse([s(cx - rw), s(cy - rw), s(cx + rw), s(cy + rw)], fill=WHITE)
    mask = Image.new('L', (s(W), s(H)), 0)
    ImageDraw.Draw(mask).ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=255)
    clipped = layer()
    clipped.paste(body, (0, 0), mask)
    img.alpha_composite(clipped)
    hi = layer()
    ImageDraw.Draw(hi).ellipse([s(cx - r * 0.7), s(cy - r * 0.86), s(cx - r * 0.18), s(cy - r * 0.52)], fill=(255, 255, 255, 120))
    img.alpha_composite(hi.filter(ImageFilter.GaussianBlur(s(4))))


def draw_balls(img, n):
    colors = ['#f2b100', '#1f6fd1', '#12a150', '#ff7a1a', '#7b3fbf', '#e8418f', '#0aa5a5']
    rows = {5: [3, 2], 6: [3, 3], 7: [4, 3]}[n]
    r = {5: 76, 6: 72, 7: 60}[n]
    gapx = r * 2.16
    k = 0
    for ri, cnt in enumerate(rows):
        cy = 262 + ri * r * 2.05
        x0 = CX - 10 - (cnt - 1) * gapx / 2
        for j in range(cnt):
            ball(img, x0 + j * gapx, cy + (12 if j % 2 else 0), r, colors[k % len(colors)])
            k += 1


def draw_tiles(img, n, fpath):
    w, h, gap = (124, 172, 20) if n == 3 else (96, 146, 12)
    x0 = CX - 15 - (n * w + (n - 1) * gap) / 2
    y0 = 340 - h / 2
    f = font(fpath, 100 if n == 3 else 80)
    for i in range(n):
        x = x0 + i * (w + gap)
        shadow(img, lambda d, c, x=x: d.rounded_rectangle([s(x), s(y0), s(x + w), s(y0 + h)], radius=s(18), fill=c), blur=8, offset=(5, 10), alpha=80)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([s(x), s(y0), s(x + w), s(y0 + h)], radius=s(18), fill=WHITE)
        d.rounded_rectangle([s(x + 10), s(y0 + h / 2 - 3), s(x + w - 10), s(y0 + h / 2 + 3)], radius=s(3), fill='#eeeeee')
        d.text((s(x + w / 2), s(y0 + h / 2 + 4)), '?', font=f, fill=RED if i % 2 == 0 else NAVY, anchor='mm')


def star(d, cx, cy, ro, ri, fill):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = ro if i % 2 == 0 else ri
        pts.append((s(cx + rr * math.cos(a)), s(cy + rr * math.sin(a))))
    d.polygon(pts, fill=fill)


def draw_bingo(img, n):
    size, cell, gap = 400, 112, 14
    x0, y0 = CX - size / 2, 340 - size / 2
    shadow(img, lambda d, c: d.rounded_rectangle([s(x0), s(y0), s(x0 + size), s(y0 + size)], radius=s(26), fill=c), blur=10, offset=(6, 12), alpha=80)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([s(x0), s(y0), s(x0 + size), s(y0 + size)], radius=s(26), fill=WHITE)
    inner = (size - 3 * cell - 2 * gap) / 2
    for r_ in range(3):
        for c_ in range(3):
            x = x0 + inner + c_ * (cell + gap)
            y = y0 + inner + r_ * (cell + gap)
            center = r_ == 1 and c_ == 1
            d.rounded_rectangle([s(x), s(y), s(x + cell), s(y + cell)], radius=s(14), fill=GOLD_SOFT if center else '#f3f3f3')
            if center:
                star(d, x + cell / 2, y + cell / 2 + 2, 44, 19, GOLD)
            elif r_ == c_:  # ななめに1列そろった印
                d.ellipse([s(x + 14), s(y + 14), s(x + cell - 14), s(y + cell - 14)], outline=RED, width=s(12))


def soccer_ball(img, cx, cy, r):
    shadow(img, lambda d, c: d.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=c), blur=9, offset=(6, 12), alpha=90)
    ball_l = layer()
    d = ImageDraw.Draw(ball_l)
    d.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=WHITE)
    pent = lambda px, py, pr, rot: [(s(px + pr * math.cos(rot + i * 2 * math.pi / 5)), s(py + pr * math.sin(rot + i * 2 * math.pi / 5))) for i in range(5)]
    d.polygon(pent(cx, cy, r * 0.36, -math.pi / 2), fill=INK)
    for i in range(5):
        a = -math.pi / 2 + i * 2 * math.pi / 5 + math.pi / 5
        px, py = cx + r * 0.92 * math.cos(a), cy + r * 0.92 * math.sin(a)
        d.polygon(pent(px, py, r * 0.3, a + math.pi), fill=INK)
        ax, ay = cx + r * 0.36 * math.cos(a - math.pi / 5 + math.pi / 5 * 0), cy + r * 0.36 * math.sin(a - math.pi / 5)
        bx, by = cx + r * 0.66 * math.cos(a - math.pi / 5), cy + r * 0.66 * math.sin(a - math.pi / 5)
        vx, vy = cx + r * 0.36 * math.cos(-math.pi / 2 + i * 2 * math.pi / 5), cy + r * 0.36 * math.sin(-math.pi / 2 + i * 2 * math.pi / 5)
        d.line([s(vx), s(vy), s(bx), s(by)], fill=INK, width=s(4))
    mask = Image.new('L', (s(W), s(H)), 0)
    ImageDraw.Draw(mask).ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=255)
    clipped = layer()
    clipped.paste(ball_l, (0, 0), mask)
    img.alpha_composite(clipped)
    ImageDraw.Draw(img).ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], outline='#cfcfcf', width=s(3))


def basket_ball(img, cx, cy, r):
    shadow(img, lambda d, c: d.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=c), blur=9, offset=(6, 12), alpha=110)
    b = layer()
    d = ImageDraw.Draw(b)
    d.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=ORANGE)
    seam = '#3a1d05'
    wdt = s(5)
    d.line([s(cx), s(cy - r), s(cx), s(cy + r)], fill=seam, width=wdt)
    d.line([s(cx - r), s(cy), s(cx + r), s(cy)], fill=seam, width=wdt)
    d.arc([s(cx - r * 1.55), s(cy - r * 0.9), s(cx - r * 0.25), s(cy + r * 0.9)], -62, 62, fill=seam, width=wdt)
    d.arc([s(cx + r * 0.25), s(cy - r * 0.9), s(cx + r * 1.55), s(cy + r * 0.9)], 118, 242, fill=seam, width=wdt)
    mask = Image.new('L', (s(W), s(H)), 0)
    ImageDraw.Draw(mask).ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=255)
    clipped = layer()
    clipped.paste(b, (0, 0), mask)
    img.alpha_composite(clipped)
    hi = layer()
    ImageDraw.Draw(hi).ellipse([s(cx - r * 0.66), s(cy - r * 0.8), s(cx - r * 0.1), s(cy - r * 0.44)], fill=(255, 255, 255, 70))
    img.alpha_composite(hi.filter(ImageFilter.GaussianBlur(s(4))))


def cells(img, n, choices, x_center, y_top, cols, size, gap, palette, seed):
    rnd = random.Random(seed)
    rows = math.ceil(n / cols)
    d = ImageDraw.Draw(img)
    for i in range(n):
        r_, c_ = divmod(i, cols)
        cnt = min(cols, n - r_ * cols)
        x0 = x_center - (cnt * size + (cnt - 1) * gap) / 2
        x = x0 + c_ * (size + gap)
        y = y_top + r_ * (size + gap)
        d.rounded_rectangle([s(x), s(y), s(x + size), s(y + size)], radius=s(9), fill=palette[rnd.randrange(choices)])
    return rows


def draw_soccer(img, spec):
    n, choices = spec
    soccer_ball(img, CX, 230, 118)
    cols = 7 if n == 14 else 6 if n in (11, 12) else 5 if n == 9 else 7
    palette = [WHITE, GOLD, '#9be3b4', '#ffd6d6'][:choices]
    cells(img, n, choices, CX, 395, cols, 52, 12, palette, n * 7 + choices)


def draw_basket(img, n):
    if n:
        basket_ball(img, CX, 230, 118)
        cols = 5 if n == 10 else 6
        cells(img, n, 4, CX, 395, cols, 60, 14, [WHITE, ORANGE, '#7fb2ff', GOLD], n * 13)
    else:
        basket_ball(img, CX, 330, 170)


def ticket(fpath, w=340, h=184, rot=0):
    t = Image.new('RGBA', (s(w + 40), s(h + 40)), (0, 0, 0, 0))
    d = ImageDraw.Draw(t)
    o = 20
    d.rounded_rectangle([s(o), s(o), s(o + w), s(o + h)], radius=s(14), fill=WHITE, outline=RED, width=s(6))
    d.rectangle([s(o + 6), s(o + 46), s(o + w - 6), s(o + 66)], fill=RED)
    d.rectangle([s(o + 6), s(o + h - 54), s(o + w - 6), s(o + h - 46)], fill=GOLD)
    crown(d, o + 22, o + 76, 56, GOLD)
    for i, ww in enumerate([150, 100, 170]):
        d.rounded_rectangle([s(o + 100), s(o + 82 + i * 24), s(o + 100 + ww), s(o + 93 + i * 24)], radius=s(6), fill='#e4e4e4')
    if rot:
        t = t.rotate(rot, resample=Image.BICUBIC, expand=True)
    return t


def draw_tickets(img, fpath):
    for rot, dx, dy in [(14, -40, 20), (-8, 50, -10), (4, 0, 110)]:
        t = ticket(fpath, rot=rot)
        sh = Image.new('RGBA', t.size, (0, 0, 0, 0))
        sh.putalpha(t.getchannel('A').point(lambda a: int(a * 0.32)))
        sh = sh.filter(ImageFilter.GaussianBlur(s(8)))
        x = s(CX + 10 + dx) - t.size[0] // 2
        y = s(300 + dy) - t.size[1] // 2
        img.alpha_composite(sh, (x + s(6), y + s(10)))
        img.alpha_composite(t, (x, y))


def bolt(d, x, y, k, fill):
    """いなずま（すぐ結果が分かる印）"""
    pts = [(15, 0), (2, 24), (12, 24), (6, 44), (24, 16), (13, 16), (20, 0)]
    d.polygon([(s(x + px * k), s(y + py * k)) for px, py in pts], fill=fill)


def draw_phone(img):
    """スマホの画面に、当たりの星と、めくった券（クイックワン：ネットで買って、その場で結果が分かる）"""
    w, h, r = 252, 440, 40
    x0, y0 = CX - w / 2, 340 - h / 2
    shadow(img, lambda d, c: d.rounded_rectangle([s(x0), s(y0), s(x0 + w), s(y0 + h)], radius=s(r), fill=c), blur=10, offset=(6, 12), alpha=95)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([s(x0), s(y0), s(x0 + w), s(y0 + h)], radius=s(r), fill=NAVY)
    sx0, sy0, sx1, sy1 = x0 + 14, y0 + 40, x0 + w - 14, y0 + h - 34
    d.rounded_rectangle([s(sx0), s(sy0), s(sx1), s(sy1)], radius=s(18), fill=GOLD_SOFT)
    d.rounded_rectangle([s(CX - 30), s(y0 + 17), s(CX + 30), s(y0 + 25)], radius=s(4), fill='#3b4b6b')
    d.rounded_rectangle([s(CX - 40), s(y0 + h - 20), s(CX + 40), s(y0 + h - 13)], radius=s(4), fill='#3b4b6b')
    # 当たりの星と、光
    cy = sy0 + 118
    rays = layer()
    rd = ImageDraw.Draw(rays)
    for i in range(12):
        a = i * math.pi / 6 + math.pi / 12
        p1 = (CX + 66 * math.cos(a - 0.12), cy + 66 * math.sin(a - 0.12))
        p2 = (CX + 102 * math.cos(a), cy + 102 * math.sin(a))
        p3 = (CX + 66 * math.cos(a + 0.12), cy + 66 * math.sin(a + 0.12))
        rd.polygon([(s(x), s(y)) for x, y in (p1, p2, p3)], fill=(242, 177, 0, 150))
    img.alpha_composite(rays)
    d = ImageDraw.Draw(img)
    star(d, CX, cy + 4, 74, 32, GOLD)
    star(d, CX, cy + 4, 44, 19, '#ffd84d')
    # めくった券：3枚のうち1枚が当たり
    tw, th, gap = 58, 74, 12
    ty = sy1 - th - 26
    for i in range(3):
        tx = CX - (3 * tw + 2 * gap) / 2 + i * (tw + gap)
        hit = i == 1
        d.rounded_rectangle([s(tx), s(ty), s(tx + tw), s(ty + th)], radius=s(10), fill=RED if hit else WHITE, outline=None if hit else '#e2d6b0', width=s(3))
        if hit:
            star(d, tx + tw / 2, ty + th / 2 + 2, 20, 9, GOLD)
        else:
            d.rounded_rectangle([s(tx + 12), s(ty + th / 2 - 4), s(tx + tw - 12), s(ty + th / 2 + 4)], radius=s(4), fill='#e2d6b0')
    # いなずまと、きらきら
    bolt(d, x0 + w - 6, y0 - 34, 2.6, GOLD)
    for (px, py, ro) in [(x0 - 52, y0 + 64, 22), (x0 + w + 58, y0 + h - 120, 16), (x0 - 30, y0 + h - 70, 12)]:
        star(d, px, py, ro, ro * 0.38, WHITE)


def make(key, fpath):
    lines, kind, spec, bg = IMAGES[key]
    img = layer()
    background(img, bg)
    if kind == 'balls':
        draw_balls(img, spec)
    elif kind == 'tiles':
        draw_tiles(img, spec, fpath)
    elif kind == 'bingo':
        draw_bingo(img, spec)
    elif kind == 'soccer':
        draw_soccer(img, spec)
    elif kind == 'basket':
        draw_basket(img, spec)
    elif kind == 'tickets':
        draw_tickets(img, fpath)
    elif kind == 'phone':
        draw_phone(img)
    brand(img, bg, fpath)
    title(img, bg, lines, fpath)
    out = img.convert('RGB').resize((W, H), Image.LANCZOS)
    out = out.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    path = os.path.join(OUT, f'{key}.png')
    out.save(path, optimize=True)
    return path, os.path.getsize(path)


def main():
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        sys.exit('使い方: python3 scripts/make-og-images.py DelaGothicOne-Regular.ttf [キー …]')
    fpath = sys.argv[1]
    keys = sys.argv[2:] or list(IMAGES)
    os.makedirs(OUT, exist_ok=True)
    for k in keys:
        if k not in IMAGES:
            sys.exit(f'知らないキーです: {k}（IMAGES に足してください）')
        path, size = make(k, fpath)
        print(f'{os.path.relpath(path)}  {size // 1024}KB')


if __name__ == '__main__':
    main()
