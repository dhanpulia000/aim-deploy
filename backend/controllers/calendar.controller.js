const { query, queryOne, execute } = require('../libs/db');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const logger = require('../utils/logger');

/**
 * GET /api/calendar/events
 * 권한: 로그인한 모든 사용자
 */
function listEvents(req, res) {
  try {
    const { startDate, endDate } = req.query || {};
    let sql = 'SELECT * FROM CalendarEvent WHERE 1=1';
    const params = [];

    if (startDate) {
      sql += ' AND endDate >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND startDate <= ?';
      params.push(endDate);
    }
    sql += ' ORDER BY startDate ASC';

    const events = query(sql, params);
    return sendSuccess(res, { events }, 'Events retrieved successfully');
  } catch (err) {
    logger.error('Calendar list events failed', { error: err.message });
    return sendError(res, 'Failed to retrieve events', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * POST /api/calendar/events
 * 권한: ADMIN, LEAD
 */
function createEvent(req, res) {
  try {
    const { platform, startDate, endDate, title, link, lineChannelId, discordWebhookUrl, discordMention, message } =
      req.body || {};

    if (!platform || !['PC', 'MO'].includes(platform)) {
      return sendValidationError(res, [{ field: 'platform', message: 'platform must be PC or MO' }]);
    }
    if (!startDate || !endDate) {
      return sendValidationError(res, [{ field: 'date', message: 'startDate and endDate are required' }]);
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return sendValidationError(res, [{ field: 'title', message: 'title is required' }]);
    }
    if (new Date(startDate) > new Date(endDate)) {
      return sendValidationError(res, [{ field: 'date', message: 'endDate must be after startDate' }]);
    }

    const linkVal = link && String(link).trim() ? String(link).trim() : null;
    const titleVal = String(title).trim();
    const lineVal = lineChannelId && String(lineChannelId).trim() ? String(lineChannelId).trim() : null;
    const discordWebhookVal =
      discordWebhookUrl && String(discordWebhookUrl).trim() ? String(discordWebhookUrl).trim() : null;
    const discordMentionVal =
      discordMention && String(discordMention).trim() ? String(discordMention).trim() : null;
    const messageVal = message !== undefined ? message : null;

    if (!lineVal && !discordWebhookVal) {
      return sendValidationError(res, [
        { field: 'notificationTarget', message: 'lineChannelId or discordWebhookUrl is required for auto work notification' },
      ]);
    }

    const { lastInsertRowid } = execute(
      `INSERT INTO CalendarEvent (platform, startDate, endDate, title, link, updatedAt)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [platform, startDate, endDate, titleVal, linkVal]
    );

    // Store notification fields (migration 017)
    try {
      execute(
        `UPDATE CalendarEvent
         SET lineChannelId = ?, discordWebhookUrl = ?, discordMention = ?, message = ?, updatedAt = datetime('now')
         WHERE id = ?`,
        [lineVal, discordWebhookVal, discordMentionVal, messageVal, lastInsertRowid]
      );
    } catch (e) {
      logger.warn('Calendar notification fields update skipped', { error: e.message });
    }

    const event = queryOne('SELECT * FROM CalendarEvent WHERE id = ?', [lastInsertRowid]);
    try {
      const workNotificationService = require('../services/workNotification.service');
      workNotificationService.upsertFromCalendarEvent(event);
    } catch (e) {
      logger.error('Calendar -> WorkNotification sync failed', { error: e.message });
    }
    return sendSuccess(res, { event }, 'Event created successfully', HTTP_STATUS.CREATED);
  } catch (err) {
    logger.error('Calendar create event failed', { error: err.message, stack: err.stack });
    return sendError(res, 'Failed to create event', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * PUT /api/calendar/events/:id
 * 권한: ADMIN, LEAD
 */
function updateEvent(req, res) {
  try {
    const { id } = req.params;
    const { platform, startDate, endDate, title, link, lineChannelId, discordWebhookUrl, discordMention, message } =
      req.body || {};

    const existing = queryOne('SELECT * FROM CalendarEvent WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 'Event not found', HTTP_STATUS.NOT_FOUND);
    }

    if (platform !== undefined && !['PC', 'MO'].includes(platform)) {
      return sendValidationError(res, [{ field: 'platform', message: 'platform must be PC or MO' }]);
    }
    if (startDate !== undefined && endDate !== undefined && new Date(startDate) > new Date(endDate)) {
      return sendValidationError(res, [{ field: 'date', message: 'endDate must be after startDate' }]);
    }

    const updates = [];
    const params = [];

    if (platform !== undefined) {
      updates.push('platform = ?');
      params.push(platform);
    }
    if (startDate !== undefined) {
      updates.push('startDate = ?');
      params.push(startDate);
    }
    if (endDate !== undefined) {
      updates.push('endDate = ?');
      params.push(endDate);
    }
    if (title !== undefined) {
      updates.push('title = ?');
      params.push(String(title).trim());
    }
    if (link !== undefined) {
      updates.push('link = ?');
      params.push(link && String(link).trim() ? String(link).trim() : null);
    }

    if (updates.length > 0) {
      updates.push("updatedAt = datetime('now')");
      params.push(id);
      execute(`UPDATE CalendarEvent SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // Notification fields (migration 017)
    const notifUpdates = [];
    const notifParams = [];
    const norm = (v) => (v && String(v).trim() ? String(v).trim() : null);
    if (lineChannelId !== undefined) {
      notifUpdates.push('lineChannelId = ?');
      notifParams.push(norm(lineChannelId));
    }
    if (discordWebhookUrl !== undefined) {
      notifUpdates.push('discordWebhookUrl = ?');
      notifParams.push(norm(discordWebhookUrl));
    }
    if (discordMention !== undefined) {
      notifUpdates.push('discordMention = ?');
      notifParams.push(norm(discordMention));
    }
    if (message !== undefined) {
      notifUpdates.push('message = ?');
      notifParams.push(message);
    }
    if (notifUpdates.length > 0) {
      notifUpdates.push("updatedAt = datetime('now')");
      notifParams.push(id);
      try {
        execute(`UPDATE CalendarEvent SET ${notifUpdates.join(', ')} WHERE id = ?`, notifParams);
      } catch (e) {
        logger.warn('Calendar notification fields update skipped', { error: e.message });
      }
    }

    const event = queryOne('SELECT * FROM CalendarEvent WHERE id = ?', [id]);
    try {
      const workNotificationService = require('../services/workNotification.service');
      workNotificationService.upsertFromCalendarEvent(event);
    } catch (e) {
      logger.error('Calendar -> WorkNotification sync failed', { error: e.message });
    }
    return sendSuccess(res, { event }, 'Event updated successfully');
  } catch (err) {
    logger.error('Calendar update event failed', { error: err.message });
    return sendError(res, 'Failed to update event', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * DELETE /api/calendar/events/:id
 * 권한: ADMIN, LEAD
 */
function deleteEvent(req, res) {
  try {
    const { id } = req.params;
    const existing = queryOne('SELECT * FROM CalendarEvent WHERE id = ?', [id]);
    if (!existing) {
      return sendError(res, 'Event not found', HTTP_STATUS.NOT_FOUND);
    }

    try {
      const workNotificationService = require('../services/workNotification.service');
      workNotificationService.deleteByCalendarEventId(existing.id);
    } catch (e) {
      logger.error('Calendar -> WorkNotification delete sync failed', { error: e.message });
    }

    execute('DELETE FROM CalendarEvent WHERE id = ?', [id]);
    return sendSuccess(res, {}, 'Event deleted successfully');
  } catch (err) {
    logger.error('Calendar delete event failed', { error: err.message });
    return sendError(res, 'Failed to delete event', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent
};
