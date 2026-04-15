/**
 * Discourse 토픽 공개 페이지에서 첫 게시글 본문(.cooked) 스크린샷 (네이버 카페 워커와 유사)
 */

const logger = require('../../../utils/logger');
const { generateScreenshotPath, ensureScreenshotDirectory } = require('../../../utils/fileUtils');
const { downloadPostImagesWithRequest } = require('./naverPostImages');

/**
 * 첫 글 .cooked 안의 이미지 절대 URL 수집
 * @param {import('playwright').Page} page
 * @param {string} usedSelector
 */
async function collectDiscourseCookedImageUrls(page, usedSelector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const imgs = root.querySelectorAll('img');
    const seen = new Set();
    const urls = [];
    imgs.forEach((img) => {
      let cand = (img.getAttribute('src') || '').trim();
      if (!cand || cand.startsWith('data:')) cand = (img.getAttribute('data-src') || '').trim();
      if (!cand || cand.startsWith('data:')) return;
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 0 && h > 0 && w < 3 && h < 3) return;
      try {
        const abs = new URL(cand, document.baseURI).href;
        if (seen.has(abs)) return;
        seen.add(abs);
        urls.push(abs);
      } catch {
        /* skip */
      }
    });
    return urls;
  }, usedSelector);
}

function htmlIndicatesImages(html) {
  if (!html || typeof html !== 'string') return false;
  const h = html.toLowerCase();
  if (/<img[\s/>]/i.test(html)) return true;
  if (h.includes('upload://')) return true;
  if (h.includes('lightbox-wrapper')) return true;
  return false;
}

/**
 * @param {object} opts
 * @param {string|number} opts.topicId
 * @param {string} opts.url - 토픽 공개 URL
 * @param {string} [opts.userAgent]
 * @returns {Promise<{ screenshotPath: string|null, hasImages: boolean, postImagePaths: string[]|null }>}
 */
async function captureDiscourseTopicScreenshot({ topicId, url, userAgent }) {
  const cookedSelectors = [
    '#post_1 .cooked',
    'article[data-post-number="1"] .cooked',
    '.topic-post.regular.contents .cooked',
    '.post.regular .cooked',
    '.topic-body .regular .cooked'
  ];

  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        userAgent ||
        'AIMFORPH-DiscourseScreenshot/1.0 (+https://github.com; monitoring; respectful crawl)',
      locale: 'ko-KR',
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    let usedSelector = null;
    for (const sel of cookedSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 8000 });
        const h = await page.$(sel);
        if (h) {
          usedSelector = sel;
          break;
        }
      } catch (_) {
        /* try next */
      }
    }

    if (!usedSelector) {
      logger.warn('[DiscourseScreenshot] No .cooked container for topic', { topicId, url });
      return { screenshotPath: null, hasImages: false, postImagePaths: null };
    }

    const imageInfo = await page.evaluate((sel) => {
      const container = document.querySelector(sel);
      if (!container) return { hasImages: false, count: 0 };
      const imgs = Array.from(container.querySelectorAll('img'));
      const visible = imgs.filter((img) => img.getAttribute('src') || img.getAttribute('data-src'));
      return { hasImages: visible.length > 0, count: visible.length };
    }, usedSelector);

    if (!imageInfo.hasImages) {
      return { screenshotPath: null, hasImages: false, postImagePaths: null };
    }

    let downloadedPaths = [];
    try {
      const imgUrls = await collectDiscourseCookedImageUrls(page, usedSelector);
      if (imgUrls.length > 0) {
        downloadedPaths = await downloadPostImagesWithRequest({
          request: page.context().request,
          urls: imgUrls,
          idPrefix: `discourse-${topicId}`,
          logger
        });
      }
    } catch (e) {
      logger.warn('[DiscourseScreenshot] Inline image download failed', {
        topicId,
        error: e.message
      });
    }

    if (downloadedPaths.length > 0) {
      logger.info('[DiscourseScreenshot] Saved inline post images', {
        topicId,
        count: downloadedPaths.length,
        firstPath: downloadedPaths[0]
      });
      return {
        screenshotPath: downloadedPaths[0],
        hasImages: true,
        postImagePaths: downloadedPaths
      };
    }

    const maxWait = 8000;
    await page
      .evaluate(
        async (sel, max) => {
          const container = document.querySelector(sel);
          if (!container) return;
          const images = Array.from(container.querySelectorAll('img'));
          await Promise.all(
            images.map(
              (img) =>
                new Promise((resolve) => {
                  if (img.complete && img.naturalWidth > 0) {
                    resolve();
                    return;
                  }
                  const t = setTimeout(resolve, max);
                  img.onload = () => {
                    clearTimeout(t);
                    resolve();
                  };
                  img.onerror = () => {
                    clearTimeout(t);
                    resolve();
                  };
                })
            )
          );
        },
        usedSelector,
        maxWait
      )
      .catch(() => {});

    await new Promise((r) => setTimeout(r, 400));

    const pathInfo = generateScreenshotPath(`discourse-${topicId}`);
    await ensureScreenshotDirectory(pathInfo.uploadsDir);

    const locator = page.locator(usedSelector).first();
    await locator.screenshot({ path: pathInfo.fullPath, type: 'png' });

    logger.info('[DiscourseScreenshot] Captured topic cooked', {
      topicId,
      relativePath: pathInfo.relativePath,
      imageCount: imageInfo.count
    });

    const singlePath = pathInfo.relativePath;
    return {
      screenshotPath: singlePath,
      hasImages: true,
      postImagePaths: singlePath ? [singlePath] : null
    };
  } catch (e) {
    logger.warn('[DiscourseScreenshot] Failed', {
      topicId,
      url,
      error: e.message
    });
    return { screenshotPath: null, hasImages: true, postImagePaths: null };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {
        /* ignore */
      }
    }
  }
}

module.exports = {
  htmlIndicatesImages,
  captureDiscourseTopicScreenshot
};
