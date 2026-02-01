import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


class Sink(BaseHTTPRequestHandler):
    calls = []
    statuses = []

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length)
        Sink.calls.append((self.path, dict(self.headers), body))
        # default: 200
        status = Sink.statuses.pop(0) if Sink.statuses else 200
        self.send_response(status)
        self.end_headers()
        self.wfile.write(b"ok")


def run_server(port: int):
    httpd = HTTPServer(("127.0.0.1", port), Sink)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd
