const { google } = require('googleapis');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

async function analyzeChannel() {
  const channelId = process.argv[2] || 'UCMswODzU1ZjjrLyUk7NfwPA';
  
  try {
    // 채널 정보 조회
    const channelResponse = await youtube.channels.list({
      part: ['snippet', 'contentDetails'],
      id: [channelId]
    });
    
    if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
      console.log('❌ 채널을 찾을 수 없습니다');
      return;
    }
    
    const channel = channelResponse.data.items[0];
    console.log('='.repeat(80));
    console.log('채널 정보:');
    console.log('='.repeat(80));
    console.log('채널명:', channel.snippet.title);
    console.log('채널 ID:', channelId);
    console.log('');
    
    // 최근 영상 20개 조회
    const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
    const videosResponse = await youtube.playlistItems.list({
      part: ['snippet'],
      playlistId: uploadsPlaylistId,
      maxResults: 20
    });
    
    if (!videosResponse.data.items || videosResponse.data.items.length === 0) {
      console.log('❌ 영상을 찾을 수 없습니다');
      return;
    }
    
    const videoIds = videosResponse.data.items
      .map(item => item.snippet.resourceId.videoId)
      .filter(id => id);
    
    // 영상 상세 정보 조회
    const videosDetailResponse = await youtube.videos.list({
      part: ['snippet', 'statistics'],
      id: videoIds
    });
    
    const videos = videosDetailResponse.data.items || [];
    
    console.log('='.repeat(80));
    console.log(`최근 영상 ${videos.length}개 분석:`);
    console.log('='.repeat(80));
    console.log('');
    
    // isBattlegroundsRelated 함수 로직
    const battlegroundsKeywords = [
      '배그', '배틀그라운드', 'pubg', 'battlegrounds',
      '배틀그라운드 모바일', 'pubg mobile', 'pubg: battlegrounds',
      '배틀그라운드 pc', 'pubg pc', 'pubg:new state',
      '배틀그라운드 뉴스테이트', 'new state',
      '에란겔', '미라마', '사녹', '비켄디', '타이고', '태이고', '데스턴', '카라킨', '파라모', '헤이븐', '리비에라',
      'erangel', 'miramar', 'sanhok', 'vikendi', 'taego', 'deston', 'karakin', 'paramo', 'haven', 'riviera',
      '배그 패치', 'pubg patch', '배틀그라운드 패치',
      '배그 업데이트', 'pubg update', '배틀그라운드 업데이트',
      '배그 공지', 'pubg notice', '배틀그라운드 공지',
      '배그 이벤트', 'pubg event', '배틀그라운드 이벤트'
    ];
    
    const checkKeyword = (keyword, text) => {
      if (/^[a-z0-9\s:]+$/i.test(keyword)) {
        if (keyword.includes(' ')) {
          const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedKeyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
          return regex.test(text);
        } else {
          const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          return regex.test(text);
        }
      } else {
        const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // lookahead를 사용하여 "태이고에서" 같은 경우도 매칭되도록 개선
        const regex = new RegExp(`(^|[^\\w가-힣])${escapedKeyword}(?=[^\\w가-힣]|$)|^${escapedKeyword}`, 'i');
        return regex.test(text);
      }
    };
    
    let battlegroundsCount = 0;
    let otherCount = 0;
    const videoClassificationResults = [];
    
    videos.forEach((video, index) => {
      const title = video.snippet?.title || '';
      const titleLower = title.toLowerCase();
      const fullDescription = (video.snippet?.description || '').toLowerCase();
      const tags = (video.snippet?.tags || []).join(' ').toLowerCase();
      const description = fullDescription.substring(0, 500);
      const titleAndDescription = `${titleLower} ${description}`;
      
      // 제목과 설명에서 확인
      let foundInTitleOrDescription = false;
      if (video.snippet.title.includes('태이고')) {
        console.log(`   [DEBUG] titleAndDescription: "${titleAndDescription}"`);
        console.log(`   [DEBUG] 키워드 리스트에 태이고 있음: ${battlegroundsKeywords.includes('태이고')}`);
      }
      foundInTitleOrDescription = battlegroundsKeywords.some(keyword => {
        const result = checkKeyword(keyword, titleAndDescription);
        // 디버깅: 태이고 관련
        if (video.snippet.title.includes('태이고') && keyword === '태이고') {
          console.log(`   [DEBUG] 키워드 '${keyword}' 매칭 테스트: ${result}`);
        }
        return result;
      });
      if (video.snippet.title.includes('태이고')) {
        console.log(`   [DEBUG] foundInTitleOrDescription: ${foundInTitleOrDescription}`);
      }
      
      let isBG = false;
      let matchedKeyword = null;
      let matchSource = null;
      
      if (foundInTitleOrDescription) {
        isBG = true;
        matchedKeyword = battlegroundsKeywords.find(keyword => 
          checkKeyword(keyword, titleAndDescription)
        );
        matchSource = 'title/description';
      } else {
        // 태그에서 확인
        const foundInTags = battlegroundsKeywords.some(keyword => 
          checkKeyword(keyword, tags)
        );
        if (foundInTags) {
          isBG = true;
          matchedKeyword = battlegroundsKeywords.find(keyword => 
            checkKeyword(keyword, tags)
          );
          matchSource = 'tags';
        }
      }
      
      if (isBG) {
        battlegroundsCount++;
      } else {
        otherCount++;
      }
      
      // 분류 결과 저장
      videoClassificationResults.push({
        video,
        isBG,
        matchedKeyword,
        matchSource
      });
      
      console.log(`${index + 1}. [${isBG ? '배그' : '그외'}] ${video.snippet.title.substring(0, 60)}...`);
      if (matchedKeyword) {
        console.log(`   매칭 키워드: ${matchedKeyword} (${matchSource})`);
      } else {
        console.log(`   키워드 없음`);
        // 디버깅: 태이고 관련 영상 상세 확인
        if (video.snippet.title.includes('태이고')) {
          console.log(`   [DEBUG] 제목: ${title}`);
          console.log(`   [DEBUG] titleLower: ${titleLower}`);
          console.log(`   [DEBUG] description: ${description || '(없음)'}`);
          console.log(`   [DEBUG] titleAndDescription: ${titleAndDescription}`);
          console.log(`   [DEBUG] 태이고 매칭 테스트: ${checkKeyword('태이고', titleAndDescription)}`);
        }
      }
      console.log(`   제목: ${video.snippet.title.substring(0, 80)}`);
      if (video.snippet.description) {
        console.log(`   설명(앞부분): ${video.snippet.description.substring(0, 100)}...`);
      }
      if (video.snippet.tags && video.snippet.tags.length > 0) {
        console.log(`   태그: ${video.snippet.tags.slice(0, 10).join(', ')}`);
      }
      console.log('');
    });
    
    console.log('='.repeat(80));
    console.log(`분류 결과: 배틀그라운드 ${battlegroundsCount}개, 그외 ${otherCount}개`);
    console.log('='.repeat(80));
    
    // 문제가 있는 영상들 상세 분석
    console.log('');
    console.log('='.repeat(80));
    console.log('문제 영상 상세 분석:');
    console.log('='.repeat(80));
    console.log('');
    
    const problemKeywords = ['태이고', '보급', '석궁', '글라이더'];
    const problemVideos = videoClassificationResults.filter(result => {
      const title = result.video.snippet.title.toLowerCase();
      const hasProblemKeyword = problemKeywords.some(kw => title.includes(kw.toLowerCase()));
      return hasProblemKeyword && !result.isBG;
    });
    
    problemVideos.forEach((result, index) => {
      const video = result.video;
      const title = video.snippet.title;
      const titleLower = title.toLowerCase();
      const description = (video.snippet.description || '').substring(0, 500).toLowerCase();
      const tags = (video.snippet.tags || []).join(' ').toLowerCase();
      
      console.log(`${index + 1}. ${title}`);
      console.log(`   제목: ${title}`);
      console.log(`   설명(앞부분): ${video.snippet.description?.substring(0, 150) || '없음'}...`);
      console.log(`   태그: ${video.snippet.tags?.slice(0, 10).join(', ') || '없음'}`);
      
      // 맵 이름 확인
      const mapKeywords = ['에란겔', '미라마', '사녹', '비켄디', '타이고', '데스턴', '카라킨', '파라모', '헤이븐', '리비에라',
        'erangel', 'miramar', 'sanhok', 'vikendi', 'taego', 'deston', 'karakin', 'paramo', 'haven', 'riviera'];
      
      console.log('   맵 이름 매칭 확인:');
      let foundMap = false;
      mapKeywords.forEach(mapName => {
        const inTitle = checkKeyword(mapName, titleLower);
        const inDescription = checkKeyword(mapName, description);
        const inTags = checkKeyword(mapName, tags);
        
        if (inTitle || inDescription || inTags) {
          foundMap = true;
          console.log(`     ✅ ${mapName}: 제목=${inTitle}, 설명=${inDescription}, 태그=${inTags}`);
        }
      });
      
      if (!foundMap) {
        console.log('     ❌ 맵 이름 매칭 없음');
      }
      
      console.log('');
    });
    
  } catch (error) {
    console.error('오류:', error.message);
    if (error.response) {
      console.error('응답:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

analyzeChannel();
