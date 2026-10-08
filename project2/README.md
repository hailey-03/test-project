# project2 — 내 AWS 리소스 관리 페이지

이름에 `cy1006`이 들어간 내 AWS 리소스만 조회/관리하는 웹 페이지입니다.

## 기능
- **EC2**: 내 인스턴스 목록, 시작 / 중지 / 재부팅 (중지·재부팅은 확인창), 최근 24시간 CPU 그래프
- **보안그룹**: 인스턴스별 인바운드 규칙, 0.0.0.0/0 공개 포트 경고 (80/443 제외)
- **S3**: 내 버킷 탐색, 파일 다운로드, 현재 폴더로 업로드 (최대 100MB, 덮어쓰기 경고)
- **자동 스케줄**: 요일 + 시간(한국 시간)에 인스턴스 자동 시작/중지
- **작업 기록**: 이 페이지·스케줄로 한 작업 + CloudTrail 최근 7일 기록 (콘솔 작업 포함)
- **비용(추정)**: 실행 중인 인스턴스의 온디맨드 단가 기준 시간/일/월 예상 비용
  (계정에 Cost Explorer 권한이 없어 추정치로 제공)

## 구조
```
backend/    Python 표준 라이브러리 + aws CLI (설치할 패키지 없음)
  server.py      HTTP 서버, /api/* 와 프론트엔드 정적 파일 제공
  aws_client.py  aws CLI 호출, '내 리소스' 필터와 안전장치
  scheduler.py   30초마다 스케줄 확인 후 실행
  storage.py     스케줄 / 작업 기록 저장 (backend/data/, git 제외)
  config.py      프로필, 리전, 키워드, 포트, 시간대, 인스턴스 단가
frontend/   HTML/CSS/JS (빌드 없음)
deploy/     systemd 서비스 파일 (서버 재부팅 후에도 자동 실행)
```
AWS 자격증명은 백엔드에서만 사용하고 브라우저로는 절대 전달되지 않습니다.

## 실행
```bash
python3 backend/server.py
# → http://127.0.0.1:8000  (VS Code Remote 사용 시 포트 8000 자동 포워딩)
```
스케줄은 server.py 가 켜져 있을 때만 동작합니다. 항상 켜두려면 `deploy/resource-manager.service` 파일 상단의 설치 명령을 참고하세요.

환경변수로 바꿀 수 있는 값: `AWS_PROFILE_NAME`(기본 cy), `AWS_REGION_NAME`, `MY_KEYWORD`(기본 cy1006), `PORT`

## 안전장치
- 백엔드가 요청마다 "내 인스턴스인지"를 다시 확인 → 다른 사람 리소스는 조작 불가
- 이 페이지가 실행 중인 서버 자신은 중지/재부팅 불가
- 인스턴스 종료(삭제) 기능 없음, 현재 서버를 중지하는 스케줄은 등록 불가
- POST/DELETE 요청은 커스텀 헤더 필수 (다른 사이트에서 몰래 보내는 요청 차단)
- 127.0.0.1에만 바인딩 (로그인 기능이 없으므로 외부에 공개하지 말 것)

## API
| Method | Path | 설명 |
|---|---|---|
| GET | /api/ec2 | 내 인스턴스 목록 |
| POST | /api/ec2/{id}/start\|stop\|reboot | 인스턴스 작업 |
| GET | /api/s3 | 내 버킷 목록 |
| GET | /api/s3/{bucket}?prefix= | 버킷 객체 목록 |
| GET | /api/ec2/{id}/cpu?hours=24 | CPU 사용률 (CloudWatch) |
| GET | /api/ec2/{id}/security | 보안그룹 규칙 |
| GET | /api/s3/{bucket}/download?key= | 파일 다운로드 |
| POST | /api/s3/{bucket}/upload?key= | 파일 업로드 (본문 = 파일) |
| GET / POST | /api/schedules | 스케줄 목록 / 추가 |
| POST | /api/schedules/{id}/toggle | 스케줄 켜기/끄기 |
| DELETE | /api/schedules/{id} | 스케줄 삭제 |
| GET | /api/logs | 페이지·스케줄 작업 기록 |
| GET | /api/cloudtrail | CloudTrail 최근 7일 |
| GET | /api/cost | 예상 비용 |
