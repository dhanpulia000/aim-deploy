/**
 * 헤더 유틸리티 함수
 * TypeScript 타입 안전성을 위한 헬퍼 함수들
 */

/**
 * 인증 헤더를 안전하게 생성
 * @param token - 인증 토큰 (없으면 undefined 반환)
 * @returns HeadersInit 또는 undefined
 */
export function createAuthHeaders(token: string | null | undefined): HeadersInit | undefined {
  if (!token) {
    return undefined;
  }
  return {
    Authorization: `Bearer ${token}`
  };
}

/**
 * 인증 헤더와 Content-Type을 포함한 헤더 생성
 * @param token - 인증 토큰 (없으면 Content-Type만 포함)
 * @returns HeadersInit
 */
export function createJsonHeaders(token?: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  
  return headers;
}

/**
 * 헤더를 안전하게 변환 (undefined 제거)
 * @param headers - 변환할 헤더
 * @returns Record<string, string> 또는 undefined
 */
export function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  
  if (Array.isArray(headers)) {
    const result: Record<string, string> = {};
    headers.forEach(([key, value]) => {
      if (value) {
        result[key] = value;
      }
    });
    return result;
  }
  
  // Record<string, string> 형식
  const result: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (value) {
      result[key] = String(value);
    }
  });
  
  return Object.keys(result).length > 0 ? result : undefined;
}









