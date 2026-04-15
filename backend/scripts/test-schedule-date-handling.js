// 스케줄 캘린더 날짜 처리 테스트

console.log('스케줄 캘린더 날짜 처리 테스트\n');
console.log('='.repeat(80));

// formatDateToLocalString 함수 시뮬레이션
function formatDateToLocalString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 테스트 케이스
const testCases = [
  { name: '오늘', date: new Date() },
  { name: '2025년 12월 8일', date: new Date(2025, 11, 8) }, // 월은 0부터 시작
  { name: '2025년 1월 1일', date: new Date(2025, 0, 1) },
  { name: '2025년 12월 31일', date: new Date(2025, 11, 31) },
];

console.log('1. formatDateToLocalString 결과:');
console.log('-'.repeat(80));
testCases.forEach((test, idx) => {
  const localStr = formatDateToLocalString(test.date);
  const isoStr = test.date.toISOString().split('T')[0];
  const match = localStr === isoStr;
  
  console.log(`\n${idx + 1}. ${test.name}`);
  console.log(`   로컬 시간 문자열: ${localStr}`);
  console.log(`   ISO 문자열:       ${isoStr}`);
  console.log(`   일치 여부: ${match ? '✅' : '❌'}`);
  
  if (!match) {
    console.log(`   ⚠️  날짜 불일치!`);
  }
});

console.log('\n' + '='.repeat(80));
console.log('2. 한국 시간대에서의 날짜 변환:');
console.log('-'.repeat(80));

// 한국 시간대에서 자정에 생성된 날짜
const koreaMidnight = new Date(2025, 11, 8, 0, 0, 0); // 2025-12-08 00:00:00 (로컬)
console.log(`\n로컬 날짜 생성: ${koreaMidnight.toString()}`);
console.log(`formatDateToLocalString: ${formatDateToLocalString(koreaMidnight)}`);
console.log(`toISOString: ${koreaMidnight.toISOString()}`);
console.log(`toISOString 날짜 부분: ${koreaMidnight.toISOString().split('T')[0]}`);

// UTC 자정으로 변환되면?
const utcDate = new Date('2025-12-08T00:00:00.000Z');
console.log(`\nUTC 날짜 생성: ${utcDate.toString()}`);
console.log(`formatDateToLocalString: ${formatDateToLocalString(utcDate)}`);
console.log(`toISOString: ${utcDate.toISOString()}`);

console.log('\n' + '='.repeat(80));
console.log('테스트 완료!');
console.log('='.repeat(80));
console.log('\n결론:');
console.log('- formatDateToLocalString은 로컬 시간 기준으로 날짜를 변환 (안전)');
console.log('- toISOString은 UTC 기준으로 변환되어 시간대에 따라 하루 차이 발생 가능');
console.log('- 스케줄 캘린더에서는 formatDateToLocalString 사용이 올바름');







