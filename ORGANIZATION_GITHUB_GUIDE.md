# 조직 GitHub 사용 가이드

조직(Organization) GitHub 저장소에 접근하고 푸시하는 방법입니다.

## 조직 GitHub의 특징

1. **SSO (Single Sign-On)** 활성화 가능
2. **Personal Access Token에 조직 승인 필요**
3. **조직 정책에 따른 토큰 사용 제한**
4. **저장소 접근 권한 관리**

## Personal Access Token 생성 (조직용)

### 1. 개인 계정에서 토큰 생성
1. GitHub 로그인 (개인 계정)
2. 우측 상단 프로필 → **Settings**
3. 좌측 하단 **Developer settings**
4. **Personal access tokens** → **Tokens (classic)**
5. **Generate new token** → **Generate new token (classic)**

### 2. 토큰 설정
- **Note**: `NodeplugKorea2026 AIM Push`
- **Expiration**: 원하는 기간 선택
- **Select scopes**:
  - ✅ **repo** (전체 체크) - 필수
    - `repo:status`
    - `repo_deployment`
    - `public_repo`
    - `repo:invite`
    - `security_events`

### 3. 토큰 생성
- **Generate token** 클릭
- **토큰 복사** (한 번만 표시됨!)

## 조직 승인 (SSO 활성화된 경우)

### 토큰 생성 후 조직 승인 필요

1. **토큰 목록으로 돌아가기**
   - Settings → Developer settings → Personal access tokens → Tokens (classic)

2. **생성한 토큰 찾기**
   - 방금 생성한 토큰 옆에 **"Enable SSO"** 또는 **"Configure SSO"** 버튼이 보임

3. **조직 승인**
   - **Enable SSO** 또는 **Configure SSO** 클릭
   - `NodeplugKorea2026` 조직 선택
   - **Authorize** 클릭
   - 조직 관리자가 승인해야 할 수도 있음

4. **승인 확인**
   - 토큰 옆에 ✅ 표시가 나타나면 승인 완료

## 조직 정책 확인

### 조직 설정에서 확인할 사항

1. **조직 설정 페이지로 이동**
   - https://github.com/organizations/NodeplugKorea2026/settings/personal_access_tokens

2. **정책 확인**
   - **"Allow access via personal access tokens (classic)"** 활성화되어 있는지 확인
   - **"Personal access tokens (classic) must expire"** 체크 여부 확인

3. **권한 요청**
   - 조직 관리자에게 토큰 사용 권한 요청이 필요할 수 있음

## 푸시 방법

### 방법 1: HTTPS + Personal Access Token

```powershell
# 원격 저장소 확인
git remote -v

# 푸시 실행
git push -u origin main
```

입력 프롬프트:
- **Username**: GitHub 개인 계정 사용자명
- **Password**: 생성한 Personal Access Token (조직 승인 완료된 것)

### 방법 2: SSH 키 사용 (조직 정책 허용 시)

```powershell
# SSH 키 생성 (없는 경우)
ssh-keygen -t ed25519 -C "your_email@example.com"

# 공개 키 복사
cat ~/.ssh/id_ed25519.pub

# GitHub에 SSH 키 등록
# GitHub → Settings → SSH and GPG keys → New SSH key

# 원격 URL을 SSH로 변경
git remote set-url origin git@github.com:NodeplugKorea2026/AIM.git

# 푸시
git push -u origin main
```

## 조직 저장소 클론 (서버에서)

### HTTPS 사용
```bash
# Personal Access Token 필요
git clone https://github.com/NodeplugKorea2026/AIM.git

# 또는 토큰을 URL에 포함 (보안 주의)
git clone https://YOUR_TOKEN@github.com/NodeplugKorea2026/AIM.git
```

### SSH 사용 (권장)
```bash
# SSH 키 설정 후
git clone git@github.com:NodeplugKorea2026/AIM.git
```

## 문제 해결

### "Repository not found" 오류
- 조직 멤버가 아닐 수 있음
- 저장소 접근 권한이 없을 수 있음
- 조직 관리자에게 권한 요청 필요

### "Permission denied" 오류
- Personal Access Token에 `repo` 권한이 없음
- 조직 SSO 승인이 안 됨
- 조직 정책으로 토큰 사용이 제한됨

### "SSO authorization required" 오류
- 토큰 목록에서 해당 토큰의 "Enable SSO" 클릭
- 조직 승인 완료 필요

### 조직 관리자에게 요청할 사항
1. 조직 멤버로 추가 요청
2. `AIM` 저장소에 대한 Write 권한 요청
3. Personal Access Token 사용 허용 정책 확인
4. SSO 승인 (필요시)

## 체크리스트

### 토큰 생성 전
- [ ] 조직 멤버인지 확인
- [ ] 저장소 접근 권한 확인
- [ ] 조직 정책 확인

### 토큰 생성 후
- [ ] 토큰 복사 완료
- [ ] 조직 SSO 승인 (필요시)
- [ ] 토큰 테스트 (푸시 시도)

### 푸시 전
- [ ] 로컬 변경사항 커밋 완료
- [ ] 원격 저장소 URL 확인
- [ ] 토큰 준비 완료

## 현재 상태 확인

```powershell
# 원격 저장소 확인
git remote -v

# 현재 브랜치 확인
git branch

# 커밋 상태 확인
git status

# 푸시 가능한 커밋 확인
git log origin/main..HEAD
```

