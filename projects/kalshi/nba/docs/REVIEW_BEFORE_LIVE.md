# Review before live (requested)

## 1) `src/market_math.mjs`
- Confirm the mid-of-book implied probability implementation:
  - cents form: `midLockedC = round((YES_best_bidC + (100 - NO_best_bidC)) / 2)`
  - probability form: `midProb = midLockedC / 100`
- Confirm spread check uses implied YES ask from NO bid: `ya = 100 - NO_bidC`
- Confirm depth check aggregates depth near mid (within ±1¢) and is compared against `minDepthContractsNearMid`.

## 2) Entry condition block
- Verify behavior when baseline is missing:
  - If `pregameLockedProb` is not set for a game (e.g. bot started mid-game), bot must **skip the game entirely**.
  - No inference/backfill of baseline allowed.

## 3) Staleness gates
- Verify:
  - `staleFreezeEntryMs` (60s) blocks **new entries only**.
  - Existing open positions are not closed until `staleForceExitMs` (3m).

## 4) JSONL schema
- Verify every decision that does **not** place an order includes `skip_reason`.
- Expected skip reasons:
  - `spread_too_wide`
  - `depth_too_low`
  - `no_baseline`
  - `stale_game_state`
  - `q4_or_later`
  - `already_traded`
  - `not_favorite`
  - `not_losing`
  - `prob_out_of_range`
