/**
 * 스크린샷 캡처 컨트롤러
 * 기존 이슈에 대해 수동으로 스크린샷을 캡처할 수 있는 API
 */

const { chromium } = require('playwright');
const { queryOne, execute } = require('../libs/db');
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');
const { generateScreenshotPath, ensureScreenshotDirectory, screenshotExists } = require('../utils/fileUtils');
const path = require('path');

/**
 * 이슈의 원본 URL에서 스크린샷 캡처
 */
const captureScreenshot = asyncMiddleware(async (req, res) => {
  const { issueId } = req.params;

  if (!issueId) {
    return sendError(res, 'Issue ID is required', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    // 이슈 정보 조회
    const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);

    if (!issue) {
      return sendError(res, 'Issue not found', HTTP_STATUS.NOT_FOUND);
    }

    // sourceUrl이 없으면 스크린샷 캡처 불가
    if (!issue.sourceUrl) {
      return sendError(res, 'Issue does not have sourceUrl', HTTP_STATUS.BAD_REQUEST);
    }

    // 이미 스크린샷이 있으면 기존 경로 반환
    if (issue.screenshotPath) {
      // 경로가 다를 수 있으므로 실제 파일 존재 여부 확인
      // __dirname은 backend/controllers이므로, 상위 디렉토리(backend)로 이동 후 uploads 폴더 접근
      const backendDir = path.resolve(__dirname, '..');
      const existingPath = path.join(backendDir, 'uploads', issue.screenshotPath);
      if (await screenshotExists(existingPath)) {
        return sendSuccess(res, {
          screenshotPath: issue.screenshotPath,
          message: 'Screenshot already exists'
        });
      }
    }

    logger.info('[Screenshot] Starting capture', { issueId, url: issue.sourceUrl });

    // 브라우저 실행 (메모리 절감 옵션)
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--mute-audio',
        '--no-first-run'
      ]
    });

    const page = await browser.newPage();

    try {
      // 페이지 로드
      await page.goto(issue.sourceUrl, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // 1. iframe 컨텍스트 확인
      let screenshotContext = page;
      let screenshotFrame = null;
      
      try {
        screenshotFrame = await page.frame({ name: 'cafe_main' });
        if (!screenshotFrame) {
          screenshotFrame = await page.frame({ url: /cafe_main/ });
        }
        if (screenshotFrame) {
          screenshotContext = screenshotFrame;
          logger.debug('[Screenshot] Using iframe context', { issueId });
        }
      } catch (frameError) {
        logger.debug('[Screenshot] No iframe context, using main page', { issueId });
      }

      // 2. 본문 컨테이너 찾기 (다중 선택자 지원)
      const containerSelectors = ['.se-main-container', '.ContentRenderer', '.article_view', '#tbody'];
      let foundContainer = null;
      let usedSelector = null;

      for (const selector of containerSelectors) {
        try {
          await screenshotContext.waitForSelector(selector, { timeout: 5000 });
          foundContainer = await screenshotContext.$(selector);
          if (foundContainer) {
            usedSelector = selector;
            logger.debug('[Screenshot] Found container', { issueId, selector });
            break;
          }
        } catch (e) {
          // 다음 선택자 시도
          continue;
        }
      }

      if (!foundContainer) {
        await browser.close();
        const errorReason = `Container not found with selectors: ${containerSelectors.join(', ')}`;
        logger.error('[Screenshot] Container not found', { issueId, errorReason });
        return sendError(res, errorReason, HTTP_STATUS.BAD_REQUEST);
      }

      // 3. 이미지 감지 및 스마트 대기 (강화된 감지 로직)
      // 먼저 페이지가 완전히 로드될 때까지 추가 대기
      await screenshotContext.waitForTimeout(2000);
      
      const imageInfo = await screenshotContext.evaluate((selector) => {
        // eslint-disable-next-line no-undef
        const container = document.querySelector(selector);
        if (!container) {
          return { 
            hasImages: false, 
            imageCount: 0,
            containerFound: false,
            containerText: null,
            debugInfo: 'Container not found'
          };
        }
        
        // 다양한 방법으로 이미지 찾기
        // eslint-disable-next-line no-undef
        const directImages = container.querySelectorAll('img');
        // eslint-disable-next-line no-undef
        const allImages = document.querySelectorAll('img'); // 전체 페이지에서도 확인
        const imageArray = Array.from(directImages);
        const allImageArray = Array.from(allImages);
        
        // 컨테이너 내부의 이미지 확인
        const containerImages = imageArray.filter(img => {
          return container.contains(img);
        });
        
        // 배경 이미지도 확인
        // eslint-disable-next-line no-undef
        const style = window.getComputedStyle(container);
        const hasBackgroundImage = style.backgroundImage && style.backgroundImage !== 'none';
        
        const containerText = container.textContent?.trim().substring(0, 200) || '';
        
        // 이미지가 있는지 확인 (직접 이미지 또는 배경 이미지)
        const hasImages = containerImages.length > 0 || hasBackgroundImage;
        
        return {
          hasImages: hasImages,
          imageCount: containerImages.length,
          imageSrcs: containerImages.map(img => ({
            src: img.src,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight
          })).slice(0, 5),
          containerFound: true,
          containerText: containerText,
          containerHeight: container.scrollHeight,
          containerWidth: container.scrollWidth,
          hasBackgroundImage: hasBackgroundImage,
          totalImagesInPage: allImageArray.length,
          debugInfo: {
            directImagesCount: imageArray.length,
            containerImagesCount: containerImages.length,
            allImagesCount: allImageArray.length
          }
        };
      }, usedSelector);

      logger.info('[Screenshot] Container and image check', { 
        issueId,
        usedSelector,
        containerFound: imageInfo.containerFound,
        hasImages: imageInfo.hasImages,
        imageCount: imageInfo.imageCount || 0,
        hasBackgroundImage: imageInfo.hasBackgroundImage || false,
        containerSize: imageInfo.containerFound ? `${imageInfo.containerWidth}x${imageInfo.containerHeight}` : 'N/A',
        debugInfo: imageInfo.debugInfo
      });

      // 이미지가 없으면 스크린샷 캡처하지 않음
      if (!imageInfo.hasImages) {
        await browser.close();
        logger.warn('[Screenshot] No images found in container', { 
          issueId,
          usedSelector,
          debugInfo: imageInfo.debugInfo
        });
        return sendError(res, 'No images found in the article', HTTP_STATUS.BAD_REQUEST);
      }

      logger.info('[Screenshot] Images detected, waiting for load', { 
        issueId, 
        imageCount: imageInfo.imageCount,
        hasBackgroundImage: imageInfo.hasBackgroundImage
      });

      // 이미지 로드 완료 대기 (최대 10초)
      const maxWaitTime = 10000;
      const startTime = Date.now();
      let allImagesLoaded = false;

      try {
        await screenshotContext.evaluate(async (selector, maxWait) => {
          // eslint-disable-next-line no-undef
          const container = document.querySelector(selector);
          if (!container) return false;
          
          const images = Array.from(container.querySelectorAll('img'));
          if (images.length === 0) return false;

          const loadPromises = images.map(img => {
            return new Promise((resolve) => {
              if (img.complete && img.naturalWidth > 0) {
                resolve(true);
                return;
              }
              
              const timeout = setTimeout(() => {
                resolve(false);
              }, maxWait);
              
              img.onload = () => {
                clearTimeout(timeout);
                resolve(true);
              };
              img.onerror = () => {
                clearTimeout(timeout);
                resolve(false);
              };
            });
          });

          const results = await Promise.all(loadPromises);
          return results.some(loaded => loaded);
        }, usedSelector, maxWaitTime);

        allImagesLoaded = true;
        const waitTime = Date.now() - startTime;
        logger.debug('[Screenshot] Images loaded', { issueId, waitTime });
      } catch (loadError) {
        logger.warn('[Screenshot] Image load check failed, proceeding anyway', {
          issueId,
          error: loadError.message
        });
      }

      // 안정화 대기 (0.5초)
      await screenshotContext.waitForTimeout(500);

      // 4. 경로 생성 및 디렉토리 생성
      const articleId = issue.externalPostId || issueId;
      const pathInfo = generateScreenshotPath(articleId);
      await ensureScreenshotDirectory(pathInfo.uploadsDir);

      // 5. 스크린샷 캡처
      const containerLocator = screenshotContext.locator(usedSelector);
      await containerLocator.screenshot({ 
        path: pathInfo.fullPath,
        fullPage: false
      });

      const screenshotPath = pathInfo.relativePath;

      // DB 업데이트
      execute(
        'UPDATE ReportItemIssue SET screenshotPath = ?, updatedAt = ? WHERE id = ?',
        [screenshotPath, new Date().toISOString(), issueId]
      );

      const updated = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
      if (updated) {
        const publisher = require('../realtime/publisher');
        publisher.broadcastIssueUpdated(updated);
      }

      await browser.close();

      logger.info('[Screenshot] Capture completed successfully', { 
        issueId, 
        screenshotPath,
        usedSelector,
        imageCount: imageInfo.imageCount || 0,
        hasBackgroundImage: imageInfo.hasBackgroundImage || false,
        allImagesLoaded
      });

      return sendSuccess(res, {
        screenshotPath,
        message: 'Screenshot captured successfully'
      });

    } catch (captureError) {
      await browser.close();
      
      // 상세한 에러 정보 로깅
      let errorReason = 'Unknown error';
      if (captureError.message.includes('Container not found')) {
        errorReason = 'Container not found';
      } else if (captureError.message.includes('timeout')) {
        errorReason = 'Image load timeout';
      } else if (captureError.message.includes('ENOENT') || captureError.message.includes('permission')) {
        errorReason = 'File permission or directory creation failed';
      } else if (captureError.message.includes('screenshot')) {
        errorReason = 'Screenshot capture failed';
      }

      logger.error('[Screenshot] Capture failed', {
        issueId,
        error: captureError.message,
        errorReason,
        stack: captureError.stack
      });
      throw captureError;
    }

  } catch (error) {
    logger.error('[Screenshot] Failed to capture screenshot', {
      issueId,
      error: error.message,
      stack: error.stack
    });
    return sendError(res, `Failed to capture screenshot: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

module.exports = {
  captureScreenshot
};



