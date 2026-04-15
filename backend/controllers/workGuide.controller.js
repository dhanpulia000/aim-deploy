/**
 * 업무 가이드 API 컨트롤러
 */

const logger = require('../utils/logger');
const workGuideService = require('../services/workGuide.service').getWorkGuideService();
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');

/**
 * 가이드 목록 조회
 * GET /api/work-guides
 */
async function listGuides(req, res) {
  try {
    const { categoryGroupId, categoryId, guideType, search } = req.query;

    const filters = {};
    if (categoryGroupId) filters.categoryGroupId = parseInt(categoryGroupId);
    if (categoryId) filters.categoryId = parseInt(categoryId);
    if (guideType) filters.guideType = guideType;
    if (search) filters.search = search;

    const guides = workGuideService.listGuides(filters);

    logger.info('[WorkGuide] Guides listed', { count: guides.length, filters });

    return sendSuccess(res, guides);
  } catch (error) {
    logger.error('[WorkGuide] Failed to list guides', {
      error: error.message,
      stack: error.stack
    });
    return sendError(res, `가이드 목록 조회 실패: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 가이드 조회
 * GET /api/work-guides/:id
 */
async function getGuide(req, res) {
  try {
    const { id } = req.params;

    const guide = workGuideService.getGuide(id);

    if (!guide) {
      return sendError(res, '가이드를 찾을 수 없습니다', HTTP_STATUS.NOT_FOUND);
    }

    return sendSuccess(res, guide);
  } catch (error) {
    logger.error('[WorkGuide] Failed to get guide', {
      id: req.params.id,
      error: error.message
    });
    return sendError(res, `가이드 조회 실패: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 가이드 생성
 * POST /api/work-guides
 */
async function createGuide(req, res) {
  try {
    const guide = await workGuideService.createGuide(req.body);

    logger.info('[WorkGuide] Guide created', { id: guide.id, title: guide.title });

    return sendSuccess(res, guide, '가이드가 생성되었습니다');
  } catch (error) {
    logger.error('[WorkGuide] Failed to create guide', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    return sendError(res, `가이드 생성 실패: ${error.message}`, HTTP_STATUS.BAD_REQUEST);
  }
}

/**
 * 가이드 업데이트
 * PATCH /api/work-guides/:id
 */
async function updateGuide(req, res) {
  try {
    const { id } = req.params;

    const guide = await workGuideService.updateGuide(id, req.body);

    logger.info('[WorkGuide] Guide updated', { id });

    return sendSuccess(res, guide, '가이드가 수정되었습니다');
  } catch (error) {
    logger.error('[WorkGuide] Failed to update guide', {
      id: req.params.id,
      error: error.message
    });
    return sendError(res, `가이드 수정 실패: ${error.message}`, HTTP_STATUS.BAD_REQUEST);
  }
}

/**
 * 가이드 삭제
 * DELETE /api/work-guides/:id
 */
async function deleteGuide(req, res) {
  try {
    const { id } = req.params;

    await workGuideService.deleteGuide(id);

    logger.info('[WorkGuide] Guide deleted', { id });

    return sendSuccess(res, null, '가이드가 삭제되었습니다');
  } catch (error) {
    logger.error('[WorkGuide] Failed to delete guide', {
      id: req.params.id,
      error: error.message
    });
    return sendError(res, `가이드 삭제 실패: ${error.message}`, HTTP_STATUS.BAD_REQUEST);
  }
}

/**
 * 유사한 가이드 검색 (벡터 검색)
 * POST /api/work-guides/search
 */
async function searchGuides(req, res) {
  try {
    const {
      query: queryText,
      limit = 5,
      threshold = 0.7,
      categoryGroupId,
      categoryId,
      guideType,
      language
    } = req.body;

    if (!queryText || typeof queryText !== 'string' || queryText.trim().length === 0) {
      return sendError(res, '검색어는 필수입니다', HTTP_STATUS.BAD_REQUEST);
    }

    const options = {
      limit: parseInt(limit),
      threshold: parseFloat(threshold),
      categoryGroupId: categoryGroupId ? parseInt(categoryGroupId) : null,
      categoryId: categoryId ? parseInt(categoryId) : null,
      guideType: guideType || null,
      language: language === 'en' || language === 'ko' ? language : null
    };

    const results = await workGuideService.searchSimilarGuides(queryText, options);

    logger.info('[WorkGuide] Guides searched', {
      queryLength: queryText.length,
      found: results.length,
      options
    });

    return sendSuccess(res, {
      query: queryText,
      results,
      count: results.length
    });
  } catch (error) {
    logger.error('[WorkGuide] Failed to search guides', {
      error: error.message,
      stack: error.stack
    });
    return sendError(res, `가이드 검색 실패: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 파일 업로드로 가이드 일괄 생성
 * POST /api/work-guides/upload
 */
async function uploadGuides(req, res) {
  try {
    if (!req.files || req.files.length === 0) {
      return sendError(res, '업로드할 파일이 없습니다', HTTP_STATUS.BAD_REQUEST);
    }

    // FormData에서 전달된 값들은 문자열로 올 수 있음
    const guideType = req.body.guideType || 'general';
    const categoryGroupId = req.body.categoryGroupId ? parseInt(req.body.categoryGroupId) : null;
    const categoryId = req.body.categoryId ? parseInt(req.body.categoryId) : null;
    const autoSplit = req.body.autoSplit !== undefined ? req.body.autoSplit : 'true';

    // autoSplit을 boolean으로 변환 (문자열 'true' 또는 boolean true 모두 처리)
    const shouldAutoSplit = autoSplit === 'true' || autoSplit === true;

    const fileParserService = require('../services/fileParser.service').getFileParserService();
    const path = require('path');

    const results = {
      total: 0, // 실제 처리된 가이드 개수 (파일 개수가 아님)
      success: 0,
      failed: 0,
      errors: [],
      filesProcessed: 0, // 처리된 파일 개수
      filesTotal: req.files.length // 전체 파일 개수
    };

    // 원본 파일 저장 디렉토리 설정
    const fs = require('fs');
    const originalsDir = './uploads/guides/originals';
    if (!fs.existsSync(originalsDir)) {
      fs.mkdirSync(originalsDir, { recursive: true });
    }

    // 각 파일 처리
    for (const file of req.files) {
      let originalFilePath = null; // 원본 파일 경로
      try {
        logger.info('[WorkGuide] Processing uploaded file', {
          filename: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        });

        // 파일에서 텍스트 추출
        const { text, metadata } = await fileParserService.extractText(file.path, file.mimetype);

        if (!text || text.trim().length === 0) {
          throw new Error('파일에서 텍스트를 추출할 수 없습니다');
        }

        // 원본 파일 영구 저장
        const crypto = require('crypto');
        const fileBuffer = fs.readFileSync(file.path);
        const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex').substring(0, 8);
        const timestamp = Date.now();
        const fileExt = path.extname(file.originalname);
        const originalFileName = path.basename(file.originalname, fileExt);
        const safeOriginalFileName = Buffer.from(originalFileName, 'latin1').toString('utf8').replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
        const savedFileName = `${fileHash}_${timestamp}_${safeOriginalFileName}${fileExt}`;
        originalFilePath = path.join(originalsDir, savedFileName);
        
        // 원본 파일 복사 (임시 파일은 나중에 삭제)
        fs.copyFileSync(file.path, originalFilePath);
        logger.info('[WorkGuide] Original file saved', {
          originalPath: file.path,
          savedPath: originalFilePath,
          fileName: savedFileName
        });

        // 파일명 인코딩 처리 (다양한 인코딩 형식 시도)
        let safeFileName = file.originalname;
        
        try {
          // 1차: URL 디코딩 시도 (RFC 5987 형식)
          if (file.originalname.includes('%')) {
            try {
              safeFileName = decodeURIComponent(file.originalname);
            } catch (e) {
              // URL 디코딩 실패 시 다음 방법 시도
            }
          }
          
          // 2차: latin1 -> utf8 변환 시도 (multer가 latin1로 처리한 경우)
          const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
          // 한글이 포함되어 있고 제대로 디코딩된 경우 사용
          if (/[가-힣]/.test(decoded) || (decoded !== file.originalname && decoded.length > 0)) {
            safeFileName = decoded;
          }
          
          logger.debug('[WorkGuide] File name encoding processed', {
            original: file.originalname,
            decoded: safeFileName,
            hasKorean: /[가-힣]/.test(safeFileName)
          });
        } catch (encodingError) {
          // 인코딩 변환 실패 시 원본 사용
          logger.warn('[WorkGuide] File name encoding conversion failed', {
            originalname: file.originalname,
            error: encodingError.message
          });
        }

        // 섹션 분할 여부에 따라 처리
        if (shouldAutoSplit && text.length > 1000) {
          // 긴 텍스트는 섹션으로 분할
          const sections = fileParserService.splitIntoSections(text, file.mimetype);

          for (const section of sections) {
            if (section.content && section.content.trim().length > 10) {
              results.total++; // 처리할 가이드 개수 증가
              try {
                await workGuideService.createGuide({
                  title: (section.title || path.basename(safeFileName, path.extname(safeFileName))).trim(),
                  content: section.content.trim(),
                  guideType,
                  categoryGroupId,
                  categoryId,
                  priority: 0,
                  tags: [safeFileName], // 전체 파일명을 태그로 사용
                  metadata: {
                    source: 'file_upload',
                    fileName: safeFileName,
                    fileType: file.mimetype,
                    fileSize: file.size,
                    filePath: originalFilePath, // 원본 파일 경로 추가
                    ...metadata
                  }
                });
                results.success++;
              } catch (error) {
                results.failed++;
                results.errors.push({
                  file: safeFileName,
                  section: section.title,
                  error: error.message
                });
              }
            }
          }
          results.filesProcessed++;
        } else {
          // 짧은 텍스트 또는 분할하지 않는 경우 전체를 하나의 가이드로
          results.total++; // 처리할 가이드 개수 증가
          await workGuideService.createGuide({
            title: path.basename(safeFileName, path.extname(safeFileName)).trim(),
            content: text.trim(),
            guideType,
            categoryGroupId,
            categoryId,
            priority: 0,
            tags: [safeFileName], // 전체 파일명을 태그로 사용
            metadata: {
              source: 'file_upload',
              fileName: safeFileName,
              fileType: file.mimetype,
              fileSize: file.size,
              ...metadata
            }
          });
          results.success++;
          results.filesProcessed++;
        }

        // 임시 파일 삭제 (원본은 이미 영구 저장됨)
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkError) {
          logger.warn('[WorkGuide] Failed to delete temp file', {
            file: file.path,
            error: unlinkError.message
          });
        }
        
        // 파일 처리 완료 (성공 또는 실패 모두)
        results.filesProcessed++;
      } catch (error) {
        // 파일 처리 실패 시에도 파일 개수는 증가
        results.filesProcessed++;
        results.errors.push({
          file: file.originalname,
          error: error.message
        });
        logger.error('[WorkGuide] Failed to process uploaded file', {
          filename: file.originalname,
          error: error.message,
          stack: error.stack
        });
      }
    }

    logger.info('[WorkGuide] Files processed', results);

    return sendSuccess(res, {
      ...results,
      message: `${results.success}개의 가이드가 생성되었습니다${results.failed > 0 ? `, ${results.failed}개 실패` : ''}`
    });
  } catch (error) {
    logger.error('[WorkGuide] Failed to upload guides', {
      error: error.message,
      stack: error.stack
    });
    return sendError(res, `파일 업로드 실패: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 가이드 원본 파일 다운로드/뷰어
 * GET /api/work-guides/:id/file
 */
async function downloadGuideFile(req, res) {
  try {
    const { id } = req.params;
    const guide = workGuideService.getGuide(id);

    if (!guide) {
      return sendError(res, '가이드를 찾을 수 없습니다', HTTP_STATUS.NOT_FOUND);
    }

    const metadata = guide.metadata || {};
    const filePath = metadata.filePath;

    if (!filePath) {
      return sendError(res, '원본 파일이 없습니다', HTTP_STATUS.NOT_FOUND);
    }

    const fs = require('fs');
    const path = require('path');

    // 파일 존재 확인
    if (!fs.existsSync(filePath)) {
      return sendError(res, '파일을 찾을 수 없습니다', HTTP_STATUS.NOT_FOUND);
    }

    // 파일명 및 확장자
    const fileName = metadata.fileName || path.basename(filePath);
    const fileExt = path.extname(fileName).toLowerCase();
    
    // MIME 타입 설정
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.html': 'text/html',
      '.htm': 'text/html'
    };

    const contentType = mimeTypes[fileExt] || 'application/octet-stream';

    // 파일 전송 (inline으로 브라우저에서 열기)
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    logger.error('[WorkGuide] Failed to download file', {
      error: error.message,
      stack: error.stack
    });
    return sendError(res, `파일 다운로드 실패: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  listGuides,
  getGuide,
  createGuide,
  updateGuide,
  deleteGuide,
  searchGuides,
  uploadGuides,
  downloadGuideFile
};
