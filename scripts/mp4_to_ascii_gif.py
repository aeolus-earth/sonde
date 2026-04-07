#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "opencv-python-headless>=4.5",
#   "numpy>=1.26",
#   "pillow>=10",
# ]
# ///
"""MP4 → animated GIF of ASCII-rendered frames.

  uv run scripts/mp4_to_ascii_gif.py ui/src/assets/mariposa_dither.mp4 -o out.gif
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ASCII_CHARS = np.array(
    list(" .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$")
)

# Sonde-ish cream background, dark ink
BG = (252, 250, 245)
FG = (28, 28, 34)


def frame_to_ascii(gray: np.ndarray, cols: int) -> str:
    h, w = gray.shape
    new_w = cols
    new_h = max(8, int(h / w * new_w * 0.45))
    small = cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_AREA)
    idx = (small.astype(np.float32) / 255.0 * (len(ASCII_CHARS) - 1)).astype(np.int32)
    idx = np.clip(idx, 0, len(ASCII_CHARS) - 1)
    lines = ["".join(ASCII_CHARS[i] for i in row) for row in idx]
    return "\n".join(lines)


def load_mono(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Courier New.ttf"),
        Path("/System/Library/Fonts/Supplemental/Menlo.ttf"),
        Path("/Library/Fonts/Menlo.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"),
        Path("C:/Windows/Fonts/consola.ttf"),
        Path("C:/Windows/Fonts/cour.ttf"),
    ]
    for p in candidates:
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except OSError:
                continue
    return ImageFont.load_default()


def ascii_to_image(ascii_text: str, font: ImageFont.FreeTypeFont | ImageFont.ImageFont) -> Image.Image:
    lines = ascii_text.split("\n")
    probe = Image.new("RGB", (8, 8), BG)
    draw = ImageDraw.Draw(probe)
    bbox = draw.textbbox((0, 0), "M", font=font)
    cw = max(1, bbox[2] - bbox[0])
    ch = max(1, bbox[3] - bbox[1] + 2)
    pad = 6
    max_chars = max((len(line) for line in lines), default=1)
    w = max_chars * cw + pad * 2
    h = len(lines) * ch + pad * 2
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        draw.text((pad, pad + i * ch), line, font=font, fill=FG)
    return img


def main() -> None:
    ap = argparse.ArgumentParser(description="MP4 → ASCII animated GIF")
    ap.add_argument("video", type=Path, help="Input .mp4")
    ap.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output .gif (default: <stem>_ascii.gif next to video)",
    )
    ap.add_argument("-w", "--width", type=int, default=72, help="ASCII columns (smaller = smaller GIF)")
    ap.add_argument(
        "--fps",
        type=float,
        default=10.0,
        help="Playback FPS for the GIF (fewer source frames are skipped to match)",
    )
    ap.add_argument(
        "--max-frames",
        type=int,
        default=90,
        help="Cap total frames (keeps file size reasonable)",
    )
    ap.add_argument("--font-size", type=int, default=9, help="Monospace font size in px")
    args = ap.parse_args()

    video = args.video.resolve()
    if not video.is_file():
        raise SystemExit(f"Not a file: {video}")

    out = args.output or video.with_name(f"{video.stem}_ascii.gif")

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"Could not open: {video}")

    src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 24.0)
    frame_step = max(1, int(round(src_fps / max(0.5, args.fps))))
    duration_ms = int(1000 / max(0.5, args.fps))

    font = load_mono(args.font_size)
    frames: list[Image.Image] = []
    idx = 0
    while len(frames) < args.max_frames:
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        if idx % frame_step != 0:
            idx += 1
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        ascii_txt = frame_to_ascii(gray, cols=args.width)
        frames.append(ascii_to_image(ascii_txt, font))
        idx += 1

    cap.release()

    if not frames:
        raise SystemExit("No frames decoded; check the video file.")

    frames[0].save(
        out,
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        optimize=False,
    )
    print(f"Wrote {out} ({len(frames)} frames @ ~{args.fps} fps, {duration_ms} ms/frame)")


if __name__ == "__main__":
    main()
