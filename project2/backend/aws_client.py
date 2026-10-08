"""aws CLI(--profile) 를 호출해서 '내 리소스'만 다루는 함수 모음."""
import json
import os
import re
import socket
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone

import config

INSTANCE_ID_RE = re.compile(r"^i-[0-9a-f]{8,17}$")
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$")

# CloudTrail에서 보여줄 인스턴스 작업
TRAIL_EVENTS = {"StartInstances", "StopInstances", "RebootInstances",
                "RunInstances", "TerminateInstances"}


class AwsError(Exception):
    pass


def _cmd(*args, output=True):
    cmd = ["aws", *args, "--profile", config.AWS_PROFILE, "--region", config.AWS_REGION]
    return cmd + (["--output", "json"] if output else [])


def _aws(*args):
    proc = subprocess.run(_cmd(*args), capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AwsError(proc.stderr.strip() or "aws CLI 호출 실패")
    return json.loads(proc.stdout) if proc.stdout.strip() else {}


def _is_mine(name):
    return config.MY_KEYWORD in (name or "")


def _iso_utc(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _my_private_ips():
    """이 서버의 사설 IP 목록 (자기 자신 인스턴스를 보호하기 위해 사용)."""
    ips = set()
    try:
        out = subprocess.run(["hostname", "-I"], capture_output=True, text=True).stdout
        ips.update(out.split())
    except OSError:
        pass
    try:
        ips.add(socket.gethostbyname(socket.gethostname()))
    except OSError:
        pass
    return ips


# ---------- EC2 ----------

def list_my_instances():
    data = _aws("ec2", "describe-instances",
                "--filters", f"Name=tag:Name,Values=*{config.MY_KEYWORD}*")
    self_ips = _my_private_ips()
    result = []
    for res in data.get("Reservations", []):
        for inst in res.get("Instances", []):
            tags = {t["Key"]: t["Value"] for t in inst.get("Tags", [])}
            name = tags.get("Name", "").strip()
            if not _is_mine(name) or inst["State"]["Name"] == "terminated":
                continue
            result.append({
                "id": inst["InstanceId"],
                "name": name,
                "state": inst["State"]["Name"],
                "type": inst["InstanceType"],
                "privateIp": inst.get("PrivateIpAddress"),
                "publicIp": inst.get("PublicIpAddress"),
                "az": inst.get("Placement", {}).get("AvailabilityZone"),
                "launchTime": inst.get("LaunchTime"),
                "securityGroups": [g["GroupId"] for g in inst.get("SecurityGroups", [])],
                "isSelf": inst.get("PrivateIpAddress") in self_ips,
            })
    result.sort(key=lambda i: i["name"])
    return result


def get_my_instance(instance_id):
    """프론트에서 온 ID를 믿지 않고, 내 인스턴스 목록에 있는지 다시 확인."""
    if not INSTANCE_ID_RE.match(instance_id or ""):
        raise ValueError("잘못된 인스턴스 ID")
    target = next((i for i in list_my_instances() if i["id"] == instance_id), None)
    if target is None:
        raise PermissionError("내 리소스가 아닌 인스턴스는 조작할 수 없어요")
    return target


def check_action_allowed(target, action):
    if action not in ("start", "stop", "reboot"):
        raise ValueError("지원하지 않는 작업")
    if target["isSelf"] and action in ("stop", "reboot"):
        raise PermissionError("이 관리 페이지가 실행 중인 서버는 중지/재부팅할 수 없어요")


def instance_action(instance_id, action):
    target = get_my_instance(instance_id)
    check_action_allowed(target, action)
    _aws("ec2", f"{action}-instances", "--instance-ids", instance_id)
    return {"id": instance_id, "name": target["name"], "action": action}


def cpu_metrics(instance_id, hours=24):
    get_my_instance(instance_id)
    hours = max(1, min(int(hours), 168))
    end = datetime.now(timezone.utc)
    period = 300 if hours <= 24 else 3600
    data = _aws("cloudwatch", "get-metric-statistics",
                "--namespace", "AWS/EC2", "--metric-name", "CPUUtilization",
                "--dimensions", f"Name=InstanceId,Value={instance_id}",
                "--start-time", _iso_utc(end - timedelta(hours=hours)),
                "--end-time", _iso_utc(end),
                "--period", str(period), "--statistics", "Average", "Maximum")
    points = sorted(
        ({"t": p["Timestamp"], "avg": round(p["Average"], 2), "max": round(p["Maximum"], 2)}
         for p in data.get("Datapoints", [])),
        key=lambda p: p["t"],
    )
    return {"id": instance_id, "hours": hours, "period": period, "points": points}


def security_rules(instance_id):
    target = get_my_instance(instance_id)
    if not target["securityGroups"]:
        return {"id": instance_id, "groups": [], "openCount": 0}
    data = _aws("ec2", "describe-security-groups", "--group-ids", *target["securityGroups"])
    groups, open_count = [], 0
    for g in data.get("SecurityGroups", []):
        rules = []
        for perm in g.get("IpPermissions", []):
            proto = perm.get("IpProtocol")
            if proto == "-1":
                ports = "전체"
            else:
                lo, hi = perm.get("FromPort"), perm.get("ToPort")
                ports = str(lo) if lo == hi else f"{lo}-{hi}"
            sources = (
                [(r["CidrIp"], r.get("Description")) for r in perm.get("IpRanges", [])]
                + [(r["CidrIpv6"], r.get("Description")) for r in perm.get("Ipv6Ranges", [])]
                + [(r["GroupId"], r.get("Description")) for r in perm.get("UserIdGroupPairs", [])]
                + [(r["PrefixListId"], r.get("Description")) for r in perm.get("PrefixListIds", [])]
            )
            for src, desc in sources:
                is_open = src in ("0.0.0.0/0", "::/0")
                # 80/443 웹 포트는 공개가 정상이므로 경고에서 제외
                risky = is_open and ports not in ("80", "443")
                open_count += risky
                rules.append({
                    "protocol": "전체" if proto == "-1" else proto.upper(),
                    "ports": ports, "source": src, "description": desc or "",
                    "open": is_open, "risky": risky,
                })
        groups.append({"id": g["GroupId"], "name": g.get("GroupName"), "rules": rules})
    return {"id": instance_id, "groups": groups, "openCount": open_count}


def cloudtrail_events(days=7):
    """내 인스턴스에 대한 시작/중지 등 기록 (콘솔이나 다른 도구로 한 작업 포함)."""
    start = _iso_utc(datetime.now(timezone.utc) - timedelta(days=days))
    events = []
    for inst in list_my_instances():
        data = _aws("cloudtrail", "lookup-events",
                    "--lookup-attributes", f"AttributeKey=ResourceName,AttributeValue={inst['id']}",
                    "--start-time", start, "--max-items", "100")
        for e in data.get("Events", []):
            if e.get("EventName") not in TRAIL_EVENTS:
                continue
            detail = json.loads(e.get("CloudTrailEvent") or "{}")
            who = detail.get("userIdentity", {})
            events.append({
                "time": e["EventTime"],
                "event": e["EventName"],
                "instanceId": inst["id"],
                "instanceName": inst["name"],
                "user": e.get("Username") or who.get("arn") or who.get("type") or "-",
                "sourceIp": detail.get("sourceIPAddress"),
                "error": detail.get("errorCode"),
            })
    events.sort(key=lambda e: e["time"], reverse=True)
    return events


# ---------- S3 ----------

def _check_bucket(bucket):
    if not BUCKET_RE.match(bucket or "") or not _is_mine(bucket):
        raise PermissionError("내 버킷이 아니에요")


def _check_key(key):
    if not key or len(key) > 1024 or key.endswith("/") or "\x00" in key:
        raise ValueError("잘못된 파일 경로")


def list_my_buckets():
    data = _aws("s3api", "list-buckets")
    return [
        {"name": b["Name"], "created": b.get("CreationDate")}
        for b in data.get("Buckets", [])
        if _is_mine(b["Name"])
    ]


def list_objects(bucket, prefix=""):
    _check_bucket(bucket)
    data = _aws("s3api", "list-objects-v2", "--bucket", bucket,
                "--prefix", prefix, "--delimiter", "/", "--max-items", "500")
    folders = [p["Prefix"] for p in data.get("CommonPrefixes", [])]
    files = [
        {"key": o["Key"], "size": o["Size"], "modified": o["LastModified"]}
        for o in data.get("Contents", [])
        if o["Key"] != prefix
    ]
    return {"bucket": bucket, "prefix": prefix, "folders": folders, "files": files}


def open_download(bucket, key):
    """S3 객체를 stdout으로 내려받는 프로세스를 연다 (서버가 스트리밍으로 전달)."""
    _check_bucket(bucket)
    _check_key(key)
    return subprocess.Popen(_cmd("s3", "cp", f"s3://{bucket}/{key}", "-", output=False),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def upload_object(bucket, key, stream, size):
    _check_bucket(bucket)
    _check_key(key)
    if size > config.MAX_UPLOAD_BYTES:
        raise ValueError(f"파일이 너무 커요 (최대 {config.MAX_UPLOAD_BYTES // 1024 // 1024}MB)")
    fd, path = tempfile.mkstemp(prefix="upload-")
    try:
        with os.fdopen(fd, "wb") as f:
            remaining = size
            while remaining > 0:
                chunk = stream.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        proc = subprocess.run(_cmd("s3", "cp", path, f"s3://{bucket}/{key}", "--only-show-errors", output=False),
                              capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AwsError(proc.stderr.strip() or "업로드 실패")
    finally:
        os.unlink(path)
    return {"bucket": bucket, "key": key, "size": size}


# ---------- 비용 (추정) ----------

def estimate_cost():
    """Cost Explorer 권한이 없어서, 실행 중인 인스턴스의 온디맨드 단가로 추정."""
    rows, total_hourly = [], 0.0
    for inst in list_my_instances():
        price = config.HOURLY_PRICE_USD.get(inst["type"])
        running = inst["state"] == "running"
        hourly = price if (running and price) else 0.0
        total_hourly += hourly
        rows.append({
            "name": inst["name"], "type": inst["type"], "state": inst["state"],
            "hourly": price, "known": price is not None,
        })
    return {
        "rows": rows,
        "hourly": round(total_hourly, 4),
        "daily": round(total_hourly * 24, 2),
        "monthly": round(total_hourly * 24 * 30, 2),
        "note": "EC2 온디맨드 컴퓨팅 요금만 계산한 추정치예요 (EBS, 트래픽, S3 제외).",
    }
