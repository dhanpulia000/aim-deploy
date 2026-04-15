/**
 * 네이버 카페 본문 이미지 URL 수집 및 로컬 저장 (Playwright 컨텍스트 쿠키 공유)
 */

const path = require('path');
const fs = require('fs').promises;

const MAX_IMAGES = 30;
const MIN_BYTES = 200;

function sanitizeArticleIdForFile(articleId) {
  return String(articleId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function extFromContentType(ct) {
  if (!ct || typeof ct !== 'string') return 'bin';
  const lower = ct.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('bmp')) return 'bmp';
  return 'bin';
}

/**
 * 본문 영역(.se-main-container 등)에서 게시 이미지 URL 목록 추출
 * @param {import('playwright').Page | import('playwright').Frame} ctx
 * @returns {Promise<string[]>}
 */
async function collectNaverPostImageUrls(ctx) {
  return ctx.evaluate(() => {
    const trySelectors = ['.se-main-container', '.ContentRenderer', '.article_view', '#tbody'];

    for (const sel of trySelectors) {
      const root = document.querySelector(sel);
      if (!root) continue;

      const imgs = root.querySelectorAll('img');
      const seen = new Set();
      const urls = [];

      imgs.forEach((img) => {
        let cand = (img.getAttribute('src') || '').trim();
        if (!cand || cand.startsWith('data:')) cand = (img.getAttribute('data-src') || '').trim();
        if (!cand || cand.startsWith('data:')) cand = (img.getAttribute('data-lazy-src') || '').trim();
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

      if (urls.length > 0) return urls;
    }
    return [];
  });
}

/**
 * Playwright APIRequestContext로 이미지 바이너리 저장 (네이버·Discourse 공통)
 * @param {object} opts
 * @param {import('playwright').APIRequestContext} opts.request
 * @param {string[]} opts.urls
 * @param {string} opts.idPrefix - 파일명용 (articleId, discourse-123 등)
 * @param {object} [opts.logger]
 * @returns {Promise<string[]>} uploads 기준 상대 경로 목록
 */
async function downloadPostImagesWithRequest({ request, urls, idPrefix, logger }) {
  if (!request || !urls || urls.length === 0) return [];

  const safeId = sanitizeArticleIdForFile(idPrefix);
  const today = new Date();
  const dateFolder = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const backendDir = path.resolve(__dirname, '../../..');
  const uploadsBase = path.join(backendDir, 'uploads', 'post-images', dateFolder);
  await fs.mkdir(uploadsBase, { recursive: true });

  const relativePaths = [];
  const slice = urls.slice(0, MAX_IMAGES);

  for (let i = 0; i < slice.length; i++) {
    const url = slice[i];
    try {
      const response = await request.get(url, { timeout: 45000 });
      if (!response.ok()) continue;
      const buffer = await response.body();
      if (!buffer || buffer.length < MIN_BYTES) continue;
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('text/html')) continue;
      const ext = extFromContentType(ct);
      const fileName = `issue_${safeId}_${i}.${ext}`;
      const fullPath = path.join(uploadsBase, fileName);
      await fs.writeFile(fullPath, buffer);
      relativePaths.push(`post-images/${dateFolder}/${fileName}`);
    } catch (e) {
      logger?.warn?.('[postImages] download failed', {
        url: typeof url === 'string' ? url.slice(0, 120) : url,
        error: e.message
      });
    }
  }

  return relativePaths;
}

/**
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {string[]} opts.urls
 * @param {string} opts.articleId
 * @param {object} [opts.logger]
 * @returns {Promise<string[]>} uploads 기준 상대 경로 목록
 */
async function downloadNaverPostImages({ page, urls, articleId, logger }) {
  if (!page || !urls || urls.length === 0) return [];
  return downloadPostImagesWithRequest({
    request: page.context().request,
    urls,
    idPrefix: articleId,
    logger
  });
}

module.exports = {
  collectNaverPostImageUrls,
  downloadNaverPostImages,
  downloadPostImagesWithRequest,
  MAX_IMAGES
};
