// Files 컨트롤러

const filesService = require('../services/files.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');

/**
 * 파일 업로드
 */
const uploadFile = asyncMiddleware(async (req, res) => {
  const file = req.file;
  
  if (!file) {
    return sendValidationError(res, [{ field: 'file', message: 'File is required' }]);
  }
  
  try {
    const filePath = await filesService.saveUploadedFile(
      file.buffer,
      file.originalname,
      './uploads'
    );
    
    const fileInfo = {
      originalName: file.originalname,
      filename: file.filename,
      path: filePath,
      size: file.size,
      mimetype: file.mimetype
    };
    
    sendSuccess(res, fileInfo, 'File uploaded successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('File upload failed', { error: error.message });
    sendError(res, 'File upload failed', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 파일 다운로드
 */
const downloadFile = asyncMiddleware(async (req, res) => {
  const { filename } = req.params;
  
  if (!filename) {
    return sendValidationError(res, [{ field: 'filename', message: 'Filename is required' }]);
  }
  
  try {
    const filePath = `./uploads/${filename}`;
    const downloadInfo = await filesService.downloadFile(filePath, filename);
    
    res.setHeader('Content-Type', downloadInfo.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadInfo.filename}"`);
    res.setHeader('Content-Length', downloadInfo.size);
    res.setHeader('Last-Modified', downloadInfo.lastModified.toUTCString());
    
    res.send(downloadInfo.data);
  } catch (error) {
    logger.error('File download failed', { error: error.message, filename });
    sendError(res, 'File download failed', HTTP_STATUS.NOT_FOUND, error.message);
  }
});

/**
 * 파일 삭제
 */
const deleteFile = asyncMiddleware(async (req, res) => {
  const { filename } = req.params;
  
  if (!filename) {
    return sendValidationError(res, [{ field: 'filename', message: 'Filename is required' }]);
  }
  
  try {
    const filePath = `./uploads/${filename}`;
    await filesService.removeFile(filePath);
    sendSuccess(res, null, 'File deleted successfully', HTTP_STATUS.NO_CONTENT);
  } catch (error) {
    logger.error('File deletion failed', { error: error.message, filename });
    sendError(res, 'File deletion failed', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 파일 목록 조회
 */
const getFileList = asyncMiddleware(async (req, res) => {
  const { directory = './uploads' } = req.query;
  const { includeHidden = false, sortBy = 'name', order = 'asc' } = req.query;
  
  try {
    const options = {
      includeHidden: includeHidden === 'true',
      sortBy,
      order
    };
    
    const files = await filesService.getFileList(directory, options);
    
    // 파일 정보 포맷팅
    const formattedFiles = files.map(file => ({
      name: file.name,
      path: file.path,
      size: file.size,
      formattedSize: filesService.formatFileSize(file.size),
      created: file.created,
      modified: file.modified,
      isFile: file.isFile,
      isDirectory: file.isDirectory
    }));
    
    sendSuccess(res, formattedFiles, 'File list retrieved successfully');
  } catch (error) {
    logger.error('File list retrieval failed', { error: error.message, directory });
    sendError(res, 'File list retrieval failed', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 파일 정보 조회
 */
const getFileInfo = asyncMiddleware(async (req, res) => {
  const { filename } = req.params;
  
  if (!filename) {
    return sendValidationError(res, [{ field: 'filename', message: 'Filename is required' }]);
  }
  
  try {
    const filePath = `./uploads/${filename}`;
    const fileInfo = await filesService.getFileInfo(filePath);
    
    const info = {
      name: filename,
      path: filePath,
      size: fileInfo.size,
      formattedSize: filesService.formatFileSize(fileInfo.size),
      created: fileInfo.created,
      modified: fileInfo.modified,
      isFile: fileInfo.isFile,
      isDirectory: fileInfo.isDirectory,
      contentType: filesService.getContentType(filename)
    };
    
    sendSuccess(res, info, 'File info retrieved successfully');
  } catch (error) {
    logger.error('File info retrieval failed', { error: error.message, filename });
    sendError(res, 'File info retrieval failed', HTTP_STATUS.NOT_FOUND, error.message);
  }
});

/**
 * 파일 유효성 검사
 */
const validateFile = asyncMiddleware(async (req, res) => {
  const file = req.file;
  const { maxSize, allowedTypes, allowedExtensions } = req.body;
  
  if (!file) {
    return sendValidationError(res, [{ field: 'file', message: 'File is required' }]);
  }
  
  const options = {
    maxSize: maxSize ? parseInt(maxSize) : undefined,
    allowedTypes: allowedTypes ? allowedTypes.split(',') : undefined,
    allowedExtensions: allowedExtensions ? allowedExtensions.split(',') : undefined
  };
  
  const validation = filesService.validateFile(file, options);
  
  if (validation.valid) {
    sendSuccess(res, { valid: true }, 'File validation passed');
  } else {
    sendValidationError(res, validation.errors.map(error => ({ field: 'file', message: error })));
  }
});

module.exports = {
  uploadFile,
  downloadFile,
  deleteFile,
  getFileList,
  getFileInfo,
  validateFile
};
