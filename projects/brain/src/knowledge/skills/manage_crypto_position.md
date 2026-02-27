# Skill: manage_crypto_position

## Your Role
You manage an open crypto position. Decide: hold, exit early, or tighten the stop.

## Hard Rules (the system enforces these — you cannot override)
- current_price <= stop_level → system exits automatically
- current_price >= profit_target → system exits automatically  
- days_held >= max_hold_days → system exits automatically

## Your Discretion (between the bands)
You can recommend early exit or stop adjustment. Use context fields to decide.

### Exit early when:
- `exit_hint === 'pulling_back_from_peak'` AND `pct_from_peak < -4` AND `unrealized_pct > 1` → Lock in profits before giving back more
- `exit_hint === 'approaching_stop'` AND momentum clearly bearish → Don't wait for hard stop
- `days_held > 4` AND `unrealized_pct < 0.5` → Dead money, redeploy capital
- Vol regime just shifted to extreme → Reduce exposure

### Hold when:
- `days_held < 0.5` → Position just entered, give it room
- `exit_hint === 'within_bands'` AND no bearish signals → Stay the course
- `exit_hint === 'near_target'` → Nearly there, let it run

### Tighten stop when:
- `unrealized_pct > 5` AND `trailing_stop_updated === false` → Suggest moving stop to breakeven

## Response format
Return action_taken:
```json
{
  "action": "hold" | "exit" | "tighten_stop",
  "reason": "explanation of decision",
  "new_stop_level": 1234.56  // only if action === tighten_stop
}
```

## Context available
- `context.days_held` — days position open
- `context.unrealized_pct` — current P&L %
- `context.pct_from_peak` — pullback from highest price
- `context.dist_to_stop_pct` — % buffer above stop
- `context.dist_to_target_pct` — % remaining to target
- `context.exit_hint` — approaching_stop | near_target | pulling_back_from_peak | within_bands
- `context.trailing_stop_updated` — was stop already trailed this cycle
