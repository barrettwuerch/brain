#!/usr/bin/env python3
"""Fetch a Moltbook post (and comments if present) with retries.

Usage:
  python3 fetch_post.py --query "How Agents Can Actually Make Money" --limit 50

Requires moltbook api key at workspace/moltbook-credentials.json
"""

import argparse
import json
import time
from typing import Any, Dict, List, Optional

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

    last_err = None
    for i in range(tries):
        try:
            r = requests.request(method, url, headers=headers, params=params, json=json_body, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_err = e
            time.sleep(0.7 * (2 ** i))
    raise RuntimeError(f"Request failed after {tries} tries: {method} {url}: {last_err}")


def normalize_posts(resp: Any) -> List[Dict[str, Any]]:
    # observed shapes: list[post] OR {posts:{items:[...]}} OR {items:[...]}
    if isinstance(resp, list):
        return [x for x in resp if isinstance(x, dict)]
    if isinstance(resp, dict):
        if "posts" in resp and isinstance(resp["posts"], dict) and isinstance(resp["posts"].get("items"), list):
            return resp["posts"]["items"]
        if isinstance(resp.get("items"), list):
            return resp["items"]
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", required=True)
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--sort", default="new")
    args = ap.parse_args()

    api_key = load_key()

    posts_resp = req("GET", "/posts", api_key, params={"sort": args.sort, "limit": args.limit}, timeout=45)
    posts = normalize_posts(posts_resp)

    q = args.query.lower()
    matches = [p for p in posts if q in (p.get("title") or "").lower() or q in (p.get("content") or "").lower()]

    print(f"fetched {len(posts)} posts, matches={len(matches)}")
    for p in matches[:10]:
        print("-", p.get("id"), p.get("title"))

    if not matches:
        return

    target = matches[0]
    pid = target.get("id")
    full = req("GET", f"/posts/{pid}", api_key, timeout=60)
    # common: {success, post}
    post = full.get("post", full) if isinstance(full, dict) else {}

    out = {
        "id": pid,
        "title": post.get("title"),
        "submolt": post.get("submolt"),
        "author": (post.get("author") or {}).get("name") if isinstance(post.get("author"), dict) else post.get("author"),
        "created_at": post.get("created_at"),
        "content": post.get("content"),
        "comment_count": post.get("comment_count"),
        "comments": post.get("comments"),
    }

    print("\n---\nJSON:\n")
    print(json.dumps(out, indent=2)[:12000])


if __name__ == "__main__":
    main()
