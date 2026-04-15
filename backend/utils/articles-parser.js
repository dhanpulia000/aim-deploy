// 커뮤니티 스크래핑 데이터 파서

const XLSX = require('xlsx');
const { excelDateToISOString } = require('./excel.util');
const { categorizeIssue } = require('./keyword-categorizer');

/**
 * 날짜 문자열을 ISO 형식으로 변환
 * @param {string} dateStr - 날짜 문자열 (예: "2025.10.13. 17:38")
 * @returns {string} ISO 날짜 문자열 (YYYY-MM-DD)
 */
function parseDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  
  // "2025.10.13. 17:38" 형식
  const match = dateStr.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  
  return '';
}

/**
 * 감성 문자열을 표준 형식으로 변환
 * @param {string} sentiment - 감성 문자열 (긍정, 중립, 부정)
 * @returns {string} 표준 감성 형식 (pos, neu, neg)
 */
function normalizeSentiment(sentiment) {
  if (!sentiment) return 'neu';
  
  const s = String(sentiment).toLowerCase();
  if (s.includes('긍정') || s === 'pos' || s === 'positive') return 'pos';
  if (s.includes('부정') || s === 'neg' || s === 'negative') return 'neg';
  return 'neu';
}

/**
 * 중요도 문자열을 심각도 숫자로 변환
 * @param {string} importance - 중요도 문자열 (상, 중, 하)
 * @returns {number} 심각도 (1, 2, 3)
 */
function importanceToSeverity(importance) {
  if (!importance) return 3;
  
  const imp = String(importance).toLowerCase();
  if (imp.includes('상') || imp === 'high' || imp === '1') return 1;
  if (imp.includes('중') || imp === 'medium' || imp === '2') return 2;
  return 3;
}

/**
 * 커뮤니티 스크래핑 데이터를 이슈 형식으로 변환
 * @param {Object} article - 스크래핑된 게시글 데이터
 * @returns {Object} 이슈 객체
 */
function convertArticleToIssue(article) {
  const title = article.title || '';
  const content = article.content || '';
  const summary = article.summary || '';
  const combinedText = `${title} ${content} ${summary}`;
  
  // 카테고리 자동 분류
  const categories = categorizeIssue(title, content, summary);
  
  // 날짜 파싱
  const dateStr = parseDateString(article.date);
  
  // 이슈 객체 생성
  const issue = {
    id: `article_${article.id}`,
    date: dateStr || new Date().toISOString().split('T')[0],
    category: article.subCategory || article.mainCategory || '기타',
    detail: content || summary,
    summary: title,
    link: article.href || '',
    time: article.date || '',
    severity: importanceToSeverity(article.postImportance),
    source: article.channel && article.channel.includes('네이버') ? 'naver' : 'system',
    status: 'new',
    sentiment: normalizeSentiment(article.postSentiment),
    categories: categories.length > 0 ? categories : ['기타'],
    primaryCategory: categories.length > 0 ? categories[0] : '기타',
    // 원본 데이터 저장
    originalData: {
      articleId: article.id,
      channel: article.channel,
      author: article.author,
      postType: article.postType,
      commentsCount: article.commentsCount,
      scrapSuccess: article.ScrapSuccess
    }
  };
  
  return issue;
}

/**
 * Excel 파일에서 커뮤니티 스크래핑 데이터 파싱
 * @param {string} filePath - Excel 파일 경로
 * @returns {Array<Object>} 이슈 배열
 */
function parseArticlesFile(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0] || 'Articles';
    const worksheet = workbook.Sheets[sheetName];
    
    // JSON 형식으로 읽기
    const articles = XLSX.utils.sheet_to_json(worksheet);
    
    // 이슈로 변환
    const issues = articles
      .filter(article => article.ScrapSuccess === 'TRUE' || article.ScrapSuccess === true) // 성공적으로 스크래핑된 것만
      .map(article => convertArticleToIssue(article));
    
    return issues;
  } catch (error) {
    console.error('Failed to parse articles file:', error);
    throw error;
  }
}

module.exports = {
  parseDateString,
  normalizeSentiment,
  importanceToSeverity,
  convertArticleToIssue,
  parseArticlesFile
};







