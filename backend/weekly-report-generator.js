// 주간 보고서 자동 생성 기능

class WeeklyReportGenerator {
  constructor(dailyReports) {
    this.dailyReports = dailyReports;
  }

  // 날짜 필터링 헬퍼 함수 (일관성 확보 및 중복 제거)
  filterByDateRange(items, startDate, endDate) {
    if (!items || items.length === 0) return [];
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    // 시간 부분 제거하고 날짜만 비교 (일관성 확보)
    const startDateOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDateOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    
    return items.filter(item => {
      if (!item.date) return false;
      
      let itemDate;
      if (typeof item.date === 'number') {
        // Excel 시리얼 날짜 변환
        const excelEpoch = new Date(1900, 0, 1);
        const daysSince1900 = Math.floor(item.date) - 2;
        itemDate = new Date(excelEpoch.getTime() + daysSince1900 * 24 * 60 * 60 * 1000);
      } else {
        itemDate = new Date(item.date);
      }
      
      // 날짜 유효성 검사
      if (isNaN(itemDate.getTime())) return false;
      
      // 날짜만 비교 (시간 제거)
      const itemDateOnly = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate());
      return itemDateOnly >= startDateOnly && itemDateOnly <= endDateOnly;
    });
  }

  // 특정 기간의 일일 보고서를 조회 (모든 mobile_daily 보고서 포함)
  getDailyReportsForPeriod(startDate, endDate, reportType) {
    // mobile_daily의 경우 모든 보고서를 포함 (내부 데이터 필터링으로 처리)
    if (reportType === 'mobile_daily') {
      return this.dailyReports.filter(report => report.reportType === reportType);
    }
    
    // PC의 경우 기존 로직
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    return this.dailyReports.filter(report => {
      const reportDate = new Date(report.date);
      return report.reportType === reportType && 
             reportDate >= start && 
             reportDate <= end;
    });
  }

  // PC 주간 보고서 생성
  generatePCWeeklyReport(startDate, endDate) {
    const pcReports = this.getDailyReportsForPeriod(startDate, endDate, 'pc_daily');
    
    if (pcReports.length === 0) {
      return null;
    }

    // 통계 계산
    const totalIssues = pcReports.reduce((sum, r) => sum + (r.summary?.totalIssues || 0), 0);
    const totalProcessed = pcReports.reduce((sum, r) => sum + (r.summary?.processedCount || 0), 0);
    
    // 주요 이슈 수집
    const majorIssues = pcReports
      .flatMap(r => r.data?.issues || [])
      .filter(issue => issue.severity >= 2);

    return {
      reportType: 'pc_weekly',
      period: `${this.formatDate(startDate)} ~ ${this.formatDate(endDate)}`,
      startDate: this.formatDate(startDate),
      endDate: this.formatDate(endDate),
      dailyReportCount: pcReports.length,
      statistics: {
        totalIssues,
        totalProcessed,
        processingRate: totalIssues > 0 ? ((totalProcessed / totalIssues) * 100).toFixed(1) + '%' : '0%',
        averageDailyIssues: (totalIssues / pcReports.length).toFixed(1),
      },
      majorIssues: majorIssues.slice(0, 20), // 상위 20개
      dailyReports: pcReports.map(r => ({
        date: r.date,
        issuesCount: r.summary?.totalIssues || 0,
        processedCount: r.summary?.processedCount || 0,
      })),
    };
  }

  // Mobile 주간 보고서 생성
  generateMobileWeeklyReport(startDate, endDate) {
    const mobileReports = this.getDailyReportsForPeriod(startDate, endDate, 'mobile_daily');
    
    if (mobileReports.length === 0) {
      console.log('Mobile 일일 보고서가 없습니다');
      return null;
    }
    
    console.log(`Mobile 일일 보고서 ${mobileReports.length}개 발견`);

    // 모든 시트 데이터 수집
    const allVOCRaw = mobileReports.flatMap(r => r.data?.voc || []);
    const allIssuesRaw = mobileReports.flatMap(r => r.data?.issue || []);
    const allDataRaw = mobileReports.flatMap(r => r.data?.data || []);
    
    console.log('Raw 데이터:', {
      vocCount: allVOCRaw.length,
      issuesCount: allIssuesRaw.length,
      dataCount: allDataRaw.length
    });

    console.log('필터링 전 VOC 샘플:', allVOCRaw.slice(0, 3).map(v => ({ date: v.date, dateType: typeof v.date })));
    console.log('필터링 기간:', startDate, '~', endDate);
    
    const allVOC = allVOCRaw.filter(item => {
      if (!item.date) return false;
      
      // 날짜가 숫자(Excel 시리얼 날짜)인 경우 처리
      let itemDate;
      if (typeof item.date === 'number') {
        // Excel 시리얼 날짜를 실제 날짜로 변환
        // Excel 시리얼 날짜는 1900-01-01을 기준으로 함
        const excelEpoch = new Date(1900, 0, 1);
        const daysSince1900 = Math.floor(item.date) - 2; // Excel은 1900년을 윤년으로 계산
        itemDate = new Date(excelEpoch.getTime() + daysSince1900 * 24 * 60 * 60 * 1000);
      } else {
        itemDate = new Date(item.date);
      }
      
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      return itemDate >= start && itemDate <= end;
    });

    const allIssues = allIssuesRaw.filter(item => {
      if (!item.date) return false;
      
      // 날짜가 숫자(Excel 시리얼 날짜)인 경우 처리
      let itemDate;
      if (typeof item.date === 'number') {
        const excelEpoch = new Date(1900, 0, 1);
        const daysSince1900 = Math.floor(item.date) - 2;
        itemDate = new Date(excelEpoch.getTime() + daysSince1900 * 24 * 60 * 60 * 1000);
      } else {
        itemDate = new Date(item.date);
      }
      
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      return itemDate >= start && itemDate <= end;
    });

    // Data 시트 필터링 (allDataRaw는 이미 79번 줄에서 선언됨)
    console.log('필터링 전 Data 샘플:', allDataRaw.slice(0, 3).map(d => ({ 
      date: d.date, 
      dateType: typeof d.date,
      category: d.category 
    })));
    
    // Data 시트 필터링 (VOC와 동일한 기간 필터 적용)
    const allData = allDataRaw.filter(item => {
        if (!item.date) return false;
        
        // 날짜가 숫자(Excel 시리얼 날짜)인 경우 처리
        let itemDate;
        if (typeof item.date === 'number') {
          const excelEpoch = new Date(1900, 0, 1);
          const daysSince1900 = Math.floor(item.date) - 2;
          itemDate = new Date(excelEpoch.getTime() + daysSince1900 * 24 * 60 * 60 * 1000);
        } else {
          itemDate = new Date(item.date);
        }
        
        // 날짜가 유효하지 않으면 false
        if (isNaN(itemDate.getTime())) return false;
        
        // VOC와 동일한 기간 필터 적용
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // 시간 부분을 제거하고 날짜만 비교
        const itemDateOnly = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate());
        const startDateOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endDateOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        
        return itemDateOnly >= startDateOnly && itemDateOnly <= endDateOnly;
      });

    console.log('필터링 후 데이터:', {
      vocCount: allVOC.length,
      issuesCount: allIssues.length,
      dataCount: allData.length
    });

    // 필터링 후 데이터가 없으면 null 반환
    if (allVOC.length === 0 && allIssues.length === 0) {
      console.log('해당 기간에 VOC와 Issue 데이터가 없습니다');
      return null;
    }

    // 1. 성향별 집계 (전체 텍스트로 매칭)
    const sentimentStats = {
      긍정: allVOC.filter(v => String(v.sentiment || '').includes('긍정') || String(v.sentiment || '').includes('pos')).length,
      부정: allVOC.filter(v => String(v.sentiment || '').includes('부정') || String(v.sentiment || '').includes('neg')).length,
      중립: allVOC.filter(v => String(v.sentiment || '').includes('중립') || String(v.sentiment || '').includes('neu')).length
    };

    // 2. 이슈별 집계
    const issueStats = {
      '게임 플레이 문의 유료화 아이템': 
        allVOC.filter(v => ['유료', '컨텐츠'].includes(v.category)).length,
      '버그': 
        allIssues.filter(i => i.category === '버그').length,
      '서버/접속 이용 제한 조치 불법프로그램': 
        allVOC.filter(v => v.category === '서버').length,
      '비매너 이용자 및 이스포츠': 
        allVOC.filter(v => ['커뮤니티', '이스포츠'].includes(v.category)).length,
      '기타': 
        allVOC.filter(v => !['유료', '컨텐츠', '서버', '커뮤니티', '이스포츠'].includes(v.category)).length
    };

    // 3. 주요 이슈 건수 증감 (간단 버전)
    const majorIssueStats = {
      '유료 아이템': allVOC.filter(v => v.category === '유료').length,
      '게임 플레이 관련 문의': allVOC.filter(v => v.category === '컨텐츠').length,
      '버그': allIssues.filter(i => i.category === '버그').length,
      '서버/접속': allVOC.filter(v => v.category === '서버').length + 
                   allIssues.filter(i => i.category === '서버').length,
      '커뮤니티/이스포츠': allVOC.filter(v => ['커뮤니티', '이스포츠'].includes(v.category)).length,
      '불법프로그램': 0, // Cheat&Abuse 시트 사용 안 함
      '비매너 행위': allVOC.filter(v => v.subcategory && v.subcategory.includes('비매너')).length,
      '이용 제한 조치': allVOC.filter(v => v.subcategory && v.subcategory.includes('이용제한')).length,
      '타게임': allVOC.filter(v => v.category === '타게임').length
    };

    // 4. 공유 이슈 (Severity 1-2가 있는 항목만)
    const sharedIssues = [...allIssues, ...allVOC]
      .filter(issue => {
        // severity가 없으면 제외
        const severity = issue.severity;
        if (!severity) return false;
        // 숫자로 변환 시도
        const severityNum = Number(severity);
        return !isNaN(severityNum) && severityNum <= 2;
      })
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .map(issue => ({
        title: issue.title || issue.content || issue.summary || '(제목 없음)',
        date: issue.date || '',
        status: '공유 완료'
      }))
      .slice(0, 30); // 최대 30개만

    // 5. 부정/긍정/기타 동향
    const negativeTrends = allVOC.filter(v => String(v.sentiment || '').includes('부정') || String(v.sentiment || '').includes('neg'));
    const positiveTrends = allVOC.filter(v => String(v.sentiment || '').includes('긍정') || String(v.sentiment || '').includes('pos'));
    const neutralTrends = allVOC.filter(v => String(v.sentiment || '').includes('중립') || String(v.sentiment || '').includes('neu'));

    // 6. 모니터링 업무 현황 (Data 시트에서 추출)
    const totalCollected = allVOC.length; // VOC 건수로 대체

    return {
      reportType: 'mobile_weekly',
      period: `${this.formatDate(startDate)} ~ ${this.formatDate(endDate)}`,
      startDate: this.formatDate(startDate),
      endDate: this.formatDate(endDate),
      dailyReportCount: mobileReports.length,
      
      // 차트 데이터
      charts: {
        sentimentStats, // 성향별 동향
        issueStats      // 이슈별 동향
      },
      
      // 통계
      statistics: {
        totalCollected,
        vocCount: allVOC.length,
        issueCount: allIssues.length,
        dataCount: allData.length
      },
      
      // 주요 이슈
      majorIssueStats,
      
      // 공유 이슈
      sharedIssues: sharedIssues.slice(0, 30),
      
      // 동향 요약
      trends: {
        negative: negativeTrends,
        positive: positiveTrends,
        neutral: neutralTrends
      },
      
      // VoC 전체 데이터
      voc: allVOC.sort((a, b) => new Date(a.date) - new Date(b.date)),
      
      // Data 시트 데이터
      data: allData.sort((a, b) => new Date(a.date) - new Date(b.date)),
      
      // 일별 요약
      dailyReports: mobileReports.map(r => {
        // 날짜별로 VOC와 Issue 데이터를 기간 필터링해서 카운트
        const vocInPeriod = (r.data?.voc || []).filter(item => {
          if (!item.date) return false;
          const itemDate = new Date(item.date);
          return itemDate >= new Date(startDate) && itemDate <= new Date(endDate);
        });
        const issuesInPeriod = (r.data?.issue || []).filter(item => {
          if (!item.date) return false;
          const itemDate = new Date(item.date);
          return itemDate >= new Date(startDate) && itemDate <= new Date(endDate);
        });
        
        const issuesCount = vocInPeriod.length + issuesInPeriod.length;
        
        // 디버깅 로그
        if (issuesCount > 1000) {
          console.log('비정상적인 이슈 수:', {
            date: r.date,
            vocCount: vocInPeriod.length,
            issueCount: issuesInPeriod.length,
            total: issuesCount,
            vocSample: vocInPeriod.slice(0, 3),
            issueSample: issuesInPeriod.slice(0, 3)
          });
        }
        
        return {
          date: r.date,
          issuesCount: issuesCount,
          processedCount: 0
        };
      }).filter(d => d.issuesCount > 0)
    };
  }

  formatDate(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 최근 주간 보고서 생성 (지난 주)
  generateLastWeekReport(reportType) {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() - today.getDay()); // 지난 주 일요일
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6); // 지난 주 월요일

    if (reportType === 'pc') {
      return this.generatePCWeeklyReport(startDate, endDate);
    } else {
      return this.generateMobileWeeklyReport(startDate, endDate);
    }
  }
}

module.exports = WeeklyReportGenerator;

