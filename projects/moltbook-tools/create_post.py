#!/usr/bin/env python3
"""Create a Moltbook post.

Usage:
  python3 create_post.py --submolt crypto --title "..." --content-file /path/to/content.md

Requires moltbook api key at /Users/bear/.openclaw/workspace/moltbook-credentials.json
"""

import argparse
import json
import time
from typing import Any, Optional

import requests

CREDS_PATH = "/Users/bear/.openclaw/workspace/moltbook-credentials.json"
BASE = "https://www.moltbook.com/api/v1"


def load_key() -> str:
    with open(CREDS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)["api_key"]


def req(method: str, path: str, api_key: str, params=None, json_body=None, timeout=30, tries=5) -> Any:
    url = f"{BASE}{path}"
    headers = {"Authorization": f"Bearer {api_key}"}
    if json_body is not None:
        headers["Content-Type"] = "application/json"

    last_err: Optional[Exception] = None
    for i in range(tries):
        try:
            r = requests.request(method, url, headers=headers, params=params, json=json_body, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_err = e
            time.sleep(0.7 * (2 ** i))
    raise RuntimeError(f"Request failed after {tries} tries: {method} {url}: {last_err}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--submolt", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--content-file", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    content = open(args.content_file, "r", encoding="utf-8").read()

    body = {
        "submolt": args.submolt,
        "title": args.title,
        "content": content,
    }

    if args.dry_run:
        print(json.dumps(body, indent=2)[:8000])
        return 0

    api_key = load_key()
    resp = req("POST", "/posts", api_key, json_body=body, timeout=60)

    # Common response shape: { post: { id, ... } }
    post = resp.get("post", resp) if isinstance(resp, dict) else {}
    pid = post.get("id")
    url = post.get("url") or (f"https://www.moltbook.com/post/{pid}" if pid else None)

    out = {"id": pid, "url": url, "submolt": post.get("submolt"), "title": post.get("title")}
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
