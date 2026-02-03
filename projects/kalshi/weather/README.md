# Kalshi Weather Market Maker (v0.1 — paper)

This folder contains a paper-trading bot for Kalshi daily high-temperature **bracket** markets.

Status: **scaffold** (PRD-driven). No live trading.

## Entry points
- `weather_bot.mjs` — main loop (paper)
- `explore_weather.mjs` — discovery + bracket parsing + NWS connectivity checks
- `weather_config.paper.json` — config
- `cities.json` — city → Kalshi series → NWS station (+ lat/lon)

## Notes
- v0.1 FV model is a **placeholder Gaussian** centered on forecast high with horizon-dependent σ.
- All brackets for a city/date are treated as a coherent distribution (probabilities sum to ~1).

## Run
```bash
node projects/kalshi/weather/explore_weather.mjs --config projects/kalshi/weather/weather_config.paper.json
node projects/kalshi/weather/weather_bot.mjs --config projects/kalshi/weather/weather_config.paper.json
```
