#!/usr/bin/env python3
"""Retention helper for polymarket-bot JSONL logs.

Why: long-running logger sessions create large JSONL files.

Features:
- Estimate disk usage for data/*.jsonl
- Optionally gzip files older than N days

Usage:
  python3 scripts/retain_logs.py --data-dir data --list
  python3 scripts/retain_logs.py --data-dir data --gzip-older-days 1

Notes:
- This is conservative: it will not delete anything.
- Gzips only files ending with .jsonl and not already gzipped.
"""

from __future__ import annotations

import argparse
import gzip
import os
import time
from pathlib import Path


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f}{unit}" if unit != "B" else f"{n}B"
        n /= 1024
    return f"{n}B"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--list", action="store_true", help="List JSONL files and sizes")
    ap.add_argument("--gzip-older-days", type=float, default=None, help="Gzip .jsonl older than N days")
    args = ap.parse_args(argv)

    data_dir = Path(args.data_dir).expanduser().resolve()
    files = sorted(data_dir.glob("*.jsonl"))

    now = time.time()
    total = 0

    if args.list:
        print(f"Data dir: {data_dir}")

    for p in files:
        st = p.stat()
        total += st.st_size
        age_days = (now - st.st_mtime) / 86400.0
        if args.list:
            print(f"- {p.name:40s} {human(st.st_size):>8s}  age={age_days:5.2f}d")

        if args.gzip_older_days is not None and age_days >= args.gzip_older_days:
            gz = p.with_suffix(p.suffix + ".gz")
            if gz.exists():
                continue
            # stream compress
            with open(p, "rb") as fin, gzip.open(gz, "wb", compresslevel=6) as fout:
                while True:
                    chunk = fin.read(1024 * 1024)
                    if not chunk:
                        break
                    fout.write(chunk)
            # keep original file (no delete)

    if args.list:
        print(f"Total .jsonl size: {human(total)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
