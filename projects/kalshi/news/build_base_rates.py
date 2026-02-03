#!/usr/bin/env python3
"""Build base-rate keyword frequencies for event types.

Current scope:
- White House transcripts: scrape transcript-like pages.
- FOMC press conference transcripts: scrape calendar page for PDF links and parse PDFs.

Outputs:
- ../base_rates.json (overwrites)

This is deliberately simple and auditable:
- Downloads HTML/PDF sources
- Extracts visible text
- Counts keyword presence
- Computes per-event-type probability of >=1 mention per transcript

NOTE: This computes *mention probability*, not counts.
"""

import json
import os
import re
import time
from dataclasses import dataclass
from typing import Dict, List, Tuple, Optional

import requests
from bs4 import BeautifulSoup
from pdfminer.high_level import extract_text

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(os.path.dirname(ROOT), "base_rates.json")
KEYWORDS_PATH = os.path.join(ROOT, "keywords.txt")
SOURCES_PATH = os.path.join(ROOT, "sources.json")
CACHE_DIR = os.path.join(ROOT, ".cache")

USER_AGENT = "OpenClaw-KalshiBot/0.5 (base rate builder)"


def load_keywords() -> List[str]:
    kws = []
    with open(KEYWORDS_PATH, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            kws.append(s.lower())
    return kws


def http_get(url: str) -> str:
    r = requests.get(url, headers={"user-agent": USER_AGENT}, timeout=30)
    r.raise_for_status()
    return r.text


def http_get_bytes(url: str) -> bytes:
    r = requests.get(url, headers={"user-agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    return r.content


def cache_get(url: str, cache_key: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    p = os.path.join(CACHE_DIR, cache_key)
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    text = http_get(url)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)
    time.sleep(0.5)
    return text


def visible_text_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style", "noscript"]):
        t.extract()
    text = soup.get_text(" ")
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp_path = os.path.join(CACHE_DIR, f"tmp_{int(time.time()*1000)}.pdf")
    with open(tmp_path, "wb") as f:
        f.write(pdf_bytes)
    try:
        txt = extract_text(tmp_path) or ""
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    txt = re.sub(r"\s+", " ", txt).strip().lower()
    return txt


def keyword_present(text: str, keyword: str) -> bool:
    # phrase-aware: simple substring; normalize punctuation boundaries for single words
    if " " in keyword:
        return keyword in text
    # word boundary match (approx)
    return re.search(r"\b" + re.escape(keyword) + r"\b", text) is not None


def extract_whitehouse_transcript_links(index_html: str) -> List[str]:
    soup = BeautifulSoup(index_html, "lxml")
    urls = set()
    for a in soup.select("a[href]"):
        href = a.get("href")
        if not href:
            continue
        if href.startswith("/"):
            href = "https://www.whitehouse.gov" + href
        if not href.startswith("https://www.whitehouse.gov/"):
            continue
        # Keep transcript-like content pages; skip obvious nav/tag pages.
        if any(x in href for x in ["/page/", "/category/", "/tag/", "?" ]):
            continue
        if not any(x in href for x in [
            "/briefings-statements/",
            "/remarks/",
            "/speeches/",
            "/news/",
            "/presidential-actions/",
        ]):
            continue
        urls.add(href.split("#")[0])
    return sorted(urls)


def compute_presence_matrix(pages: List[Tuple[str, str]], keywords: List[str]) -> List[Tuple[str, set]]:
    """Return list of (url, set(keywords_present))."""
    out = []
    for url, text in pages:
        present = set()
        for k in keywords:
            if keyword_present(text, k):
                present.add(k)
        out.append((url, present))
    return out


def compute_base_rates(presence: List[Tuple[str, set]], keywords: List[str]) -> Dict[str, int]:
    """Return probability in cents (0-100) that keyword appears at least once."""
    if not presence:
        return {k: 0 for k in keywords}

    present_counts = {k: 0 for k in keywords}
    for _url, present in presence:
        for k in present:
            present_counts[k] += 1

    total = len(presence)
    rates = {k: int(round(100 * present_counts[k] / total)) for k in keywords}
    return rates


def compute_co_occurrence(presence: List[Tuple[str, set]], keywords: List[str]) -> Dict[str, Dict[str, float]]:
    """Compute conditional probabilities P(other|kw) based on co-occurrence in transcripts."""
    if not presence:
        return {k: {} for k in keywords}

    count = {k: 0 for k in keywords}
    pair = {k: {o: 0 for o in keywords if o != k} for k in keywords}

    for _url, present in presence:
        for k in present:
            count[k] += 1
            for o in present:
                if o == k:
                    continue
                if o in pair[k]:
                    pair[k][o] += 1

    co = {k: {} for k in keywords}
    for k in keywords:
        if count[k] == 0:
            continue
        for o, n in pair[k].items():
            if n:
                co[k][o] = round(n / count[k], 3)
    return co


def extract_fomc_presconf_pdf_links(calendar_html: str) -> List[str]:
    """Derive press conference transcript PDF URLs from FOMC calendar page.

    The calendar page reliably includes minutes PDF links like:
      /monetarypolicy/files/fomcminutes20251210.pdf

    We extract the YYYYMMDD and construct:
      https://www.federalreserve.gov/mediacenter/files/FOMCpresconfYYYYMMDD.pdf

    Then we attempt to download; missing files are skipped later.
    """
    soup = BeautifulSoup(calendar_html, "lxml")
    dates = set()
    for a in soup.select('a[href]'):
        href = a.get('href') or ''
        m = re.search(r"fomcminutes(\d{8})\.pdf", href)
        if m:
            dates.add(m.group(1))
    # Construct PDF URLs
    urls = [f"https://www.federalreserve.gov/mediacenter/files/FOMCpresconf{d}.pdf" for d in sorted(dates, reverse=True)]
    return urls


def main():
    keywords = load_keywords()
    with open(SOURCES_PATH, "r", encoding="utf-8") as f:
        sources = json.load(f)

    # White House
    wh_links = set()
    for idx, wh_index in enumerate(sources["white_house_transcripts"]["index_urls"]):
        try:
            wh_index_html = cache_get(wh_index, f"whitehouse_index_{idx}.html")
        except Exception:
            continue
        wh_links.update(extract_whitehouse_transcript_links(wh_index_html))

    links = sorted(wh_links)
    links = links[:120]

    wh_pages = []
    for i, url in enumerate(links):
        key = f"whitehouse_{i}.html"
        try:
            html = cache_get(url, key)
            text = visible_text_from_html(html)
            if len(text) < 1500:
                continue
            wh_pages.append((url, text))
        except Exception:
            continue

    wh_presence = compute_presence_matrix(wh_pages, keywords)
    wh_rates = compute_base_rates(wh_presence, keywords)
    wh_co = compute_co_occurrence(wh_presence, keywords)

    # FOMC press conference transcripts (PDF)
    fomc_calendar_url = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
    cal_html = cache_get(fomc_calendar_url, 'fomc_calendars.html')
    pdf_links = extract_fomc_presconf_pdf_links(cal_html)
    pdf_links = pdf_links[:40]

    fomc_pages = []
    for i, url in enumerate(pdf_links):
        try:
            pdf = http_get_bytes(url)
        except Exception:
            continue
        try:
            text = text_from_pdf_bytes(pdf)
            if len(text) < 2000:
                continue
            fomc_pages.append((url, text))
            time.sleep(0.5)
        except Exception:
            continue

    fomc_presence = compute_presence_matrix(fomc_pages, keywords)
    fomc_rates = compute_base_rates(fomc_presence, keywords)
    fomc_co = compute_co_occurrence(fomc_presence, keywords)

    out = {
        "version": 4,
        "generated_at": int(time.time()),
        "keywords": keywords,
        "samples": {
            "WHITE_HOUSE": {
                "count": len(wh_pages),
                "urls": [u for u, _ in wh_pages[:10]],
            },
            "FOMC": {
                "count": len(fomc_pages),
                "urls": [u for u, _ in fomc_pages[:10]],
            },
        },
        "event_types": {
            "WHITE_HOUSE": wh_rates,
            "FOMC": fomc_rates,
        },
        "co_occurrence": {
            "WHITE_HOUSE": wh_co,
            "FOMC": fomc_co,
        }
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, sort_keys=True)
        f.write("\n")

    print(f"Wrote {OUT_PATH}")
    print(f"WHITE_HOUSE transcripts used: {len(wh_pages)}")


if __name__ == "__main__":
    main()
