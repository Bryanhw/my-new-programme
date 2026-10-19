# -*- coding: utf-8 -*-
"""生成站点图标（favicon / 主屏图标）—— 零依赖，纯标准库。

为什么不用现成图片工具：这个仓库刻意不引依赖，而且这三张图必须能**随时重新生成**
（改个颜色、改个半径就重跑一次），所以图形是用代码画的，不是某次手工导出的产物。

图形取站点自己的母题：金色画布上的一枚柔光太阳（`--bg: #CB9243` + 太阳 =
`style.css` 里空态图标那句「一枚和首页太阳同源的柔光」）。没有文字，因此不受字体影响。

产出（相对仓库根）：
    assets/img/favicon.svg          矢量，现代浏览器的标签页图标
    assets/img/favicon-32.png       32px 位图兜底（不开 SVG 的浏览器）
    assets/img/apple-touch-icon.png 180px，iOS / Android 加到主屏用（不透明）

用法：
    python tools/make_icons.py          # 生成（覆盖同名文件）
    python tools/make_icons.py --check  # 只校验现有文件是否与代码一致
"""
import io
import math
import os
import struct
import sys
import zlib

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
IMG_DIR = os.path.join(ROOT, "assets", "img")

# 和 style.css 的令牌同源，改这里之前先看 :root
GOLD = (0xCB, 0x92, 0x43)      # --bg
CREAM = (0xFF, 0xF6, 0xEF)     # --surface-soft

# 几何（0–1 归一化，长宽等比）：太阳圆盘 + 8 道锥形光芒
SUN_CY = 0.545
SUN_R = 0.205
RAY_IN = 0.235
RAY_OUT = 0.425
RAY_HALF_DEG = 13.5
RAY_N = 8
CORNER_RATIO = 0.22            # 浏览器标签页图标的圆角


def ray_polygons():
    """返回 8 道光芒的三角形顶点（归一化坐标）。SVG 与位图共用这一份几何。"""
    polys = []
    for i in range(RAY_N):
        a = math.radians(i * 360.0 / RAY_N)
        h = math.radians(RAY_HALF_DEG)
        apex = (0.5 + RAY_IN * math.cos(a), SUN_CY + RAY_IN * math.sin(a))
        b1 = (0.5 + RAY_OUT * math.cos(a - h), SUN_CY + RAY_OUT * math.sin(a - h))
        b2 = (0.5 + RAY_OUT * math.cos(a + h), SUN_CY + RAY_OUT * math.sin(a + h))
        polys.append((apex, b1, b2))
    return polys


def in_tri(px, py, tri):
    (x1, y1), (x2, y2), (x3, y3) = tri
    d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)
    d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3)
    d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def in_rounded(px, py, radius):
    """归一化坐标 (0–1) 是否落在圆角方块内。"""
    if radius <= 0:
        return 0.0 <= px <= 1.0 and 0.0 <= py <= 1.0
    cx = min(max(px, radius), 1.0 - radius)
    cy = min(max(py, radius), 1.0 - radius)
    if (px, py) == (cx, cy):
        return True
    return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2


def render(size, rounded, opaque, ss=4):
    """画一张 size×size 的图，返回 RGBA 行列表（4×4 超采样抗锯齿）。"""
    polys = ray_polygons()
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for sy in range(ss):
                for sx in range(ss):
                    ux = (px + (sx + 0.5) / ss) / size
                    uy = (py + (sy + 0.5) / ss) / size
                    if not in_rounded(ux, uy, CORNER_RATIO if rounded else 0.0):
                        continue
                    # 底：金
                    cr, cg, cb = GOLD
                    # 太阳圆盘
                    if (ux - 0.5) ** 2 + (uy - SUN_CY) ** 2 <= SUN_R ** 2:
                        cr, cg, cb = CREAM
                    else:
                        for tri in polys:
                            if in_tri(ux, uy, tri):
                                cr, cg, cb = CREAM
                                break
                    r += cr
                    g += cg
                    b += cb
                    a += 255
            n = ss * ss
            if a == 0:
                # 不透明的图不该出现「没有覆盖」的像素；真出现了就画成金色，
                # 绝不留透明（否则用户会看到一片黑）。
                row += b"\x00\x00\x00" if opaque else b"\x00\x00\x00\x00"
            else:
                cov = a / (n * 255.0)
                row += bytes((int(round(r / n / cov)), int(round(g / n / cov)),
                              int(round(b / n / cov)))) if opaque else bytes(
                    (int(round(r / n / cov)), int(round(g / n / cov)),
                     int(round(b / n / cov)), int(round(255 * cov))))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows, opaque):
    color_type = 2 if opaque else 6
    want = size * (3 if opaque else 4)
    for i, row in enumerate(rows):
        # 2026-10-19 踩过的坑：图里是 RGBA、头部写 RGB（或反过来）时，
        # 文件本身合法、CRC 也过，但浏览器解出来是花的。这里直接拦死。
        if len(row) != want:
            raise AssertionError(
                "row %d has %d bytes, colour type %d needs %d"
                % (i, len(row), color_type, want))
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, color_type, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def svg_text(size=64):
    """和位图共用同一份几何，保证矢量与位图长得一样。"""
    polys = ray_polygons()
    rays = "\n".join(
        '    <polygon points="%s"/>' % " ".join(
            "%.3f,%.3f" % (x * size, y * size) for x, y in tri)
        for tri in polys)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
        'width="%d" height="%d" role="img" aria-label="\u6821\u56ed\u62fe\u5149">\n'
        '  <title>\u6821\u56ed\u62fe\u5149</title>\n'
        '  <rect width="%d" height="%d" rx="%.1f" fill="#CB9243"/>\n'
        '  <g fill="#FFF6EF">\n'
        '    <circle cx="%.1f" cy="%.1f" r="%.1f"/>\n'
        '%s\n'
        '  </g>\n'
        '</svg>\n' % (size, size, size, size, size, size, CORNER_RATIO * size,
                      0.5 * size, SUN_CY * size, SUN_R * size, rays)
    )


def verify_png(path):
    """把写出来的 PNG 再解一遍：头部尺寸/通道数对不对、扫描线长度对不对。

    只信「自己写出去的字节」是不够的 —— 这个函数是回归网：只要写图逻辑再走偏，
    `--check` 与生成都会当场失败，而不是等浏览器显示出一张花图。
    """
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return "not a png"
    pos, idat, hdr = 8, b"", None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if tag == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat += body
        pos += 12 + ln
    if hdr is None:
        return "no IHDR"
    w, h, depth, ctype = hdr[0], hdr[1], hdr[2], hdr[3]
    if depth != 8 or ctype not in (2, 6):
        return "unexpected depth/colour type %r" % ((depth, ctype),)
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    if len(raw) != h * (w * bpp + 1):
        return "scanline length %d, expected %d" % (len(raw), h * (w * bpp + 1))
    if any(raw[i] != 0 for i in range(0, len(raw), w * bpp + 1)):
        return "non-zero filter byte(s)"
    base = os.path.basename(path)
    want_type = 6 if base == "favicon-32.png" else 2
    if ctype != want_type:
        return "%s should be colour type %d, is %d" % (base, want_type, ctype)
    return ""


def build(check_only):
    svg = svg_text()
    png32 = (32, render(32, rounded=True, opaque=False))
    touch = (180, render(180, rounded=False, opaque=True))
    wanted = [
        (os.path.join(IMG_DIR, "favicon.svg"), svg.encode("utf-8"), 6),
        (os.path.join(IMG_DIR, "favicon-32.png"), None, 32),
        (os.path.join(IMG_DIR, "apple-touch-icon.png"), None, 180),
    ]
    # 图片走内存比对：--check 时不该产生任何写入
    import tempfile
    tmp = tempfile.mkdtemp(prefix="dw-icons-")
    for name, (size, rows) in [("favicon-32.png", png32), ("apple-touch-icon.png", touch)]:
        write_png(os.path.join(tmp, name), size, rows, opaque=(name != "favicon-32.png"))

    problems = []
    written = []
    for path, data, _kind in wanted:
        name = os.path.basename(path)
        src = os.path.join(tmp, name) if data is None else None
        payload = data if data is not None else open(src, "rb").read()
        if os.path.exists(path):
            same = open(path, "rb").read() == payload
        else:
            same = False
        if check_only:
            if not same:
                problems.append(name)
        else:
            if not same:
                with open(path, "wb") as f:
                    f.write(payload)
                written.append(name)

    # 结构自检：位图两张都要能按自己的头部解出来（见 verify_png 里的注释）
    for name in ("favicon-32.png", "apple-touch-icon.png"):
        why = verify_png(os.path.join(IMG_DIR, name))
        if why:
            problems.append("%s: %s" % (name, why))

    if check_only:
        if problems:
            print("icon files out of date (%d): %s" % (len(problems), ", ".join(problems)))
            print("run: python tools/make_icons.py")
            return 1
        print("icon files OK")
        return 0
    if written:
        print("icons regenerated: %s" % ", ".join(written))
    else:
        print("icons already up to date")
    for name in ("favicon.svg", "favicon-32.png", "apple-touch-icon.png"):
        p = os.path.join(IMG_DIR, name)
        print("  %-22s %7d bytes" % (name, os.path.getsize(p)))
    return 0


if __name__ == "__main__":
    sys.exit(build("--check" in sys.argv[1:]))
