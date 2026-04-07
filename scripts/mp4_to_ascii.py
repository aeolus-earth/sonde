#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "opencv-python-headless>=4.5",
#   "numpy>=1.26",
# ]
# ///
"""Sample an MP4 to ASCII frames (no PyPI video-to-ascii — that package is broken).

  uv run scripts/mp4_to_ascii.py ui/src/assets/mariposa_dither.mp4
  uv run scripts/mp4_to_ascii.py video.mp4 -o out.txt -n 24 -w 120
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

ASCII_CHARS = np.array(
    list(" .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$")
)


def frame_to_ascii(gray: np.ndarray, cols: int) -> str:
    h, w = gray.shape
    new_w = cols
    new_h = max(8, int(h / w * new_w * 0.45))
    small = cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_AREA)
    idx = (small.astype(np.float32) / 255.0 * (len(ASCII_CHARS) - 1)).astype(np.int32)
    idx = np.clip(idx, 0, len(ASCII_CHARS) - 1)
    lines = ["".join(ASCII_CHARS[i] for i in row) for row in idx]
    return "\n".join(lines)


def main() -> None:
    p = argparse.ArgumentParser(description="MP4 → ASCII frames (sampled)")
    p.add_argument("video", type=Path, help="Input .mp4 path")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output .txt (default: <video>_ascii.txt)",
    )
    p.add_argument("-n", "--samples", type=int, default=12, help="Number of frames to sample")
    p.add_argument("-w", "--width", type=int, default=100, help="ASCII width in characters")
    args = p.parse_args()

    video = args.video.resolve()
    if not video.is_file():
        raise SystemExit(f"Not a file: {video}")

    out = args.output or video.with_name(f"{video.stem}_ascii.txt")

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"Could not open: {video}")

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    n = max(1, args.samples)
    indices = (
        [int(i * max(0, total - 1) / max(1, n - 1)) for i in range(n)]
        if total > 0
        else [0]
    )

    chunks: list[str] = [
        f"# ASCII from {video.name}\n# {n} samples, width={args.width} cols\n\n"
    ]

    for target in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, target)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        chunks.append(f"--- frame ~{target} / {total} ---\n")
        chunks.append(frame_to_ascii(gray, cols=args.width))
        chunks.append("\n\n")

    cap.release()

    text = "".join(chunks)
    out.write_text(text, encoding="utf-8")
    print(f"Wrote {out} ({len(text):,} bytes)")


if __name__ == "__main__":
    main()
