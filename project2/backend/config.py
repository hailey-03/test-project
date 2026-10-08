import os
from zoneinfo import ZoneInfo

AWS_PROFILE = os.environ.get("AWS_PROFILE_NAME", "cy")
AWS_REGION = os.environ.get("AWS_REGION_NAME", "ap-northeast-2")

# 이름(EC2 Name 태그, S3 버킷명)에 이 문자열이 들어간 리소스만 '내 리소스'로 취급
MY_KEYWORD = os.environ.get("MY_KEYWORD", "cy1006")

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))

# 스케줄은 이 시간대 기준으로 실행
TIMEZONE = ZoneInfo(os.environ.get("TZ_NAME", "Asia/Seoul"))

# S3 업로드 최대 크기
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# 서울 리전 Linux 온디맨드 시간당 요금 (USD, 대략값)
HOURLY_PRICE_USD = {
    "t2.micro": 0.0144,
    "t2.small": 0.0288,
    "t2.medium": 0.0576,
    "t3.micro": 0.013,
    "t3.small": 0.026,
    "t3.medium": 0.052,
    "t3.large": 0.104,
}
