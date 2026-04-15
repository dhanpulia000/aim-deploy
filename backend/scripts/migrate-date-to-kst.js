/**
 * 기존 이슈의 date 필드를 UTC 기준에서 한국 시간(KST) 기준으로 마이그레이션
 * 
 * 실행 방법:
 * cd /home/young-dev/AIM/backend
 * node scripts/migrate-date-to-kst.js
 */

const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

async function migrateDateToKST() {
  try {
    logger.info('날짜 마이그레이션 시작: UTC → KST');
    
    // 모든 이슈 조회
    const issues = query('SELECT id, date, sourceCreatedAt, createdAt FROM ReportItemIssue ORDER BY createdAt DESC');
    
    logger.info(`총 ${issues.length}개의 이슈를 마이그레이션합니다.`);
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const issue of issues) {
      try {
        let newDate = null;
        
        // sourceCreatedAt이 있으면 그것을 사용 (더 정확함)
        if (issue.sourceCreatedAt) {
          const sourceDate = new Date(issue.sourceCreatedAt);
          // 한국 시간(UTC+9)으로 변환하여 날짜 추출
          const kstOffset = 9 * 60 * 60 * 1000; // 9시간을 밀리초로
          const kstTime = new Date(sourceDate.getTime() + kstOffset);
          const year = kstTime.getUTCFullYear();
          const month = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
          const day = String(kstTime.getUTCDate()).padStart(2, '0');
          newDate = `${year}-${month}-${day}`;
        } else if (issue.date) {
          // sourceCreatedAt이 없으면 기존 date 필드를 사용
          // 기존 date가 UTC 기준이므로, 한국 시간으로 변환
          // date 필드가 YYYY-MM-DD 형식이므로, UTC 00:00:00으로 가정
          const utcDate = new Date(issue.date + 'T00:00:00Z');
          // 한국 시간(UTC+9)으로 변환하여 날짜 추출
          const kstOffset = 9 * 60 * 60 * 1000;
          const kstTime = new Date(utcDate.getTime() + kstOffset);
          const year = kstTime.getUTCFullYear();
          const month = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
          const day = String(kstTime.getUTCDate()).padStart(2, '0');
          newDate = `${year}-${month}-${day}`;
        } else {
          // date도 없으면 createdAt 사용
          const createdDate = new Date(issue.createdAt);
          const kstOffset = 9 * 60 * 60 * 1000;
          const kstTime = new Date(createdDate.getTime() + kstOffset);
          const year = kstTime.getUTCFullYear();
          const month = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
          const day = String(kstTime.getUTCDate()).padStart(2, '0');
          newDate = `${year}-${month}-${day}`;
        }
        
        // 날짜가 변경되지 않았으면 스킵
        if (newDate === issue.date) {
          skipped++;
          continue;
        }
        
        // 날짜 업데이트
        execute(
          'UPDATE ReportItemIssue SET date = ?, updatedAt = ? WHERE id = ?',
          [newDate, new Date().toISOString(), issue.id]
        );
        
        updated++;
        
        if (updated % 100 === 0) {
          logger.info(`진행 중: ${updated}개 업데이트 완료`);
        }
      } catch (error) {
        errors++;
        logger.error(`이슈 ${issue.id} 마이그레이션 실패`, { 
          error: error.message,
          issueId: issue.id 
        });
      }
    }
    
    logger.info('날짜 마이그레이션 완료', {
      total: issues.length,
      updated,
      skipped,
      errors
    });
    
    console.log('\n=== 마이그레이션 결과 ===');
    console.log(`총 이슈 수: ${issues.length}`);
    console.log(`업데이트된 이슈: ${updated}`);
    console.log(`변경 없음 (스킵): ${skipped}`);
    console.log(`오류: ${errors}`);
    console.log('========================\n');
    
  } catch (error) {
    logger.error('날짜 마이그레이션 실패', { error: error.message, stack: error.stack });
    console.error('마이그레이션 실패:', error);
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  migrateDateToKST()
    .then(() => {
      console.log('마이그레이션이 완료되었습니다.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('마이그레이션 중 오류 발생:', error);
      process.exit(1);
    });
}

module.exports = { migrateDateToKST };




