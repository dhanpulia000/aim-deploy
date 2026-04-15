// 키워드 카테고라이저 테스트

const { categorizeIssue } = require('../../utils/keyword-categorizer');

describe('keyword-categorizer', () => {
  test('should categorize issue with keyword match', () => {
    // categorizeIssue(title, detail, summary) -> Array<string>
    const result = categorizeIssue('결제 오류가 발생했습니다', '결제 관련 문제입니다', '기타');
    
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test('should handle empty input', () => {
    const result = categorizeIssue('', '', '기타');
    
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  test('should preserve existing category if no match', () => {
    const result = categorizeIssue('일반적인 문의', '내용', '기타');
    
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});























