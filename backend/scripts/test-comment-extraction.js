/**
 * 크롤러와 동일한 방식으로 게시글 스크랩하여 댓글 수 추출 결과 비교
 * 
 * 실행 방법:
 * cd /home/young-dev/AIM/backend
 * node scripts/test-comment-extraction.js "진짜 배린이인데요"
 */

const { chromium } = require('playwright');
const { queryOne } = require('../libs/db');
const logger = require('../utils/logger');

async function testCommentExtraction(searchTitle) {
  let browser = null;
  let page = null;
  
  try {
    logger.info('댓글 수 추출 테스트 시작', { searchTitle });
    
    // DB에서 게시글 정보 가져오기
    const issue = queryOne(
      `SELECT id, summary, commentCount, scrapedComments, sourceUrl, externalPostId, source 
       FROM ReportItemIssue 
       WHERE summary LIKE ? AND (source LIKE '%PC%' OR source LIKE '%MOBILE%')
       ORDER BY createdAt DESC 
       LIMIT 1`,
      [`%${searchTitle}%`]
    );
    
    // RawLog에서 monitoredBoardId 가져오기
    let boardUrl = null;
    let boardListUrl = null;
    if (issue && issue.externalPostId) {
      // RawLog에서 monitoredBoardId 찾기
      const rawLogs = queryOne(
        `SELECT metadata FROM RawLog 
         WHERE metadata LIKE ? 
         AND source = 'naver'
         ORDER BY createdAt DESC
         LIMIT 1`,
        [`%"externalPostId":"${issue.externalPostId}"%`]
      );
      
      if (rawLogs && rawLogs.metadata) {
        try {
          const metadata = typeof rawLogs.metadata === 'string' ? JSON.parse(rawLogs.metadata) : rawLogs.metadata;
          const boardId = metadata.monitoredBoardId;
          
          if (boardId) {
            const board = queryOne(
              `SELECT url, listUrl FROM MonitoredBoard WHERE id = ?`,
              [boardId]
            );
            if (board) {
              boardUrl = board.url;
              boardListUrl = board.listUrl;
              console.log(`   DB에서 게시판 정보 찾음: boardId=${boardId}, url=${boardUrl}, listUrl=${boardListUrl}`);
            }
          }
        } catch (e) {
          console.log(`   RawLog metadata 파싱 실패: ${e.message}`);
        }
      }
    }
    
    if (!issue) {
      console.log(`\n❌ "${searchTitle}" 제목을 가진 게시글을 찾을 수 없습니다.\n`);
      return;
    }
    
    console.log(`\n=== 테스트 대상 게시글 ===`);
    console.log(`제목: ${issue.summary}`);
    console.log(`URL: ${issue.sourceUrl}`);
    console.log(`현재 DB 댓글 수: ${issue.commentCount || 0}`);
    console.log(`externalPostId: ${issue.externalPostId}`);
    console.log('');
    
    // 브라우저 시작
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    page = await context.newPage();
    
    const articleUrl = issue.sourceUrl;
    const articleId = issue.externalPostId;
    
    // 결과 비교를 위한 변수 (전역 스코프)
    let listPageCount = 0;
    
    // 게시판 URL 결정: DB에서 가져온 URL 우선, 없으면 URL에서 추출
    let targetBoardUrl = boardListUrl || boardUrl || '';
    
    if (!targetBoardUrl && articleUrl) {
      // URL에서 추출 시도
      if (articleUrl.includes('/articles/')) {
        targetBoardUrl = articleUrl.substring(0, articleUrl.indexOf('/articles/'));
      } else if (articleUrl.includes('/ArticleRead.nhn')) {
        targetBoardUrl = articleUrl.substring(0, articleUrl.indexOf('/ArticleRead.nhn'));
      }
    }
    
    // 상세 페이지에서 게시판 링크 찾기 (게시판 URL이 없을 경우)
    if (!targetBoardUrl) {
      console.log('⚠️ 게시판 URL을 추출할 수 없습니다.');
      console.log(`   원본 URL: ${articleUrl}`);
      console.log('   → 상세 페이지에서 게시판 링크를 찾아보겠습니다...');
      console.log('');
      
      // 상세 페이지로 먼저 이동하여 게시판 링크 찾기
      const fullArticleUrl = articleUrl.startsWith('http') ? articleUrl : `https://cafe.naver.com${articleUrl}`;
      await page.goto(fullArticleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      // 게시판 링크 찾기
      const boardLinkFromDetail = await page.evaluate(() => {
        // 다양한 선택자로 게시판 링크 찾기
        const selectors = [
          'a.board_name',
          '.board_name a',
          'a[href*="/menus/"]',
          'a[href*="/boards/"]',
          '.article-board a',
          '.cafe-board a'
        ];
        
        for (const selector of selectors) {
          const link = document.querySelector(selector);
          if (link) {
            const href = link.getAttribute('href');
            if (href && (href.includes('/menus/') || href.includes('/boards/') || href.includes('/cafes/'))) {
              return href.startsWith('http') ? href : `https://cafe.naver.com${href}`;
            }
          }
        }
        
        return null;
      });
      
      if (boardLinkFromDetail) {
        targetBoardUrl = boardLinkFromDetail;
        console.log(`   ✅ 상세 페이지에서 게시판 링크 발견: ${targetBoardUrl}`);
      } else {
        console.log('   ❌ 상세 페이지에서도 게시판 링크를 찾을 수 없습니다.');
        console.log('   → 상세 페이지에서만 댓글 수를 확인합니다...\n');
      }
    }
    
    if (targetBoardUrl) {
      // 리스트 페이지 접속 (크롤러와 동일한 방식)
      // URL에 viewType=title, listType=50 파라미터 추가
      let listUrl = targetBoardUrl;
      try {
        const urlObj = new URL(targetBoardUrl);
        urlObj.searchParams.delete('search.viewType');
        urlObj.searchParams.delete('viewType');
        urlObj.searchParams.set('search.viewType', 'title');
        urlObj.searchParams.delete('search.listType');
        urlObj.searchParams.delete('listType');
        urlObj.searchParams.set('search.listType', '50');
        listUrl = urlObj.toString();
      } catch (e) {
        // URL 파싱 실패 시 쿼리 파라미터 추가
        listUrl = `${targetBoardUrl}${targetBoardUrl && targetBoardUrl.includes('?') ? '&' : '?'}search.viewType=title&search.listType=50`;
      }
      
      console.log(`\n=== 1단계: 리스트 페이지 접속 ===`);
      console.log(`리스트 페이지 URL: ${listUrl}`);
      
      await page.goto(listUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(5000); // 초기 로딩 대기
      
      // 페이지 스크린샷 저장 (디버깅용)
      try {
        await page.screenshot({ path: `/tmp/list-page-${Date.now()}.png`, fullPage: true });
        console.log('   📸 리스트 페이지 스크린샷 저장됨');
      } catch (e) {
        // 스크린샷 실패는 무시
      }
      
      // iframe 컨텍스트 확인 및 전환 (크롤러와 동일)
      let frame = null;
      let isInIframe = false;
      
      try {
        // iframe이 있는지 확인
        const iframeExists = await page.evaluate(() => {
          const iframe = document.querySelector('iframe#cafe_main, iframe#cafe_main_original, iframe[name="cafe_main"]');
          return !!iframe;
        });
        
        if (iframeExists) {
          console.log('   iframe 감지됨, 전환 시도 중...');
          
          // Playwright의 frame API로 iframe 전환 시도
          try {
            frame = await page.frame({ name: 'cafe_main' });
            if (!frame) {
              // name으로 찾지 못하면 id로 시도
              frame = await page.frame({ url: /cafe_main/ });
            }
            
            if (frame) {
              isInIframe = true;
              console.log('   ✅ iframe 컨텍스트로 전환됨');
            } else {
              console.log('   ⚠️ iframe이 있지만 frame context를 찾지 못함, 메인 페이지 사용');
            }
          } catch (frameError) {
            console.log(`   ⚠️ iframe 전환 실패: ${frameError.message}, 메인 페이지 사용`);
          }
        } else {
          console.log('   iframe 없음, 메인 페이지 사용');
        }
      } catch (iframeCheckError) {
        console.log(`   ⚠️ iframe 확인 중 오류: ${iframeCheckError.message}, 메인 페이지 사용`);
      }
      
      // iframe이 있으면 frame을, 없으면 page를 사용
      const listContext = frame || page;
      
      // 목록 로딩 완료 대기: 최소 10개 이상의 게시글 행이 로드될 때까지 기다림 (크롤러와 동일)
      console.log(`\n=== 2단계: 리스트 페이지 로딩 대기 ===`);
      
      try {
        // waitForFunction을 사용하여 최소 10개 이상의 행이 로드될 때까지 대기
        await listContext.waitForFunction(
          () => {
            // 다양한 선택자로 행 개수 확인
            const listRows = document.querySelectorAll('tbody tr:not(.board-notice)');
            const cardRows = document.querySelectorAll('.article-card, .article-item, .board-list-item');
            const allRows = document.querySelectorAll('tbody tr');
            
            const count = Math.max(
              listRows.length,
              cardRows.length,
              allRows.length
            );
            
            return count >= 10; // 최소 10개 이상
          },
          {
            timeout: 30000, // 최대 30초 대기
            polling: 500 // 500ms마다 체크
          }
        );
        
        console.log('   ✅ 리스트 항목 로딩 완료 (최소 10개 이상 발견)');
      } catch (waitError) {
        // 타임아웃이 발생해도 계속 진행 (게시글이 10개 미만일 수도 있음)
        console.log(`   ⚠️ 최소 항목 대기 타임아웃, 계속 진행 (${waitError.message})`);
        
        // 추가 안정화 대기 (1초)
        await page.waitForTimeout(1000);
      }
      
      // DOM 요소 카운트 및 상세 디버깅 (크롤러와 동일)
      const domStats = await listContext.evaluate(() => {
        // 다양한 선택자로 DOM 요소 카운트
        const selectors = {
          'tbody tr': document.querySelectorAll('tbody tr').length,
          'tbody tr:not(.board-notice)': document.querySelectorAll('tbody tr:not(.board-notice)').length,
          '#upperArticleList tr': document.querySelectorAll('#upperArticleList tr').length,
          '.article-board > table > tbody > tr': document.querySelectorAll('.article-board > table > tbody > tr').length,
          'tbody tr.board-notice': document.querySelectorAll('tbody tr.board-notice').length,
          '.article-list': document.querySelectorAll('.article-list').length,
          '.article-card': document.querySelectorAll('.article-card').length,
          '.board-list': document.querySelectorAll('.board-list').length
        };
        
        return selectors;
      });
      
      console.log(`   DOM 요소 통계:`, domStats);
      
      // 리스트 페이지에서 게시글 찾기 및 댓글 수 추출 (크롤러와 동일한 로직)
      console.log(`\n=== 3단계: 리스트 페이지에서 게시글 찾기 ===`);
      
      const listPageData = await listContext.evaluate(({ targetArticleId, searchTitle }) => {
        const rows = document.querySelectorAll('tbody tr');
        const results = [];
        const allPosts = []; // 디버깅용: 모든 게시글 정보
        
        rows.forEach((row, index) => {
          // 링크 찾기 (크롤러와 동일한 선택자)
          let link = row.querySelector('td .board-list .inner_list a.article');
          if (!link) {
            link = row.querySelector('a.article, a[href*="/ArticleRead.nhn"], a[href*="/ArticleDetail.nhn"]');
          }
          if (!link) {
            link = row.querySelector('.article-title a, .title a, a.title');
          }
          
          if (!link) {
            allPosts.push({ index: index + 1, status: 'no_link' });
            return;
          }
          
          const href = link.getAttribute('href') || '';
          let title = link.textContent?.trim() || link.innerText?.trim() || '';
          
          // 제목 링크의 부모 요소에서 전체 텍스트 가져오기 (제목 + [숫자] 포함)
          let fullTitleText = title;
          if (link.parentElement) {
            const parentText = link.parentElement.textContent?.trim() || '';
            // 제목 링크 다음에 [숫자]가 있는지 확인
            if (parentText.includes(title)) {
              fullTitleText = parentText;
            }
          }
          
          // articleId 추출
          let articleId = null;
          const articleMatch = href.match(/articles\/(\d+)|articleId=(\d+)|articleNo=(\d+)/i);
          if (articleMatch) {
            articleId = articleMatch[1] || articleMatch[2] || articleMatch[3];
          }
          
          // 댓글 수 추출 (크롤러와 동일한 로직)
          let commentCountFromTitle = 0;
          
          // 방법 0: 제목 텍스트 자체에 [숫자]가 포함되어 있는지 확인 (가장 정확)
          // 제목 링크의 textContent와 부모 요소의 textContent 모두 확인
          const titleWithBracket = fullTitleText.match(/\[(\d+)\]/);
          if (titleWithBracket) {
            commentCountFromTitle = parseInt(titleWithBracket[1], 10) || 0;
          }
          
          // 제목 링크만으로 찾지 못했으면 원본 title도 확인
          if (!commentCountFromTitle) {
            const titleOnlyBracket = title.match(/\[(\d+)\]/);
            if (titleOnlyBracket) {
              commentCountFromTitle = parseInt(titleOnlyBracket[1], 10) || 0;
            }
          }
          
          // 방법 1: 제목 링크의 바로 다음 형제 요소
          if (!commentCountFromTitle && link.nextSibling) {
            const siblingText = link.nextSibling.textContent?.trim() || '';
            const siblingCommentMatch = siblingText.match(/^\s*\[(\d+)\]\s*$/);
            if (siblingCommentMatch) {
              commentCountFromTitle = parseInt(siblingCommentMatch[1], 10) || 0;
            }
          }
          
          // 방법 2: 부모 요소의 형제 요소
          if (!commentCountFromTitle && link.parentElement) {
            const parent = link.parentElement;
            const children = Array.from(parent.children);
            const linkIndex = children.indexOf(link);
            if (linkIndex >= 0 && linkIndex < children.length - 1) {
              const nextSibling = children[linkIndex + 1];
              const nextSiblingText = nextSibling.textContent?.trim() || '';
              const nextSiblingMatch = nextSiblingText.match(/^\s*\[(\d+)\]\s*$/);
              if (nextSiblingMatch) {
                commentCountFromTitle = parseInt(nextSiblingMatch[1], 10) || 0;
              }
            }
          }
          
          // 방법 3: 댓글 수 전용 셀렉터
          if (!commentCountFromTitle) {
            const commentCountSelectors = [
              '.comment_count',
              '.reply_count',
              '.cmt_count',
              '[class*="comment"]',
              '[class*="reply"]',
              'td.td_comment',
              'td.td_reply'
            ];
            
            for (const selector of commentCountSelectors) {
              const commentElement = row.querySelector(selector);
              if (commentElement) {
                const commentText = commentElement.textContent?.trim() || '';
                const commentMatch = commentText.match(/\[(\d+)\]/);
                if (commentMatch) {
                  commentCountFromTitle = parseInt(commentMatch[1], 10) || 0;
                  break;
                }
                const numOnlyMatch = commentText.match(/^(\d+)$/);
                if (numOnlyMatch && parseInt(numOnlyMatch[1], 10) < 1000) {
                  commentCountFromTitle = parseInt(numOnlyMatch[1], 10) || 0;
                  break;
                }
              }
            }
          }
          
          // 전체 행 텍스트에서 [숫자] 패턴 찾기
          const rowText = row.textContent || '';
          const allMatches = rowText.match(/\[(\d+)\]/g);
          
          // 디버깅용: 모든 게시글 정보 저장
          allPosts.push({
            index: index + 1,
            title: title.substring(0, 50),
            articleId,
            href: href.substring(0, 100),
            commentCountFromTitle,
            allMatches: allMatches || []
          });
          
          // 제목 또는 articleId로 매칭
          const titleMatches = searchTitle && title.toLowerCase().includes(searchTitle.toLowerCase());
          const articleIdMatches = articleId && String(articleId) === String(targetArticleId);
          
          if (!articleIdMatches && !titleMatches) return;
          
          results.push({
            index: index + 1,
            title,
            href,
            articleId,
            commentCountFromTitle,
            allMatches: allMatches || [],
            rowText: rowText.substring(0, 200)
          });
        });
        
        return { results, allPosts: allPosts.slice(0, 20) }; // 최대 20개만 반환
      }, { targetArticleId: articleId, searchTitle: searchTitle });
      
      // 디버깅: 처음 몇 개 게시글 출력
      if (listPageData.allPosts && listPageData.allPosts.length > 0) {
        console.log(`\n   디버깅: 리스트 페이지 처음 ${Math.min(5, listPageData.allPosts.length)}개 게시글:`);
        listPageData.allPosts.slice(0, 5).forEach(post => {
          console.log(`   [${post.index}] ${post.title.substring(0, 30)}... | articleId: ${post.articleId} | 댓글수: ${post.commentCountFromTitle} | [숫자]패턴: ${post.allMatches.join(', ')}`);
        });
      }
      
      if (listPageData.results && listPageData.results.length > 0) {
        const foundPost = listPageData.results[0];
        console.log(`\n✅ 게시글 발견:`);
        console.log(`   제목: ${foundPost.title}`);
        console.log(`   링크: ${foundPost.href}`);
        console.log(`   articleId: ${foundPost.articleId}`);
        console.log(`   리스트 페이지에서 추출한 댓글 수: ${foundPost.commentCountFromTitle}`);
        console.log(`   행에서 발견된 모든 [숫자] 패턴: ${foundPost.allMatches.join(', ')}`);
        
        // 결과 비교를 위해 변수 저장
        listPageCount = foundPost.commentCountFromTitle;
      } else {
        console.log('\n⚠️ 리스트 페이지에서 해당 게시글을 찾을 수 없습니다.');
        console.log(`   검색 조건: articleId=${articleId}, 제목="${searchTitle}"`);
        console.log('   → 상세 페이지로 직접 이동합니다...\n');
      }
    }
    
      // 상세 페이지 접속
      console.log(`\n=== 4단계: 상세 페이지 접속 ===`);
    const fullArticleUrl = articleUrl.startsWith('http') ? articleUrl : `https://cafe.naver.com${articleUrl}`;
    console.log(`상세 페이지 URL: ${fullArticleUrl}`);
    
    await page.goto(fullArticleUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000); // 더 긴 대기 시간
    
    // iframe 확인 (상세 페이지도 iframe이 있을 수 있음)
    let detailFrame = null;
    try {
      const iframeExists = await page.evaluate(() => {
        const iframe = document.querySelector('iframe#cafe_main, iframe#cafe_main_original, iframe[name="cafe_main"]');
        return !!iframe;
      });
      
      if (iframeExists) {
        detailFrame = await page.frame({ name: 'cafe_main' });
        if (!detailFrame) {
          detailFrame = await page.frame({ url: /cafe_main/ });
        }
        if (detailFrame) {
          console.log('   ✅ 상세 페이지 iframe 컨텍스트로 전환됨');
          await detailFrame.waitForTimeout(2000);
        }
      }
    } catch (e) {
      // iframe 처리 실패 시 무시
    }
    
    const detailContext = detailFrame || page;
    
      // 상세 페이지에서 댓글 수 확인 (크롤러와 동일한 로직)
      console.log(`\n=== 5단계: 상세 페이지에서 댓글 수 확인 ===`);
    
    // 1. ReplyBox에서 댓글 수 추출 (더 강화된 로직)
    const actualCommentCount = await detailContext.evaluate(() => {
      // 다양한 ReplyBox 선택자 시도
      const replyBoxSelectors = [
        'div.ReplyBox',
        'div.replyBox',
        '.ReplyBox',
        '.replyBox',
        '[class*="ReplyBox"]',
        '[class*="replyBox"]',
        '[class*="comment"]',
        '.comment_count',
        '.reply_count'
      ];
      
      let replyBox = null;
      for (const selector of replyBoxSelectors) {
        replyBox = document.querySelector(selector);
        if (replyBox) break;
      }
      
      // 페이지 전체에서 "댓글 숫자" 패턴 찾기 (우선 시도)
      const allText = document.body.textContent || '';
      const commentMatches = allText.match(/댓글\s*(\d+)/g);
      if (commentMatches && commentMatches.length > 0) {
        // 가장 많이 나타나는 숫자 사용 (댓글 수는 보통 여러 곳에 표시됨)
        const numbers = commentMatches.map(m => {
          const numMatch = m.match(/(\d+)/);
          return numMatch ? parseInt(numMatch[1], 10) : 0;
        }).filter(n => n > 0 && n < 10000);
        
        if (numbers.length > 0) {
          // 가장 작은 숫자 사용 (댓글 수는 보통 작은 숫자)
          return Math.min(...numbers);
        }
      }
      
      if (!replyBox) {
        return null;
      }
      
      const replyText = replyBox.textContent || '';
      const replyIndex = replyText.indexOf('댓글');
      
      if (replyIndex >= 0) {
        // 방법 1: <strong class="num"> 찾기
        const allElements = replyBox.querySelectorAll('*');
        for (const el of allElements) {
          if (el.tagName === 'STRONG' && el.classList.contains('num')) {
            const text = el.textContent?.trim() || '';
            const numMatch = text.match(/^(\d+)$/);
            if (numMatch) {
              return parseInt(numMatch[1], 10) || 0;
            }
          }
        }
        
        // 방법 2: "댓글 숫자" 패턴 찾기
        const replyMatch = replyText.substring(replyIndex).match(/댓글\s*(\d+)/);
        if (replyMatch) {
          return parseInt(replyMatch[1], 10) || 0;
        }
        
        // 방법 3: "댓글" 다음에 오는 숫자 찾기
        const afterReply = replyText.substring(replyIndex + 2);
        const numAfterReply = afterReply.match(/^\s*(\d+)/);
        if (numAfterReply) {
          return parseInt(numAfterReply[1], 10) || 0;
        }
      }
      
      // 방법 4: strong.num 요소 찾기
      const numElements = replyBox.querySelectorAll('strong.num, .num, [class*="num"]');
      for (const numEl of numElements) {
        const text = numEl.textContent?.trim() || '';
        const numMatch = text.match(/^(\d+)$/);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10) || 0;
          if (num < 10000) { // 10000 이상이면 조회수일 가능성
            return num;
          }
        }
      }
      
      // 방법 5: ReplyBox 전체 텍스트에서 숫자 찾기
      const allNumbers = replyText.match(/\d+/g);
      if (allNumbers && allNumbers.length > 0) {
        // 가장 작은 숫자 (댓글 수는 보통 작은 숫자)
        const numbers = allNumbers.map(n => parseInt(n, 10)).filter(n => n < 1000);
        if (numbers.length > 0) {
          return Math.min(...numbers);
        }
      }
      
      return null;
    });
    
    // 2. 실제 댓글 요소 개수 확인 (더 많은 선택자 시도)
    const actualCommentElementsCount = await detailContext.evaluate(() => {
      // 네이버 카페 댓글 선택자 (다양한 패턴 시도)
      const commentSelectors = [
        // 네이버 카페 특정 구조
        'ul.comment_list > li',
        '.comment_list > li',
        '.comment_box > ul > li',
        '.reply_area > ul > li',
        '.CommentBox > ul > li',
        // 일반적인 선택자
        '.CommentItem',
        '.comment_item',
        'li[class*="comment"]',
        'li[class*="Comment"]',
        'li[class*="reply"]',
        'li[class*="Reply"]',
        // 더 구체적인 선택자
        '.comment-content',
        '.reply-content',
        '[data-role="comment"]',
        '[data-role="reply"]'
      ];
      
      let maxCount = 0;
      let foundSelector = null;
      
      for (const selector of commentSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          // 댓글은 보통 1개 이상이고 1000개 미만
          if (elements.length > maxCount && elements.length < 1000) {
            maxCount = elements.length;
            foundSelector = selector;
          }
        } catch (e) {
          // 선택자 오류 무시
        }
      }
      
      // 디버깅 정보
      const replyBox = document.querySelector('.ReplyBox, .replyBox, [class*="ReplyBox"]');
      const debugInfo = {
        maxCount,
        foundSelector,
        replyBoxText: replyBox?.textContent?.substring(0, 150) || '없음',
        replyBoxHTML: replyBox?.innerHTML?.substring(0, 200) || '없음'
      };
      
      return { count: maxCount, debug: debugInfo };
    });
    
    const commentCount = actualCommentElementsCount.count || 0;
    const debugInfo = actualCommentElementsCount.debug || {};
    
    // 3. scrapedComments 수집 (핫토픽인 경우만, 여기서는 간단히 확인만)
    const scrapedCommentsCount = 0; // 실제 수집은 생략
    
    console.log(`✅ 상세 페이지 댓글 수 확인 결과:`);
    console.log(`   ReplyBox에서 추출한 댓글 수: ${actualCommentCount !== null ? actualCommentCount : '없음'}`);
    console.log(`   실제 댓글 요소 개수: ${commentCount}`);
    if (debugInfo.foundSelector) {
      console.log(`   사용된 선택자: ${debugInfo.foundSelector}`);
    }
    if (debugInfo.replyBoxText && debugInfo.replyBoxText !== '없음') {
      console.log(`   ReplyBox 텍스트: ${debugInfo.replyBoxText}`);
    }
    if (debugInfo.replyBoxHTML && debugInfo.replyBoxHTML !== '없음') {
      console.log(`   ReplyBox HTML 일부: ${debugInfo.replyBoxHTML.substring(0, 200)}`);
    }
    
    // 결과 비교 (크롤러와 동일한 우선순위)
    // listPageCount는 위에서 이미 설정되었을 수 있음
    if (typeof listPageCount === 'undefined') {
      listPageCount = 0;
      if (typeof listPageData !== 'undefined' && listPageData) {
        if (listPageData.results && listPageData.results.length > 0) {
          listPageCount = listPageData.results[0].commentCountFromTitle;
        } else if (Array.isArray(listPageData) && listPageData.length > 0) {
          // listPageData가 배열인 경우 (이전 버전 호환)
          listPageCount = listPageData[0].commentCountFromTitle;
        }
      }
    }
    
    console.log(`\n=== 결과 비교 ===`);
    console.log(`1. 리스트 페이지에서 추출한 댓글 수: ${listPageCount}`);
    console.log(`2. 상세 페이지 ReplyBox 댓글 수: ${actualCommentCount !== null ? actualCommentCount : '없음'}`);
    console.log(`3. 실제 댓글 요소 개수: ${commentCount}`);
    console.log(`4. 현재 DB에 저장된 댓글 수: ${issue.commentCount || 0}`);
    
    // 최종 판단 (크롤러와 동일한 우선순위)
    let finalCount = 0;
    let reason = '';
    
    if (scrapedCommentsCount > 0) {
      finalCount = scrapedCommentsCount;
      reason = 'scrapedComments 개수 사용 (가장 정확)';
    } else if (commentCount > 0) {
      finalCount = commentCount;
      reason = '실제 댓글 요소 개수 사용 (가장 정확)';
    } else if (actualCommentCount !== null && actualCommentCount === 0) {
      finalCount = 0;
      reason = 'ReplyBox에서 0 확인';
    } else if (actualCommentCount !== null && actualCommentCount > 0) {
      if (commentCount === 0) {
        finalCount = 0;
        reason = 'ReplyBox에 값이 있지만 실제 댓글 요소가 없음 → 0으로 수정';
      } else {
        finalCount = actualCommentCount;
        reason = 'ReplyBox 값 사용';
      }
    } else if (listPageCount > 0 && commentCount === 0) {
      finalCount = 0;
      reason = '리스트 페이지에 값이 있지만 실제 댓글이 없음 → 0으로 수정';
    } else {
      finalCount = listPageCount;
      reason = '리스트 페이지 값 사용 (검증 불가)';
    }
    
    console.log(`\n=== 최종 판단 ===`);
    console.log(`최종 댓글 수: ${finalCount}`);
    console.log(`사용된 근거: ${reason}`);
    
    if (finalCount !== (issue.commentCount || 0)) {
      console.log(`\n⚠️ DB 값(${issue.commentCount || 0})과 실제 값(${finalCount})이 다릅니다!`);
      console.log(`   → 다음 크롤링 시 자동으로 수정될 예정입니다.`);
    } else {
      console.log(`\n✅ DB 값과 실제 값이 일치합니다.`);
    }
    
  } catch (error) {
    logger.error('댓글 수 추출 테스트 실패', { error: error.message, stack: error.stack });
    console.error('오류 발생:', error);
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  const searchTitle = process.argv[2] || '진짜 배린이인데요';
  testCommentExtraction(searchTitle)
    .then(() => {
      console.log('\n테스트 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('오류 발생:', error);
      process.exit(1);
    });
}

module.exports = { testCommentExtraction };
