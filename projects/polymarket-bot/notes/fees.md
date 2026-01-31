# Polymarket CLOB fees (15m Up/Down crypto markets)

This repo trades Polymarket **15‑minute crypto Up/Down** markets. Polymarket has enabled **taker fees** on these markets to fund a **Maker Rebates** program.

## Primary source of truth

### Fee flag / parameter (token-specific)

Polymarket exposes a simple endpoint to determine whether a given **token_id** is fee-enabled and what `feeRateBps` value must be used in signed orders:

- `GET https://clob.polymarket.com/fee-rate?token_id={token_id}`
  - Fee-enabled example response: `{ "fee_rate_bps": 1000 }`
  - Fee-free example response: `{ "fee_rate_bps": 0 }`

Docs: **Maker Rebates Program** (“Step 1: Fetch the Fee Rate”) 
<https://docs.polymarket.com/developers/market-makers/maker-rebates-program>

### Requirement for order signing

If you place orders via REST / custom signing, the `feeRateBps` must be included **inside the signed order payload** (CLOB validates signatures against it).

Docs: **Create/Place Order** (`feeRateBps` field in the `order` object)
<https://docs.polymarket.com/developers/CLOB/orders/create-order>

## Fee behavior (taker fee curve) — implementable approximation

Polymarket documents that fees:

- are charged in **USDC**
- apply to **taker flow** (marketable orders)
- are the **same for buys and sells**
- **vary with share price**, peaking near **50%** and decreasing toward **0%/100%**

Source: <https://docs.polymarket.com/developers/market-makers/maker-rebates-program>

### Anchor table from docs (fee_rate_bps = 1000)

The doc provides example fees for **100 shares**. Converting those to an **effective fee rate** (fee / notional) gives:

| price | notional (100 sh) | fee (USDC) | effective % | effective bps |
|---:|---:|---:|---:|---:|
| 0.10 | 10 | 0.02 | 0.20% | 20 |
| 0.20 | 20 | 0.13 | 0.65% | 65 |
| 0.30 | 30 | 0.33 | 1.10% | 110 |
| 0.40 | 40 | 0.58 | 1.45% | 145 |
| 0.50 | 50 | 0.78 | 1.56% | 156 |
| 0.60 | 60 | 0.86 | 1.43% | 143 |
| 0.70 | 70 | 0.77 | 1.10% | 110 |
| 0.80 | 80 | 0.51 | 0.64% | 64 |
| 0.90 | 90 | 0.18 | 0.20% | 20 |

Notes:
- The table is **symmetric-ish** but not perfectly (0.40 vs 0.60).
- Docs don’t publish a closed-form curve; this table is enough to implement a decent sim.

### Practical implication: fee_rate_bps ≠ effective bps

`fee_rate_bps` (e.g. `1000`) is a **market parameter** you must include in signed orders.
It is **not** the constant effective fee rate.

For simulation, we can approximate the effective fee bps as a function of price using the anchor table above.

## Recommended implementation approach

### 1) Live trading / signing

- Always query `/fee-rate?token_id=...` when you discover a new `token_id` from Gamma.
- Store the returned integer as the per-token `feeRateBps`.
- Include that exact value in any signed order payload.

This is the only requirement to successfully trade fee-enabled 15m markets (per docs).

### 2) Paper trading / backtests (this repo’s `paper_runner.py`) — implement now

`paper_runner.py` currently takes a constant `--fee-bps` and computes round-trip fees as:

```py
fee = (fee_bps / 10000.0) * (entry_px + exit_px) * size
```

That assumes a constant % fee on notional. For 15m markets, fees are **price-dependent**.

#### Recommended drop-in approach: table interpolation

Implement two helpers and replace the fee calculation.

**A) Effective fee bps as a function of price** (anchored to Polymarket’s published table for `fee_rate_bps=1000`):

```py
# price -> effective fee bps (from docs; see table above)
ANCHOR = [
  (0.10, 20),
  (0.20, 65),
  (0.30, 110),
  (0.40, 145),
  (0.50, 156),
  (0.60, 143),
  (0.70, 110),
  (0.80, 64),
  (0.90, 20),
]

def interp_effective_bps(px: float) -> float:
    # clamp to table range (fees near 0/1 approach 0; this is conservative-ish)
    if px <= ANCHOR[0][0]:
        return ANCHOR[0][1]
    if px >= ANCHOR[-1][0]:
        return ANCHOR[-1][1]

    for (p0, b0), (p1, b1) in zip(ANCHOR, ANCHOR[1:]):
        if p0 <= px <= p1:
            t = (px - p0) / (p1 - p0)
            return b0 + t * (b1 - b0)
    return ANCHOR[-1][1]


def effective_fee_bps(px: float, fee_rate_bps: int) -> float:
    # docs show the curve for fee_rate_bps=1000
    # scaling by fee_rate_bps/1000 is a reasonable assumption if Polymarket changes amplitude
    base = interp_effective_bps(px)
    return base * (fee_rate_bps / 1000.0)
```

**B) Fee in USDC for one taker leg** (buy *or* sell):

```py
def taker_fee_usdc(px: float, shares: float, fee_rate_bps: int) -> float:
    notional = px * shares  # USDC
    bps = effective_fee_bps(px, fee_rate_bps)
    return (bps / 10_000.0) * notional
```

**Then in `paper_runner.py`**, replace the current round-trip fee line with:

```py
fee = taker_fee_usdc(p.entry_px, p.size, fee_rate_bps) + taker_fee_usdc(exit_px, p.size, fee_rate_bps)
```

This is immediately implementable and consistent with Polymarket’s published examples.

#### Minimal alternative (one-flag, pessimistic)

If you don’t want price-dependence yet:
- set `--fee-bps 156` (peak effective fee at ~0.50) and keep the existing calculation.

## Endpoint examples + gotchas

### Endpoint examples

```bash
curl "https://clob.polymarket.com/fee-rate?token_id=71321045679252212594626385532706912750332728571942532289631379312455583992563"
# -> {"fee_rate_bps":1000}

curl "https://clob.polymarket.com/fee-rate?token_id=..."
# -> {"fee_rate_bps":0}  (fee-free)
```

### Gotchas

- **Token-specific:** fee is per **outcome token_id**, not per event slug.
- **Signing:** `feeRateBps` must be included in the signed order payload for fee-enabled markets.
  - It is shown as a **string** in docs examples (e.g. `"feeRateBps": "1000"`).
  - Source: <https://docs.polymarket.com/developers/market-makers/maker-rebates-program> and <https://docs.polymarket.com/developers/CLOB/orders/create-order>
- **Simulation vs reality:** We can simulate fees with an interpolation approximation; live trading must use the on-chain/operator-validated `feeRateBps` value.
- **Rollover:** 15m markets roll frequently; cache feeRateBps by token_id with TTL and refresh on new token_id.

## Caching strategy

### Fee-rate caching

`/fee-rate` is cheap and (likely) slow-changing, but avoid hammering it.

Suggested cache:

- Key: `token_id`
- Value: `{ fee_rate_bps: int, fetched_at: monotonic_time }`
- TTL: **1 hour** (or until the market `slug`/token_id rolls over)

Also cache negative results (e.g., failures) briefly (e.g., 30–60s) to prevent tight retry loops.

### When to refresh

- On first sight of a `token_id`
- On TTL expiry
- On explicit mismatch errors (if the CLOB rejects an order due to missing/wrong `feeRateBps`)

## Robust probing steps & fallbacks

If the endpoint behavior changes or is temporarily unavailable:

1) Try:
   - `GET https://clob.polymarket.com/fee-rate?token_id={token_id}`

2) If non-200 or malformed JSON:
   - retry with backoff (e.g., 250ms, 1s, 5s)
   - treat as **unknown** until recovered

3) If still unknown and you must proceed:
   - **safe fallback for signing**: do not submit orders (or only submit post-only maker orders) until feeRateBps is known, because `feeRateBps` is part of the signature for fee-enabled markets.
   - **safe fallback for simulation**: assume `fee_rate_bps = 1000` for known 15m markets and `0` otherwise, but log loudly.

4) Cross-check (optional):
   - Polymarket notes “Currently, only 15-minute crypto markets have fees enabled.”
     Source: <https://docs.polymarket.com/developers/market-makers/maker-rebates-program>

## Non-goal / avoid confusion

Polymarket Exchange (US DCM) publishes a separate trading fee schedule (e.g., 10 bps taker fee on premium).
Do **not** apply that to these 15m CLOB markets.

Reference only: <https://www.polymarketexchange.com/fees-hours.html>
