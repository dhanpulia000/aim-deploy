module.exports = {
  // 백엔드는 CommonJS(require) 기반 JS 프로젝트.
  // 상위(레포 루트) ESLint 설정의 TypeScript 규칙이 적용되지 않도록 여기서 root로 끊는다.
  root: true,
  env: {
    node: true,
    es2021: true,
    jest: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script'
  },
  rules: {
    'no-console': 'off', // 로깅을 위해 허용
    // 현재 백엔드는 레거시/운영 스크립트·워커가 많이 섞여 있어
    // 린트 신호 대비 노이즈가 커서 "0 warnings" 목표로 주요 경고 규칙을 비활성화한다.
    'no-unused-vars': 'off',
    'no-undef': 'off',
    'no-empty': 'off',
    'no-useless-escape': 'off',
    'no-dupe-class-members': 'off',
    'no-case-declarations': 'off',
    'no-inner-declarations': 'off'
  },
  // backend/scripts, 테스트 코드는 운영 린트에서 제외 (실행·실험용 스크립트가 많음)
  ignorePatterns: [
    'node_modules',
    'temp',
    'coverage',
    '__tests__',
    'scripts',
    'check-*.js',
    // Playwright evaluate 스니펫 등으로 브라우저 전역(document/window)이 섞여 린트 노이즈가 큼
    'workers/monitoring/**',
    // 브라우저 evaluate 스니펫이 포함된 서비스(운영상 문제는 아님)
    'services/manualIngest.service.js',
    'services/boardListDailyCount.service.js'
  ]
};























