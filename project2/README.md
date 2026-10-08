# project2 — 내 AWS 리소스 관리 페이지

이름에 `cy1006`이 들어간 내 AWS 리소스만 조회/관리하는 웹 페이지입니다.

## 기능
- **EC2**: 내 인스턴스 목록, 시작 / 중지 / 재부팅 (중지·재부팅은 확인창)
- **S3**: 내 버킷 목록, 폴더/파일 탐색 (읽기 전용)
- **비용(추정)**: 실행 중인 인스턴스의 온디맨드 단가 기준 시간/일/월 예상 비용
  (계정에 Cost Explorer 권한이 없어 추정치로 제공)

## 구조
```
backend/    Python 표준 라이브러리 + aws CLI (설치할 패키지 없음)
  server.py      HTTP 서버, /api/* 와 프론트엔드 정적 파일 제공
  aws_client.py  aws CLI 호출, '내 리소스' 필터와 안전장치
  config.py      프로필, 리전, 키워드, 포트, 인스턴스 단가
frontend/   HTML/CSS/JS (빌드 없음)
```
AWS 자격증명은 백엔드에서만 사용하고 브라우저로는 절대 전달되지 않습니다.

## 실행
```bash
python3 backend/server.py
# → http://127.0.0.1:8000  (VS Code Remote 사용 시 포트 8000 자동 포워딩)
```
환경변수로 바꿀 수 있는 값: `AWS_PROFILE_NAME`(기본 cy), `AWS_REGION_NAME`, `MY_KEYWORD`(기본 cy1006), `PORT`

## 안전장치
- 백엔드가 요청마다 "내 인스턴스인지"를 다시 확인 → 다른 사람 리소스는 조작 불가
- 이 페이지가 실행 중인 서버 자신은 중지/재부팅 불가
- 인스턴스 종료(삭제) 기능 없음
- 127.0.0.1에만 바인딩 (로그인 기능이 없으므로 외부에 공개하지 말 것)

## API
| Method | Path | 설명 |
|---|---|---|
| GET | /api/ec2 | 내 인스턴스 목록 |
| POST | /api/ec2/{id}/start\|stop\|reboot | 인스턴스 작업 |
| GET | /api/s3 | 내 버킷 목록 |
| GET | /api/s3/{bucket}?prefix= | 버킷 객체 목록 |
| GET | /api/cost | 예상 비용 |
