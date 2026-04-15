/**
 * 업무 가이드 데이터 수집 및 임포트 서비스
 * agent-manual.html 파싱 및 가이드 데이터 생성
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const logger = require('../utils/logger');
const workGuideService = require('./workGuide.service').getWorkGuideService();
const { query } = require('../libs/db');

class GuideImporterService {
  /**
   * agent-manual.html 파일 파싱
   */
  async parseManualHTML(filePath) {
    try {
      const html = fs.readFileSync(filePath, 'utf-8');
      const dom = new JSDOM(html);
      const document = dom.window.document;

      const guides = [];

      // 섹션별로 파싱
      const sections = document.querySelectorAll('h2, h3, h4');
      
      let currentSection = null;
      let currentContent = [];

      for (const element of sections) {
        const tagName = element.tagName.toLowerCase();
        const text = element.textContent.trim();

        // 이전 섹션 저장
        if (currentSection && currentContent.length > 0) {
          guides.push({
            title: currentSection.title,
            content: currentContent.join('\n\n').trim(),
            section: currentSection.section,
            subsection: currentSection.subsection
          });
        }

        // 새 섹션 시작
        if (tagName === 'h2') {
          currentSection = {
            title: text,
            section: text,
            subsection: null
          };
          currentContent = [];
        } else if (tagName === 'h3' && currentSection) {
          currentSection.subsection = text;
          currentSection.title = `${currentSection.section} - ${text}`;
          currentContent = [];
        } else if (tagName === 'h4' && currentSection) {
          currentSection.title = `${currentSection.section} - ${text}`;
          currentContent = [];
        }

        // 다음 요소까지의 내용 수집
        let nextElement = element.nextElementSibling;
        while (nextElement && !['H2', 'H3', 'H4'].includes(nextElement.tagName)) {
          const text = nextElement.textContent?.trim();
          if (text && text.length > 10) {
            currentContent.push(text);
          }
          nextElement = nextElement.nextElementSibling;
        }
      }

      // 마지막 섹션 저장
      if (currentSection && currentContent.length > 0) {
        guides.push({
          title: currentSection.title,
          content: currentContent.join('\n\n').trim(),
          section: currentSection.section,
          subsection: currentSection.subsection
        });
      }

      logger.info('[GuideImporter] Parsed manual HTML', {
        filePath,
        guidesCount: guides.length
      });

      return guides;
    } catch (error) {
      logger.error('[GuideImporter] Failed to parse manual HTML', {
        filePath,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * 가이드 타입 추론
   */
  inferGuideType(title, content) {
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();

    if (titleLower.includes('분류') || titleLower.includes('카테고리')) {
      return 'classification';
    }
    if (titleLower.includes('처리') || titleLower.includes('대응') || titleLower.includes('조치')) {
      return 'handling';
    }
    if (titleLower.includes('에스컬레이션') || titleLower.includes('상급자') || titleLower.includes('관리자')) {
      return 'escalation';
    }
    if (titleLower.includes('faq') || titleLower.includes('질문') || titleLower.includes('답변')) {
      return 'faq';
    }

    return 'general';
  }

  /**
   * 카테고리 매핑 (제목/내용 기반)
   */
  async mapToCategory(title, content) {
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();

    // 카테고리 그룹 및 카테고리 조회
    const categoryGroups = query('SELECT * FROM CategoryGroup');
    const categories = query('SELECT * FROM Category');

    // 키워드 기반 매칭
    const keywords = {
      '게임플레이': ['게임', '플레이', '버그', '오류', '크래시', '렉', '성능'],
      '불법프로그램': ['불법', '치팅', '핵', '계정', '도용', '차단', '제재'],
      '커뮤니티': ['커뮤니티', '이벤트', '공지', '이벤트', '캠페인'],
      '결제': ['결제', '구매', '환불', '크레딧', '코인', '스킨'],
      '기술지원': ['기술', '지원', '설정', '설치', '업데이트']
    };

    let matchedCategoryGroupId = null;
    let matchedCategoryId = null;

    for (const [groupName, groupKeywords] of Object.entries(keywords)) {
      const group = categoryGroups.find(g => 
        g.name.includes(groupName) || g.code?.toLowerCase().includes(groupName.toLowerCase())
      );

      if (group) {
        const hasKeyword = groupKeywords.some(keyword => 
          titleLower.includes(keyword) || contentLower.includes(keyword)
        );

        if (hasKeyword) {
          matchedCategoryGroupId = group.id;
          
          // 세부 카테고리 매칭
          const relatedCategories = categories.filter(c => c.categoryGroupId === group.id);
          for (const category of relatedCategories) {
            const categoryName = category.name.toLowerCase();
            if (titleLower.includes(categoryName) || contentLower.includes(categoryName)) {
              matchedCategoryId = category.id;
              break;
            }
          }
          break;
        }
      }
    }

    return {
      categoryGroupId: matchedCategoryGroupId,
      categoryId: matchedCategoryId
    };
  }

  /**
   * 매뉴얼에서 가이드 임포트
   */
  async importFromManual(manualPath = null) {
    const filePath = manualPath || path.join(__dirname, '../../public/agent-manual.html');

    if (!fs.existsSync(filePath)) {
      throw new Error(`매뉴얼 파일을 찾을 수 없습니다: ${filePath}`);
    }

    logger.info('[GuideImporter] Starting import from manual', { filePath });

    // HTML 파싱
    const parsedGuides = await this.parseManualHTML(filePath);

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const guideData of parsedGuides) {
      try {
        // 가이드 타입 추론
        const guideType = this.inferGuideType(guideData.title, guideData.content);

        // 카테고리 매핑
        const { categoryGroupId, categoryId } = await this.mapToCategory(
          guideData.title,
          guideData.content
        );

        // 태그 생성
        const tags = [];
        if (guideData.section) tags.push(guideData.section);
        if (guideData.subsection) tags.push(guideData.subsection);

        // 가이드 생성
        await workGuideService.createGuide({
          title: guideData.title,
          content: guideData.content,
          categoryGroupId,
          categoryId,
          guideType,
          priority: guideType === 'escalation' ? 10 : guideType === 'handling' ? 5 : 0,
          tags,
          metadata: {
            source: 'agent-manual.html',
            section: guideData.section,
            subsection: guideData.subsection
          }
        });

        imported++;
        logger.debug('[GuideImporter] Guide imported', {
          title: guideData.title.substring(0, 50),
          guideType
        });
      } catch (error) {
        errors++;
        logger.error('[GuideImporter] Failed to import guide', {
          title: guideData.title?.substring(0, 50),
          error: error.message
        });
      }
    }

    logger.info('[GuideImporter] Import completed', {
      total: parsedGuides.length,
      imported,
      skipped,
      errors
    });

    return {
      total: parsedGuides.length,
      imported,
      skipped,
      errors
    };
  }

  /**
   * 수동 가이드 생성 (예시)
   */
  async createExampleGuides() {
    const examples = [
      {
        title: '계정 도용 이슈 처리 가이드',
        content: `계정 도용 이슈는 즉시 다음 조치를 취해야 합니다:

1. 계정 잠금 처리
   - 사용자 계정을 즉시 잠금 처리하여 추가 피해 방지
   - 계정 복구 절차 안내

2. 2차 비밀번호 설정 안내
   - 사용자에게 2차 비밀번호 설정을 안내
   - 보안 강화 방법 제공

3. 관련 증거 수집
   - 로그인 기록 확인
   - 의심스러운 활동 기록 수집

4. 에스컬레이션
   - 심각도가 높은 경우 즉시 관리자에게 보고
   - 보안팀에 통보`,
        guideType: 'handling',
        categoryGroupId: null, // 카테고리 매핑 필요
        categoryId: null,
        priority: 10,
        tags: ['계정도용', '긴급처리', '보안']
      },
      {
        title: '버그/오류 이슈 분류 기준',
        content: `버그/오류 이슈는 다음과 같이 분류합니다:

- 게임 크래시: 게임이 강제 종료되는 경우
- 렉/성능 문제: 게임이 느리게 실행되거나 프레임 드롭 발생
- UI 오류: 화면 표시 오류
- 기능 오작동: 특정 기능이 정상 작동하지 않는 경우

각 유형별로 적절한 카테고리를 선택하고, 심각도에 따라 우선순위를 설정합니다.`,
        guideType: 'classification',
        priority: 5,
        tags: ['버그', '오류', '분류']
      }
    ];

    let created = 0;
    for (const example of examples) {
      try {
        await workGuideService.createGuide(example);
        created++;
      } catch (error) {
        logger.error('[GuideImporter] Failed to create example guide', {
          title: example.title,
          error: error.message
        });
      }
    }

    logger.info('[GuideImporter] Example guides created', { created });

    return created;
  }
}

// 싱글톤 인스턴스
let instance = null;

function getGuideImporterService() {
  if (!instance) {
    instance = new GuideImporterService();
  }
  return instance;
}

module.exports = {
  GuideImporterService,
  getGuideImporterService
};
