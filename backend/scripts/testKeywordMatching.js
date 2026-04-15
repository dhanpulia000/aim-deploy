// '태이고' 키워드 매칭 테스트
const keyword = '태이고';
const testCases = [
  '태이고에서 발견된 수상한 차량',
  '태이고 맵',
  '태이고에서',
  '태이고를',
  '태이고의',
  '태이고',
  '타이고',
  'taego'
];

const checkKeyword = (keyword, text) => {
  if (/^[a-z0-9\s:]+$/i.test(keyword)) {
    if (keyword.includes(' ')) {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedKeyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      return regex.test(text);
    } else {
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(text);
    }
  } else {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 현재 정규식
    const regex1 = new RegExp(`(^|[^\\w가-힣])${escapedKeyword}([^\\w가-힣]|$)|^${escapedKeyword}`, 'i');
    // 개선된 정규식 (lookahead 사용)
    const regex2 = new RegExp(`(^|[^\\w가-힣])${escapedKeyword}(?=[^\\w가-힣]|$)|^${escapedKeyword}`, 'i');
    
    return {
      current: regex1.test(text),
      improved: regex2.test(text)
    };
  }
};

console.log('키워드 매칭 테스트: "태이고"');
console.log('='.repeat(60));
testCases.forEach(test => {
  const result = checkKeyword(keyword, test);
  if (typeof result === 'object') {
    console.log(`'${test}': 현재=${result.current}, 개선=${result.improved}`);
  } else {
    console.log(`'${test}': ${result}`);
  }
});


