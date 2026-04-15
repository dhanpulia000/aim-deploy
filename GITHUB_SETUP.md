# GitHub 업로드 가이드

이 문서는 Agent Ops Wallboard 프로젝트를 GitHub에 업로드하는 방법을 안내합니다.

## 업로드 전 확인 사항

### ✅ 필수 확인 항목

1. **민감한 정보 제거 확인**
   - [ ] `.env` 파일이 `.gitignore`에 포함되어 있는지 확인
   - [ ] API 키, 토큰, 비밀번호 등이 코드에 하드코딩되어 있지 않은지 확인
   - [ ] 데이터베이스 파일(`*.db`)이 제외되어 있는지 확인

2. **불필요한 파일 제거**
   - [ ] `node_modules/` 폴더 제외 확인
   - [ ] `dist/` 빌드 폴더 제외 확인
   - [ ] 업로드된 파일(`uploads/`) 제외 확인
   - [ ] 데이터 파일(`data/*.xlsx`, `data/*.json`) 제외 확인

3. **문서 확인**
   - [ ] `README.md` 최신 상태 확인
   - [ ] `.env.example` 파일 생성 확인
   - [ ] 라이센스 파일 확인 (선택)

## GitHub 저장소 생성

### 1. GitHub에서 새 저장소 생성

1. GitHub에 로그인
2. 우측 상단의 "+" 버튼 클릭 → "New repository" 선택
3. 저장소 정보 입력:
   - Repository name: `WallboardV2` (또는 원하는 이름)
   - Description: "Agent Ops Wallboard - 실시간 이슈 모니터링 시스템"
   - Public 또는 Private 선택
   - **Initialize this repository with a README 체크 해제** (이미 README가 있으므로)

### 2. 로컬 Git 저장소 초기화

```bash
# 프로젝트 루트 디렉토리에서
git init
git add .
git commit -m "Initial commit: Agent Ops Wallboard"
```

### 3. GitHub 저장소와 연결

```bash
# GitHub에서 제공하는 저장소 URL 사용
git remote add origin https://github.com/your-username/WallboardV2.git
git branch -M main
git push -u origin main
```

## 업로드 후 설정

### 1. 저장소 설정

1. GitHub 저장소 페이지로 이동
2. Settings → Secrets and variables → Actions
3. 필요한 경우 환경 변수 추가 (GitHub Actions 사용 시)

### 2. README 업데이트

저장소의 README.md가 최신 상태인지 확인하고, 필요시 업데이트하세요.

### 3. 이슈 템플릿 활성화

`.github/ISSUE_TEMPLATE/` 폴더의 템플릿이 자동으로 사용됩니다.

## 보안 주의사항

⚠️ **중요**: 다음 항목들을 반드시 확인하세요

1. **절대 업로드하지 말아야 할 것들:**
   - `.env` 파일
   - API 키나 토큰이 포함된 파일
   - 데이터베이스 파일 (`*.db`)
   - 개인 정보가 포함된 파일
   - 인증서 파일 (`*.pem`, `*.key`, `*.crt`)

2. **업로드 전 최종 확인:**
   ```bash
   # Git에 추가될 파일 목록 확인
   git status
   
   # 민감한 정보가 포함된 파일 검색
   git diff --cached | grep -i "password\|secret\|key\|token"
   ```

3. **실수로 업로드한 경우:**
   - 즉시 GitHub에서 해당 파일 삭제
   - Git 히스토리에서 제거 (필요시)
   - API 키나 토큰은 즉시 재발급

## 추가 리소스

- [GitHub 보안 모범 사례](https://docs.github.com/en/code-security)
- [.gitignore 가이드](https://git-scm.com/docs/gitignore)
- [GitHub Actions 문서](https://docs.github.com/en/actions)

## 문제 해결

### 업로드 실패 시

1. 파일 크기 확인 (GitHub는 100MB 이상 파일 제한)
2. 네트워크 연결 확인
3. 인증 정보 확인

### 민감한 정보가 포함된 커밋이 있는 경우

```bash
# Git 히스토리에서 파일 제거 (주의: 히스토리 재작성)
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch path/to/sensitive-file" \
  --prune-empty --tag-name-filter cat -- --all

# 강제 푸시 (협업 중이면 주의)
git push origin --force --all
```

또는 [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) 사용을 고려하세요.
