module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'off', // Fast refresh 경고 비활성화 (컴포넌트 외 export 허용)
    ],
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }
    ],
    '@typescript-eslint/no-explicit-any': [
      'off', // any 타입 사용 허용 (타입 정의가 어려운 경우가 많음)
    ],
    'react-hooks/exhaustive-deps': [
      'off', // React Hook 의존성 배열 경고 비활성화 (의도적인 경우가 많음)
    ],
  },
}
