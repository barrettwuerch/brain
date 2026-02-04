# Augur-weather (paper) — fast-cycle weather bond harvesting

Status: **paper**.

## Run
```bash
node projects/kalshi/augur_v2/weather/weather_bot.mjs --config projects/kalshi/augur_v2/weather/config.paper.json
```

## What it does
- Scans Kalshi weather markets settling in the next **12–36h**.
- Looks for near-certain sides priced **$0.93–$0.99** with tight spread.
- Applies a simple NWS sanity check (strike comfortably inside forecast).
- Paper-buys and tracks positions until settlement.
- Uses NOAA NCEI CDO (GHCND) daily TMAX/TMIN to score outcomes once data is available.
