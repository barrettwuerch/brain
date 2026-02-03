#!/usr/bin/env python3
"""Backtest-style validation for FOMC keyword base rates.

We simulate: for each held-out transcript, the model only knows transcripts that came before it.
Then we evaluate whether keywords were mentioned.

Output metrics:
- accuracy@50: treat p>=0.5 as predict-mention
- brier score: mean (p - y)^2
- per-keyword confusion counts (optional)

This does NOT require Kalshi market history; it validates the core "base rates from transcripts" thesis.
"""

import json
import re
import time
from dataclasses import dataclass
from typing import Dict, List, Tuple

import requests

BASE = '/Users/bear/.openclaw/workspace/projects/kalshi/base_rates.json'


def fetch_text(url: str) -> str:
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.text


def pdf_to_text(url: str) -> str:
    """Download a PDF and extract text.

    This script is intended to be run either:
    - inside projects/kalshi/news/.venv (recommended), or
    - with system python if pdfminer.six is installed.
    """
    import tempfile, os

    r = requests.get(url, timeout=60)
    r.raise_for_status()
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
        f.write(r.content)
        pdf_path = f.name

    try:
        try:
            from pdfminer.high_level import extract_text  # type: ignore
        except Exception as e:
            raise RuntimeError(
                "pdfminer.six is required. Run: source projects/kalshi/news/.venv/bin/activate && python news/backtest_fomc.py"
            ) from e

        return extract_text(pdf_path) or ''
    finally:
        try:
            os.unlink(pdf_path)
        except Exception:
            pass


def keyword_present(text: str, k: str) -> bool:
    t = text.lower()
    k = k.lower()
    # word boundary-ish; allow spaces in keyword
    if ' ' in k:
        return k in t
    return re.search(r'\b' + re.escape(k) + r'\b', t) is not None


def compute_presence(pages: List[Tuple[str, str]], keywords: List[str]):
    pres = []
    for url, text in pages:
        s = set()
        for k in keywords:
            if keyword_present(text, k):
                s.add(k)
        pres.append((url, s))
    return pres


def base_rates_from_presence(pres, keywords: List[str]) -> Dict[str, float]:
    n = len(pres)
    if n == 0:
        return {k: 0.0 for k in keywords}
    counts = {k: 0 for k in keywords}
    for _url, s in pres:
        for k in s:
            counts[k] += 1
    return {k: counts[k] / n for k in keywords}


def brier(p: float, y: int) -> float:
    return (p - y) ** 2


def main():
    db = json.load(open(BASE))
    keywords = db['keywords']

    # Use the sample URL list we already store (first 10) is not enough.
    # Instead: re-scrape the FOMC PDF URL pattern for the last ~50 available.
    # We'll leverage the cached calendars HTML if present.
    cache_path = '/Users/bear/.openclaw/workspace/projects/kalshi/news/.cache/fomc_calendars.html'
    try:
        html = open(cache_path, 'r', encoding='utf-8').read()
    except Exception:
        html = fetch_text('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')

    # The calendars page reliably contains minutes PDFs like:
    #   /monetarypolicy/files/fomcminutesYYYYMMDD.pdf
    # We derive pressconf transcript PDFs from those dates.
    dates = re.findall(r'fomcminutes(\d{8})\.pdf', html, flags=re.I)
    dates = list(dict.fromkeys(dates))
    pdf_urls = [f"https://www.federalreserve.gov/mediacenter/files/FOMCpresconf{d}.pdf" for d in dates]

    if len(pdf_urls) < 15:
        raise SystemExit(f"Not enough FOMC minutes-derived dates found: {len(pdf_urls)}")

    # take earliest->latest by the numeric date in url
    def key(u):
        m = re.search(r'FOMCpresconf(\d{8})\\.pdf', u)
        return int(m.group(1)) if m else 0

    pdf_urls.sort(key=key)

    # hold out last N
    holdout_n = 5
    train_urls = pdf_urls[:-holdout_n]
    test_urls = pdf_urls[-holdout_n:]

    print(f"train={len(train_urls)} test={len(test_urls)} holdout_n={holdout_n}")

    # Fetch + textify train once
    train_pages = []
    for u in train_urls:
        train_pages.append((u, pdf_to_text(u)))

    train_presence = compute_presence(train_pages, keywords)

    # Evaluate each test transcript sequentially, updating knowledge as we go.
    total_brier = 0.0
    total_acc = 0
    total_labels = 0

    seen_pages = list(train_pages)

    for u in test_urls:
        # rates from what we've seen so far
        pres = compute_presence(seen_pages, keywords)
        rates = base_rates_from_presence(pres, keywords)

        text = pdf_to_text(u)
        y = {k: int(keyword_present(text, k)) for k in keywords}

        for k in keywords:
            p = rates[k]
            total_brier += brier(p, y[k])
            pred = 1 if p >= 0.5 else 0
            total_acc += (1 if pred == y[k] else 0)
            total_labels += 1

        # add this transcript to knowledge for the next iteration
        seen_pages.append((u, text))

        print(f"scored {u}")

    print("---")
    print(f"accuracy@0.5: {total_acc/total_labels:.4f} ({total_acc}/{total_labels})")
    print(f"brier: {total_brier/total_labels:.6f}")


if __name__ == '__main__':
    main()
