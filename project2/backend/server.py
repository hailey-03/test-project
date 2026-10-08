"""AWS 리소스 관리 페이지 백엔드 (Python 표준 라이브러리만 사용).

실행: python3 backend/server.py  →  http://127.0.0.1:8000
"""
import json
import mimetypes
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import aws_client
import config

FRONTEND_DIR = (Path(__file__).resolve().parent.parent / "frontend").resolve()

ACTION_RE = re.compile(r"^/api/ec2/([^/]+)/(start|stop|reboot)$")
BUCKET_RE = re.compile(r"^/api/s3/([^/]+)$")


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, body):
        data = json.dumps(body, ensure_ascii=False, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _run(self, fn, *args):
        try:
            self._json(200, fn(*args))
        except PermissionError as e:
            self._json(403, {"error": str(e)})
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except aws_client.AwsError as e:
            self._json(502, {"error": str(e)})

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/api/ec2":
            return self._run(aws_client.list_my_instances)
        if path == "/api/s3":
            return self._run(aws_client.list_my_buckets)
        m = BUCKET_RE.match(path)
        if m:
            prefix = parse_qs(url.query).get("prefix", [""])[0]
            return self._run(aws_client.list_objects, unquote(m.group(1)), prefix)
        if path == "/api/cost":
            return self._run(aws_client.estimate_cost)
        if path.startswith("/api/"):
            return self._json(404, {"error": "없는 API"})

        self._static(path)

    def do_POST(self):
        # 다른 사이트에서 몰래 보내는 요청 차단: 커스텀 헤더는 CORS preflight 없이 못 붙임
        if self.headers.get("X-Requested-By") != "resource-manager":
            return self._json(403, {"error": "허용되지 않은 요청"})
        m = ACTION_RE.match(urlparse(self.path).path)
        if not m:
            return self._json(404, {"error": "없는 API"})
        self._run(aws_client.instance_action, m.group(1), m.group(2))

    def _static(self, path):
        rel = "index.html" if path in ("", "/") else unquote(path).lstrip("/")
        file = (FRONTEND_DIR / rel).resolve()
        if not file.is_relative_to(FRONTEND_DIR) or not file.is_file():
            return self._json(404, {"error": "파일 없음"})
        data = file.read_bytes()
        ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    server = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    print(f"Resource Manager: http://{config.HOST}:{config.PORT}  "
          f"(profile={config.AWS_PROFILE}, keyword={config.MY_KEYWORD})")
    server.serve_forever()
