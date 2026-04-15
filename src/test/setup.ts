// Vitest 테스트 설정 파일
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// jest-dom matchers 확장
expect.extend(matchers);

// TypeScript 타입 확장
import '@testing-library/jest-dom/vitest';

// 각 테스트 후 cleanup
afterEach(() => {
  cleanup();
});























