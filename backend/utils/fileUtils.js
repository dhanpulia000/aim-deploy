/**
 * 파일 경로 유틸리티 함수
 * 스크린샷 경로 생성 및 관리를 위한 공통 함수
 */

const path = require('path');
const fs = require('fs').promises;

/**
 * 스크린샷 파일 경로 생성
 * @param {string} articleId - 게시글 ID (externalPostId 또는 issueId)
 * @returns {Object} { fullPath, relativePath, fileName, dateFolder, uploadsDir }
 */
function generateScreenshotPath(articleId) {
  // 날짜별 폴더 생성
  const today = new Date();
  const dateFolder = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  // 파일명: issue_{articleId}.png
  const fileName = `issue_${articleId}.png`;
  
  // 상대 경로 (DB 저장용)
  const relativePath = `screenshots/${dateFolder}/${fileName}`;
  
  // 절대 경로 (파일 저장용)
  // __dirname은 backend/utils이므로, 상위 디렉토리(backend)로 이동 후 uploads 폴더 접근
  const backendDir = path.resolve(__dirname, '..');
  const uploadsDir = path.join(backendDir, 'uploads', 'screenshots', dateFolder);
  const fullPath = path.join(uploadsDir, fileName);
  
  return {
    fullPath,
    relativePath,
    fileName,
    dateFolder,
    uploadsDir
  };
}

/**
 * 스크린샷 디렉토리 생성 (재귀적)
 * @param {string} uploadsDir - 업로드 디렉토리 경로
 * @returns {Promise<void>}
 */
async function ensureScreenshotDirectory(uploadsDir) {
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create screenshot directory: ${error.message}`);
  }
}

/**
 * 스크린샷 파일 존재 여부 확인
 * @param {string} fullPath - 파일 전체 경로
 * @returns {Promise<boolean>}
 */
async function screenshotExists(fullPath) {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  generateScreenshotPath,
  ensureScreenshotDirectory,
  screenshotExists
};

