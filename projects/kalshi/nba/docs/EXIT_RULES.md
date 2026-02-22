# Exit rules (defaults)

## Locked default (2026-02-22)
- **Target:** 68¢
- **Rule B stop:**
  - if `score_deficit <= 8`: **no stop** until Q4 forced-close
  - else: stop at **25¢**
- **Q4 forced-close:** exit at Q4 start regardless

## Notes
The historical grid search showed fixed stops were negative EV regardless of target.
Rule B (letting small-deficit setups breathe) made EV positive across all targets.
