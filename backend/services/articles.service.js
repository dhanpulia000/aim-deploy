// Articles 서비스 (커뮤니티 스크래핑 데이터 처리)

const { prisma, executeTransaction } = require('../libs/db');
const { parseArticlesFile } = require('../utils/articles-parser');
const { enrichIssuesWithCategories } = require('../utils/keyword-categorizer');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const classificationRulesService = require('./classification-rules.service');

/**
 * 스크래핑된 커뮤니티 데이터를 이슈로 변환하여 저장
 * @param {string} filePath - Excel 파일 경로
 * @param {string} agentId - 에이전트 ID
 * @returns {Promise<Object>} 저장 결과
 */
async function importArticlesAsIssues(filePath, agentId = 'system', projectId = null) {
  try {
    // 파일 존재 확인
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    logger.info('Importing articles from file', { filePath, agentId, projectId });
    
    // 파일 파싱
    const issues = parseArticlesFile(filePath);
    logger.info('Articles parsed', { count: issues.length });
    
    if (issues.length === 0) {
      return {
        success: true,
        message: 'No valid articles to import',
        imported: 0,
        skipped: 0
      };
    }
    
    // 카테고리 자동 분류 적용
    const enrichedIssues = enrichIssuesWithCategories(issues);
    
    // 보고서 생성 (스크래핑 데이터용)
    const reportDate = new Date().toISOString().split('T')[0];
    const fileName = path.basename(filePath);
    
    const normalizedProjectId = projectId !== null && projectId !== undefined && projectId !== ''
      ? Number(projectId)
      : null;
    if (projectId && Number.isNaN(normalizedProjectId)) {
      throw new Error('Invalid projectId');
    }

    const activeRules = normalizedProjectId
      ? await classificationRulesService.loadActiveRules(normalizedProjectId)
      : [];

    let report;
    let importedCount = 0;
    let skippedCount = 0;
    
    try {
      report = await executeTransaction(async (tx) => {
        // Agent가 존재하는지 확인하고 없으면 생성
        let agent = await tx.agent.findUnique({
          where: { id: agentId }
        });
        
        if (!agent) {
          agent = await tx.agent.create({
            data: {
              id: agentId,
              name: agentId === 'system' ? 'System' : agentId,
              status: 'offline',
              isActive: true
            }
          });
          logger.info('Agent created', { agentId: agent.id, name: agent.name });
        }
        
        // 보고서 생성
        const newReport = await tx.report.create({
          data: {
            agentId,
            date: reportDate,
            fileType: 'community_scraped',
            fileName,
            reportType: 'community_scraped',
            status: 'processed'
          }
        });
        
        // 이슈 저장
        const issueData = enrichedIssues.map(issue => ({
          reportId: newReport.id,
          date: issue.date || reportDate,
          category: issue.category || '기타',
          detail: issue.detail || '',
          testResult: '',
          summary: issue.summary || '',
          link: issue.link || '',
          time: issue.time || '',
          severity: issue.severity || 3,
          source: issue.source || 'system',
          status: issue.status || 'new',
          sentiment: issue.sentiment || 'neu'
        }));
        
        // 중복 확인 (이미 존재하는 링크는 스킵, 링크가 없는 경우는 항상 저장)
        const linksToCheck = issueData.map(i => i.link).filter(Boolean);
        let existingLinks = new Set();
        
        if (linksToCheck.length > 0) {
          const existingIssues = await tx.reportItemIssue.findMany({
            where: {
              link: {
                in: linksToCheck
              }
            },
            select: { link: true }
          });
          existingLinks = new Set(existingIssues.map(i => i.link));
        }
        
        // 링크가 없거나 중복되지 않은 항목만 저장
        const uniqueIssues = issueData.filter(i => {
          if (!i.link || i.link === '') {
            // 링크가 없는 경우는 항상 저장 (중복 체크 불가)
            return true;
          }
          return !existingLinks.has(i.link);
        });
        
        if (uniqueIssues.length > 0) {
          const issuesWithRules = uniqueIssues.map((issue) => {
            const baseSeverity = Number(issue.severity);
            const fallbackSeverity = Number.isNaN(baseSeverity) ? 3 : baseSeverity;

            const ruleResult = classificationRulesService.applyRules(
              activeRules,
              issue.summary,
              issue.detail,
              issue.category,
              fallbackSeverity
            );

            const severityFromRule = ruleResult.severity !== undefined ? Number(ruleResult.severity) : undefined;
            const normalizedSeverity = Number.isNaN(severityFromRule) ? fallbackSeverity : severityFromRule;
            const normalizedStatus = typeof issue.status === 'string' ? issue.status.toUpperCase() : 'OPEN';

            return {
              ...issue,
              projectId: normalizedProjectId || undefined,
              category: ruleResult.category || issue.category,
              severity: normalizedSeverity,
              status: normalizedStatus
            };
          });

          await tx.reportItemIssue.createMany({
            data: issuesWithRules
          });
        }
        
        importedCount = uniqueIssues.length;
        skippedCount = issueData.length - uniqueIssues.length;
        
        logger.info('Articles imported', { 
          reportId: newReport.id, 
          imported: importedCount,
          skipped: skippedCount
        });
        
        return newReport;
      });
    } catch (dbError) {
      logger.error('Failed to save articles to database', { error: dbError.message });
      throw dbError;
    }
    
    return {
      success: true,
      message: 'Articles imported successfully',
      reportId: report.id,
      imported: importedCount,
      skipped: skippedCount,
      total: enrichedIssues.length
    };
  } catch (error) {
    logger.error('Failed to import articles', { error: error.message, filePath });
    throw error;
  }
}

/**
 * 커뮤니티 데이터 파일 목록 조회
 * @returns {Promise<Array>} 파일 목록
 */
async function getAvailableArticleFiles() {
  const dataDir = path.join(__dirname, '..', '..', 'data');
  const files = fs.readdirSync(dataDir).filter(file => 
    file.startsWith('articles_') && file.endsWith('.xlsx')
  );
  
  return files.map(file => ({
    name: file,
    path: path.join(dataDir, file),
    size: fs.statSync(path.join(dataDir, file)).size,
    modified: fs.statSync(path.join(dataDir, file)).mtime
  }));
}

module.exports = {
  importArticlesAsIssues,
  getAvailableArticleFiles
};




