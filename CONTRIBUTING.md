# 기여 가이드

Agent Ops Wallboard 프로젝트에 기여해주셔서 감사합니다!

## 개발 환경 설정

1. 저장소 클론
```bash
git clone https://github.com/your-username/WallboardV2.git
cd WallboardV2
```

2. 의존성 설치
```bash
# 프론트엔드
npm install

# 백엔드
cd backend
npm install
```

3. 환경 변수 설정
```bash
# backend/.env 파일 생성
cp backend/.env.example backend/.env
# .env 파일을 편집하여 필요한 값 설정
```

4. 데이터베이스 설정
```bash
cd backend
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```

5. 개발 서버 실행
```bash
# 프론트엔드 (터미널 1)
npm run dev

# 백엔드 (터미널 2)
cd backend
npm run dev
```

## 코드 스타일

- 프론트엔드: TypeScript, React, Tailwind CSS
- 백엔드: JavaScript (Node.js), Express
- ESLint 규칙 준수
- Prettier 포맷팅 사용

## 커밋 메시지

커밋 메시지는 명확하고 간결하게 작성해주세요:
- `feat: 새로운 기능 추가`
- `fix: 버그 수정`
- `docs: 문서 수정`
- `style: 코드 스타일 변경`
- `refactor: 코드 리팩토링`
- `test: 테스트 추가`
- `chore: 빌드 설정 변경`

## Pull Request

1. 새로운 브랜치 생성
```bash
git checkout -b feature/your-feature-name
```

2. 변경사항 커밋
```bash
git add .
git commit -m "feat: 기능 설명"
```

3. 브랜치 푸시
```bash
git push origin feature/your-feature-name
```

4. GitHub에서 Pull Request 생성

## 질문이나 도움이 필요하신가요?

이슈를 생성해주시면 도와드리겠습니다!

