# GitHub 푸시 방법 안내

## 저장소 생성 확인
먼저 https://github.com/NodeplugKorea2026/AIM 에 접속하여 저장소가 생성되어 있는지 확인하세요.

## 방법 1: Personal Access Token 사용 (권장)

### 1. GitHub에서 Personal Access Token 생성
1. GitHub 로그인
2. 우측 상단 프로필 → `Settings`
3. 좌측 메뉴 하단 `Developer settings`
4. `Personal access tokens` → `Tokens (classic)`
5. `Generate new token` → `Generate new token (classic)`
6. Note: "WallboardV2 Push" 입력
7. Expiration: 원하는 만료일 선택
8. Scopes: `repo` 체크
9. `Generate token` 클릭
10. **토큰을 복사해두세요** (한 번만 표시됩니다)

### 2. 푸시 시 토큰 사용
```powershell
git push -u origin main
```
사용자 이름: `NodeplugKorea2026`
비밀번호: **위에서 생성한 토큰 입력**

## 방법 2: GitHub CLI 사용
```powershell
# GitHub CLI 설치 (없는 경우)
winget install --id GitHub.cli

# 로그인
gh auth login

# 푸시
git push -u origin main
```

## 방법 3: SSH 키 사용

### 1. SSH 키 생성 (없는 경우)
```powershell
ssh-keygen -t ed25519 -C "your_email@example.com"
```

### 2. 공개 키를 GitHub에 등록
1. `cat ~/.ssh/id_ed25519.pub` 명령으로 공개 키 복사
2. GitHub → Settings → SSH and GPG keys → New SSH key
3. 키 붙여넣기 후 저장

### 3. 원격 URL을 SSH로 변경
```powershell
git remote set-url origin git@github.com:NodeplugKorea2026/AIM.git
git push -u origin main
```

## 현재 상태
- 원격 저장소: `https://github.com/NodeplugKorea2026/AIM.git`
- 커밋 완료: 변경사항이 로컬에 커밋되었습니다
- 푸시 대기 중: 저장소 생성 및 인증 후 푸시 가능

