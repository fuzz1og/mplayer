"""
Generate MPlayer icon: artistic 6+9 music note
Stylized numbers with rotation, gradients, glow, and musical decorations.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
import struct
import os
import math

SIZE = 1024


def draw_gradient_bg(size):
    """Deep purple-blue gradient rounded rectangle"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        r = int(0x5B + (0x2D - 0x5B) * t)
        g = int(0x4E + (0x6A - 0x5E) * t)
        b = int(0xD8 + (0xE0 - 0xD8) * t)
        draw.line([(0, y), (size - 1, y)], fill=(r, g, b, 255))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([6, 6, size - 6, size - 6], radius=44, fill=255)
    img.putalpha(mask)
    return img


def rotate_text(size, text, font, color, angle, center):
    """Render text, rotate it, return layer"""
    # Step 1: Render text on a square canvas (centered)
    text_size = int(size * 0.8)
    layer = Image.new('RGBA', (text_size, text_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (text_size - tw) // 2 - bbox[0]
    ty = (text_size - th) // 2 - bbox[1]
    draw.text((tx, ty), text, font=font, fill=color)

    # Step 2: Rotate with expand=True (canvas grows, no black fill)
    rotated = layer.rotate(angle, resample=Image.BICUBIC, expand=True)

    # Step 3: Find content bounding box and crop tight
    alpha = rotated.split()[3]
    content_bbox = alpha.getbbox()
    if content_bbox:
        rotated = rotated.crop(content_bbox)
        # Center of the text in rotated space
        rot_cx = text_size // 2
        rot_cy = text_size // 2
        # After expand+crop, the center shifted
        new_cx = rot_cx - content_bbox[0]
        new_cy = rot_cy - content_bbox[1]
    else:
        new_cx = text_size // 2
        new_cy = text_size // 2

    # Step 4: Scale to fit if needed, then paste at target center
    rw, rh = rotated.size
    if rw > size or rh > size:
        scale = min(size / rw, size / rh) * 0.9
        rotated = rotated.resize((int(rw * scale), int(rh * scale)), Image.BICUBIC)
        new_cx = int(new_cx * scale)
        new_cy = int(new_cy * scale)

    result = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    paste_x = int(center[0] - new_cx)
    paste_y = int(center[1] - new_cy)
    result.paste(rotated, (paste_x, paste_y))

    # Clip to canvas bounds (remove any overflow)
    return result.crop((0, 0, size, size))


def create_glow_layer(size, source_layer, radius=8, intensity=1.4):
    """Create a soft glow from an existing layer"""
    glow = source_layer.copy()
    glow = glow.filter(ImageFilter.GaussianBlur(radius=radius))
    r, g, b, a = glow.split()
    a = a.point(lambda x: min(255, int(x * intensity)))
    glow.putalpha(a)
    return glow


def create_icon():
    img = draw_gradient_bg(SIZE)
    font_path = "C:/Windows/Fonts/arialbd.ttf"

    white = (255, 255, 255, 220)
    white_bright = (255, 255, 255, 255)

    # === "6" - large, slightly rotated, bottom-left ===
    font_six = ImageFont.truetype(font_path, 150)
    six_layer = rotate_text(SIZE, "6", font_six, white, angle=-12, center=(108, 155))

    # === "9" - smaller, slightly rotated, top-right ===
    font_nine = ImageFont.truetype(font_path, 100)
    nine_layer = rotate_text(SIZE, "9", font_nine, white, angle=8, center=(162, 60))

    # === Glow layers ===
    glow_six = create_glow_layer(SIZE, six_layer, radius=12, intensity=1.6)
    glow_nine = create_glow_layer(SIZE, nine_layer, radius=10, intensity=1.4)

    # Compose: glow first, then numbers
    img = Image.alpha_composite(img, glow_six)
    img = Image.alpha_composite(img, glow_nine)
    img = Image.alpha_composite(img, six_layer)
    img = Image.alpha_composite(img, nine_layer)

    # === Musical decorations ===
    deco = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    deco_draw = ImageDraw.Draw(deco)
    deco_color = (255, 255, 255, 100)

    # Small floating music notes (♪) as decoration
    # Note 1: top-left area
    def draw_mini_note(d, cx, cy, sz, color):
        # Note head
        d.ellipse([cx - sz, cy - sz//2, cx + sz, cy + sz//2], fill=color)
        # Stem
        d.line([(cx + sz - 1, cy - sz//2), (cx + sz - 1, cy - sz*2)], fill=color, width=max(1, sz//3))
        # Flag
        flag_pts = []
        for i in range(10):
            t = i / 9
            x = cx + sz - 1 + sz * 0.8 * t
            y = cy - sz*2 + sz * 1.2 * t * t
            flag_pts.append((x, y))
        for i in range(len(flag_pts) - 1):
            d.line([flag_pts[i], flag_pts[i+1]], fill=color, width=max(1, sz//3))

    draw_mini_note(deco_draw, 55, 55, 6, deco_color)
    draw_mini_note(deco_draw, 200, 190, 5, deco_color)
    draw_mini_note(deco_draw, 45, 210, 4, (255, 255, 255, 60))

    # Sound wave arcs near the top-right
    for i in range(3):
        r = 12 + i * 8
        arc_color = (255, 255, 255, 50 - i * 12)
        deco_draw.arc([200 - r, 30 - r, 200 + r, 30 + r], 200, 340,
                      fill=arc_color, width=2)

    img = Image.alpha_composite(img, deco)

    return img


def create_ico(images, output_path):
    sizes = [16, 32, 48, 256]
    prepared = []
    for sz in sizes:
        resized = images[0].resize((sz, sz), Image.LANCZOS)
        prepared.append((sz, resized.tobytes()))

    header_size = 6
    dir_entry_size = 16
    data_offset = header_size + dir_entry_size * len(prepared)

    image_data_list = []
    for sz, rgba_data in prepared:
        bmp_header = struct.pack('<IiiHHIIiiII',
            40, sz, sz * 2, 1, 32, 0,
            len(rgba_data) + sz * 4 * 2, 0, 0, 0, 0)
        and_mask = bytes(sz * 4 * 2)
        image_data_list.append(bmp_header + rgba_data + and_mask)

    with open(output_path, 'wb') as f:
        f.write(struct.pack('<HHH', 0, 1, len(prepared)))
        current_offset = data_offset
        for i, (sz, _) in enumerate(prepared):
            w = sz if sz < 256 else 0
            h = sz if sz < 256 else 0
            f.write(struct.pack('<BBBBHHII',
                w, h, 0, 0, 1, 32, len(image_data_list[i]), current_offset))
            current_offset += len(image_data_list[i])
        for data in image_data_list:
            f.write(data)


def main():
    output_dir = os.path.dirname(os.path.abspath(__file__))
    print("Generating artistic 6+9 music note icon...")
    icon_256 = create_icon()

    icon_256.save(os.path.join(output_dir, 'icon.png'), 'PNG')
    print(f"  Saved: icon.png")

    icon_256.resize((16, 16), Image.LANCZOS).save(
        os.path.join(output_dir, 'icon_tray.png'), 'PNG')
    print(f"  Saved: icon_tray.png")

    create_ico([icon_256], os.path.join(output_dir, 'icon.ico'))
    print(f"  Saved: icon.ico")
    print("Done!")


if __name__ == '__main__':
    main()
