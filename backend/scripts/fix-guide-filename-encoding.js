/**
 * 이미 저장된 가이드의 깨진 파일명 복구 스크립트
 * 
 * 주의: 이 스크립트는 깨진 파일명을 복구하려고 시도하지만,
 * 완전한 복구가 불가능한 경우가 많습니다 (원본 정보 손실).
 * 
 * 사용법: node scripts/fix-guide-filename-encoding.js
 */

require('dotenv').config();
const { query, execute, executeTransaction } = require('../libs/db');
const logger = require('../utils/logger');

function decodeFilename(filename) {
  if (!filename) return filename;
  
  // URL 디코딩 시도
  try {
    if (filename.includes('%')) {
      return decodeURIComponent(filename);
    }
    // latin1 -> utf8 변환 시도
    const decoded = Buffer.from(filename, 'latin1').toString('utf8');
    // 한글이 포함되어 있고 제대로 디코딩된 경우 사용
    if (/[가-힣]/.test(decoded) || (decoded !== filename && decoded.length > 0)) {
      return decoded;
    }
  } catch (e) {
    // 디코딩 실패
  }
  return filename;
}

function fixGuideFilenameEncoding() {
  console.log('🔍 깨진 파일명을 가진 가이드 검색 중...\n');
  
  // 깨진 문자 패턴 찾기 (latin1 인코딩으로 깨진 한글)
  const corruptedGuides = query(`
    SELECT id, title, tags, metadata 
    FROM WorkGuide 
    WHERE tags LIKE '%ê%' 
       OR tags LIKE '%ë%' 
       OR tags LIKE '%ì%'
       OR tags LIKE '%î%'
       OR metadata LIKE '%ê%'
       OR metadata LIKE '%ë%'
       OR metadata LIKE '%ì%'
       OR metadata LIKE '%î%'
    ORDER BY createdAt DESC
  `);
  
  console.log(`📊 발견된 깨진 파일명 가이드: ${corruptedGuides.length}개\n`);
  
  if (corruptedGuides.length === 0) {
    console.log('✅ 깨진 파일명이 없습니다.');
    return;
  }
  
  let fixed = 0;
  let failed = 0;
  
  for (const guide of corruptedGuides) {
    try {
      let updated = false;
      let newTags = guide.tags ? JSON.parse(guide.tags) : [];
      let newMetadata = guide.metadata ? JSON.parse(guide.metadata) : {};
      
      // 태그 복구
      if (Array.isArray(newTags) && newTags.length > 0) {
        const fixedTags = newTags.map(tag => {
          const decoded = decodeFilename(tag);
          if (decoded !== tag) {
            updated = true;
            return decoded;
          }
          return tag;
        });
        
        if (updated) {
          newTags = fixedTags;
        }
      }
      
      // 메타데이터의 fileName 복구
      if (newMetadata.fileName) {
        const decoded = decodeFilename(newMetadata.fileName);
        if (decoded !== newMetadata.fileName) {
          newMetadata.fileName = decoded;
          updated = true;
        }
      }
      
      // 업데이트 필요 시 DB 업데이트
      if (updated) {
        executeTransaction(() => {
          execute(
            'UPDATE WorkGuide SET tags = ?, metadata = ?, updatedAt = ? WHERE id = ?',
            [
              JSON.stringify(newTags),
              JSON.stringify(newMetadata),
              new Date().toISOString(),
              guide.id
            ]
          );
        });
        
        fixed++;
        console.log(`✅ 수정됨: ${guide.id}`);
        console.log(`   제목: ${guide.title}`);
        console.log(`   태그: ${JSON.stringify(newTags)}`);
        if (newMetadata.fileName) {
          console.log(`   파일명: ${newMetadata.fileName}`);
        }
        console.log('');
      } else {
        console.log(`⚠️  복구 불가: ${guide.id} - ${guide.title}`);
        console.log(`   태그: ${JSON.stringify(newTags)}`);
        console.log('');
        failed++;
      }
    } catch (error) {
      console.error(`❌ 오류 발생: ${guide.id} - ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n📊 복구 결과:');
  console.log(`   ✅ 성공: ${fixed}개`);
  console.log(`   ❌ 실패/복구불가: ${failed}개`);
  console.log(`\n💡 참고: 일부 파일명은 완전한 복구가 불가능할 수 있습니다.`);
  console.log(`   완전한 복구를 위해서는 원본 파일을 다시 업로드하는 것을 권장합니다.`);
}

// 실행
try {
  fixGuideFilenameEncoding();
} catch (error) {
  console.error('스크립트 실행 오류:', error);
  process.exit(1);
}
