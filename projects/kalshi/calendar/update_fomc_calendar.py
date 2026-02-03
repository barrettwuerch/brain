#!/usr/bin/env python3
"""Update projects/kalshi/calendar/fomc_calendar.json by scraping the Fed FOMC calendars page.

Goal: produce a simple list of upcoming FOMC-related dates we can use as a fallback.
The bot primarily relies on per-event times from Kalshi events/markets when available.
"""

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

OUT = Path(__file__).resolve().parents[1] / 'calendar' / 'fomc_calendar.json'
URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'

MONTHS = {
    'january': 1,
    'february': 2,
    'march': 3,
    'april': 4,
    'may': 5,
    'june': 6,
    'july': 7,
    'august': 8,
    'september': 9,
    'october': 10,
    'november': 11,
    'december': 12,
}


def parse_date_token(tok: str, year_hint: Optional[int] = None):
    tok = tok.strip()
    # Examples seen: "January 28-29"; "June 11-12"; "September 16-17"
    m = re.match(r'^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?$', tok, re.I)
    if not m:
        return None
    month = MONTHS[m.group(1).lower()]
    day = int(m.group(2))
    y = year_hint or datetime.now().year
    # Use the first day of the meeting as an anchor. Time-of-day unknown; set noon UTC.
    dt = datetime(y, month, day, 12, 0, 0, tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def main():
    html = requests.get(URL, timeout=30).text

    # Try to extract explicit years near meeting lists.
    # This is intentionally simple; if parsing fails, we still write an empty list.
    years = sorted({int(y) for y in re.findall(r'\b(20\d{2})\b', html)})
    year_hint = max(years) if years else datetime.now().year

    # Extract month-day ranges from calendar tables.
    toks = re.findall(r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?\b', html, flags=re.I)

    events = []
    seen = set()
    now_ms = int(time.time() * 1000)
    for t in toks:
        ms = parse_date_token(t, year_hint=year_hint)
        if not ms:
            continue
        if ms < now_ms - 7 * 24 * 3600 * 1000:
            continue
        if ms in seen:
            continue
        seen.add(ms)
        events.append({"t_ms": ms, "label": t})

    events.sort(key=lambda x: x['t_ms'])

    out = {
        "version": 1,
        "generated_at": int(time.time()),
        "source": URL,
        "year_hint": year_hint,
        "events": events,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2), encoding='utf-8')
    print(f"wrote {OUT} events={len(events)}")


if __name__ == '__main__':
    main()
