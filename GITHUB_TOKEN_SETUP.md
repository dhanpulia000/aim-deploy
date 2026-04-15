# GitHub Personal Access Token 생성 및 푸시 가이드

## 토큰 생성 단계

### 1. 토큰 생성 페이지로 이동
- 방법 1: 현재 페이지에서 `Generate new token` 또는 `Generate new token (classic)` 버튼 클릭
- 방법 2: 직접 URL 접속: https://github.com/settings/tokens/new

### 2. 토큰 설정
- **Note**: `NodeplugKorea2026 AIM Push`
- **Expiration**: 원하는 만료 기간 선택 (예: 90 days, 1 year)
- **Select scopes**: 
  - ✅ `repo` (전체 체크) - 필수
    - `repo:status`
    - `repo_deployment`
    - `public_repo`
    - `repo:invite`
    - `security_events`

### 3. 토큰 생성
- `Generate token` 버튼 클릭
- **생성된 토큰을 즉시 복사하세요** (다시 볼 수 없습니다!)

### 4. 푸시 실행
토큰 생성 후 아래 명령어를 실행하세요:

```powershell
git push -u origin main
```

입력 프롬프트가 나타나면:
- **Username**: GitHub 사용자명 입력
- **Password**: 생성한 Personal Access Token 붙여넣기

## 조직 SSO 활성화된 경우
만약 조직에 SSO(Single Sign-On)가 활성화되어 있다면:
1. 토큰 생성 후 조직 승인 필요
2. 토큰 목록에서 생성한 토큰 옆 `Enable SSO` 버튼 클릭
3. 각 조직에 대해 승인 완료

## 현재 상태
- 원격 저장소: `https://github.com/NodeplugKorea2026/AIM.git`
- 커밋 완료: 변경사항이 로컬에 커밋됨
- 푸시 대기: 토큰 생성 후 푸시 가능

