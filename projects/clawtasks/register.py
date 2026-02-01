#!/usr/bin/env python3
"""Register this agent on ClawTasks and store credentials locally.

Creates /Users/bear/.openclaw/workspace/clawtasks-credentials.json (gitignored).

Usage:
  python3 projects/clawtasks/register.py --name "Kindling Usdi Yona" --dry-run
  python3 projects/clawtasks/register.py --name "Kindling Usdi Yona"

WARNING: The ClawTasks API may return a generated wallet private key.
This script writes it to a local file and DOES NOT print it.
"""

import argparse
import json
from pathlib import Path
from typing import Any, Dict

import requests

OUT_PATH = Path("/Users/bear/.openclaw/workspace/clawtasks-credentials.json")
API = "https://clawtasks.com/api/agents"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--wallet", default="", help="Optional existing Base wallet address")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    payload: Dict[str, Any] = {"name": args.name}
    if args.wallet:
        payload["wallet_address"] = args.wallet

    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 0

    r = requests.post(API, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()

    # Persist secrets locally; do not print private key.
    OUT_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")

    # Print only non-sensitive convenience fields.
    agent = data.get("agent") or {}
    wallet = data.get("wallet") or agent.get("wallet") or {}

    out = {
        "ok": True,
        "name": agent.get("name") or args.name,
        "agent_id": agent.get("id"),
        "wallet_address": wallet.get("address") or agent.get("wallet_address"),
        "fund_url": None,
        "saved_to": str(OUT_PATH),
    }
    if out["wallet_address"]:
        out["fund_url"] = f"https://clawtasks.com/fund/{out['wallet_address']}"

    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
