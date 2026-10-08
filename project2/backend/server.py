"""AWS 리소스 관리 페이지 백엔드 (Python 표준 라이브러리만 사용).

실행: python3 backend/server.py  →  http://127.0.0.1:8000
"""
import json
import mimetypes
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

import aws_client
import config
import scheduler
import storage

FRONTEND_DIR = (Path(__file__).resolve().parent.parent / "frontend").resolve()


def _action(instance_id, action):
    """페이지에서 누른 시작/중지/재부팅 → 실행하고 작업 기록에 남김."""
    try:
        result = aws_client.instance_action(instance_id, action)
    except (PermissionError, ValueError, aws_client.AwsError) as e:
        storage.append_log("페이지", instance_id, "", action, False, str(e))
        raise
    storage.append_log("페이지", instance_id, result["name"], action, True)
    return result


# (method, 경로 정규식) → handler(match, query, body)
ROUTES = [
    ("GET", r"/api/info", lambda m, q, b: {
        "profile": config.AWS_PROFILE, "region": config.AWS_REGION,
        "keyword": config.MY_KEYWORD, "timezone": str(config.TIMEZONE)}),
    ("GET", r"/api/ec2", lambda m, q, b: aws_client.list_my_instances()),
    ("GET", r"/api/ec2/([^/]+)/cpu", lambda m, q, b: aws_client.cpu_metrics(m[1], q.get("hours", 24))),
    ("GET", r"/api/ec2/([^/]+)/security", lambda m, q, b: aws_client.security_rules(m[1])),
    ("POST", r"/api/ec2/([^/]+)/(start|stop|reboot)", lambda m, q, b: _action(m[1], m[2])),
    ("GET", r"/api/s3", lambda m, q, b: aws_client.list_my_buckets()),
    ("GET", r"/api/s3/([^/]+)", lambda m, q, b: aws_client.list_objects(m[1], q.get("prefix", ""))),
    ("GET", r"/api/cost", lambda m, q, b: aws_client.estimate_cost()),
    ("GET", r"/api/schedules", lambda m, q, b: storage.load_schedules()),
    ("POST", r"/api/schedules", lambda m, q, b: storage.add_schedule(scheduler.validate(b))),
    ("POST", r"/api/schedules/([0-9a-f]+)/toggle",
     lambda m, q, b: storage.update_schedule(m[1], enabled=bool(b.get("enabled")))),
    ("DELETE", r"/api/schedules/([0-9a-f]+)", lambda m, q, b: storage.delete_schedule(m[1])),
    ("GET", r"/api/logs", lambda m, q, b: storage.read_logs()),
    ("GET", r"/api/cloudtrail", lambda m, q, b: aws_client.cloudtrail_events()),
]
ROUTES = [(method, re.compile(f"^{pattern}$"), fn) for method, pattern, fn in ROUTES]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # 콘솔을 조용하게

    def _json(self, status, body):
        data = json.dumps(body, ensure_ascii=False, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _guard(self):
        # 다른 사이트에서 몰래 보내는 요청 차단: 커스텀 헤더는 CORS preflight 없이 못 붙임
        if self.headers.get("X-Requested-By") != "resource-manager":
            self._json(403, {"error": "허용되지 않은 요청"})
            return False
        return True

    def _dispatch(self, method):
        url = urlparse(self.path)
        path = unquote(url.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}

        # 파일 업로드/다운로드는 JSON이 아니라 바이트를 주고받으므로 따로 처리
        m = re.match(r"^/api/s3/([^/]+)/(upload|download)$", path)
        if m:
            if m[2] == "upload" and method == "POST":
                return self._upload(m[1], query.get("key", ""))
            if m[2] == "download" and method == "GET":
                return self._download(m[1], query.get("key", ""))

        for route_method, pattern, fn in ROUTES:
            match = pattern.match(path)
            if route_method == method and match:
                body = {}
                if method in ("POST", "DELETE"):
                    length = int(self.headers.get("Content-Length") or 0)
                    if length:
                        try:
                            body = json.loads(self.rfile.read(length))
                        except json.JSONDecodeError:
                            return self._json(400, {"error": "잘못된 JSON"})
                return self._run(fn, match, query, body)

        if path.startswith("/api/"):
            return self._json(404, {"error": "없는 API"})
        if method == "GET":
            return self._static(path)
        self._json(405, {"error": "허용되지 않은 메서드"})

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
        self._dispatch("GET")

    def do_POST(self):
        if self._guard():
            self._dispatch("POST")

    def do_DELETE(self):
        if self._guard():
            self._dispatch("DELETE")

    def _upload(self, bucket, key):
        size = int(self.headers.get("Content-Length") or 0)
        self._run(aws_client.upload_object, bucket, key, self.rfile, size)

    def _download(self, bucket, key):
        try:
            proc = aws_client.open_download(bucket, key)
        except PermissionError as e:
            return self._json(403, {"error": str(e)})
        except ValueError as e:
            return self._json(400, {"error": str(e)})

        first = proc.stdout.read(64 * 1024)
        if not first and proc.wait() != 0:
            return self._json(502, {"error": proc.stderr.read().decode(errors="replace").strip() or "다운로드 실패"})

        filename = key.rsplit("/", 1)[-1]
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(filename)}")
        self.end_headers()
        try:
            chunk = first
            while chunk:
                self.wfile.write(chunk)
                chunk = proc.stdout.read(64 * 1024)
        finally:
            proc.kill()
            proc.wait()

    def _static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        file = (FRONTEND_DIR / rel).resolve()
        if not file.is_relative_to(FRONTEND_DIR) or not file.is_file():
            return self._json(404, {"error": "파일 없음"})
        data = file.read_bytes()
        ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    scheduler.start()
    server = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    print(f"Resource Manager: http://{config.HOST}:{config.PORT}  "
          f"(profile={config.AWS_PROFILE}, keyword={config.MY_KEYWORD})", flush=True)
    server.serve_forever()
