/**
 * 파트너 영상 아카이빙 서비스 테스트 (인증 없이 서비스 직접 호출)
 * 사용: node scripts/test-partner-archiving.js [엑셀경로]
 * 기본 엑셀: ../public/partner_channel_list_template.xlsx
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const path = require('path');
const partnerArchivingService = require('../services/partnerArchiving.service');

const excelPath = process.argv[2] || path.join(__dirname, '../../public/partner_channel_list_template.xlsx');

async function main() {
  console.log('엑셀 경로:', excelPath);
  const date = new Date();
  console.log('기준 날짜:', date.toISOString().split('T')[0]);
  console.log('---');

  try {
    const partners = await partnerArchivingService.readPartnerListFromExcel(excelPath);
    console.log('파싱된 파트너 수:', partners.length);
    partners.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.channelName} (${p.platform})`);
    });
    console.log('---');

    const result = await partnerArchivingService.collectMultiPlatformWeeklyMetadata(excelPath, date);

    console.log('결과:');
    console.log('  성공 채널 수:', result.channelCount);
    console.log('  오류 채널 수:', result.errorCount);
    console.log('  총 영상 수:', result.totalVideoCount);
    if (result.period) {
      console.log(
        '  주차:',
        result.period.yearMonthWeekLabel ||
          result.period.year + '년 ' + result.period.weekNumber + '주차'
      );
    }
    if (result.errorCount > 0 && result.errorDetails && result.errorDetails.length > 0) {
      console.log('  오류 상세:');
      result.errorDetails.forEach((e, i) => {
        console.log(`    [${i + 1}] ${e.channelName}: ${e.error}`);
      });
    }
    if (result.message) console.log('  메시지:', result.message);
    if (result.xlsxPath) console.log('  생성 파일:', result.xlsxPath);
  } catch (err) {
    console.error('테스트 실패:', err.message);
    process.exit(1);
  }
}

main();
