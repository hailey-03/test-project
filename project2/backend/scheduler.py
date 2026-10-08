"""등록된 스케줄을 30초마다 확인해서, 시각이 되면 인스턴스를 시작/중지."""
import re
import threading
import time
from datetime import datetime

import aws_client
import config
import storage

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"]

# 같은 분에 두 번 실행되지 않도록 "스케줄ID@YYYY-MM-DD HH:MM" 기록
_fired = set()


def validate(body):
    instance_id = body.get("instanceId", "")
    action = body.get("action")
    at = body.get("time", "")
    days = body.get("days", [])
    if action not in ("start", "stop"):
        raise ValueError("작업은 시작 또는 중지만 가능해요")
    if not TIME_RE.match(at):
        raise ValueError("시간 형식은 HH:MM 이에요")
    if not days or not all(isinstance(d, int) and 0 <= d <= 6 for d in days):
        raise ValueError("요일을 하나 이상 선택하세요")
    target = aws_client.get_my_instance(instance_id)
    aws_client.check_action_allowed(target, action)
    return {
        "instanceId": instance_id, "instanceName": target["name"],
        "action": action, "time": at, "days": sorted(set(days)),
    }


def _tick():
    now = datetime.now(config.TIMEZONE)
    hhmm = now.strftime("%H:%M")
    for s in storage.load_schedules():
        if not s.get("enabled") or s["time"] != hhmm or now.weekday() not in s["days"]:
            continue
        key = f"{s['id']}@{now:%Y-%m-%d %H:%M}"
        if key in _fired:
            continue
        _fired.add(key)
        try:
            aws_client.instance_action(s["instanceId"], s["action"])
            storage.append_log("스케줄", s["instanceId"], s["instanceName"], s["action"], True)
        except Exception as e:  # 실패해도 스케줄러는 계속 돌아야 함
            storage.append_log("스케줄", s["instanceId"], s["instanceName"], s["action"], False, str(e))
    # 오래된 기록 정리
    if len(_fired) > 1000:
        _fired.clear()


def _loop():
    while True:
        try:
            _tick()
        except Exception as e:
            print("scheduler error:", e)
        time.sleep(30)


def start():
    threading.Thread(target=_loop, daemon=True, name="scheduler").start()
