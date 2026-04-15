// 업무 알림 컨트롤러

const workNotificationService = require('../services/workNotification.service');
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');
const logger = require('../utils/logger');

/**
 * 모든 업무 알림 조회
 */
async function getAllNotifications(req, res) {
  try {
    const { includeInactive = 'false', includeSent = 'true' } = req.query;
    
    const notifications = await workNotificationService.getAllNotifications({
      includeInactive: includeInactive === 'true',
      includeSent: includeSent === 'true'
    });
    
    return sendSuccess(res, notifications, '업무 알림 목록을 조회했습니다.');
  } catch (error) {
    logger.error('[WorkNotificationController] Failed to get all notifications', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, '업무 알림 목록 조회에 실패했습니다.', error.message);
  }
}

/**
 * 업무 알림 생성
 */
async function createNotification(req, res) {
  try {
    const {
      workName,
      repeatType,
      notificationDate,
      notificationTime,
      startDate,
      endDate,
      dayOfWeek,
      dayOfMonth,
      intervalMinutes,
      windowStartTime,
      windowEndTime,
      lineChannelId,
      discordWebhookUrl,
      discordMention,
      message,
      isActive
    } = req.body;
    
    const hasLine = lineChannelId && String(lineChannelId).trim();
    const hasDiscord = discordWebhookUrl && String(discordWebhookUrl).trim();
    if (!workName) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, '업무명은 필수입니다.');
    }
    if (!hasLine && !hasDiscord) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Line 채널 ID 또는 Discord 웹훅 URL 중 하나는 필수입니다.');
    }
    
    const notification = await workNotificationService.createNotification({
      workName,
      repeatType,
      notificationDate,
      notificationTime,
      startDate,
      endDate,
      dayOfWeek,
      dayOfMonth,
      intervalMinutes,
      windowStartTime,
      windowEndTime,
      lineChannelId: hasLine ? lineChannelId : '',
      discordWebhookUrl: hasDiscord ? discordWebhookUrl : null,
      discordMention: discordMention && String(discordMention).trim() ? discordMention.trim() : null,
      message,
      isActive
    });
    
    return sendSuccess(res, notification, '업무 알림이 등록되었습니다.');
  } catch (error) {
    logger.error('[WorkNotificationController] Failed to create notification', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, '업무 알림 등록에 실패했습니다.', error.message);
  }
}

/**
 * 업무 알림 수정
 */
async function updateNotification(req, res) {
  try {
    const { notificationId } = req.params;
    const updateData = req.body;
    
    const notification = await workNotificationService.updateNotification(notificationId, updateData);
    
    if (!notification) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, '업무 알림을 찾을 수 없습니다.');
    }
    
    return sendSuccess(res, notification, '업무 알림이 수정되었습니다.');
  } catch (error) {
    logger.error('[WorkNotificationController] Failed to update notification', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, '업무 알림 수정에 실패했습니다.', error.message);
  }
}

/**
 * 업무 알림 삭제
 */
async function deleteNotification(req, res) {
  try {
    const { notificationId } = req.params;
    
    await workNotificationService.deleteNotification(notificationId);
    
    return sendSuccess(res, null, '업무 알림이 삭제되었습니다.');
  } catch (error) {
    logger.error('[WorkNotificationController] Failed to delete notification', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, '업무 알림 삭제에 실패했습니다.', error.message);
  }
}

/**
 * 현재 KST 시각 계산 (getPendingNotifications와 동일한 기준)
 */
function getCurrentKst() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  const h = parts.find(p => p.type === 'hour').value;
  const min = parts.find(p => p.type === 'minute').value;
  return { currentKstDate: `${y}-${m}-${d}`, currentKstTime: `${h}:${min}` };
}

/**
 * 전송 대기 중인 알림 조회 (시간 기준 검증용: 현재 KST 시각·대기 건수 포함)
 */
async function getPendingNotifications(req, res) {
  try {
    const notifications = await workNotificationService.getPendingNotifications();
    const { currentKstDate, currentKstTime } = getCurrentKst();
    return sendSuccess(res, {
      pending: notifications,
      currentKstDate,
      currentKstTime,
      pendingCount: notifications.length
    }, '전송 대기 중인 알림 목록을 조회했습니다.');
  } catch (error) {
    logger.error('[WorkNotificationController] Failed to get pending notifications', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, '전송 대기 중인 알림 조회에 실패했습니다.', error.message);
  }
}

module.exports = {
  getAllNotifications,
  createNotification,
  updateNotification,
  deleteNotification,
  getPendingNotifications
};
