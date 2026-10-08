"""스케줄과 작업 기록을 backend/data/ 아래 JSON 파일로 저장."""
import json
import threading
import uuid
from datetime import datetime
from pathlib import Path

import config

DATA_DIR = Path(__file__).resolve().parent / "data"
SCHEDULES_FILE = DATA_DIR / "schedules.json"
LOG_FILE = DATA_DIR / "actions.jsonl"

_lock = threading.Lock()


def _now():
    return datetime.now(config.TIMEZONE).isoformat(timespec="seconds")


# ---------- 작업 기록 ----------

def append_log(source, instance_id, instance_name, action, ok, message=""):
    entry = {
        "time": _now(), "source": source, "instanceId": instance_id,
        "instanceName": instance_name, "action": action, "ok": ok, "message": message,
    }
    with _lock:
        DATA_DIR.mkdir(exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def read_logs(limit=200):
    with _lock:
        if not LOG_FILE.exists():
            return []
        lines = LOG_FILE.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in reversed(lines[-limit:]) if line.strip()]


# ---------- 스케줄 ----------

def load_schedules():
    with _lock:
        if not SCHEDULES_FILE.exists():
            return []
        return json.loads(SCHEDULES_FILE.read_text(encoding="utf-8"))


def _save(schedules):
    DATA_DIR.mkdir(exist_ok=True)
    tmp = SCHEDULES_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(schedules, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(SCHEDULES_FILE)


def add_schedule(item):
    item = {**item, "id": uuid.uuid4().hex[:8], "enabled": True, "createdAt": _now()}
    with _lock:
        schedules = json.loads(SCHEDULES_FILE.read_text(encoding="utf-8")) if SCHEDULES_FILE.exists() else []
        schedules.append(item)
        _save(schedules)
    return item


def update_schedule(schedule_id, **changes):
    with _lock:
        schedules = json.loads(SCHEDULES_FILE.read_text(encoding="utf-8")) if SCHEDULES_FILE.exists() else []
        for s in schedules:
            if s["id"] == schedule_id:
                s.update(changes)
                _save(schedules)
                return s
    raise ValueError("없는 스케줄")


def delete_schedule(schedule_id):
    with _lock:
        schedules = json.loads(SCHEDULES_FILE.read_text(encoding="utf-8")) if SCHEDULES_FILE.exists() else []
        remaining = [s for s in schedules if s["id"] != schedule_id]
        if len(remaining) == len(schedules):
            raise ValueError("없는 스케줄")
        _save(remaining)
    return {"id": schedule_id}
