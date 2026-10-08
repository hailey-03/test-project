"""aws CLI(--profile) 를 호출해서 '내 리소스'만 다루는 함수 모음."""
import json
import re
import socket
import subprocess

import config

INSTANCE_ID_RE = re.compile(r"^i-[0-9a-f]{8,17}$")
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$")


class AwsError(Exception):
    pass


def _aws(*args):
    cmd = ["aws", *args, "--profile", config.AWS_PROFILE,
           "--region", config.AWS_REGION, "--output", "json"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise AwsError(proc.stderr.strip() or "aws CLI 호출 실패")
    return json.loads(proc.stdout) if proc.stdout.strip() else {}


def _is_mine(name):
    return config.MY_KEYWORD in (name or "")


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
            if not _is_mine(name):
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
                "isSelf": inst.get("PrivateIpAddress") in self_ips,
            })
    result.sort(key=lambda i: i["name"])
    return result


def instance_action(instance_id, action):
    if not INSTANCE_ID_RE.match(instance_id):
        raise ValueError("잘못된 인스턴스 ID")
    if action not in ("start", "stop", "reboot"):
        raise ValueError("지원하지 않는 작업")

    # 프론트에서 온 ID를 믿지 않고, 내 인스턴스 목록에 있는지 다시 확인
    target = next((i for i in list_my_instances() if i["id"] == instance_id), None)
    if target is None:
        raise PermissionError("내 리소스가 아닌 인스턴스는 조작할 수 없어요")
    if target["isSelf"] and action in ("stop", "reboot"):
        raise PermissionError("이 관리 페이지가 실행 중인 서버는 중지/재부팅할 수 없어요")

    _aws("ec2", f"{action}-instances", "--instance-ids", instance_id)
    return {"id": instance_id, "action": action}


# ---------- S3 ----------

def list_my_buckets():
    data = _aws("s3api", "list-buckets")
    return [
        {"name": b["Name"], "created": b.get("CreationDate")}
        for b in data.get("Buckets", [])
        if _is_mine(b["Name"])
    ]


def list_objects(bucket, prefix=""):
    if not BUCKET_RE.match(bucket) or not _is_mine(bucket):
        raise PermissionError("내 버킷이 아니에요")
    data = _aws("s3api", "list-objects-v2", "--bucket", bucket,
                "--prefix", prefix, "--delimiter", "/", "--max-items", "200")
    folders = [p["Prefix"] for p in data.get("CommonPrefixes", [])]
    files = [
        {"key": o["Key"], "size": o["Size"], "modified": o["LastModified"]}
        for o in data.get("Contents", [])
        if o["Key"] != prefix
    ]
    return {"bucket": bucket, "prefix": prefix, "folders": folders, "files": files}


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
