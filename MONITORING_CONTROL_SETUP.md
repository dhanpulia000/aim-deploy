# 모니터링 제어 페이지 설정 가이드

## 개요

백엔드에 통합된 모니터링 기능을 제어할 수 있는 관리자 페이지가 추가되었습니다.

## 구현된 기능

### 1. 백엔드 API 엔드포인트

**파일**: `backend/routes/monitoring.routes.js`, `backend/controllers/monitoring.controller.js`, `backend/services/monitoring.service.js`

**엔드포인트**:
- `GET /api/monitoring/status` - 워커 프로세스 상태 확인
- `GET /api/monitoring/keywords` - 키워드 목록 조회
- `POST /api/monitoring/keywords` - 키워드 생성 (ADMIN/LEAD만)
- `DELETE /api/monitoring/keywords/:id` - 키워드 삭제 (ADMIN/LEAD만)
- `GET /api/monitoring/logs` - 최근 수집 로그 조회
- `GET /api/monitoring/config/:key` - 설정 조회
- `PUT /api/monitoring/config/:key` - 설정 저장 (ADMIN/LEAD만)

### 2. 프론트엔드 페이지

**파일**: `src/pages/Admin/MonitoringControl.tsx`

**기능**:
- **상태 패널**: Discord 봇과 Naver 크롤러의 실행 상태 표시 (초록/빨강 불)
- **키워드 관리**: 키워드 목록 테이블, 추가/삭제 기능
- **최근 로그**: RawLog 테이블에서 최근 수집된 로그 조회
- **설정 제어**: 크롤링 주기, 알림 쿨타임 등 설정 수정

### 3. 라우팅

**경로**: `/admin/monitoring`

**접근 방법**:
- 메인 현황판(`App.tsx`)에서 "모니터링" 버튼 클릭 (ADMIN/LEAD만 표시)
- 관리자 페이지(`Admin.tsx`)에서 "모니터링 제어" 탭 클릭

## 사용 방법

### 1. 워커 상태 확인

1. `/admin/monitoring` 페이지 접속
2. "상태" 탭에서 워커 프로세스 상태 확인
   - 초록 불: 실행 중 (Running)
   - 빨강 불: 중지됨 (Stopped)
   - PID와 마지막 확인 시간 표시

### 2. 키워드 관리

1. "키워드 관리" 탭 선택
2. 키워드 추가:
   - 타입 선택 (Naver/Discord/System)
   - 키워드 입력
   - "추가" 버튼 클릭
3. 키워드 삭제:
   - 테이블에서 "삭제" 버튼 클릭
   - 확인 후 삭제

### 3. 최근 로그 조회

1. "최근 로그" 탭 선택
2. 최근 50개의 RawLog 확인
3. "새로고침" 버튼으로 최신 로그 업데이트

### 4. 설정 변경

1. "설정" 탭 선택 (ADMIN/LEAD만)
2. 크롤링 주기 또는 알림 쿨타임 입력
3. "저장" 버튼 클릭

## 권한

- **모든 사용자**: 상태 조회, 키워드 조회, 로그 조회
- **ADMIN/LEAD**: 키워드 추가/삭제, 설정 변경

## 다크 모드 지원

모든 UI 컴포넌트는 Tailwind CSS의 `dark:` 클래스를 사용하여 다크 모드를 지원합니다.

## API 응답 형식

### 워커 상태
```json
{
  "success": true,
  "data": {
    "naverCafe": {
      "status": "running",
      "pid": 12345,
      "lastCheck": "2025-01-XX..."
    },
    "discord": {
      "status": "running",
      "pid": 12346,
      "lastCheck": "2025-01-XX..."
    }
  }
}
```

### 키워드 목록
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "type": "naver",
      "word": "버그",
      "enabled": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### 최근 로그
```json
{
  "success": true,
  "data": {
    "logs": [...],
    "total": 100,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

## 문제 해결

### 워커 상태가 "unknown"으로 표시되는 경우
- 서버가 재시작되었는지 확인
- `backend/server.js`의 워커 프로세스 관리 로직 확인

### 키워드가 필터링되지 않는 경우
- `MonitoringKeyword` 테이블에 키워드가 등록되어 있는지 확인
- 키워드의 `enabled` 필드가 `true`인지 확인
- 워커 프로세스가 실행 중인지 확인

### 로그가 표시되지 않는 경우
- `RawLog` 테이블에 데이터가 있는지 확인
- 워커 프로세스가 정상적으로 실행 중인지 확인
- 키워드 필터링이 너무 제한적인지 확인

## 다음 단계

1. **RawLog → Issue 승격 프로세스**: RawLog를 Issue로 변환하는 워커/스케줄러 구현
2. **실시간 상태 업데이트**: WebSocket을 통한 실시간 워커 상태 업데이트
3. **워커 제어 API**: 워커 시작/중지 API 추가
4. **통계 대시보드**: 키워드별 수집 통계, 처리율 등




















