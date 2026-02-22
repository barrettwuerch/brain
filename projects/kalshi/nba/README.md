# Kalshi NBA Live Probability Bot (v0 — paper/shadow)

Implements the **NBA live probability mean reversion** strategy described in `~/Downloads/NBA_Trading_Bot_Product_Document.docx`.

## Locked strategy rules (implemented)
- Probability = **mid of top-of-book implied**:
  - `midProb = (bestYesBidProb + (1 - bestNoBidProb)) / 2`
  - cents form: `midC = round((yesBidC + (100 - noBidC)) / 2)`
- Entry constraints:
  - Skip if spread > **5¢**
  - Skip if depth < **10 contracts** near mid
  - Place **limit at mid**; cancel if unfilled after **30s**
- Pregame probability baseline:
  - First observed `midProb` **at/after scheduled tip-off**, immutable.
- One trade per game, max.
- Staleness:
  - If game state age > **60s**, freeze new entries
  - If position open and game state age > **3m**, force exit (safety)

## Run (paper)
```bash
cd projects/kalshi/nba
node src/nba_bot.mjs --config config.paper.json
```

### Credentials
This project expects Kalshi API credentials in environment variables (or an env file pointed to by config):
- `KALSHI_KEY_ID`
- `KALSHI_PRIVATE_KEY_PEM` (full PEM text)

No secrets should be committed.

## NBA market discovery (locked)
- Series: `KXNBAGAME`
- Event ticker pattern: `KXNBAGAME-{YY}{MON}{DD}{AWAYTEAM}{HOMETEAM}`
- Discovery call:
  - `GET /trade-api/v2/markets?series_ticker=KXNBAGAME&status=open`

## Status
- v0 scaffolding: **in progress**
- Discovery + baseline locking: **implemented**
- ESPN game-state + entry/exit logic: **next**
- Live execution: **not implemented**
