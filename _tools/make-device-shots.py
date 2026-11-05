"""把实机截图套上手机外壳，生成 README 用的产品图（透明底 PNG）。

用法： python _tools/make-device-shots.py
输入： 社交推广图/实机截图/shot-01.png（记一笔）、shot-02.png（明细）—— 本地素材，不进仓库
输出： screenshots/record.png、detail.png —— 手机外壳 + 圆角 + 投影，会被提交
      （特意不放在 assets/ 下：assets 会被 build-dist.js 整个打进 dist 和 APK）

改了原始截图后重跑本脚本即可，不要直接覆盖输出图（会叠层）。
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "社交推广图", "实机截图")
DST_DIR = os.path.join(ROOT, "screenshots")

S = 2                 # 绘制倍率，最后缩回 1x 得到平滑圆角
BEZEL = 22            # 边框厚度（1x）
SCREEN_R = 54         # 屏幕圆角（1x）
BODY_R = SCREEN_R + BEZEL
PAD = 56              # 画布外边距，留给投影
SCREEN_W = 620        # 输出屏幕宽度（1x）——README 里按 300px 展示，2x 足够清晰且体积减半

BODY = (22, 22, 26, 255)      # 机身深灰
EDGE = (60, 60, 68, 255)      # 机身高光内圈
SHADOW = (12, 14, 24, 105)


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return m


def build(src, dst):
    shot = Image.open(src).convert("RGB")
    sw, sh = shot.size
    if sw != SCREEN_W:
        sh = round(sh * SCREEN_W / sw)
        sw = SCREEN_W
    shot = shot.resize((sw, sh), Image.LANCZOS)

    body_w, body_h = sw + BEZEL * 2, sh + BEZEL * 2
    canvas = (body_w + PAD * 2, body_h + PAD * 2)

    cs = (canvas[0] * S, canvas[1] * S)
    bw, bh = body_w * S, body_h * S
    off = (PAD * S, PAD * S)

    # 1) 投影
    shadow = Image.new("RGBA", cs, (0, 0, 0, 0))
    shadow.paste(Image.new("RGBA", (bw, bh), SHADOW),
                 (off[0], off[1] + 14 * S), rounded_mask((bw, bh), BODY_R * S))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18 * S))

    # 2) 机身
    body = Image.new("RGBA", cs, (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.rounded_rectangle([off[0], off[1], off[0] + bw - 1, off[1] + bh - 1],
                         BODY_R * S, fill=BODY)

    # 侧面按键
    btn = (34, 34, 40, 255)
    r = 4 * S
    for y0, y1 in ((0.17, 0.26), (0.28, 0.37)):
        bd.rounded_rectangle([off[0] - 2 * S, off[1] + bh * y0,
                              off[0] + 3 * S, off[1] + bh * y1], r, fill=btn)
    bd.rounded_rectangle([off[0] + bw - 3 * S, off[1] + bh * 0.22,
                          off[0] + bw + 3 * S, off[1] + bh * 0.34], r, fill=btn)

    # 3) 屏幕（圆角裁切）
    screen = shot.resize((sw * S, sh * S), Image.LANCZOS).convert("RGBA")
    body.paste(screen, (off[0] + BEZEL * S, off[1] + BEZEL * S),
               rounded_mask((sw * S, sh * S), SCREEN_R * S))

    # 4) 内圈高光
    bd.rounded_rectangle([off[0] + S, off[1] + S, off[0] + bw - 1 - S, off[1] + bh - 1 - S],
                         (BODY_R - 1) * S, outline=EDGE, width=max(1, S))

    out = Image.alpha_composite(shadow, body).resize(canvas, Image.LANCZOS)
    # 量化为 256 色调色板（保留 alpha）：投影渐变占了大头，量化后体积掉到 ~1/8，
    # 300px 展示尺寸下看不出色阶。
    out = out.quantize(colors=256, method=Image.FASTOCTREE)
    out.save(dst, optimize=True)
    print("%s -> %s  %s" % (os.path.basename(src), os.path.basename(dst), out.size))


if __name__ == "__main__":
    for shot_name, out_name in (("shot-01", "record"), ("shot-02", "detail")):
        build(os.path.join(SRC_DIR, shot_name + ".png"), os.path.join(DST_DIR, out_name + ".png"))
