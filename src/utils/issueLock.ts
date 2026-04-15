/**
 * Issue Lock API Client
 * 이슈 잠금 관리 API 호출 유틸리티
 */

import { createAuthHeaders } from './headers';

// 토큰을 가져오는 헬퍼 함수 (localStorage에서 직접 읽기)
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export interface IssueLock {
  id: string;
  issueId: string;
  userId: string;
  userName: string;
  lockedAt: string;
  expiresAt: string;
  lastActivityAt: string;
}

export interface AcquireLockResponse {
  success: boolean;
  lock?: IssueLock;
  message?: string;
  existingLock?: IssueLock;
}

export interface ReleaseLockResponse {
  success: boolean;
  released: boolean;
}

export interface CheckLockResponse {
  locked: boolean;
  lock?: IssueLock;
}

/**
 * 이슈 잠금 획득
 */
export async function acquireIssueLock(issueId: string): Promise<AcquireLockResponse> {
  const response = await fetch(`/api/issue-locks/${issueId}`, {
    method: 'POST',
    headers: createAuthHeaders(getToken()) ?? {},
  });

  if (!response.ok && response.status !== 409) {
    throw new Error(`Failed to acquire lock: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 이슈 잠금 해제
 */
export async function releaseIssueLock(issueId: string): Promise<ReleaseLockResponse> {
  const response = await fetch(`/api/issue-locks/${issueId}`, {
    method: 'DELETE',
    headers: createAuthHeaders(getToken()) ?? {},
  });

  if (!response.ok) {
    throw new Error(`Failed to release lock: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 이슈 잠금 상태 확인
 */
export async function checkIssueLock(issueId: string): Promise<CheckLockResponse> {
  const response = await fetch(`/api/issue-locks/${issueId}`, {
    method: 'GET',
    headers: createAuthHeaders(getToken()) ?? {},
  });

  if (!response.ok) {
    throw new Error(`Failed to check lock: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 잠금 활동 시간 갱신 (heartbeat)
 */
export async function refreshIssueLock(issueId: string): Promise<{ success: boolean; refreshed: boolean }> {
  const response = await fetch(`/api/issue-locks/${issueId}/refresh`, {
    method: 'PUT',
    headers: createAuthHeaders(getToken()) ?? {},
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh lock: ${response.statusText}`);
  }

  return response.json();
}


