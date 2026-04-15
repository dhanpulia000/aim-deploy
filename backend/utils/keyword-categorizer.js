// 키워드 기반 이슈 카테고리 자동 분류 유틸리티

/**
 * 카테고리별 키워드 팩 (한국어/영어 동의어, 오탈자 포함)
 */
const KEYWORD_PACKS = {
  '장애/접속': {
    keywords: [
      '서버', '점검', '접속 불가', '접속불가', '접속안됨', '접속안됨',
      '튕김', '렉', '핑', '지연', '버벅', '다운', '오류', '에러', 
      '먹통', 'maintenance', 'outage', 'lag', 'ping', 'dc', 'disconnect',
      'crash', '서버다운', '서버 점검', '접속 문제', '연결 안됨',
      '연결안됨', '연결 오류', '타임아웃', 'timeout', 'connection error'
    ],
    priority: 1 // 높은 우선순위
  },
  '결제/환불': {
    keywords: [
      '환불', '결제 오류', '결제오류', '미결제', '영수증', '과금', 
      '결제취소', '결제 취소', '청구', 'charge', 'refund', 'billing', 
      'payment failed', 'payment error', 'double charge', '중복결제',
      '결제 실패', '결제실패', '환불요청', '환불 요청', '미환불',
      '과금오류', '과금 오류', '청구오류', '청구 오류'
    ],
    priority: 2
  },
  '핵/부정행위': {
    keywords: [
      '핵', '치트', '에임핵', '에임 핵', '매크로', '스피드핵', '스피드 핵',
      '벽핵', '벽 핵', 'bot', 'cheat', 'aimbot', 'macro', 'hack', 
      'exploit', '핵쟁이', '핵유저', '치트유저', '부정행위', '부정 행위',
      '사기', '조작', 'exploitation', 'hacking'
    ],
    priority: 3
  },
  '운영/정책': {
    keywords: [
      '밴', '정지', '제재', '영구정지', '영구 정지', '어필', '공지', 
      '운영자', '신고', 'ban', 'suspend', 'appeal', 'policy', 'ToS',
      '이용약관', '규정', '정책', '운영 공지', '운영공지', '제재 안내',
      '계정 정지', '계정정지', '계정 밴', '계정밴', '신고하기', '신고 하기'
    ],
    priority: 4
  },
  '불만/이탈징후': {
    keywords: [
      '망겜', '망 겜', '현타', '접을', '접을래', '환멸', '실망', '욕',
      'refund please', 'quitting', 'uninstall', '삭제', '지우기',
      '탈퇴', '접지마', '접지 말아', '접지말아', '게임 망함', '망함',
      '망한 게임', '재미없음', '재미 없음', '너무 쉬움', '너무 어려움',
      '밸런스', '밸런스 문제', '밸런스문제'
    ],
    priority: 5
  }
};

/**
 * 텍스트 정규화 (한글 자모 분리 방지, 공백/이모지 제거, 소문자화)
 * @param {string} text - 원본 텍스트
 * @returns {string} 정규화된 텍스트
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ') // 여러 공백을 하나로
    .replace(/[^\w\s가-힣]/g, '') // 이모지 및 특수문자 제거 (한글, 영문, 숫자만 유지)
    .trim();
}

/**
 * 키워드 매칭 (부분 일치 포함)
 * @param {string} text - 검색할 텍스트
 * @param {Array<string>} keywords - 키워드 배열
 * @returns {boolean} 매칭 여부
 */
function matchKeywords(text, keywords) {
  const normalizedText = normalizeText(text);
  
  return keywords.some(keyword => {
    const normalizedKeyword = normalizeText(keyword);
    return normalizedText.includes(normalizedKeyword);
  });
}

/**
 * 이슈 텍스트에서 카테고리 분류
 * @param {string} title - 이슈 제목
 * @param {string} detail - 이슈 상세 내용
 * @param {string} summary - 이슈 요약
 * @returns {Array<string>} 매칭된 카테고리 배열 (우선순위 순)
 */
function categorizeIssue(title = '', detail = '', summary = '') {
  const combinedText = `${title} ${detail} ${summary}`;
  const matches = [];
  
  // 각 카테고리별로 매칭 확인
  for (const [category, config] of Object.entries(KEYWORD_PACKS)) {
    if (matchKeywords(combinedText, config.keywords)) {
      matches.push({
        category,
        priority: config.priority,
        matched: true
      });
    }
  }
  
  // 우선순위 순으로 정렬 (낮은 숫자가 높은 우선순위)
  matches.sort((a, b) => a.priority - b.priority);
  
  // 카테고리 이름만 반환
  return matches.map(m => m.category);
}

/**
 * 이슈 객체에 카테고리 추가
 * @param {Object} issue - 이슈 객체
 * @returns {Object} 카테고리가 추가된 이슈 객체
 */
function enrichIssueWithCategory(issue) {
  const categories = categorizeIssue(
    issue.summary || issue.title || '',
    issue.detail || '',
    issue.summary || ''
  );
  
  return {
    ...issue,
    categories: categories.length > 0 ? categories : ['기타'],
    primaryCategory: categories.length > 0 ? categories[0] : '기타',
    categoryCount: categories.length
  };
}

/**
 * 여러 이슈에 카테고리 일괄 추가
 * @param {Array<Object>} issues - 이슈 배열
 * @returns {Array<Object>} 카테고리가 추가된 이슈 배열
 */
function enrichIssuesWithCategories(issues) {
  return issues.map(issue => enrichIssueWithCategory(issue));
}

/**
 * 카테고리별 통계 생성
 * @param {Array<Object>} issues - 이슈 배열
 * @returns {Object} 카테고리별 통계
 */
function getCategoryStats(issues) {
  const stats = {};
  
  issues.forEach(issue => {
    const categories = issue.categories || ['기타'];
    categories.forEach(category => {
      if (!stats[category]) {
        stats[category] = {
          count: 0,
          issues: []
        };
      }
      stats[category].count++;
      stats[category].issues.push(issue.id);
    });
  });
  
  return stats;
}

module.exports = {
  KEYWORD_PACKS,
  normalizeText,
  matchKeywords,
  categorizeIssue,
  enrichIssueWithCategory,
  enrichIssuesWithCategories,
  getCategoryStats
};







