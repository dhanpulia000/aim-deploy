# GitHub Personal Access Token 메뉴 찾기 가이드

## 가장 빠른 방법: 직접 URL 접속

### 1. 토큰 생성 페이지 (직접 접속)
```
https://github.com/settings/tokens/new
```

이 URL을 브라우저 주소창에 입력하면 바로 토큰 생성 페이지로 이동합니다.

### 2. 토큰 목록 페이지 (기존 토큰 확인)
```
https://github.com/settings/tokens
```

## 단계별 메뉴 경로

### 방법 1: 프로필 메뉴에서 찾기

1. **GitHub 로그인**
   - https://github.com 접속

2. **우측 상단 프로필 아이콘 클릭**
   - 화면 우측 상단의 프로필 사진 또는 아이콘 클릭

3. **Settings 클릭**
   - 드롭다운 메뉴에서 **Settings** 선택
   - 또는 직접: https://github.com/settings

4. **좌측 메뉴 하단으로 스크롤**
   - 좌측 사이드바를 아래로 스크롤

5. **Developer settings 클릭**
   - 좌측 하단에 있는 **Developer settings** 클릭
   - 또는 직접: https://github.com/settings/apps

6. **Personal access tokens 클릭**
   - **Personal access tokens** 섹션에서
   - **Tokens (classic)** 클릭
   - 또는 직접: https://github.com/settings/tokens

7. **Generate new token 클릭**
   - 우측 상단의 **Generate new token** 버튼 클릭
   - 또는 **Generate new token (classic)** 클릭
   - 또는 직접: https://github.com/settings/tokens/new

### 방법 2: 검색 기능 사용

1. GitHub 로그인
2. 우측 상단 검색창에 "tokens" 입력
3. "Personal access tokens" 선택

## 토큰 생성 페이지 설정

토큰 생성 페이지에 도착하면:

1. **Note** (토큰 이름)
   - 예: `NodeplugKorea2026 AIM Push`

2. **Expiration** (만료 기간)
   - 드롭다운에서 선택 (예: 90 days, 1 year)

3. **Select scopes** (권한 선택)
   - **repo** 섹션을 찾아서
   - **repo** 체크박스를 클릭 (전체 권한)
   - 또는 개별 권한 선택:
     - ✅ repo:status
     - ✅ repo_deployment
     - ✅ public_repo
     - ✅ repo:invite
     - ✅ security_events

4. **Generate token** 버튼 클릭

5. **토큰 복사**
   - 생성된 토큰을 즉시 복사하세요!
   - `ghp_` 또는 `github_pat_`로 시작하는 긴 문자열

## 조직 승인 (SSO)

토큰 생성 후:

1. **토큰 목록으로 돌아가기**
   - https://github.com/settings/tokens

2. **생성한 토큰 찾기**
   - 방금 생성한 토큰을 찾습니다

3. **Enable SSO 버튼 클릭**
   - 토큰 오른쪽에 **"Enable SSO"** 또는 **"Configure SSO"** 버튼이 있습니다
   - 클릭합니다

4. **조직 승인**
   - `NodeplugKorea2026` 조직을 선택
   - **Authorize** 클릭

## 빠른 링크 모음

- **토큰 생성**: https://github.com/settings/tokens/new
- **토큰 목록**: https://github.com/settings/tokens
- **설정 메인**: https://github.com/settings
- **Developer settings**: https://github.com/settings/apps

## 문제 해결

### "Developer settings"가 보이지 않는 경우
- 좌측 메뉴를 아래로 스크롤해야 할 수 있습니다
- 또는 직접 URL 접속: https://github.com/settings/apps

### "Personal access tokens"가 보이지 않는 경우
- 직접 URL 접속: https://github.com/settings/tokens
- 또는 https://github.com/settings/tokens/new

### 토큰 생성 버튼이 보이지 않는 경우
- 조직 정책으로 인해 제한될 수 있습니다
- 조직 관리자에게 문의하세요

## 스크린샷 설명

메뉴 구조:
```
GitHub
└── 프로필 아이콘 (우측 상단)
    └── Settings
        └── Developer settings (좌측 하단)
            └── Personal access tokens
                └── Tokens (classic)
                    └── Generate new token (우측 상단)
```

