# 90-minute sprint plan (execution)

## Goal
Turn the Claude PRD callouts into concrete operational improvements that increase the chance we get a real OOS verdict quickly, safely, and without babysitting.

## Scope (ship in this sprint)
1) **Latency sensitivity** (paper)
- Add `--decision-lag-s` (or similar) to `paper_runner.py` to simulate slower reaction.
- Emit results that show how performance changes under lag.

2) **Data retention / rotation tooling**
- Add a small script to:
  - estimate JSONL disk footprint
  - gzip old JSONL files
  - optionally delete/compress by age
- Update RUNBOOK with suggested operational workflow.

3) **Tuner reporting improvements**
- Already added `--min-test-trades`; ensure reports surface:
  - valid_fold_ratio
  - trades-per-fold summaries

4) **Ops alerting plan (MVP)**
- Write an ops note with the minimal path to “don’t babysit it overnight”.

## Non-goals
- Implement full VWAP fills (planned separately per `notes/vwap-depth-plan.md`).
- Live trading.
