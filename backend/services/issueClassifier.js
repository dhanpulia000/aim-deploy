/**
 * 이슈 텍스트를 DB의 CategoryGroup/Category로 분류하는 서비스
 * 
 * 키워드 기반 매칭을 사용하여 동적 카테고리 시스템과 통합
 */

const { query } = require('../libs/db');
const logger = require('../utils/logger');

// 인메모리 캐시 (카테고리 그룹 및 카테고리)
let cachedGroups = null;
let cachedCategories = null;
let lastLoadedAt = null;
const CACHE_TTL = 5 * 60 * 1000; // 5분

/**
 * 카테고리 데이터를 DB에서 로드하고 캐시
 * @param {Object} db - 데이터베이스 인스턴스 (호환성을 위해 유지)
 */
function loadCategories(db) {
  const now = Date.now();
  if (cachedGroups && lastLoadedAt && (now - lastLoadedAt) < CACHE_TTL) {
    return { groups: cachedGroups, categories: cachedCategories };
  }

  const groups = query(
    'SELECT * FROM CategoryGroup WHERE isActive = ? ORDER BY name ASC',
    [1]
  );
  
  const categories = query(
    'SELECT c.*, cg.id as group_id, cg.name as group_name, cg.code as group_code FROM Category c JOIN CategoryGroup cg ON c.groupId = cg.id WHERE c.isActive = ? ORDER BY c.name ASC',
    [1]
  );
  
  // 그룹별로 카테고리 그룹화
  const categoriesByGroup = {};
  categories.forEach(cat => {
    if (!categoriesByGroup[cat.groupId]) {
      categoriesByGroup[cat.groupId] = [];
    }
    categoriesByGroup[cat.groupId].push({
      ...cat,
      group: {
        id: cat.group_id,
        name: cat.group_name,
        code: cat.group_code
      }
    });
  });
  
  const formattedGroups = groups.map(group => ({
    ...group,
    isActive: Boolean(group.isActive),
    categories: categoriesByGroup[group.id] || []
  }));

  cachedGroups = formattedGroups;
  cachedCategories = categories.map(cat => ({
    ...cat,
    isActive: Boolean(cat.isActive),
    group: {
      id: cat.group_id,
      name: cat.group_name,
      code: cat.group_code
    }
  }));
  lastLoadedAt = now;

  return { groups: formattedGroups, categories: cachedCategories };
}

/**
 * 텍스트 정규화 (한글 자모 분리 방지, 공백/이모지 제거, 소문자화)
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s가-힣]/g, '')
    .trim();
}

/**
 * 키워드 매칭 (부분 일치 포함)
 */
function matchKeywords(text, keywords) {
  const normalizedText = normalizeText(text);
  return keywords.some(keyword => {
    const normalizedKeyword = normalizeText(keyword);
    return normalizedText.includes(normalizedKeyword);
  });
}

/**
 * 키워드 매핑 규칙 (카테고리 그룹 코드 -> 키워드 배열)
 * 이 규칙은 DB의 카테고리와 매핑됩니다
 */
const KEYWORD_MAPPINGS = {
  SERVER: {
    keywords: [
      '서버', '점검', '접속 불가', '접속불가', '접속안됨', '접속안됨',
      '서버다운', '서버 점검', '접속 문제', '연결 안됨', '연결안됨',
      '연결 오류', '타임아웃', 'timeout', 'connection error',
      'maintenance', 'outage', 'dc', 'disconnect', 'crash'
    ],
    categoryKeywords: {
      '접속 불가': ['접속 불가', '접속불가', '접속안됨', '로그인 안됨', '로그인안됨', '서버다운', '서버 점검'],
      '네트워크': ['네트워크', 'network', 'ping', '핑', '지연', 'lag', 'latency']
    }
  },
  PERFORMANCE: {
    keywords: [
      '프레임', 'fps', '렉', '버벅', '성능', '최적화', 'optimization',
      'performance', 'lag', 'stutter', 'freeze', '실행 오류', '실행오류'
    ],
    categoryKeywords: {
      '프레임 드랍': ['프레임', 'fps', 'frame', '드랍', 'drop'],
      '실행 오류': ['실행 오류', '실행오류', '런타임', 'runtime', 'error'],
      '최적화': ['최적화', 'optimization', '성능', 'performance']
    }
  },
  ILLEGAL_PROGRAM: {
    keywords: [
      '핵', '치트', '에임핵', '에임 핵', '매크로', '스피드핵', '스피드 핵',
      '벽핵', '벽 핵', 'bot', 'cheat', 'aimbot', 'macro', 'hack',
      'exploit', '핵쟁이', '핵유저', '치트유저', '부정행위', '부정 행위',
      '이용제한조치', '계정도용'
    ],
    categoryKeywords: {
      '이용제한조치': ['이용제한조치', '제재', '정지', '밴', 'ban'],
      '계정도용': ['계정도용', '도용', '해킹', 'hacking', 'account']
    }
  },
  CONTENT: {
    keywords: [
      '게임 플레이', '경쟁전', '일반매치', '아케이드', '이벤트',
      '서바이버패스', '유료', '총기 밸런스', '비매너 행위',
      'gameplay', 'ranked', 'match', 'arcade', 'event', 'pass', 'weapon', 'balance'
    ],
    categoryKeywords: {
      '게임 플레이': ['게임 플레이', 'gameplay', '플레이'],
      '경쟁전': ['경쟁전', 'ranked', '랭크'],
      '일반매치': ['일반매치', 'normal match', '매치'],
      '아케이드': ['아케이드', 'arcade'],
      '이벤트': ['이벤트', 'event'],
      '서바이버패스': ['서바이버패스', 'survivor pass', '패스'],
      '유료': ['유료', 'paid', '구매', 'purchase'],
      '총기 밸런스': ['총기 밸런스', 'weapon balance', '밸런스'],
      '비매너 행위': ['비매너', 'toxic', '매너']
    }
  },
  BUG: {
    keywords: [
      '버그', 'bug', '오류', '에러', '지형 투과', '오브젝트 끼임',
      '그래픽', '모델링', '아이템', 'UI', 'UX', '음량', '음성',
      'glitch', 'error', 'graphic', 'modeling', 'item', 'sound', 'audio'
    ],
    categoryKeywords: {
      '지형 투과': ['지형 투과', 'terrain', 'clip', '투과'],
      '오브젝트 끼임': ['오브젝트 끼임', 'stuck', '끼임'],
      '그래픽': ['그래픽', 'graphic', 'visual'],
      '모델링': ['모델링', 'modeling', 'model'],
      '아이템': ['아이템', 'item'],
      'UI': ['UI', '인터페이스', 'interface'],
      'UX': ['UX', '사용자 경험', 'user experience'],
      '음량 및 음성': ['음량', '음성', 'sound', 'audio', 'volume']
    }
  },
  ESPORTS: {
    keywords: [
      'PCS', 'PGI', 'esports', '이스포츠', '프로게임', '대회', 'tournament'
    ],
    categoryKeywords: {
      'PCS': ['PCS'],
      'PGI': ['PGI']
    }
  },
  COMMUNITY: {
    keywords: [
      '커뮤니티', 'community', '이벤트', 'event', '소통'
    ],
    categoryKeywords: {
      '이벤트': ['이벤트', 'event']
    }
  },
  OTHER_GAME: {
    keywords: [
      '타게임', '다른 게임', 'other game', '외부 게임'
    ],
    categoryKeywords: {
      '타게임 제목': ['타게임', 'other game', '다른 게임']
    }
  }
};

/**
 * 규칙 기반 분류 (기존 키워드 매칭 로직)
 * 
 * @param {object} params
 * @param {string} params.text - 전체 텍스트 (제목 + 상세)
 * @param {PrismaClient} params.prisma
 * @returns {Promise<{
 *   groupId: number | null
 *   categoryId: number | null
 *   importance: string // "HIGH" | "MEDIUM" | "LOW"
 *   otherGameTitle?: string | null
 * }>}
 */
async function classifyIssueCategoryByRules({ text, db }) {
  if (!text || typeof text !== 'string') {
    return {
      groupId: null,
      categoryId: null,
      importance: 'MEDIUM',
      otherGameTitle: null
    };
  }

  try {
    const { groups, categories } = loadCategories(db);

    // 각 그룹별로 키워드 매칭 시도
    for (const group of groups) {
      const mapping = KEYWORD_MAPPINGS[group.code];
      if (!mapping) continue;

      // 그룹 레벨 키워드 매칭
      if (matchKeywords(text, mapping.keywords)) {
        // 그룹 내 카테고리 매칭 시도
        const groupCategories = categories.filter(c => c.groupId === group.id);
        
        for (const category of groupCategories) {
          const categoryMapping = mapping.categoryKeywords?.[category.name];
          if (categoryMapping && matchKeywords(text, categoryMapping)) {
            // 매칭된 카테고리 반환
            return {
              groupId: group.id,
              categoryId: category.id,
              importance: group.importance,
              otherGameTitle: group.code === 'OTHER_GAME' ? extractGameTitle(text) : null
            };
          }
        }

        // 그룹은 매칭되었지만 특정 카테고리는 없음 -> 첫 번째 활성 카테고리 사용
        if (groupCategories.length > 0) {
          return {
            groupId: group.id,
            categoryId: groupCategories[0].id,
            importance: group.importance,
            otherGameTitle: group.code === 'OTHER_GAME' ? extractGameTitle(text) : null
          };
        }

        // 그룹만 매칭 (카테고리 없음)
        return {
          groupId: group.id,
          categoryId: null,
          importance: group.importance,
          otherGameTitle: group.code === 'OTHER_GAME' ? extractGameTitle(text) : null
        };
      }
    }

    // 매칭 실패 -> 기본값
    return {
      groupId: null,
      categoryId: null,
      importance: 'MEDIUM',
      otherGameTitle: null
    };
  } catch (error) {
    logger.error('[IssueClassifier] Error classifying issue', {
      error: error.message,
      stack: error.stack
    });
    // 에러 발생 시 기본값 반환
    return {
      groupId: null,
      categoryId: null,
      importance: 'MEDIUM',
      otherGameTitle: null
    };
  }
}

/**
 * OTHER_GAME 그룹용: 텍스트에서 게임 제목 추출 (간단한 휴리스틱)
 */
function extractGameTitle(text) {
  // 간단한 추출 로직 (필요시 개선 가능)
  const normalized = normalizeText(text);
  const gamePatterns = [
    /(?:게임|game)[\s:]+([가-힣a-zA-Z0-9\s]+)/i,
    /([가-힣a-zA-Z0-9\s]+)[\s]*(?:게임|game)/i
  ];

  for (const pattern of gamePatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      return match[1].trim().substring(0, 100); // 최대 100자
    }
  }

  return null;
}

/**
 * 캐시 무효화 (카테고리 변경 시 호출)
 */
function invalidateCache() {
  cachedGroups = null;
  cachedCategories = null;
  lastLoadedAt = null;
}

/**
 * 하이브리드 분류기: AI 먼저 시도, 실패 시 규칙 기반으로 폴백
 * 
 * @param {object} params
 * @param {string} params.text - 전체 텍스트 (제목 + 상세)
 * @param {PrismaClient} params.prisma
 * @returns {Promise<{
 *   groupId: number | null
 *   categoryId: number | null
 *   importance: string // "HIGH" | "MEDIUM" | "LOW"
 *   otherGameTitle?: string | null
 * }>}
 */
async function classifyIssueCategory({ text, db, projectId = null }) {
  // 프로젝트 정보 로드 (severityRules 포함)
  let project = null;
  let severityRules = null;
  if (projectId) {
    try {
      const { queryOne } = require('../libs/db');
      project = queryOne(
        'SELECT id, name, severityRules FROM Project WHERE id = ?',
        [projectId]
      );
      if (project && project.severityRules) {
        severityRules = project.severityRules;
      }
    } catch (error) {
      logger.warn('[IssueClassifier] Failed to load project', { projectId, error: error.message });
    }
  }

  // 1) AI 기반 분류 시도
  try {
    const { classifyIssueWithAI, analyzeSentimentWithAI } = require('./aiIssueClassifier');
    const aiResult = await classifyIssueWithAI({ 
      text, 
      projectId: projectId || null,
      severityRules: severityRules || null
    });

    // AI 분류 성공 조건: groupId는 필수 (대분류는 반드시 있어야 함)
    if (aiResult && aiResult.groupId) {
      // Sentiment 분석 시도 (별도 함수)
      let sentiment = aiResult.sentiment || 'neu';
      try {
        const sentimentResult = await analyzeSentimentWithAI({ text });
        if (sentimentResult && sentimentResult.sentiment) {
          sentiment = sentimentResult.sentiment;
          logger.debug('[IssueClassifier] Sentiment analyzed', { 
            sentiment, 
            reason: sentimentResult.reason?.substring(0, 50) 
          });
        }
      } catch (sentimentError) {
        logger.warn('[IssueClassifier] Sentiment analysis failed, using default', {
          error: sentimentError.message
        });
      }

      // AI 분류 성공
      return {
        importance: aiResult.importance,
        groupId: aiResult.groupId,
        categoryId: aiResult.categoryId || null,
        severity: aiResult.severity || null,
        sentiment: sentiment,
        trend: aiResult.trend || null,
        otherGameTitle: aiResult.otherGameTitle || null,
        aiClassificationReason: aiResult.reason || null,
        aiClassificationMethod: 'AI'
      };
    }
    
    // groupId가 없으면 AI 분류 실패로 간주하고 규칙 기반으로 폴백
    if (aiResult && !aiResult.groupId) {
      logger.warn('[IssueClassifier] AI classification missing groupId, falling back to rules', {
        hasCategoryId: !!aiResult.categoryId,
        reason: aiResult.reason?.substring(0, 100)
      });
    }
  } catch (error) {
    // AI 분류 실패는 무시하고 규칙 기반으로 폴백
    logger.warn('[IssueClassifier] AI classification failed, falling back to rules', {
      error: error.message
    });
  }

  // 2) 폴백: 규칙 기반 분류
  const ruleResult = classifyIssueCategoryByRules({ text, db });
  return {
    ...ruleResult,
    aiClassificationMethod: 'RULE'
  };
}

module.exports = {
  classifyIssueCategory,
  classifyIssueCategoryByRules, // 규칙 기반 분류도 직접 사용 가능하도록 export
  loadCategories,
  invalidateCache
};

