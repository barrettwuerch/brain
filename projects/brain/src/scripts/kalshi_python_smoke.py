#!/usr/bin/env python3
import os, sys, base64, time, json

import requests
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization


def load_key_from_env():
    raw = os.environ.get('KALSHI_PRIVATE_KEY', '')
    if not raw:
        raise RuntimeError('Missing env KALSHI_PRIVATE_KEY')
    pem = raw.replace('\\n', '\n').encode('utf-8')
    return serialization.load_pem_private_key(pem, password=None)


def sign_message(private_key, msg: str) -> str:
    sig = private_key.sign(
        msg.encode('utf-8'),
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=hashes.SHA256().digest_size,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(sig).decode('ascii')


def main():
    key_id = os.environ.get('KALSHI_KEY_ID', '').strip()
    if not key_id:
        raise RuntimeError('Missing env KALSHI_KEY_ID')

    host = os.environ.get('KALSHI_BASE_URL', 'https://trading-api.kalshi.com').rstrip('/')

    # trade api v2 balance
    path = '/trade-api/v2/portfolio/balance'
    ts = str(int(time.time() * 1000))
    msg = ts + 'GET' + path

    private_key = load_key_from_env()
    sig_b64 = sign_message(private_key, msg)

    headers = {
        'KALSHI-ACCESS-KEY': key_id,
        'KALSHI-ACCESS-SIGNATURE': sig_b64,
        'KALSHI-ACCESS-TIMESTAMP': ts,
    }

    # Print debug without secrets
    pub = private_key.public_key().public_numbers().n.bit_length()
    print(json.dumps({
        'host': host,
        'path': path,
        'timestamp': ts,
        'msg_len': len(msg),
        'rsa_bits': pub,
        'sig_b64_len': len(sig_b64),
        'sig_b64_prefix': sig_b64[:12],
    }, indent=2))

    resp = requests.get(host + path, headers=headers, timeout=20)
    print('status', resp.status_code)
    print(resp.text[:800])


if __name__ == '__main__':
    main()
