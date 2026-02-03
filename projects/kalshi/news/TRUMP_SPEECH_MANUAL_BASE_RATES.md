# TRUMP_SPEECH manual base rates (v0.75)

Goal: get a **first-pass, current-era** base rate table for Kalshi `TRUMP_SPEECH` mention markets **without building a scraper**.

We want:
- ~15–20 **recent (2025–2026)** Trump events
- Mixed contexts (rally / press conference / policy address / bilateral remarks)
- For each event, whether each keyword was mentioned **≥1 time**

Keywords (from `projects/kalshi/news/keywords.txt`):
- inflation
- recession
- tariffs
- border
- economy
- jobs
- housing
- bitcoin
- immigration
- china
- ukraine
- nato
- climate
- ai

## Workflow (90 minutes)

### 1) Collect sources (15–20 events)
Use YouTube (auto captions), Rev.com pages, or other reliable transcript pages.

For each event, record:
- `url`
- `date` (YYYY-MM-DD)
- `context` (rally | presser | bilateral | policy | other)
- `notes` (optional)

### 2) For each event, mark keyword presence
For each keyword, record `1` if it appears ≥1 time in captions/transcript, else `0`.

Tip: YouTube captions allow Ctrl+F in the transcript panel.

### 3) Compute base rates
For each keyword:

`rate% = round(100 * (sum(presence) / N))`

Where N is number of events.

### 4) Update `projects/kalshi/base_rates.json`
Add:
- `samples.TRUMP_SPEECH.count = N`
- `samples.TRUMP_SPEECH.urls = [first 10 urls]` (or all if you want)
- `event_types.TRUMP_SPEECH = { keyword: rate% }`
- optionally `co_occurrence.TRUMP_SPEECH` later (can be empty initially)

Also keep conviction conservative:
- In config, cap TRUMP_SPEECH confidence at LOW initially until we have scored resolutions.

## Data capture template (CSV-ish)

Copy/paste into a sheet:

url,date,context,ai,bitcoin,border,china,climate,economy,housing,immigration,inflation,jobs,nato,recession,tariffs,ukraine,notes

## Optional local calculator
If you fill the CSV above, we can write a tiny script to compute rates and output JSON.
