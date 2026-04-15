# GitHub 업로드 가이드

## 현재 상태

✅ Git 저장소가 이미 초기화되어 있습니다.  
✅ 원격 저장소가 연결되어 있습니다: `NodeplugKorea2026/AIM`

## 업로드 전 확인 사항

### 1. 민감한 정보 확인

다음 파일들이 `.gitignore`에 포함되어 있는지 확인:
- ✅ `.env` 파일 (환경 변수)
- ✅ `*.db` 파일 (데이터베이스)
- ✅ `*.db-shm`, `*.db-wal` (SQLite 임시 파일)
- ✅ `uploads/` 디렉토리 (업로드된 파일)
- ✅ `credentials/` 디렉토리 (인증 정보)

### 2. 변경된 파일 확인

현재 수정된 파일들:
- 백엔드 서비스 파일들
- 워커 파일들
- 프론트엔드 컴포넌트들
- 데이터베이스 임시 파일들 (`.db-shm`, `.db-wal`)

## 업로드 단계

### 방법 1: 명령어로 직접 업로드 (권장)

```bash
cd /home/young-dev/AIM

# 1. 현재 상태 확인
git status

# 2. 데이터베이스 임시 파일 제외 확인 (이미 .gitignore에 포함되어 있어야 함)
# .db-shm, .db-wal 파일은 커밋하지 않아야 합니다

# 3. 변경사항 스테이징
git add .

# 4. 커밋 메시지와 함께 커밋
git commit -m "최신 기능 업데이트: 본문 추출 개선, 에이전트 자동 할당, UI 개선"

# 5. GitHub에 푸시
git push origin main
```

### 방법 2: 단계별 업로드 (더 안전)

```bash
cd /home/young-dev/AIM

# 1. 변경사항 확인
git status

# 2. 특정 파일만 추가 (데이터베이스 파일 제외)
git add backend/controllers/
git add backend/services/
git add backend/workers/
git add backend/routes/
git add src/
git add *.md
git add package.json
git add .gitignore

# 3. 커밋
git commit -m "기능 업데이트: 본문 추출 개선 및 에이전트 자동 할당"

# 4. 푸시
git push origin main
```

## 주의사항

### ⚠️ 절대 커밋하면 안 되는 파일들

1. **`.env` 파일**: API 키, 비밀번호 등 민감한 정보
2. **`*.db` 파일**: 데이터베이스 파일 (개인 데이터 포함)
3. **`*.db-shm`, `*.db-wal`**: SQLite 임시 파일
4. **`uploads/` 디렉토리**: 업로드된 사용자 파일
5. **`credentials/` 디렉토리**: 인증 정보

### ✅ 커밋해도 되는 파일들

- 소스 코드 (`.js`, `.ts`, `.tsx`)
- 설정 파일 (`package.json`, `vite.config.ts`)
- 문서 파일 (`.md`)
- `.gitignore` 파일

## .gitignore 확인 및 수정

현재 `.gitignore`에 다음이 포함되어 있는지 확인:

```gitignore
# Database files
*.db
*.db-journal
*.db-shm
*.db-wal
*.sqlite
*.sqlite3
backend/prisma/*.db
backend/prisma/*.db-shm
backend/prisma/*.db-wal

# Environment variables
.env
.env.local
.env.*.local

# Uploads
uploads/
backend/uploads/
```

만약 `.db-shm`, `.db-wal`이 포함되어 있지 않다면 추가:

```bash
cd /home/young-dev/AIM
echo "*.db-shm" >> .gitignore
echo "*.db-wal" >> .gitignore
echo "backend/prisma/*.db-shm" >> .gitignore
echo "backend/prisma/*.db-wal" >> .gitignore
```

## 문제 해결

### 1. 이미 커밋된 민감한 파일 제거

만약 실수로 `.env`나 데이터베이스 파일을 커밋했다면:

```bash
# Git 히스토리에서 제거 (파일은 로컬에 유지)
git rm --cached backend/.env
git rm --cached backend/prisma/*.db*

# .gitignore에 추가
echo ".env" >> .gitignore
echo "*.db*" >> .gitignore

# 커밋
git add .gitignore
git commit -m "민감한 파일 제거 및 .gitignore 업데이트"
git push origin main
```

### 2. 인증 오류 발생 시

GitHub 토큰이 만료되었거나 권한이 없는 경우:

```bash
# 원격 저장소 URL 확인
git remote -v

# 새로운 토큰으로 업데이트
git remote set-url origin https://YOUR_TOKEN@github.com/NodeplugKorea2026/AIM.git
```

### 3. 충돌 해결

다른 사람이 같은 파일을 수정한 경우:

```bash
# 최신 변경사항 가져오기
git pull origin main

# 충돌 해결 후
git add .
git commit -m "충돌 해결"
git push origin main
```

## 업로드 후 확인

1. GitHub 웹사이트에서 저장소 확인
2. 커밋된 파일들이 올바르게 업로드되었는지 확인
3. 민감한 파일이 포함되지 않았는지 확인

## 추가 권장 사항

### 1. README 업데이트

프로젝트 README를 최신 상태로 업데이트:

```bash
# SYSTEM_STATUS_REPORT.md의 내용을 참고하여 README.md 업데이트
```

### 2. 릴리즈 노트 작성

주요 변경사항을 정리한 릴리즈 노트 작성:

```markdown
## 버전 1.1.0 (2025-12-17)

### 개선사항
- 본문 추출 로직 개선 (에러 메시지 필터링)
- 에이전트 자동 할당 기능 추가 (근무 시간 기반)
- UI 개선 (에이전트 상태 카드 최적화)
- 중복 텍스트 제거 로직 추가

### 버그 수정
- 로그인 필요 게시글 감지 개선
- 본문에 불필요한 UI 텍스트 제거
```

### 3. 브랜치 전략

큰 기능 추가 시 브랜치 사용:

```bash
# 새 기능 브랜치 생성
git checkout -b feature/new-feature

# 작업 후
git add .
git commit -m "새 기능 추가"
git push origin feature/new-feature

# GitHub에서 Pull Request 생성
```

## 빠른 업로드 스크립트

다음 스크립트를 사용하여 빠르게 업로드:

```bash
#!/bin/bash
cd /home/young-dev/AIM

# .gitignore 확인
if ! grep -q "*.db-shm" .gitignore; then
    echo "*.db-shm" >> .gitignore
    echo "*.db-wal" >> .gitignore
fi

# 변경사항 추가 (데이터베이스 파일 제외)
git add backend/controllers/ backend/services/ backend/workers/ backend/routes/ src/ *.md package.json .gitignore

# 커밋
git commit -m "최신 기능 업데이트: $(date +%Y-%m-%d)"

# 푸시
git push origin main

echo "업로드 완료!"
```

## 보안 체크리스트

업로드 전 확인:

- [ ] `.env` 파일이 커밋되지 않았는지
- [ ] 데이터베이스 파일(`*.db*`)이 커밋되지 않았는지
- [ ] API 키나 비밀번호가 코드에 하드코딩되지 않았는지
- [ ] `uploads/` 디렉토리가 커밋되지 않았는지
- [ ] `credentials/` 디렉토리가 커밋되지 않았는지

---

**주의**: GitHub에 업로드하기 전에 반드시 민감한 정보가 포함되지 않았는지 확인하세요!
