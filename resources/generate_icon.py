#!/usr/bin/env python3
"""
MPlayer 图标生成器 —— 从 resources/icon.svg 派生全部位图产物。

用法:  python resources/generate_icon.py

只依赖 Pillow（和旧版 generate_icon.py 一样）。SVG 只解析本文件用到的那一个子集：
<linearGradient> + <rect rx> + <path d>（M/L/C/A/Z），不引入 SVG 渲染库。

产物:
  resources/icon.png             1024        electron-builder mac/linux 打包 + Electron 窗口图标
  resources/icon.ico             16/32/48/256 Windows 安装包 / exe
  resources/icon_tray.png        16          系统托盘
  resources/icon-foreground.png  1024        Android 自适应图标前景（音符居中，占 66% 安全区）
  public/icon.png                128         渲染层 TitleBar（显示 16px）
  packages/mobile/android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/
      ic_launcher.webp           48/72/96/144/192      旧版方形图标
      ic_launcher_round.webp     48/72/96/144/192      旧版圆形图标
      ic_launcher_foreground.webp 108/162/216/324/432  自适应图标前景

不生成 drawable-*/splashscreen_logo.png —— 那是 expo-splash-screen 的模板占位图，
且 styles.xml 把 @drawable/splashscreen_logo 当 windowBackground（会被拉伸到整屏），
换图需要先配 app.json 的 splash 配置重生成原生资源，属于另一件事。
"""

import io
import math
import os
import re
import struct

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG_PATH = os.path.join(ROOT, 'resources', 'icon.svg')
ANDROID_RES = os.path.join(ROOT, 'packages', 'mobile', 'android', 'app', 'src', 'main', 'res')

# 自适应图标安全区：内容需落在画布中心 66% 的圆内
SAFE_ZONE = 0.66
# 密度 -> (ic_launcher 边长, ic_launcher_foreground 边长)
DENSITIES = {
    'mdpi': (48, 108),
    'hdpi': (72, 162),
    'xhdpi': (96, 216),
    'xxhdpi': (144, 324),
    'xxxhdpi': (192, 432),
}


# ---------------------------------------------------------------- SVG 解析

def parse_svg(path):
    svg = open(path, encoding='utf-8').read()

    vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
    if not vb:
        raise SystemExit('icon.svg: 缺少 viewBox')
    size = float(vb.group(1))

    rect = re.search(r'<rect id="tile"[^>]*rx="([\d.]+)"', svg)
    if not rect:
        raise SystemExit('icon.svg: 缺少 <rect id="tile" rx="...">')
    radius = float(rect.group(1))

    grad = re.search(r'<linearGradient id="tile"[^>]*>(.*?)</linearGradient>', svg, re.S)
    if not grad:
        raise SystemExit('icon.svg: 缺少 <linearGradient id="tile">')
    attrs = dict(re.findall(r'(x1|y1|x2|y2)="([\d.]+)"', grad.group(0)))
    stops = [(float(o), c) for o, c in
             re.findall(r'<stop offset="([\d.]+)" stop-color="(#[0-9A-Fa-f]{6})"', grad.group(1))]
    if len(stops) < 2:
        raise SystemExit('icon.svg: 渐变至少要有两个 stop')

    mark = re.search(r'<g id="mark"[^>]*>(.*?)</g>', svg, re.S)
    if not mark:
        raise SystemExit('icon.svg: 缺少 <g id="mark">')
    d = re.search(r'\bd="([^"]+)"', mark.group(1))
    fill = re.search(r'fill="(#[0-9A-Fa-f]{6})"', mark.group(1))
    if not d:
        raise SystemExit('icon.svg: mark 里缺少 <path d="...">')

    return {
        'size': size,
        'radius': radius,
        'grad': {k: float(v) for k, v in attrs.items()},
        'stops': stops,
        'path': d.group(1),
        'fill': fill.group(1) if fill else '#FFFFFF',
    }


# ---------------------------------------------------------------- 路径离散化

def _cubic(p0, p1, p2, p3, t):
    u = 1 - t
    return (
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    )


def _arc(p0, rx, ry, phi_deg, large_arc, sweep, p1, steps):
    """SVG 椭圆弧 endpoint -> center 参数化后采样（F.6.5）。"""
    phi = math.radians(phi_deg)
    cos_phi, sin_phi = math.cos(phi), math.sin(phi)
    dx, dy = (p0[0] - p1[0]) / 2.0, (p0[1] - p1[1]) / 2.0
    x1p = cos_phi * dx + sin_phi * dy
    y1p = -sin_phi * dx + cos_phi * dy
    rx, ry = abs(rx), abs(ry)
    lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry)
    if lam > 1:
        s = math.sqrt(lam)
        rx, ry = rx * s, ry * s
    num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large_arc == sweep:
        co = -co
    cxp = co * rx * y1p / ry
    cyp = -co * ry * x1p / rx
    cx = cos_phi * cxp - sin_phi * cyp + (p0[0] + p1[0]) / 2.0
    cy = sin_phi * cxp + cos_phi * cyp + (p0[1] + p1[1]) / 2.0

    def angle(ux, uy, vx, vy):
        dot = (ux * vx + uy * vy) / (math.hypot(ux, uy) * math.hypot(vx, vy))
        a = math.acos(max(-1.0, min(1.0, dot)))
        return -a if ux * vy - uy * vx < 0 else a

    ux, uy = (x1p - cxp) / rx, (y1p - cyp) / ry
    vx, vy = (-x1p - cxp) / rx, (-y1p - cyp) / ry
    theta1 = angle(1, 0, ux, uy)
    delta = angle(ux, uy, vx, vy)
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    elif sweep and delta < 0:
        delta += 2 * math.pi

    out = []
    for i in range(steps + 1):
        t = theta1 + delta * i / steps
        out.append((
            cx + rx * math.cos(t) * cos_phi - ry * math.sin(t) * sin_phi,
            cy + rx * math.cos(t) * sin_phi + ry * math.sin(t) * cos_phi,
        ))
    return out


def flatten(d, curve_steps=64, arc_steps=96):
    """把 M/L/C/A/Z 子集离散成多边形顶点。"""
    points, cur, start = [], (0.0, 0.0), None
    for cmd, argstr in re.findall(r'([MLCAZ])([^MLCAZ]*)', d):
        nums = [float(x) for x in re.findall(r'-?\d*\.?\d+', argstr)]
        if cmd == 'M':
            cur = (nums[0], nums[1])
            start = cur
            points.append(cur)
        elif cmd == 'L':
            cur = (nums[0], nums[1])
            points.append(cur)
        elif cmd == 'C':
            p1, p2, p3 = (nums[0], nums[1]), (nums[2], nums[3]), (nums[4], nums[5])
            for i in range(1, curve_steps + 1):
                points.append(_cubic(cur, p1, p2, p3, i / curve_steps))
            cur = p3
        elif cmd == 'A':
            rx, ry, rot, laf, sf, x, y = nums
            seg = _arc(cur, rx, ry, rot, int(laf), int(sf), (x, y), arc_steps)
            points.extend(seg[1:])
            cur = (x, y)
        elif cmd == 'Z':
            if start is not None:
                points.append(start)
    return points


# ---------------------------------------------------------------- 光栅化

def _hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _gradient(size, grad, stops):
    """按 objectBoundingBox 的线性渐变方向生成底图（低分辨率算完再放大，足够平滑）。"""
    lo = 96
    x1, y1 = grad['x1'] * lo, grad['y1'] * lo
    x2, y2 = grad['x2'] * lo, grad['y2'] * lo
    dx, dy = x2 - x1, y2 - y1
    denom = dx * dx + dy * dy or 1.0
    base = Image.new('RGB', (lo, lo))
    px = base.load()
    for y in range(lo):
        for x in range(lo):
            t = ((x - x1) * dx + (y - y1) * dy) / denom
            t = max(0.0, min(1.0, t))
            for i in range(len(stops) - 1):
                o0, c0 = stops[i]
                o1, c1 = stops[i + 1]
                if o0 <= t <= o1:
                    k = 0.0 if o1 == o0 else (t - o0) / (o1 - o0)
                    a, b = _hex_to_rgb(c0), _hex_to_rgb(c1)
                    px[x, y] = tuple(round(a[j] + (b[j] - a[j]) * k) for j in range(3))
                    break
            else:
                px[x, y] = _hex_to_rgb(stops[-1][1] if t > stops[-1][0] else stops[0][1])
    return base.resize((size, size), Image.BICUBIC)


def _ss_for(size):
    """小尺寸多超采样，大尺寸够用就行（Pillow 的 LANCZOS 缩放在做抗锯齿）。"""
    if size <= 48:
        return 8
    if size <= 256:
        return 4
    return 2


def render_tile(spec, size, round_clip=False):
    """圆角方形砖 + 音符（桌面图标 / Android 旧版图标）。"""
    ss = _ss_for(size)
    big = size * ss
    scale = big / spec['size']

    img = _gradient(big, spec['grad'], spec['stops']).convert('RGBA')
    mask = Image.new('L', (big, big), 0)
    radius = spec['radius'] * scale
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=255)
    if round_clip:
        mask = Image.new('L', (big, big), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, big - 1, big - 1], fill=255)
    img.putalpha(mask)

    poly = [(x * scale, y * scale) for x, y in spec['points']]
    note = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(note).polygon(poly, fill=_hex_to_rgb(spec['fill']) + (255,))
    img = Image.alpha_composite(img, note)
    return img.resize((size, size), Image.LANCZOS)


def render_foreground(spec, size):
    """Android 自适应图标前景：音符居中，长边占安全区（中心 66% 圆的内接正方形）。"""
    ss = _ss_for(size)
    big = size * ss
    xs = [p[0] for p in spec['points']]
    ys = [p[1] for p in spec['points']]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    scale = (big * SAFE_ZONE) / max(w, h)
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2

    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    poly = [((x - cx) * scale + big / 2, (y - cy) * scale + big / 2) for x, y in spec['points']]
    ImageDraw.Draw(img).polygon(poly, fill=_hex_to_rgb(spec['fill']) + (255,))
    return img.resize((size, size), Image.LANCZOS)


def write_ico(render, path, sizes=(16, 32, 48, 256)):
    """手写 ICO。<=48 用 BMP 条目（32 位 + AND 掩码，老工具也认），256 用 PNG 条目
    （Vista+ 支持；不压缩的话单这一张就 262KB，整个 ico 会胖十倍）。

    BMP 条目的像素顺序是 **BGRA**（Windows 的 DIB 约定），不是 Pillow 的 RGBA。
    写反的后果不是「稍微不对」而是**红蓝互换**：蓝砖直接变橙棕（1.8.6 就这么错的）。
    每个尺寸都由 render(sz) 按目标像素原生渲染，而不是从 1024 母版缩下来 ——
    16px 上两者差别肉眼可见。
    """
    entries = []
    for sz in sizes:
        small = render(sz)
        if small.size != (sz, sz):
            raise SystemExit('render(%d) 返回了 %s，尺寸不对' % (sz, small.size))
        if sz >= 256:
            buf = io.BytesIO()
            small.save(buf, 'PNG')
            entries.append((sz, buf.getvalue()))
        else:
            r, g, b, a = small.convert('RGBA').split()
            bgra = Image.merge('RGBA', (b, g, r, a)).tobytes()      # RGBA -> BGRA
            mask_len = ((sz + 31) // 32) * 4 * sz                    # 1bpp 掩码，按 4 字节对齐
            header = struct.pack('<IiiHHIIiiII', 40, sz, sz * 2, 1, 32, 0,
                                 len(bgra) + mask_len, 0, 0, 0, 0)
            entries.append((sz, header + bgra + bytes(mask_len)))

    offset = 6 + 16 * len(entries)
    with open(path, 'wb') as f:
        f.write(struct.pack('<HHH', 0, 1, len(entries)))
        for sz, blob in entries:
            dim = sz if sz < 256 else 0
            f.write(struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(blob), offset))
            offset += len(blob)
        for _, blob in entries:
            f.write(blob)


def verify_ico(path, render, sizes):
    """回读 ICO 的每一条并与设计稿逐像素比对。

    自己解析 ICO 目录取指定尺寸的条目 —— **不能**靠 Image.open(ico)：它默认只给最大的那一帧，
    im.size = (w, h) 那条路实测不可靠（负向测试里把 BGRA 写回 RGBA，它照样报「一致」）。
    通道顺序写反这类错误结构完全合法、尺寸也齐全，唯有解码回像素才露馅 ——
    1.8.6 的橙棕 installer 图标就是漏在这里。

    注意：行序按写出的原样解（top-down）。1.8.6 的 installer 实际渲染出来音符是正的、
    只有颜色反了，说明 Windows 这一路就是按 top-down 读的；本校验因此管不住行序，只管通道。
    """
    data = open(path, 'rb').read()
    count = struct.unpack('<HHH', data[:6])[2]
    checked = []
    for i in range(count):
        w, _h, _cc, _r, _p, _bpp, blob_size, offset = struct.unpack(
            '<BBBBHHII', data[6 + 16 * i:22 + 16 * i])
        sz = w or 256
        if sz not in sizes:
            continue
        blob = data[offset:offset + blob_size]
        if blob[:8] == b'\x89PNG\r\n\x1a\n':
            got = Image.open(io.BytesIO(blob)).convert('RGBA')
        else:
            px = blob[40:40 + sz * sz * 4]
            got = Image.merge('RGBA', tuple(
                Image.frombytes('L', (sz, sz), px[c::4]) for c in (2, 1, 0, 3)))   # BGRA -> RGBA
        ref = render(sz)
        if got.size != ref.size:
            raise SystemExit('icon.ico 的 %dpx 条目尺寸是 %s，应为 %s' % (sz, got.size, ref.size))
        # 逐字节比较，别用 ImageChops.difference(...).getbbox() —— getbbox 默认
        # alpha_only=True，两张 alpha 相同的图差值恒为 None，颜色全错也报「一致」（踩过）。
        if got.tobytes() != ref.tobytes():
            raise SystemExit('icon.ico 的 %dpx 条目与设计稿不一致（十有八九是通道顺序写反了）' % sz)
        checked.append(sz)
    print('  %-72s %s' % ('resources/icon.ico 回读校验',
                          '%d 条逐像素一致（%s）' % (len(checked), '/'.join(str(c) for c in checked))))


# ---------------------------------------------------------------- 主流程

def main():
    spec = parse_svg(SVG_PATH)
    spec['points'] = flatten(spec['path'])
    print('icon.svg 解析完成：%d 个多边形顶点' % len(spec['points']))

    def save(img, *parts):
        path = os.path.join(ROOT, *parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        img.save(path)
        print('  %-72s %s' % ('/'.join(parts), img.size))

    master = render_tile(spec, 1024)
    save(master, 'resources', 'icon.png')
    save(render_tile(spec, 16), 'resources', 'icon_tray.png')
    save(render_tile(spec, 128), 'public', 'icon.png')
    save(render_foreground(spec, 1024), 'resources', 'icon-foreground.png')

    ico = os.path.join(ROOT, 'resources', 'icon.ico')
    write_ico(lambda sz: render_tile(spec, sz), ico)
    print('  %-72s %s' % ('resources/icon.ico', '16/32/48/256'))
    verify_ico(ico, lambda sz: render_tile(spec, sz), (16, 32, 48, 256))

    for density, (launcher, foreground) in DENSITIES.items():
        folder = os.path.join(ANDROID_RES, 'mipmap-' + density)
        os.makedirs(folder, exist_ok=True)
        render_tile(spec, launcher).save(os.path.join(folder, 'ic_launcher.webp'), 'WEBP', lossless=True)
        render_tile(spec, launcher, round_clip=True).save(os.path.join(folder, 'ic_launcher_round.webp'), 'WEBP', lossless=True)
        render_foreground(spec, foreground).save(os.path.join(folder, 'ic_launcher_foreground.webp'), 'WEBP', lossless=True)
        print('  %-72s %s' % ('mipmap-%s/ic_launcher{,_round,_foreground}.webp' % density,
                              '%d / %d' % (launcher, foreground)))

    print('完成。')


if __name__ == '__main__':
    main()
