/**
 * 공지사항(CustomerFeedbackNotice) ↔ WorkGuide(RAG) 동기화 서비스
 * - 공지 생성/수정 시: 대응하는 WorkGuide 생성 또는 업데이트 + 임베딩 생성
 * - 공지 삭제 시: 대응하는 WorkGuide 및 임베딩 삭제
 */

const { query } = require('../libs/db');
const logger = require('../utils/logger');
const { getWorkGuideService } = require('./workGuide.service');

let singleton = null;

class NoticeGuideSyncService {
  constructor() {
    this.workGuideService = getWorkGuideService();
  }

  /**
   * CustomerFeedbackNotice 레코드를 가이드 payload로 변환
   * @param {Object} notice
   */
  buildGuidePayloadFromNotice(notice) {
    if (!notice) return null;

    const {
      id,
      title: noticeTitle,
      gameName,
      managerName,
      category,
      content,
      noticeDate,
      screenshotPath,
      slackChannelId,
      slackTeamId
    } = notice;

    const dateStr = noticeDate
      ? new Date(noticeDate).toISOString().slice(0, 10)
      : '';

    const titleParts = [];
    if (noticeTitle && String(noticeTitle).trim()) titleParts.push(String(noticeTitle).trim());
    if (gameName) titleParts.push(gameName);
    if (category) titleParts.push(category);
    if (dateStr) titleParts.push(dateStr);
    const title =
      titleParts.length > 0
        ? `[공지] ${titleParts.join(' / ')}`
        : '[공지] 고객 피드백 공지';

    const lines = [];
    lines.push('[고객 피드백 공지사항]');
    if (gameName) lines.push(`게임: ${gameName}`);
    if (managerName) lines.push(`담당자: ${managerName}`);
    if (category) lines.push(`카테고리: ${category}`);
    if (dateStr) lines.push(`공지 일자: ${dateStr}`);
    lines.push('');
    lines.push('내용:');
    lines.push((content || '').trim());
    lines.push('');
    const metaLines = [];
    if (screenshotPath) metaLines.push(`스크린샷: ${screenshotPath}`);
    if (slackChannelId) metaLines.push(`Slack 채널 ID: ${slackChannelId}`);
    if (slackTeamId) metaLines.push(`Slack 팀 ID: ${slackTeamId}`);
    if (metaLines.length > 0) {
      lines.push(metaLines.join(' | '));
    }

    const guideContent = lines.join('\n').trim();

    const tags = ['NOTICE'];
    if (gameName) tags.push(gameName);
    if (category) tags.push(category);

    const metadata = {
      source: 'CustomerFeedbackNotice',
      noticeId: id,
      gameName,
      managerName,
      category,
      noticeDate: dateStr || null
    };

    return {
      title,
      content: guideContent,
      guideType: 'notice',
      priority: 5,
      tags,
      metadata
    };
  }

  /**
   * noticeId로 대응하는 WorkGuide ID 찾기
   * (guideType = 'notice' + metadata.source / noticeId 검사)
   */
  findGuideIdByNoticeId(noticeId) {
    const guides = this.workGuideService.listGuides({ guideType: 'notice' });
    const targetId = String(noticeId);
    for (const guide of guides) {
      let meta = {};
      try {
        meta =
          typeof guide.metadata === 'string'
            ? JSON.parse(guide.metadata || '{}')
            : guide.metadata || {};
      } catch {
        meta = {};
      }
      if (
        meta &&
        meta.source === 'CustomerFeedbackNotice' &&
        String(meta.noticeId) === targetId
      ) {
        return guide.id;
      }
    }
    return null;
  }

  /**
   * 단일 공지사항을 WorkGuide와 동기화 (생성 또는 업데이트)
   */
  async syncFromNotice(notice) {
    if (!notice) return null;
    const payload = this.buildGuidePayloadFromNotice(notice);
    if (!payload || !payload.content) {
      logger.warn('[NoticeGuideSync] Empty payload from notice, skip', {
        noticeId: notice.id
      });
      return null;
    }

    const existingGuideId = this.findGuideIdByNoticeId(notice.id);

    if (existingGuideId) {
      logger.info('[NoticeGuideSync] Updating notice guide', {
        noticeId: notice.id,
        guideId: existingGuideId
      });
      return this.workGuideService.updateGuide(existingGuideId, payload);
    }

    logger.info('[NoticeGuideSync] Creating notice guide', {
      noticeId: notice.id
    });
    return this.workGuideService.createGuide(payload);
  }

  /**
   * 공지사항 삭제 시 대응하는 WorkGuide/임베딩 삭제
   */
  async deleteForNotice(noticeId) {
    const guideId = this.findGuideIdByNoticeId(noticeId);
    if (!guideId) {
      logger.debug('[NoticeGuideSync] No guide found for notice, skip delete', {
        noticeId
      });
      return;
    }

    logger.info('[NoticeGuideSync] Deleting notice guide', {
      noticeId,
      guideId
    });
    await this.workGuideService.deleteGuide(guideId);
  }
}

function getNoticeGuideSyncService() {
  if (!singleton) {
    singleton = new NoticeGuideSyncService();
  }
  return singleton;
}

module.exports = {
  getNoticeGuideSyncService
};

