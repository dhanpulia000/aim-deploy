// 파일 저장 및 다운로드 관련 라이브러리

const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const logger = require('../utils/logger');

/**
 * 업로드 디렉토리 설정
 * @param {string} uploadsDir - 업로드 디렉토리 경로
 * @returns {Promise<void>}
 */
async function setupUploadDirectory(uploadsDir) {
  try {
    await fs.access(uploadsDir);
  } catch (error) {
    await fs.mkdir(uploadsDir, { recursive: true });
    logger.info('Upload directory created', { path: uploadsDir });
  }
}

/**
 * Multer 스토리지 설정
 * @param {string} destination - 저장 경로
 * @returns {Object} Multer 스토리지 설정
 */
function decodeFilename(filename) {
  if (!filename) return filename;
  
  // RFC 5987 형식: filename*=UTF-8''encoded-name 또는 filename="encoded-name"
  // URL 디코딩 시도
  try {
    // URL 인코딩된 파일명 디코딩
    if (filename.includes('%')) {
      return decodeURIComponent(filename);
    }
    // latin1로 잘못 인코딩된 경우 복구 시도
    if (Buffer.from(filename, 'latin1').toString('utf8') !== filename) {
      return Buffer.from(filename, 'latin1').toString('utf8');
    }
  } catch (e) {
    // 디코딩 실패 시 원본 반환
  }
  return filename;
}

function createStorage(destination) {
  return multer.diskStorage({
    destination: destination,
    filename: (req, file, cb) => {
      // 파일명 인코딩 처리 (다양한 인코딩 형식 시도)
      let originalName = file.originalname;
      
      // 1차: URL 디코딩 시도
      originalName = decodeFilename(originalName);
      
      // 2차: latin1 -> utf8 변환 시도 (multer가 latin1로 처리한 경우)
      try {
        const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
        // 한글이 포함되어 있고 제대로 디코딩된 경우 사용
        if (/[가-힣]/.test(decoded) || decoded !== file.originalname) {
          originalName = decoded;
        }
      } catch (e) {
        // 변환 실패 시 무시
      }
      
      const timestamp = Date.now();
      const ext = path.extname(originalName);
      const name = path.basename(originalName, ext);
      
      // 안전한 파일명 생성
      const safeName = `${name}_${timestamp}${ext}`;
      cb(null, safeName);
    }
  });
}

/**
 * 파일 업로드 미들웨어 생성
 * @param {Object} options - 업로드 옵션
 * @returns {Object} Multer 미들웨어
 */
function createUploadMiddleware(options = {}) {
  const {
    destination = './uploads',
    maxSize = 10 * 1024 * 1024, // 10MB
    allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/haansoftxlsx']
  } = options;
  
  // 디렉토리 초기화 (동기적으로 실행)
  const fsSync = require('fs');
  try {
    if (!fsSync.existsSync(destination)) {
      fsSync.mkdirSync(destination, { recursive: true });
      logger.info('Upload directory created synchronously', { path: destination });
    }
  } catch (dirError) {
    logger.error('Failed to create upload directory', { error: dirError.message, path: destination });
  }
  
  const storage = createStorage(destination);
  
  return multer({
    storage,
    limits: { fileSize: maxSize },
    fileFilter: (req, file, cb) => {
      logger.debug('File filter check', { 
        mimetype: file.mimetype, 
        originalname: file.originalname,
        allowedTypes 
      });
      
      // 1) MIME 타입 허용
      if (allowedTypes.includes(file.mimetype)) {
        logger.debug('File type allowed by MIME type', { mimetype: file.mimetype });
        return cb(null, true);
      }

      // 2) 확장자 기반 허용 (xlsx/xls 등 일부 환경에서 MIME이 다르게 오는 경우 보정)
      const name = (file.originalname || '').toLowerCase();
      const ext = name.split('.').pop();
      const excelExts = ['xlsx', 'xls'];
      if (excelExts.includes(ext)) {
        logger.debug('File type allowed by extension', { ext, mimetype: file.mimetype });
        return cb(null, true);
      }

      // 3) 마지막으로 octet-stream도 확장자 기준으로 허용
      if (file.mimetype === 'application/octet-stream' && excelExts.includes(ext)) {
        logger.debug('File type allowed by octet-stream with Excel extension', { ext });
        return cb(null, true);
      }

      logger.warn('File type rejected', { mimetype: file.mimetype, originalname: file.originalname, ext });
      cb(new Error(`File type ${file.mimetype} is not allowed. Only Excel files (.xlsx, .xls) are accepted.`), false);
    }
  });
}

/**
 * 파일 저장
 * @param {Buffer} data - 파일 데이터
 * @param {string} filename - 파일명
 * @param {string} directory - 저장 디렉토리
 * @returns {Promise<string>} 저장된 파일 경로
 */
async function saveFile(data, filename, directory = './uploads') {
  try {
    await setupUploadDirectory(directory);
    
    const filePath = path.join(directory, filename);
    await fs.writeFile(filePath, data);
    
    logger.info('File saved', { path: filePath, size: data.length });
    return filePath;
  } catch (error) {
    logger.error('File save failed', { error: error.message, filename });
    throw error;
  }
}

/**
 * 파일 읽기
 * @param {string} filePath - 파일 경로
 * @returns {Promise<Buffer>} 파일 데이터
 */
async function readFile(filePath) {
  try {
    const data = await fs.readFile(filePath);
    logger.debug('File read', { path: filePath, size: data.length });
    return data;
  } catch (error) {
    logger.error('File read failed', { error: error.message, path: filePath });
    throw error;
  }
}

/**
 * 파일 삭제
 * @param {string} filePath - 파일 경로
 * @returns {Promise<void>}
 */
async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
    logger.info('File deleted', { path: filePath });
  } catch (error) {
    logger.error('File delete failed', { error: error.message, path: filePath });
    throw error;
  }
}

/**
 * 파일 존재 여부 확인
 * @param {string} filePath - 파일 경로
 * @returns {Promise<boolean>} 파일 존재 여부
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 파일 정보 가져오기
 * @param {string} filePath - 파일 경로
 * @returns {Promise<Object>} 파일 정보
 */
async function getFileInfo(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
  } catch (error) {
    logger.error('Get file info failed', { error: error.message, path: filePath });
    throw error;
  }
}

/**
 * 디렉토리 내용 나열
 * @param {string} directory - 디렉토리 경로
 * @returns {Promise<Array>} 파일 목록
 */
async function listFiles(directory) {
  try {
    const files = await fs.readdir(directory);
    const fileInfos = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(directory, file);
        const info = await getFileInfo(filePath);
        return {
          name: file,
          path: filePath,
          ...info
        };
      })
    );
    
    return fileInfos;
  } catch (error) {
    logger.error('List files failed', { error: error.message, directory });
    throw error;
  }
}

/**
 * 임시 파일 생성
 * @param {Buffer} data - 파일 데이터
 * @param {string} extension - 파일 확장자
 * @returns {Promise<string>} 임시 파일 경로
 */
async function createTempFile(data, extension = '.tmp') {
  const tempDir = path.join(process.cwd(), 'temp');
  await setupUploadDirectory(tempDir);
  
  const filename = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${extension}`;
  const filePath = path.join(tempDir, filename);
  
  await fs.writeFile(filePath, data);
  
  // 1시간 후 자동 삭제
  setTimeout(async () => {
    try {
      await deleteFile(filePath);
    } catch (error) {
      logger.warn('Temp file cleanup failed', { error: error.message, path: filePath });
    }
  }, 60 * 60 * 1000);
  
  return filePath;
}

module.exports = {
  setupUploadDirectory,
  createStorage,
  createUploadMiddleware,
  saveFile,
  readFile,
  deleteFile,
  fileExists,
  getFileInfo,
  listFiles,
  createTempFile
};

