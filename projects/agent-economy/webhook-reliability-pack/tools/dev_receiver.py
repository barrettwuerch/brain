#!/usr/bin/env python3
"""Minimal local webhook receiver for WRP smoke tests.

Runs an HTTP server that accepts POSTs at /webhook and prints headers + body.
Optionally verifies WRP signature if you set WRP_ENDPOINT_SECRET.

Usage:
  export WRP_ENDPOINT_SECRET='sek'
  python3 tools/dev_receiver.py --port 8001

Then in another terminal:
  python3 -m wrp.cli --postgres "$WRP_DSN" add-endpoint --url http://127.0.0.1:8001/webhook --secret sek
  python3 -m wrp.cli --postgres "$WRP_DSN" enqueue --endpoint <ep_id> --type test --payload '{"hello":"world"}'
"""

import argparse
import hmac
import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


def compute_sig(secret: str, method: str, path: str, ts: str, body: bytes) -> str:
    msg = method.upper().encode() + b"\n" + path.encode() + b"\n" + ts.encode() + b"\n" + body
    digest = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return "v1=" + digest


class Handler(BaseHTTPRequestHandler):
    server_version = "wrp-dev-receiver/0.1"

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)

        print("\n--- incoming webhook ---")
        print("path:", self.path)
        print("headers:")
        for k, v in dict(self.headers).items():
            print(f"  {k}: {v}")
        print("body:")
        try:
            print(json.dumps(json.loads(body.decode("utf-8")), indent=2))
        except Exception:
            print(body.decode("utf-8", errors="replace"))

        secret = os.environ.get("WRP_ENDPOINT_SECRET", "")
        ts = self.headers.get("X-Timestamp", "")
        sig = self.headers.get("X-Signature", "")
        if secret:
            expected = compute_sig(secret, "POST", self.path, ts, body)
            ok = ts != "" and sig != "" and hmac.compare_digest(expected, sig)
            print("signature:", "OK" if ok else "BAD")
            if not ok:
                print("expected:", expected)

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8001)
    args = ap.parse_args()

    httpd = HTTPServer(("127.0.0.1", args.port), Handler)
    print(f"WRP dev receiver listening on http://127.0.0.1:{args.port}/webhook")
    print("Set WRP_ENDPOINT_SECRET to verify signatures.")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
