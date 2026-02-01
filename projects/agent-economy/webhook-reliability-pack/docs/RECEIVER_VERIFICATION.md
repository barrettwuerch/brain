# Receiver Verification (WRP)

WRP sends **signed** webhooks. This doc is for the **receiver** side.

## What the receiver gets
WRP sends a JSON body (an envelope) and headers like:
- `X-Event-Id`: stable event id (use for dedupe)
- `X-Delivery-Id`: delivery id (attempts for same delivery share this)
- `X-Attempt`: attempt count (1..N)
- `X-Timestamp`: unix ms
- `X-Signature`: `v1=<hex>` HMAC
- `Idempotency-Key`: same as `X-Event-Id`

## What is signed
Signature v1 signs:

```
method + "\n" + path + "\n" + timestamp + "\n" + body_bytes
```

Notes:
- method is `POST`
- path is the URL **path only** (no scheme/host), e.g. `/webhook/agentmail`
- timestamp is the exact `X-Timestamp` header value
- body_bytes are the raw request bytes

## Receiver rules (recommended)
1) Reject requests with timestamp skew > 5 minutes.
2) Recompute HMAC over the exact bytes and compare in constant time.
3) Dedupe using `X-Event-Id` (store “already processed” for some TTL).

---

## Python example (FastAPI)
```py
import hmac
import hashlib
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()

SECRET = b"<your endpoint secret>"


def compute_sig(method: str, path: str, ts: str, body: bytes) -> str:
    msg = method.upper().encode() + b"\n" + path.encode() + b"\n" + ts.encode() + b"\n" + body
    digest = hmac.new(SECRET, msg, hashlib.sha256).hexdigest()
    return "v1=" + digest


@app.post("/webhook")
async def webhook(req: Request):
    body = await req.body()
    ts = req.headers.get("x-timestamp")
    sig = req.headers.get("x-signature")
    if not ts or not sig:
        raise HTTPException(401, "missing signature")

    expected = compute_sig("POST", req.url.path, ts, body)
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(401, "bad signature")

    # Optional: validate timestamp skew here.

    # Process JSON
    payload = await req.json()
    return {"ok": True}
```

## Node example (Express)
Important: you must use the **raw body bytes**.

```js
import express from 'express';
import crypto from 'crypto';

const app = express();

// capture raw body
app.use(express.raw({ type: '*/*' }));

const SECRET = Buffer.from('<your endpoint secret>');

function computeSig(method, path, ts, bodyBuf) {
  const msg = Buffer.concat([
    Buffer.from(method.toUpperCase()), Buffer.from('\n'),
    Buffer.from(path), Buffer.from('\n'),
    Buffer.from(ts), Buffer.from('\n'),
    bodyBuf,
  ]);
  const hex = crypto.createHmac('sha256', SECRET).update(msg).digest('hex');
  return 'v1=' + hex;
}

app.post('/webhook', (req, res) => {
  const ts = req.header('X-Timestamp');
  const sig = req.header('X-Signature');
  if (!ts || !sig) return res.status(401).send('missing signature');

  const expected = computeSig('POST', req.path, ts, req.body);
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  if (!ok) return res.status(401).send('bad signature');

  // parse JSON after verifying
  const json = JSON.parse(req.body.toString('utf8'));
  res.json({ ok: true });
});

app.listen(8001);
```
