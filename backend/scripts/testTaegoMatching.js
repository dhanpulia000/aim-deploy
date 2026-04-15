// '태이고' 키워드 매칭 테스트
const keyword = '태이고';
const title = '태이고에서 발견된 수상한 차량';
const titleLower = title.toLowerCase();
const description = '';
const titleAndDescription = `${titleLower} ${description}`;

const checkKeyword = (keyword, text) => {
  if (/^[a-z0-9\s:]+$/i.test(keyword)) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(text);
  } else {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^\\w가-힣])${escapedKeyword}(?=[^\\w가-힣]|$)|^${escapedKeyword}`, 'i');
    return regex.test(text);
  }
};

console.log('제목:', title);
console.log('titleLower:', titleLower);
console.log('titleAndDescription:', titleAndDescription);
console.log('매칭 결과:', checkKeyword(keyword, titleAndDescription));
console.log('');

// 디버깅
const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regex = new RegExp(`(^|[^\\w가-힣])${escapedKeyword}(?=[^\\w가-힣]|$)|^${escapedKeyword}`, 'i');
console.log('정규식:', regex);
console.log('정규식 패턴:', regex.source);
console.log('테스트:', regex.test(titleAndDescription));
console.log('매치 결과:', titleAndDescription.match(regex));


