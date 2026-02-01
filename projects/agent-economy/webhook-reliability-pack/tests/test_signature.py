from wrp.util import sign_v1


def test_sign_v1_stable():
    body = b"{\"a\":1}"
    s1 = sign_v1(secret="sek", method="POST", path="/webhook", timestamp_ms=123, body_bytes=body)
    s2 = sign_v1(secret="sek", method="POST", path="/webhook", timestamp_ms=123, body_bytes=body)
    assert s1 == s2
    assert s1.startswith("v1=")
