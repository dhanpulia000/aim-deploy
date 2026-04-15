/**
 * 파일 파서 서비스
 * 다양한 파일 타입 (PDF, DOCX, TXT, MD, HTML)에서 텍스트 추출
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const logger = require('../utils/logger');

class FileParserService {
  /**
   * 파일에서 텍스트 추출
   * @param {string} filePath - 파일 경로
   * @param {string} mimeType - MIME 타입 (선택)
   * @returns {Promise<{text: string, metadata: Object}>}
   */
  async extractText(filePath, mimeType = null) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const ext = path.extname(filePath).toLowerCase();
      const detectedMimeType = mimeType || this.detectMimeType(filePath, ext);

      logger.info('[FileParser] Extracting text', {
        filePath,
        ext,
        mimeType: detectedMimeType
      });

      let result;

      switch (detectedMimeType) {
        case 'application/pdf':
          result = await this.parsePDF(filePath);
          break;
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/msword':
          result = await this.parseDOCX(filePath);
          break;
        case 'text/plain':
          result = await this.parseTXT(filePath);
          break;
        case 'text/markdown':
          result = await this.parseMD(filePath);
          break;
        case 'text/html':
        case 'application/xhtml+xml':
          result = await this.parseHTML(filePath);
          break;
        default:
          // 확장자 기반으로 추론 시도
          if (ext === '.pdf') {
            result = await this.parsePDF(filePath);
          } else if (ext === '.docx') {
            result = await this.parseDOCX(filePath);
          } else if (ext === '.doc') {
            result = await this.parseDOCX(filePath);
          } else if (ext === '.txt') {
            result = await this.parseTXT(filePath);
          } else if (ext === '.md' || ext === '.markdown') {
            result = await this.parseMD(filePath);
          } else if (ext === '.html' || ext === '.htm') {
            result = await this.parseHTML(filePath);
          } else {
            throw new Error(`Unsupported file type: ${ext} (${detectedMimeType})`);
          }
      }

      logger.info('[FileParser] Text extracted', {
        filePath,
        textLength: result.text.length,
        metadata: result.metadata
      });

      return result;
    } catch (error) {
      logger.error('[FileParser] Failed to extract text', {
        filePath,
        mimeType,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * PDF 파싱
   */
  async parsePDF(filePath) {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);

      return {
        text: pdfData.text,
        metadata: {
          pages: pdfData.numpages,
          info: pdfData.info || {},
          metadata: pdfData.metadata || {}
        }
      };
    } catch (error) {
      logger.error('[FileParser] PDF parsing failed', {
        filePath,
        error: error.message
      });
      throw new Error(`PDF 파싱 실패: ${error.message}`);
    }
  }

  /**
   * DOCX 파싱
   */
  async parseDOCX(filePath) {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      const htmlResult = await mammoth.convertToHtml({ path: filePath });

      return {
        text: result.value,
        html: htmlResult.value, // HTML로 변환된 내용도 저장 (선택)
        metadata: {
          messages: htmlResult.messages || []
        }
      };
    } catch (error) {
      logger.error('[FileParser] DOCX parsing failed', {
        filePath,
        error: error.message
      });
      throw new Error(`DOCX 파싱 실패: ${error.message}`);
    }
  }

  /**
   * TXT 파싱
   */
  async parseTXT(filePath) {
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      return {
        text,
        metadata: {}
      };
    } catch (error) {
      logger.error('[FileParser] TXT parsing failed', {
        filePath,
        error: error.message
      });
      throw new Error(`TXT 파싱 실패: ${error.message}`);
    }
  }

  /**
   * Markdown 파싱
   */
  async parseMD(filePath) {
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      return {
        text,
        metadata: {}
      };
    } catch (error) {
      logger.error('[FileParser] Markdown parsing failed', {
        filePath,
        error: error.message
      });
      throw new Error(`Markdown 파싱 실패: ${error.message}`);
    }
  }

  /**
   * HTML 파싱
   */
  async parseHTML(filePath) {
    try {
      const html = fs.readFileSync(filePath, 'utf-8');
      const dom = new JSDOM(html);
      const document = dom.window.document;

      // 스크립트와 스타일 태그 제거
      const scripts = document.querySelectorAll('script, style');
      scripts.forEach(el => el.remove());

      // 텍스트 추출
      const text = document.body.textContent || '';

      return {
        text: text.trim(),
        html,
        metadata: {
          title: document.title || null
        }
      };
    } catch (error) {
      logger.error('[FileParser] HTML parsing failed', {
        filePath,
        error: error.message
      });
      throw new Error(`HTML 파싱 실패: ${error.message}`);
    }
  }

  /**
   * MIME 타입 감지
   */
  detectMimeType(filePath, ext) {
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.markdown': 'text/markdown',
      '.html': 'text/html',
      '.htm': 'text/html'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * 파일을 섹션으로 분할 (제목 기반)
   * @param {string} text - 추출된 텍스트
   * @param {string} fileType - 파일 타입 (현재 미사용, 향후 확장 가능)
   * @returns {Array<{title: string, content: string}>}
   */
  splitIntoSections(text, fileType = 'general') {
    // fileType 파라미터는 향후 파일 타입별 분할 로직에 사용 가능
    const sections = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let currentTitle = null;
    let currentContent = [];

    for (const line of lines) {
      // 제목 패턴 감지 (마크다운, HTML 제목, 숫자 목록 등)
      const isTitle = this.isTitleLine(line);

      if (isTitle && currentTitle !== null && currentContent.length > 0) {
        // 이전 섹션 저장
        sections.push({
          title: currentTitle,
          content: currentContent.join('\n').trim()
        });
        currentContent = [];
      }

      if (isTitle) {
        // 제목 정리 (마크다운 제목 기호 제거, 번호 제거 등)
        currentTitle = this.cleanTitle(line);
      } else {
        currentContent.push(line);
      }
    }

    // 마지막 섹션 저장
    if (currentTitle !== null && currentContent.length > 0) {
      sections.push({
        title: currentTitle,
        content: currentContent.join('\n').trim()
      });
    }

    // 섹션이 없으면 전체를 하나의 섹션으로
    if (sections.length === 0 && text.trim().length > 0) {
      sections.push({
        title: 'Document',
        content: text.trim()
      });
    }

    return sections;
  }

  /**
   * 제목 라인인지 판단
   */
  isTitleLine(line) {
    // 마크다운 제목 (#, ##, ###)
    if (/^#{1,6}\s+/.test(line)) return true;

    // 숫자 목록 시작 (1., 2., 3. 등)
    if (/^\d+\.\s+/.test(line) && line.length < 100) return true;

    // 대문자로 시작하고 짧은 라인 (제목 가능성) - 너무 관대하지 않도록 조건 강화
    // 단, 마크다운이나 숫자 목록이 아닌 경우에만
    if (/^[A-Z가-힣]/.test(line) && line.length < 80 && line.length > 5 && 
        !line.includes('.') && !line.match(/^[가-힣\s]+$/)) return true;

    // 구분선 (---, ===)
    if (/^[-=]{3,}$/.test(line)) return true;

    return false;
  }

  /**
   * 제목 정리
   */
  cleanTitle(title) {
    // 마크다운 제목 기호 제거
    title = title.replace(/^#+\s+/, '');

    // 숫자 목록 번호 제거
    title = title.replace(/^\d+\.\s+/, '');

    // 구분선 제거
    title = title.replace(/^[-=]+\s*$/, '');

    return title.trim();
  }
}

// 싱글톤 인스턴스
let instance = null;

function getFileParserService() {
  if (!instance) {
    instance = new FileParserService();
  }
  return instance;
}

module.exports = {
  FileParserService,
  getFileParserService
};
