// Files 서비스

const { createUploadMiddleware, saveFile, readFile, deleteFile, fileExists, getFileInfo, listFiles, createTempFile } = require('../libs/storage');
const { sendFile } = require('../utils/http');
const logger = require('../utils/logger');

/**
 * 파일 업로드 미들웨어 생성
 * @param {Object} options - 업로드 옵션
 * @returns {Object} Multer 미들웨어
 */
function createFileUploadMiddleware(options = {}) {
  const defaultOptions = {
    destination: './uploads',
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: [
      'image/jpeg',
      'image/png', 
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ]
  };
  
  return createUploadMiddleware({ ...defaultOptions, ...options });
}

/**
 * 파일 저장
 * @param {Buffer} fileData - 파일 데이터
 * @param {string} filename - 파일명
 * @param {string} directory - 저장 디렉토리
 * @returns {Promise<string>} 저장된 파일 경로
 */
async function saveUploadedFile(fileData, filename, directory = './uploads') {
  try {
    const filePath = await saveFile(fileData, filename, directory);
    logger.info('File uploaded and saved', { filename, path: filePath });
    return filePath;
  } catch (error) {
    logger.error('File upload failed', { error: error.message, filename });
    throw error;
  }
}

/**
 * 파일 다운로드
 * @param {string} filePath - 파일 경로
 * @param {string} filename - 다운로드 파일명
 * @returns {Promise<Object>} 파일 정보
 */
async function downloadFile(filePath, filename) {
  try {
    // 파일 존재 확인
    if (!(await fileExists(filePath))) {
      throw new Error('File not found');
    }
    
    // 파일 정보 가져오기
    const fileInfo = await getFileInfo(filePath);
    
    // 파일 읽기
    const fileData = await readFile(filePath);
    
    logger.info('File downloaded', { filename, path: filePath, size: fileData.length });
    
    return {
      data: fileData,
      filename,
      contentType: getContentType(filename),
      size: fileData.length,
      lastModified: fileInfo.modified
    };
  } catch (error) {
    logger.error('File download failed', { error: error.message, filePath });
    throw error;
  }
}

/**
 * 파일 삭제
 * @param {string} filePath - 파일 경로
 * @returns {Promise<void>}
 */
async function removeFile(filePath) {
  try {
    await deleteFile(filePath);
    logger.info('File removed', { path: filePath });
  } catch (error) {
    logger.error('File removal failed', { error: error.message, filePath });
    throw error;
  }
}

/**
 * 파일 목록 조회
 * @param {string} directory - 디렉토리 경로
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>} 파일 목록
 */
async function getFileList(directory, options = {}) {
  const { includeHidden = false, sortBy = 'name', order = 'asc' } = options;
  
  try {
    let files = await listFiles(directory);
    
    // 숨김 파일 필터링
    if (!includeHidden) {
      files = files.filter(file => !file.name.startsWith('.'));
    }
    
    // 정렬
    files.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'modified':
          comparison = new Date(a.modified) - new Date(b.modified);
          break;
        default:
          comparison = a.name.localeCompare(b.name);
      }
      
      return order === 'desc' ? -comparison : comparison;
    });
    
    logger.info('File list retrieved', { directory, count: files.length });
    return files;
  } catch (error) {
    logger.error('File list retrieval failed', { error: error.message, directory });
    throw error;
  }
}

/**
 * 임시 파일 생성
 * @param {Buffer} fileData - 파일 데이터
 * @param {string} extension - 파일 확장자
 * @returns {Promise<string>} 임시 파일 경로
 */
async function createTemporaryFile(fileData, extension = '.tmp') {
  try {
    const tempPath = await createTempFile(fileData, extension);
    logger.info('Temporary file created', { path: tempPath });
    return tempPath;
  } catch (error) {
    logger.error('Temporary file creation failed', { error: error.message });
    throw error;
  }
}

/**
 * 파일명에서 MIME 타입 추출
 * @param {string} filename - 파일명
 * @returns {string} MIME 타입
 */
function getContentType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'pdf': 'application/pdf',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'json': 'application/json',
    'zip': 'application/zip'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * 파일 크기 포맷팅
 * @param {number} bytes - 바이트 수
 * @returns {string} 포맷된 크기
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 안전한 파일명 생성
 * @param {string} originalName - 원본 파일명
 * @returns {string} 안전한 파일명
 */
function sanitizeFilename(originalName) {
  // 특수문자 제거 및 공백을 언더스코어로 변경
  return originalName
    .replace(/[^a-zA-Z0-9가-힣._-]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * 파일 유효성 검사
 * @param {Object} file - 파일 객체
 * @param {Object} options - 검사 옵션
 * @returns {Object} 검사 결과
 */
function validateFile(file, options = {}) {
  const {
    maxSize = 10 * 1024 * 1024, // 10MB
    allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'],
    allowedExtensions = ['jpg', 'jpeg', 'png', 'pdf']
  } = options;
  
  const errors = [];
  
  // 파일 존재 확인
  if (!file) {
    errors.push('File is required');
    return { valid: false, errors };
  }
  
  // 파일 크기 확인
  if (file.size > maxSize) {
    errors.push(`File size exceeds ${formatFileSize(maxSize)} limit`);
  }
  
  // MIME 타입 확인
  if (!allowedTypes.includes(file.mimetype)) {
    errors.push(`File type ${file.mimetype} is not allowed`);
  }
  
  // 확장자 확인
  const extension = file.originalname.split('.').pop().toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    errors.push(`File extension .${extension} is not allowed`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  createFileUploadMiddleware,
  saveUploadedFile,
  downloadFile,
  removeFile,
  getFileList,
  createTemporaryFile,
  getContentType,
  formatFileSize,
  sanitizeFilename,
  validateFile
};

