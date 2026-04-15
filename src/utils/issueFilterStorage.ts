/**
 * 검색/필터 상태를 localStorage에 저장하여 새로고침·페이지 이동 후에도 유지
 */

const STORAGE_KEY = 'aim-issue-filters';

export interface StoredFilters {
  searchQuery?: string;
  dateFilter?: { startDate?: string; endDate?: string };
  filter?: { src?: string; sev?: number | string; cat?: string; game?: string };
  showCompletedIssues?: boolean;
}

export function loadFiltersFromStorage(): StoredFilters | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return null;
    const parsed = JSON.parse(s);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function saveFiltersToStorage(partial: StoredFilters): void {
  try {
    const current = loadFiltersFromStorage() || {};
    const merged = { ...current, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

export function clearFiltersFromStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 검색어 복원 시 앞뒤 공백 제거 (공백만 있으면 검색 미적용과 동일하게 처리) */
export function initialSearchQueryTrimmed(): string {
  try {
    const raw = loadFiltersFromStorage()?.searchQuery;
    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}
