import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


class Sink(BaseHTTPRequestHandler):
    calls = []
    statuses = []
    headers = []  # list[dict[str,str]]; applied per request
    delays_s = []  # list[float]; applied per request

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length)
        Sink.calls.append((self.path, dict(self.headers), body))

        # optional delay (simulate slow receiver)
        delay = Sink.delays_s.pop(0) if Sink.delays_s else 0.0
        if delay and delay > 0:
            time.sleep(delay)

        # default: 200
        status = Sink.statuses.pop(0) if Sink.statuses else 200
        extra_headers = Sink.headers.pop(0) if Sink.headers else {}

        self.send_response(status)
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b"ok")


def run_server(port: int):
    httpd = HTTPServer(("127.0.0.1", port), Sink)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd
