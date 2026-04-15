/**
 * API 호출 유틸리티 함수
 * 타입 안전한 API 호출을 위한 헬퍼 함수들
 */

import type { ApiResponse } from '../types';
import { createAuthHeaders, createJsonHeaders } from './headers';

/**
 * API 에러 클래스
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: ApiResponse
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 타입 안전한 fetch 래퍼
 * @param url - API 엔드포인트 URL
 * @param options - fetch 옵션
 * @returns Promise<ApiResponse<T>>
 */
async function apiFetch<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const body: ApiResponse<T> = await response.json();

  if (!response.ok) {
    throw new ApiError(
      body.message || body.error || 'API 요청 실패',
      response.status,
      body
    );
  }

  return body;
}

/**
 * 인증이 필요한 API 호출
 * @param url - API 엔드포인트 URL
 * @param token - 인증 토큰
 * @param options - fetch 옵션
 * @returns Promise<ApiResponse<T>>
 */
export async function authenticatedFetch<T = any>(
  url: string,
  token: string | null | undefined,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers = createJsonHeaders(token);
  
  return apiFetch<T>(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });
}

/**
 * GET 요청
 * @param url - API 엔드포인트 URL
 * @param token - 인증 토큰 (선택)
 * @returns Promise<T> - 응답 데이터
 */
export async function apiGet<T = any>(
  url: string,
  token?: string | null
): Promise<T> {
  const headers = token ? createAuthHeaders(token) : undefined;
  const response = await apiFetch<T>(url, {
    method: 'GET',
    headers: headers || undefined,
  });
  
  return response.data as T;
}

/**
 * POST 요청
 * @param url - API 엔드포인트 URL
 * @param data - 요청 본문 데이터
 * @param token - 인증 토큰 (선택)
 * @returns Promise<T> - 응답 데이터
 */
export async function apiPost<T = any, D = any>(
  url: string,
  data: D,
  token?: string | null
): Promise<T> {
  const headers = createJsonHeaders(token);
  const response = await apiFetch<T>(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  
  return response.data as T;
}

/**
 * PUT 요청
 * @param url - API 엔드포인트 URL
 * @param data - 요청 본문 데이터
 * @param token - 인증 토큰 (선택)
 * @returns Promise<T> - 응답 데이터
 */
export async function apiPut<T = any, D = any>(
  url: string,
  data: D,
  token?: string | null
): Promise<T> {
  const headers = createJsonHeaders(token);
  const response = await apiFetch<T>(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  });
  
  return response.data as T;
}

/**
 * DELETE 요청
 * @param url - API 엔드포인트 URL
 * @param token - 인증 토큰 (선택)
 * @returns Promise<T> - 응답 데이터
 */
export async function apiDelete<T = any>(
  url: string,
  token?: string | null
): Promise<T> {
  const headers = token ? createAuthHeaders(token) : undefined;
  const response = await apiFetch<T>(url, {
    method: 'DELETE',
    headers: headers || undefined,
  });
  
  return response.data as T;
}

/**
 * FormData를 사용한 POST 요청 (파일 업로드 등)
 * @param url - API 엔드포인트 URL
 * @param formData - FormData 객체
 * @param token - 인증 토큰 (선택)
 * @returns Promise<T> - 응답 데이터
 */
export async function apiPostFormData<T = any>(
  url: string,
  formData: FormData,
  token?: string | null
): Promise<T> {
  const headers = token ? createAuthHeaders(token) : undefined;
  const response = await apiFetch<T>(url, {
    method: 'POST',
    headers: headers || undefined,
    body: formData,
  });
  
  return response.data as T;
}









