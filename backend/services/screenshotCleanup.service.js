/**
 * 스크린샷 파일 정리 서비스
 * 10일이 지난 스크린샷 파일을 삭제합니다.
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const SCREENSHOTS_DIR = path.join(__dirname, '../uploads/screenshots');
const RETENTION_DAYS = 10; // 10일 보관

/**
 * 10일이 지난 스크린샷 파일 삭제
 */
async function cleanupOldScreenshots() {
  try {
    logger.info('[ScreenshotCleanup] Starting cleanup...');
    
    // screenshots 디렉토리가 없으면 생성
    try {
      await fs.access(SCREENSHOTS_DIR);
    } catch {
      logger.info('[ScreenshotCleanup] Screenshots directory does not exist, skipping cleanup');
      return { deleted: 0, errors: 0 };
    }

    const now = Date.now();
    const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000; // 10일을 밀리초로 변환
    let deletedCount = 0;
    let errorCount = 0;

    // 날짜별 폴더 순회
    const dateFolders = await fs.readdir(SCREENSHOTS_DIR);
    
    for (const dateFolder of dateFolders) {
      const dateFolderPath = path.join(SCREENSHOTS_DIR, dateFolder);
      
      try {
        const stat = await fs.stat(dateFolderPath);
        
        // 폴더가 아니면 건너뛰기
        if (!stat.isDirectory()) {
          continue;
        }

        // 폴더 이름에서 날짜 파싱 (YYYY-MM-DD 형식)
        const dateMatch = dateFolder.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateMatch) {
          logger.warn('[ScreenshotCleanup] Invalid date folder name', { dateFolder });
          continue;
        }

        const [, year, month, day] = dateMatch;
        const folderDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        const folderAge = now - folderDate.getTime();

        // 10일이 지난 폴더는 삭제
        if (folderAge > retentionMs) {
          logger.info('[ScreenshotCleanup] Deleting old folder', { 
            dateFolder, 
            ageDays: Math.floor(folderAge / (24 * 60 * 60 * 1000))
          });

          // 폴더 내 파일 삭제
          const files = await fs.readdir(dateFolderPath);
          for (const file of files) {
            try {
              const filePath = path.join(dateFolderPath, file);
              await fs.unlink(filePath);
              deletedCount++;
            } catch (fileError) {
              logger.warn('[ScreenshotCleanup] Failed to delete file', {
                file,
                error: fileError.message
              });
              errorCount++;
            }
          }

          // 빈 폴더 삭제
          try {
            await fs.rmdir(dateFolderPath);
            logger.info('[ScreenshotCleanup] Deleted folder', { dateFolder });
          } catch (rmdirError) {
            logger.warn('[ScreenshotCleanup] Failed to delete folder', {
              dateFolder,
              error: rmdirError.message
            });
          }
        }
      } catch (folderError) {
        logger.warn('[ScreenshotCleanup] Error processing folder', {
          dateFolder,
          error: folderError.message
        });
        errorCount++;
      }
    }

    logger.info('[ScreenshotCleanup] Cleanup completed', {
      deleted: deletedCount,
      errors: errorCount
    });

    return {
      deleted: deletedCount,
      errors: errorCount
    };
  } catch (error) {
    logger.error('[ScreenshotCleanup] Cleanup failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

module.exports = {
  cleanupOldScreenshots
};














