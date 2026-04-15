/**
 * AI 기반 이슈 분류기
 * OpenAI API (또는 호환 API)를 사용하여 이슈를 의미론적으로 분류
 */

// 환경 변수 로드 (다른 모듈보다 먼저 로드되더라도 환경 변수를 읽을 수 있도록)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const axios = require('axios');
const logger = require('../utils/logger');

// DB 라이브러리 로드
const { query, queryOne } = require('../libs/db');

// 상수 정의
const CONSTANTS = {
  DEFAULT_LEARNING_EXAMPLES_LIMIT: 5,
  MAX_DETAIL_LENGTH_FOR_EXAMPLE: 300,
  MAX_INPUT_TEXT_LENGTH: 200,
  MAX_TEXT_LENGTH_FOR_CLASSIFICATION: 4000,
  MAX_TEXT_LENGTH_FOR_SENTIMENT: 2000,
  API_TIMEOUT_CLASSIFICATION: 15000,
  API_TIMEOUT_SENTIMENT: 10000,
  MAX_TOKENS_CLASSIFICATION: 500,
  MAX_TOKENS_SENTIMENT: 200,
  TEMPERATURE: 0.0,
  VALID_SENTIMENTS: ['pos', 'neg', 'neu'],
  DEFAULT_SENTIMENT: 'neu',
  MIN_SEVERITY: 1,
  MAX_SEVERITY: 3,
  DEFAULT_IMPORTANCE: 'MEDIUM'
};

// 환경 변수는 함수 호출 시마다 읽도록 변경 (dotenv 로드 후 값이 설정될 수 있음)
function getAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  };
}

/**
 * 안전한 JSON 파싱 (에러 시 기본값 반환)
 * @param {string} jsonString - 파싱할 JSON 문자열
 * @param {*} defaultValue - 파싱 실패 시 반환할 기본값
 * @returns {*} 파싱된 객체 또는 기본값
 */
function safeJsonParse(jsonString, defaultValue = null) {
  if (!jsonString || typeof jsonString !== 'string') {
    return defaultValue;
  }
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    logger.warn('[AIClassifier] JSON parse failed', {
      error: error.message,
      jsonPreview: jsonString.substring(0, 100)
    });
    return defaultValue;
  }
}

/**
 * 문자열을 JSON 안전하게 이스케이프
 * @param {string} str - 이스케이프할 문자열
 * @returns {string} 이스케이프된 문자열
 */
function escapeForJson(str) {
  if (typeof str !== 'string') {
    return String(str);
  }
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * 배열인지 확인하고 안전하게 변환
 * @param {*} value - 확인할 값
 * @returns {Array} 배열 또는 빈 배열
 */
function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [];
}

/**
 * sentiment 값 검증 및 정규화
 * @param {*} sentiment - 검증할 sentiment 값
 * @returns {string} 유효한 sentiment 값
 */
function validateSentiment(sentiment) {
  if (!sentiment || typeof sentiment !== 'string') {
    return CONSTANTS.DEFAULT_SENTIMENT;
  }
  const normalized = sentiment.toLowerCase().trim();
  if (CONSTANTS.VALID_SENTIMENTS.includes(normalized)) {
    return normalized;
  }
  logger.warn('[AIClassifier] Invalid sentiment value', { sentiment, normalized });
  return CONSTANTS.DEFAULT_SENTIMENT;
}

/**
 * 카테고리 이름 매칭 (다양한 방식으로 시도)
 * @param {Array} categories - 검색할 카테고리 배열
 * @param {string} targetName - 찾을 카테고리 이름
 * @returns {Object|null} 매칭된 카테고리 또는 null
 */
function findCategoryMatch(categories, targetName) {
  if (!Array.isArray(categories) || categories.length === 0 || !targetName) {
    return null;
  }

  const normalizedTarget = targetName.trim().replace(/\s+/g, '').toLowerCase();

  // 1. 정확한 매칭
  let matched = categories.find(c => c.name === targetName);
  if (matched) return matched;

  // 2. 대소문자 무시 매칭
  matched = categories.find(c => c.name.toLowerCase() === targetName.toLowerCase());
  if (matched) return matched;

  // 3. 공백 무시 매칭
  matched = categories.find(c => {
    const normalizedC = c.name.trim().replace(/\s+/g, '').toLowerCase();
    return normalizedC === normalizedTarget;
  });
  if (matched) return matched;

  // 4. 부분 매칭 (정확한 포함 관계)
  matched = categories.find(c =>
    c.name.includes(targetName) || targetName.includes(c.name)
  );
  if (matched) return matched;

  // 5. 부분 매칭 (정규화된 버전)
  matched = categories.find(c => {
    const normalizedC = c.name.trim().replace(/\s+/g, '').toLowerCase();
    return normalizedC.includes(normalizedTarget) || normalizedTarget.includes(normalizedC);
  });

  return matched || null;
}

/**
 * DB에서 카테고리 택소노미를 로드하고 프롬프트용 설명 텍스트 생성
 * 
 * @param {number} projectId - 프로젝트 ID (선택, 없으면 모든 프로젝트)
 * @returns {Promise<{ groups: any[]; promptSnippet: string }>}
 */
async function loadCategoryTaxonomyForPrompt(projectId = null) {
  try {
    let sql = 'SELECT * FROM CategoryGroup WHERE isActive = ?';
    const params = [1];
    
    if (projectId) {
      sql += ' AND projectId = ?';
      params.push(projectId);
    }
    
    sql += ' ORDER BY name ASC';
    
    const groups = query(sql, params);
    
    // 각 그룹의 카테고리 조회
    const groupIds = groups.map(g => g.id);
    let categories = [];
    if (groupIds.length > 0) {
      const placeholders = groupIds.map(() => '?').join(',');
      categories = query(
        `SELECT * FROM Category WHERE groupId IN (${placeholders}) AND isActive = ? ORDER BY name ASC`,
        [...groupIds, 1]
      );
    }
    
    // 카테고리를 그룹별로 그룹화
    const categoriesByGroup = {};
    categories.forEach(cat => {
      if (!categoriesByGroup[cat.groupId]) {
        categoriesByGroup[cat.groupId] = [];
      }
      categoriesByGroup[cat.groupId].push(cat);
    });
    
    const formattedGroups = groups.map(group => ({
      ...group,
      isActive: Boolean(group.isActive),
      categories: categoriesByGroup[group.id] || []
    }));

    // 한국어 설명 텍스트 생성
    const textLines = [];

    for (const g of formattedGroups) {
      const subNames = g.categories.map((c) => c.name).join(', ');
      textLines.push(`- 대분류 "${g.name}": [${subNames}]`);
    }

    const promptSnippet = textLines.join('\n');

    return { groups: formattedGroups, promptSnippet };
  } catch (error) {
    logger.error('[AIClassifier] Failed to load category taxonomy', { error: error.message });
    throw error;
  }
}

/**
 * AIClassificationLog에서 학습 데이터 조회 (Few-shot learning용)
 * @param {number} projectId - 프로젝트 ID (선택)
 * @param {number} limit - 조회할 최대 개수 (기본값: 5)
 * @returns {Array} 학습 예시 배열
 */
/**
 * AIClassificationLog에서 학습 데이터 조회 (Few-shot learning용)
 * @param {number} projectId - 프로젝트 ID (선택)
 * @param {number} limit - 조회할 최대 개수 (기본값: 5)
 * @returns {Array} 학습 예시 배열
 */
function loadLearningExamples(projectId = null, limit = CONSTANTS.DEFAULT_LEARNING_EXAMPLES_LIMIT) {
  try {
    const contentFields = ['summary', 'detail'];
    let sql = `
      SELECT 
        acl.id,
        acl.issueId,
        acl.originalData,
        acl.aiPrediction,
        acl.userCorrection,
        acl.changedFields,
        i.projectId,
        i.categoryGroupId AS issue_categoryGroupId,
        i.categoryId AS issue_categoryId,
        i.severity AS issue_severity,
        i.importance AS issue_importance,
        i.trend AS issue_trend
      FROM AIClassificationLog acl
      INNER JOIN ReportItemIssue i ON acl.issueId = i.id
      WHERE acl.userCorrection IS NOT NULL 
        AND acl.userCorrection != '{}'
        AND acl.changedFields IS NOT NULL
        AND acl.changedFields != '[]'
    `;
    const params = [];
    
    if (projectId) {
      sql += ' AND i.projectId = ?';
      params.push(projectId);
    }
    
    sql += ' ORDER BY acl.createdAt DESC LIMIT ?';
    params.push(limit);
    
    const logs = query(sql, params);
    
    if (!Array.isArray(logs) || logs.length === 0) {
      return [];
    }
    
    return logs
      .map(log => {
        try {
          // 안전한 JSON 파싱
          const original = safeJsonParse(log.originalData, {});
          const aiPred = safeJsonParse(log.aiPrediction, {});
          const userCorr = safeJsonParse(log.userCorrection, {});
          const changed = ensureArray(safeJsonParse(log.changedFields, []));
          
          // 변경된 필드가 없으면 스킵
          if (changed.length === 0) {
            return null;
          }
          
          // 카테고리 정보 조회 (방어 코드 추가)
          let categoryGroupName = null;
          let categoryName = null;
          
          if (userCorr.categoryGroupId) {
            try {
              const cg = queryOne('SELECT name FROM CategoryGroup WHERE id = ?', [userCorr.categoryGroupId]);
              categoryGroupName = cg?.name || null;
            } catch (error) {
              logger.warn('[AIClassifier] Failed to query category group', {
                categoryGroupId: userCorr.categoryGroupId,
                error: error.message
              });
            }
          }
          
          if (userCorr.categoryId) {
            try {
              const cat = queryOne('SELECT name FROM Category WHERE id = ?', [userCorr.categoryId]);
              categoryName = cat?.name || null;
            } catch (error) {
              logger.warn('[AIClassifier] Failed to query category', {
                categoryId: userCorr.categoryId,
                error: error.message
              });
            }
          }
          
          const hasContentChange = Array.isArray(changed) && changed.some(f => contentFields.includes(f));
          const hasClassificationChange = Array.isArray(changed) && changed.some(f => ['categoryGroupId', 'categoryId', 'severity', 'importance', 'trend'].includes(f));

          // 입력: 요약/본문 수정 건은 에이전트가 수정한 내용을 사용(그 텍스트가 이 분류에 해당한다는 학습)
          const inputSummary = hasContentChange && (userCorr.summary !== undefined && userCorr.summary !== null)
            ? String(userCorr.summary).trim()
            : String(original.summary || '').trim();
          const inputDetail = hasContentChange && (userCorr.detail !== undefined && userCorr.detail !== null)
            ? String(userCorr.detail).substring(0, CONSTANTS.MAX_DETAIL_LENGTH_FOR_EXAMPLE).trim()
            : String(original.detail || '').substring(0, CONSTANTS.MAX_DETAIL_LENGTH_FOR_EXAMPLE).trim();

          const example = {
            input: {
              summary: inputSummary,
              detail: inputDetail
            },
            output: {}
          };

          // 입력이 비어있으면 스킵
          if (!example.input.summary && !example.input.detail) {
            return null;
          }

          // 1) 분류 필드 수정 건: userCorrection 기준으로 output 채움
          if (hasClassificationChange) {
            if (changed.includes('categoryGroupId') && categoryGroupName) {
              example.output.categoryGroup = categoryGroupName;
            }
            if (changed.includes('categoryId') && categoryName) {
              example.output.category = categoryName;
            }
            if (changed.includes('severity') && userCorr.severity !== undefined) {
              example.output.severity = userCorr.severity;
            }
            if (changed.includes('sentiment')) {
              const sentiment = userCorr.sentiment || aiPred.sentiment;
              if (sentiment) {
                example.output.sentiment = validateSentiment(sentiment);
              }
            }
            if (changed.includes('trend') && userCorr.trend) {
              example.output.trend = String(userCorr.trend).trim();
            }
            if (changed.includes('importance') && userCorr.importance) {
              example.output.importance = String(userCorr.importance).trim();
            }
          }

          // 2) 요약/본문만 수정한 건: 해당 이슈의 최종 분류를 output으로 사용 (에이전트가 고친 텍스트 → 이 분류)
          if (Object.keys(example.output).length === 0 && hasContentChange && log.issueId) {
            try {
              const issueCgId = log.issue_categoryGroupId;
              const issueCatId = log.issue_categoryId;
              const issueSev = log.issue_severity;
              const issueImp = log.issue_importance;
              const issueTrend = log.issue_trend;
              if (issueCgId) {
                const cg = queryOne('SELECT name FROM CategoryGroup WHERE id = ?', [issueCgId]);
                if (cg?.name) example.output.categoryGroup = cg.name;
              }
              if (issueCatId) {
                const cat = queryOne('SELECT name FROM Category WHERE id = ?', [issueCatId]);
                if (cat?.name) example.output.category = cat.name;
              }
              if (issueSev !== undefined && issueSev !== null) {
                example.output.severity = issueSev;
              }
              if (issueImp) {
                example.output.importance = String(issueImp).trim();
              }
              if (issueTrend) {
                example.output.trend = String(issueTrend).trim();
              }
            } catch (err) {
              logger.warn('[AIClassifier] Failed to resolve issue classification for content-only example', {
                issueId: log.issueId,
                error: err.message
              });
            }
          }

          // 출력에 필드가 하나라도 있어야 유효한 예시
          if (Object.keys(example.output).length > 0) {
            return example;
          }
          return null;
        } catch (error) {
          logger.warn('[AIClassifier] Failed to parse learning example', {
            logId: log?.id || 'unknown',
            error: error.message
          });
          return null;
        }
      })
      .filter(example => example !== null)
      .slice(0, limit); // 최종적으로 limit 개수만 반환
  } catch (error) {
    logger.error('[AIClassifier] Failed to load learning examples', {
      projectId,
      error: error.message,
      stack: error.stack
    });
    return [];
  }
}

/**
 * 학습 예시를 프롬프트 형식으로 변환
 * @param {Array} examples - 학습 예시 배열
 * @returns {string} 프롬프트 형식의 예시 문자열
 */
function formatLearningExamplesForPrompt(examples) {
  if (!Array.isArray(examples) || examples.length === 0) {
    return '';
  }
  
  const exampleTexts = examples
    .filter(example => example && example.input && example.output) // 방어 코드
    .map((example, index) => {
      try {
        const inputText = `${example.input.summary || ''}\n${example.input.detail || ''}`.trim();
        if (!inputText) {
          return null; // 입력이 비어있으면 스킵
        }
        
        const outputFields = [];
        
        // 안전하게 필드 추가 (이스케이프 처리)
        if (example.output.categoryGroup) {
          outputFields.push(`"categoryGroup": "${escapeForJson(String(example.output.categoryGroup))}"`);
        }
        if (example.output.category) {
          outputFields.push(`"category": "${escapeForJson(String(example.output.category))}"`);
        }
        if (example.output.severity !== undefined && example.output.severity !== null) {
          const severity = Number(example.output.severity);
          if (!isNaN(severity)) {
            outputFields.push(`"severity": ${severity}`);
          }
        }
        if (example.output.sentiment) {
          outputFields.push(`"sentiment": "${escapeForJson(String(example.output.sentiment))}"`);
        }
        if (example.output.trend) {
          outputFields.push(`"trend": "${escapeForJson(String(example.output.trend))}"`);
        }
        if (example.output.importance) {
          outputFields.push(`"importance": "${escapeForJson(String(example.output.importance))}"`);
        }
        
        // 출력 필드가 없으면 스킵
        if (outputFields.length === 0) {
          return null;
        }
        
        const truncatedInput = inputText.substring(0, CONSTANTS.MAX_INPUT_TEXT_LENGTH);
        return `예시 ${index + 1}:
입력: "${escapeForJson(truncatedInput)}"
올바른 출력: { ${outputFields.join(', ')} }`;
      } catch (error) {
        logger.warn('[AIClassifier] Failed to format learning example', {
          index,
          error: error.message
        });
        return null;
      }
    })
    .filter(text => text !== null);
  
  if (exampleTexts.length === 0) {
    return '';
  }
  
  return [
    '',
    '=== 학습 예시 (에이전트가 수정한 실제 사례) ===',
    '아래 예시들을 참고하여 유사한 패턴의 게시글을 올바르게 분류하세요:',
    ...exampleTexts,
    ''
  ].join('\n');
}

/**
 * AI 모델을 호출하여 이슈 텍스트 분류
 * 
 * @param {object} params
 * @param {string} params.text - 제목 + 본문 + (선택) 댓글 스니펫
 * @param {number} params.projectId - 프로젝트 ID (선택)
 * @param {string} params.severityRules - 프로젝트별 중요도 산정 기준 (선택)
 * @param {boolean} params.useLearning - 학습 데이터 사용 여부 (기본값: true)
 * @returns {Promise<{
 *   importance: string;
 *   groupId: number | null;
 *   categoryId: number | null;
 *   severity: number | null;
 *   sentiment: string | null;
 *   trend: string | null;
 *   otherGameTitle: string | null;
 *   reason: string;
 *   raw: any;
 * } | null>}
 */
async function classifyIssueWithAI({ text, projectId = null, severityRules = null, useLearning = true }) {
  const { apiKey: AI_API_KEY, baseUrl: AI_BASE_URL, model: AI_MODEL } = getAIConfig();
  
  // API 키가 없으면 AI 분류 비활성화
  if (!AI_API_KEY) {
    logger.debug('[AIClassifier] AI API key not configured, skipping AI classification');
    return null;
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  try {
    const { groups, promptSnippet } = await loadCategoryTaxonomyForPrompt(projectId);

    // 학습 데이터 로드 (Few-shot learning)
    let learningExamplesText = '';
    if (useLearning) {
      try {
        const learningExamples = loadLearningExamples(projectId, CONSTANTS.DEFAULT_LEARNING_EXAMPLES_LIMIT);
        if (Array.isArray(learningExamples) && learningExamples.length > 0) {
          learningExamplesText = formatLearningExamplesForPrompt(learningExamples);
          logger.debug('[AIClassifier] Loaded learning examples', {
            count: learningExamples.length,
            projectId
          });
        }
      } catch (error) {
        logger.warn('[AIClassifier] Failed to load learning examples, continuing without them', {
          error: error.message,
          stack: error.stack
        });
      }
    }

    // System 프롬프트 - 더 강력한 지시사항
    let system = [
      '당신은 배틀그라운드(PC/모바일) 커뮤니티 이슈를 분류하는 전문가입니다.',
      '아래에 제시된 카테고리 체계(대분류/중분류)를 기준으로 게시글을 분류해야 합니다.',
      '',
      '⚠️ 절대 규칙:',
      '1. categoryGroup(대분류)는 반드시 제공된 목록에서 정확히 하나를 선택해야 합니다. 생략하거나 null로 설정하면 안 됩니다.',
      '2. category(중분류)는 선택한 대분류의 중분류 목록에서 정확히 하나를 선택해야 합니다. 생략하거나 null로 설정하면 안 됩니다.',
      '3. 반드시 JSON 형식으로만 답변하고, 추가 설명 텍스트는 포함하지 마세요.',
      '4. categoryGroup과 category는 제공된 목록의 정확한 이름을 사용해야 합니다.'
    ].join('\n');

    // 프로젝트별 중요도 산정 기준 추가
    if (severityRules) {
      try {
        const rules = typeof severityRules === 'string' ? JSON.parse(severityRules) : severityRules;
        if (rules && typeof rules === 'object') {
          system += '\n\n[중요도 산정 기준]\n';
          if (rules.description) {
            system += rules.description + '\n';
          }
          if (rules.rules && Array.isArray(rules.rules)) {
            rules.rules.forEach((rule, idx) => {
              system += `${idx + 1}. ${rule}\n`;
            });
          }
        }
      } catch (e) {
        logger.warn('[AIClassifier] Failed to parse severityRules', { error: e.message });
      }
    }

    // 카테고리 설명 - 더 명확하고 강력한 지시사항
    const categoriesDescription = [
      '카테고리 체계:',
      promptSnippet,
      learningExamplesText, // 학습 예시 추가
      '⚠️ 필수 출력 형식 (반드시 준수해야 합니다):',
      '{',
      '  "categoryGroup": "대분류이름",  // [필수] 위 목록에서 정확히 하나 선택',
      '  "category": "중분류이름",       // [필수] 선택한 대분류의 중분류 중 하나 선택',
      '  "severity": 1,                  // 1~3 정수 (1=가장 심각, 3=경미)',
      '  "sentiment": "pos",             // [필수] "pos"(긍정), "neg"(부정), "neu"(중립) 중 하나',
      '  "trend": "3단어이내",          // 동향/토픽 요약',
      '  "otherGameTitle": null,        // 타게임 관련 시 게임명, 아니면 null',
      '  "reason": "간단한 설명"         // 한국어 설명',
      '}',
      '',
      '⚠️ sentiment(사용자 성향) 판단 기준 (매우 중요 - 반드시 준수):',
      '- "pos" (긍정): 만족, 감사, 칭찬, 기대감, 즐거움 등의 긍정적 감정 표현',
      '- "neg" (부정): **다음 중 하나라도 해당하면 반드시 부정으로 분류**:',
      '  * 불만, 비판, 문제 제기, 개선 요구, 버그 신고, 실망 표현',
      '  * "~했으면 좋겠다", "~해주세요", "~개선", "~문제", "~버그", "~오류", "~불편", "~안됨" 등의 표현',
      '  * 현재 상태에 대한 불만이나 요구사항 제시',
      '  * **중요: 문제를 지적하거나 불편함을 표현하면 반드시 부정으로 분류. 감정 표현이 약해도 문제 제기면 부정입니다.**',
      '- "neu" (중립): **오직 다음 경우만 중립으로 분류**:',
      '  * 객관적 정보 전달 (예: "업데이트 내역입니다", "이벤트 일정입니다")',
      '  * 단순 질문 (예: "이 기능 어떻게 사용하나요?", "언제 시작하나요?")',
      '  * 감정 표현이 전혀 없는 순수 사실 나열',
      '',
      '**절대 규칙**:',
      '1. 문제 제기, 불만, 개선 요구는 감정 표현이 약해도 반드시 "neg"로 분류',
      '2. "~했으면 좋겠다", "~해주세요" 같은 요구사항은 현재 상태에 대한 불만이므로 "neg"',
      '3. 버그 신고, 오류 제기, 불편함 표현은 모두 "neg"',
      '4. 중립(neu)은 오직 객관적 정보나 단순 질문만 해당',
      '5. 애매한 경우는 부정(neg)으로 분류 (안전한 선택)',
      '',
      '⚠️ 절대 규칙:',
      '1. categoryGroup은 반드시 위에 나열된 대분류 중 하나를 정확히 선택해야 합니다. 생략, null, 빈 문자열은 절대 안 됩니다.',
      '2. category는 선택한 대분류의 중분류 중 하나를 정확히 선택해야 합니다. 생략, null, 빈 문자열은 절대 안 됩니다.',
      '3. categoryGroup과 category는 반드시 위 목록에 있는 정확한 이름을 사용해야 합니다. 유사한 이름이나 다른 표현을 사용하면 안 됩니다.',
      '',
      '사용 가능한 대분류 목록 (반드시 이 중 하나를 선택):',
      groups.map(g => `  - "${g.name}"`).join('\n')
    ].join('\n');

    // User 프롬프트
    const hasComments = text.includes('[유저 댓글]') || text.includes('댓글');
    const userInstructions = [
      categoriesDescription,
      '',
      '분류할 게시글 내용은 다음과 같습니다.',
      '--------------------------------',
      text.slice(0, CONSTANTS.MAX_TEXT_LENGTH_FOR_CLASSIFICATION), // 토큰 절약을 위해 길이 제한
      '--------------------------------',
      ''
    ];
    
    // 댓글이 있는 경우 추가 지시사항
    if (hasComments) {
      userInstructions.push(
        '중요: 본문 내용과 함께 제공된 "유저 댓글"을 분석하여, 유저들의 주요 반응(긍정/부정/구체적 불만)을 파악하세요.',
        '댓글의 여론이 강하게 나타나는 경우, trend 필드에 이를 반영하세요. (예: "서버 렉에 대한 보상 요구 쇄도", "긍정적 반응", "불만 집중")',
        ''
      );
    }
    
    userInstructions.push(
      '',
      '=== 최종 출력 형식 (반드시 이 형식으로만 출력) ===',
      '{',
      '  "categoryGroup": "서버",',
      '  "category": "접속 불가",',
      '  "severity": 1,',
      '  "sentiment": "neg",',
      '  "trend": "부정적",',
      '  "otherGameTitle": null,',
      '  "reason": "서버 접속 불가 문제로 인한 사용자 불만"',
      '}',
      '',
      '⚠️ 최종 확인 사항 (반드시 체크):',
      '1. categoryGroup 필드가 반드시 포함되어 있고, 위 목록의 대분류 중 하나와 정확히 일치하는가?',
      '2. category 필드가 반드시 포함되어 있고, 선택한 대분류의 중분류 중 하나와 정확히 일치하는가?',
      '3. JSON 형식이 올바른가? (추가 텍스트 없이 JSON만 출력)',
      '',
      '⚠️ 절대 하지 말아야 할 것:',
      '- categoryGroup을 생략하거나 null로 설정',
      '- category를 생략하거나 null로 설정',
      '- 위 목록에 없는 이름 사용',
      '- JSON 외의 추가 설명 텍스트 출력',
      '',
      '이제 위 형식에 맞춰 JSON만 출력하세요:'
    );
    
    const user = userInstructions.join('\n');

    // API 호출
    const res = await axios.post(
      `${AI_BASE_URL}/chat/completions`,
      {
        model: AI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: CONSTANTS.TEMPERATURE, // 0으로 설정하여 더 일관된 결과
        response_format: { type: 'json_object' }, // JSON만 반환
        max_tokens: CONSTANTS.MAX_TOKENS_CLASSIFICATION, // 응답 길이 제한
        presence_penalty: 0,
        frequency_penalty: 0
      },
      {
        headers: {
          Authorization: `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: CONSTANTS.API_TIMEOUT_CLASSIFICATION
      }
    );

    const content = res.data.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn('[AIClassifier] Empty response from AI');
      return null;
    }

    // 안전한 JSON 파싱
    const parsed = safeJsonParse(content, null);
    if (!parsed) {
      logger.error('[AIClassifier] Failed to parse JSON response', {
        content: content.substring(0, 200)
      });
      return null;
    }

    // 카테고리 이름을 DB ID로 매핑
    // 새로운 필드명 (categoryGroup, category) 또는 레거시 필드명 (categoryGroupName, categoryName) 지원
    const groupName = String(parsed.categoryGroup || parsed.categoryGroupName || '').trim();
    const categoryName = String(parsed.category || parsed.categoryName || '').trim();

    // categoryGroup이 없는 경우 상세 로깅 및 에러 강화
    if (!groupName) {
      logger.error('[AIClassifier] categoryGroup is missing in AI response - AI가 대분류를 지정하지 않았습니다', {
        parsedKeys: Object.keys(parsed),
        parsedValues: Object.values(parsed).map(v => typeof v === 'string' ? v.substring(0, 50) : v),
        rawResponse: JSON.stringify(parsed).substring(0, 500),
        availableGroups: groups.map(g => g.name),
        textPreview: text.substring(0, 200)
      });
      return null; // categoryGroup이 없으면 즉시 null 반환 (폴백 트리거)
    }

    // 대분류 매칭 (정확 매칭 우선, 부분 매칭 폴백)
    let group = groups.find((g) => g.name === groupName);
    if (!group) {
      group = groups.find((g) => 
        g.name.includes(groupName) || groupName.includes(g.name)
      );
    }
    
    if (!group) {
      logger.error('[AIClassifier] Category group not found', { 
        groupName, 
        available: groups.map(g => g.name),
        rawResponse: JSON.stringify(parsed).substring(0, 500)
      });
      return null; // 대분류를 찾을 수 없으면 null 반환
    }

    // 중분류 매칭 (헬퍼 함수 사용)
    let category = null;
    if (categoryName && Array.isArray(group.categories) && group.categories.length > 0) {
      category = findCategoryMatch(group.categories, categoryName);
      
      if (!category) {
        logger.warn('[AIClassifier] Category not found - AI가 반환한 중분류 이름이 해당 대분류에 없습니다', { 
          aiReturnedCategoryName: categoryName,
          groupName: group.name,
          availableCategories: group.categories.map(c => c.name),
          suggestion: `AI가 반환한 "${categoryName}"는 "${group.name}" 대분류의 중분류 목록에 없습니다. 사용 가능한 중분류: ${group.categories.map(c => c.name).join(', ')}`
        });
        // 중분류가 없어도 대분류는 있으므로 계속 진행 (대분류만 선택된 경우)
      } else {
        logger.debug('[AIClassifier] Category matched successfully', {
          aiReturnedCategoryName: categoryName,
          matchedCategoryName: category.name,
          matchedCategoryId: category.id,
          groupName: group.name
        });
      }
    } else if (group && !categoryName) {
      // AI가 중분류를 반환하지 않은 경우
      logger.info('[AIClassifier] AI did not return category name - 대분류만 지정됨', {
        groupName: group.name,
        groupId: group.id,
        availableCategories: group.categories?.map(c => c.name) || [],
        parsedKeys: Object.keys(parsed),
        hasCategory: !!(parsed.category || parsed.categoryName)
      });
    }

    // importance 검증
    const importance =
      parsed.importance === 'HIGH' || parsed.importance === 'LOW'
        ? parsed.importance
        : CONSTANTS.DEFAULT_IMPORTANCE;

    // severity 검증 (1~3 범위)
    let severity = parsed.severity;
    if (typeof severity === 'number') {
      severity = Math.max(CONSTANTS.MIN_SEVERITY, Math.min(CONSTANTS.MAX_SEVERITY, Math.round(severity)));
    } else if (typeof severity === 'string') {
      const parsedSeverity = parseInt(severity, 10);
      severity = isNaN(parsedSeverity) ? null : Math.max(CONSTANTS.MIN_SEVERITY, Math.min(CONSTANTS.MAX_SEVERITY, parsedSeverity));
    } else {
      severity = null;
    }

    // sentiment 검증 (헬퍼 함수 사용)
    // 주의: classifyIssueWithAI의 sentiment는 참고용이며, 
    // 실제로는 issueClassifier.js에서 analyzeSentimentWithAI를 별도로 호출하여 DB 프롬프트를 사용합니다.
    const sentiment = validateSentiment(parsed.sentiment);

    // trend 검증 (3단어 이내, 문자열)
    let trend = null;
    if (parsed.trend && typeof parsed.trend === 'string') {
      const words = parsed.trend.trim().split(/\s+/);
      if (words.length > 3) {
        trend = words.slice(0, 3).join(' ');
      } else {
        trend = parsed.trend.trim();
      }
      trend = trend || null;
    }

    // 유효한 결과인지 확인 (최소한 groupId는 있어야 함 - 대분류는 필수)
    if (!group) {
      logger.error('[AIClassifier] Invalid classification result - AI가 반환한 대분류 이름이 DB에 없습니다', {
        aiReturnedGroupName: groupName || '(empty)',
        aiReturnedCategoryName: categoryName || '(empty)',
        availableGroups: groups.map(g => g.name),
        rawResponse: JSON.stringify(parsed).substring(0, 500),
        textPreview: text.substring(0, 200),
        suggestion: `AI가 반환한 "${groupName}"는 사용 가능한 대분류 목록에 없습니다. 정확한 이름을 사용해야 합니다.`
      });
      return null;
    }
    
    // category가 없어도 group이 있으면 계속 진행 (대분류만 선택된 경우)

    logger.info('[AIClassifier] Classification successful', {
      importance,
      groupName: group?.name,
      categoryName: category?.name,
      severity,
      sentiment,
      trend,
      reason: parsed.reason?.substring(0, 50)
    });

    return {
      importance,
      groupId: group?.id || null,
      categoryId: category?.id || null,
      severity: severity || null,
      sentiment: sentiment || CONSTANTS.DEFAULT_SENTIMENT,
      trend: trend || null,
      otherGameTitle: String(parsed.otherGameTitle || '').trim() || null,
      reason: String(parsed.reason || '').trim(),
      raw: parsed
    };
  } catch (error) {
    // 에러 로깅하지만 예외는 전파하지 않음 (폴백을 위해)
    if (error.response) {
      logger.error('[AIClassifier] API error', {
        status: error.response.status,
        statusText: error.response.statusText,
        message: error.message
      });
    } else if (error.request) {
      logger.error('[AIClassifier] Request failed (no response)', {
        message: error.message
      });
    } else {
      logger.error('[AIClassifier] Error', {
        message: error.message,
        stack: error.stack
      });
    }
    return null; // 실패 시 null 반환 (폴백 트리거)
  }
}

/**
 * AI로 sentiment(사용자 성향) 분석
 * 
 * @param {object} params
 * @param {string} params.text - 분석할 텍스트
 * @returns {Promise<{ sentiment: string; reason: string } | null>}
 */
async function analyzeSentimentWithAI({ text }) {
  const { apiKey: AI_API_KEY, baseUrl: AI_BASE_URL, model: AI_MODEL } = getAIConfig();
  
  if (!AI_API_KEY) {
    logger.debug('[AIClassifier] AI API key not configured, skipping sentiment analysis');
    return null;
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  try {
    // DB에서 sentiment 프롬프트 로드
    const promptConfig = query(
      'SELECT * FROM AIPromptConfig WHERE name = ? AND isActive = ?',
      ['sentiment_analysis', 1]
    );

    let systemPrompt = '';
    let userPromptTemplate = '';

    if (promptConfig && promptConfig.length > 0) {
      systemPrompt = promptConfig[0].systemPrompt;
      userPromptTemplate = promptConfig[0].userPromptTemplate || '게시글 내용:\n{{content}}\n\n위 게시글의 사용자 성향을 분석하여 JSON 형식으로 답변하세요.';
      logger.debug('[AIClassifier] Using sentiment prompt from DB', { 
        version: promptConfig[0].version,
        promptName: promptConfig[0].displayName
      });
    } else {
      // 폴백: 기본 프롬프트 사용
      logger.warn('[AIClassifier] Sentiment prompt not found in DB, using default');
      systemPrompt = `당신은 게임 커뮤니티 게시글의 사용자 성향을 분석하는 전문가입니다.

게시글을 읽고 작성자의 감정과 태도를 분석하여 다음 중 하나로 분류하세요:

1. **긍정 (pos)**: 만족, 감사, 칭찬, 기대감, 즐거움 등의 긍정적 감정 표현

2. **부정 (neg)** - 다음 중 하나라도 해당하면 반드시 부정:
   - 불만, 비판, 분노, 실망, 좌절 등의 부정적 감정 표현
   - 문제 제기, 개선 요구, 항의, 불평
   - 버그/오류 신고
   - "~했으면 좋겠다", "~해주세요", "~개선", "~문제", "~버그", "~오류", "~불편", "~안됨" 등의 표현
   - 현재 상태에 대한 불만이나 요구사항 제시

3. **중립 (neu)** - 오직 다음 경우만 중립:
   - 객관적 정보 전달 (예: "업데이트 내역입니다", "이벤트 일정입니다")
   - 단순 질문 (예: "이벤트 언제 시작하나요?", "이 기능 어떻게 사용하나요?")
   - 감정 표현이 전혀 없는 순수 사실 나열
   - **주의: 질문이라도 불만이나 문제 제기가 포함되면 부정입니다**

**절대 규칙 (매우 중요):**
- 문제 제기, 불만, 개선 요구는 감정 표현이 약해도 반드시 부정(neg)으로 분류
- "~했으면 좋겠다", "~해주세요" 같은 요구사항은 현재 상태에 대한 불만이므로 부정
- 버그 신고, 오류 제기, 불편함 표현은 모두 부정
- 중립(neu)은 오직 객관적 정보나 단순 질문만 해당
- 애매한 경우는 부정(neg)으로 분류 (안전한 선택)

응답 형식:
{
  "sentiment": "pos" | "neg" | "neu",
  "reason": "판단 근거"
}`;
      userPromptTemplate = '게시글 내용:\n{{content}}\n\n위 게시글의 사용자 성향을 분석하여 JSON 형식으로 답변하세요.';
    }

    // 템플릿에 실제 텍스트 적용
    const userPrompt = userPromptTemplate.replace('{{content}}', text.slice(0, CONSTANTS.MAX_TEXT_LENGTH_FOR_SENTIMENT));

    // API 호출
    const res = await axios.post(
      `${AI_BASE_URL}/chat/completions`,
      {
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: CONSTANTS.TEMPERATURE,
        response_format: { type: 'json_object' },
        max_tokens: CONSTANTS.MAX_TOKENS_SENTIMENT
      },
      {
        headers: {
          Authorization: `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: CONSTANTS.API_TIMEOUT_SENTIMENT
      }
    );

    const content = res.data.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn('[AIClassifier] Empty response from AI for sentiment analysis');
      return null;
    }

    // 안전한 JSON 파싱
    const parsed = safeJsonParse(content, null);
    if (!parsed) {
      logger.error('[AIClassifier] Failed to parse sentiment analysis response', {
        content: content.substring(0, 200)
      });
      return null;
    }

    const sentiment = validateSentiment(parsed.sentiment);

    return {
      sentiment,
      reason: String(parsed.reason || '').trim()
    };
  } catch (error) {
    logger.error('[AIClassifier] Sentiment analysis failed', {
      error: error.message
    });
    return null;
  }
}

module.exports = {
  classifyIssueWithAI,
  loadCategoryTaxonomyForPrompt,
  analyzeSentimentWithAI
};

