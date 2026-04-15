# 조직 저장소에 푸시하기

## 현재 설정
- 원격 저장소: `https://github.com/NodeplugKorea2026/AIM.git`
- Git 사용자: Young (koyoung.ice@gmail.com)

## 필수 확인사항

### 1. 조직 멤버십 확인
- `NodeplugKorea2026` 조직의 멤버인지 확인
- 저장소 `AIM`에 대한 Write 권한이 있는지 확인
- 확인 방법: https://github.com/orgs/NodeplugKorea2026/repositories 에서 AIM 저장소가 보이는지 확인

### 2. Personal Access Token 생성
1. GitHub 로그인
2. https://github.com/settings/tokens 접속
3. `Generate new token` → `Generate new token (classic)`
4. 설정:
   - Note: "NodeplugKorea2026 AIM Push"
   - Expiration: 원하는 기간 선택
   - Scopes:
     - ✅ `repo` (전체 체크)
     - ✅ `write:org` (조직 권한, 필요시)
5. `Generate token` 클릭
6. **토큰을 복사해두세요** (한 번만 표시됨)

### 3. 푸시 실행
```powershell
git push -u origin main
```

실행 시 입력:
- **Username**: `NodeplugKorea2026` 또는 개인 GitHub 사용자명
- **Password**: 생성한 Personal Access Token 붙여넣기

## 문제 해결

### "Repository not found" 오류
- 조직 멤버가 아닐 수 있음
- 저장소 권한이 없을 수 있음
- 조직 관리자에게 권한 요청 필요

### "Permission denied" 오류
- Personal Access Token에 `repo` 권한이 없음
- 조직 정책으로 인해 토큰 사용이 제한될 수 있음

### 조직 SSO(Single Sign-On) 활성화된 경우
- Personal Access Token 생성 후 조직 승인 필요
- 토큰 생성 페이지에서 "Enable SSO" 버튼 클릭하여 조직 승인

