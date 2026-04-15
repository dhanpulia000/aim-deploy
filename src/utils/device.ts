/**
 * 디바이스 감지 유틸리티
 */

/**
 * 모바일 디바이스인지 확인
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  
  // User Agent 기반 감지
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
  const isMobileUA = mobileRegex.test(userAgent);
  
  // 화면 크기 기반 감지 (터치 디바이스 보조 확인)
  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;
  
  return isMobileUA || (hasTouchScreen && isSmallScreen);
}

/**
 * iOS 디바이스인지 확인
 */
export function isIOSDevice(): boolean {
  if (typeof window === 'undefined') return false;
  
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  return /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;
}

/**
 * Safari 브라우저인지 확인
 */
export function isSafariBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  
  const userAgent = navigator.userAgent;
  return /^((?!chrome|android).)*safari/i.test(userAgent);
}

