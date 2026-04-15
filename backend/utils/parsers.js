/**
 * 공통 파싱 유틸리티 함수들
 * 
 * 여러 컨트롤러에서 중복 사용되는 파싱 로직을 통합
 */

/**
 * 프로젝트 ID 파싱
 * @param {string|number|undefined|null} value - 파싱할 값
 * @returns {number|undefined} 파싱된 프로젝트 ID 또는 undefined
 */
function parseProjectId(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  // '0'도 유효한 값으로 처리
  if (value === 0 || value === '0') {
    return 0;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * 정수 파싱 (범용)
 * @param {string|number|undefined|null} value - 파싱할 값
 * @param {number} defaultValue - 기본값 (파싱 실패 시)
 * @returns {number|undefined} 파싱된 정수 또는 기본값
 */
function parseIntSafe(value, defaultValue = undefined) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 부동소수점 파싱
 * @param {string|number|undefined|null} value - 파싱할 값
 * @param {number} defaultValue - 기본값 (파싱 실패 시)
 * @returns {number|undefined} 파싱된 부동소수점 또는 기본값
 */
function parseFloatSafe(value, defaultValue = undefined) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 불리언 파싱
 * @param {string|boolean|undefined|null} value - 파싱할 값
 * @param {boolean} defaultValue - 기본값
 * @returns {boolean} 파싱된 불리언 값
 */
function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'yes';
  }
  return Boolean(value);
}

/**
 * 날짜 파싱
 * @param {string|Date|undefined|null} value - 파싱할 값
 * @returns {Date|undefined} 파싱된 Date 객체 또는 undefined
 */
function parseDate(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * 배열 파싱 (쉼표로 구분된 문자열을 배열로 변환)
 * @param {string|Array|undefined|null} value - 파싱할 값
 * @returns {Array|undefined} 파싱된 배열 또는 undefined
 */
function parseArray(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return undefined;
}

/**
 * UUID 파싱 및 검증
 * @param {string|undefined|null} value - 파싱할 값
 * @returns {string|undefined} 유효한 UUID 또는 undefined
 */
function parseUUID(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value) ? value : undefined;
}

module.exports = {
  parseProjectId,
  parseIntSafe,
  parseFloatSafe,
  parseBoolean,
  parseDate,
  parseArray,
  parseUUID
};












