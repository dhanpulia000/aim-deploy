// 업무 알림 관리 서비스

const { query, queryOne, execute, executeTransaction, safeQuery } = require('../libs/db');
const logger = require('../utils/logger');

let _schemaEnsured = false;
function ensureWorkNotificationSchema() {
  if (_schemaEnsured) return;
  if (/^postgres/i.test(process.env.DATABASE_URL || '')) {
    _schemaEnsured = true;
    return;
  }
  try {
    const cols = query('PRAGMA table_info(WorkNotification)') || [];
    const existing = new Set(cols.map(c => c.name));
    const addColumn = (name, type) => {
      if (existing.has(name)) return;
      execute(`ALTER TABLE WorkNotification ADD COLUMN ${name} ${type}`);
      existing.add(name);
      logger.info('[WorkNotification] Schema migrated', { addedColumn: name });
    };

    // interval(간격) 전송 지원용
    addColumn('intervalMinutes', 'INTEGER');   // 예: 30, 120
    addColumn('windowStartTime', 'TEXT');     // HH:mm
    addColumn('windowEndTime', 'TEXT');       // HH:mm
    addColumn('lastSentAt', 'TEXT');          // ISO datetime (간격 전송 중복 방지용)
    addColumn('discordWebhookUrl', 'TEXT');   // Discord 웹훅 URL (선택, 있으면 LINE과 함께 전송)
    addColumn('discordMention', 'TEXT');      // Discord 멘션: @everyone, @here, <@USER_ID>, <@&ROLE_ID>
    addColumn('calendarEventId', 'INTEGER');  // CalendarEvent 연동 (단방향)

    _schemaEnsured = true;
  } catch (e) {
    logger.warn('[WorkNotification] Failed to ensure schema (will continue)', { error: e.message });
    _schemaEnsured = true;
  }
}

/**
 * 날짜가 범위 내에 있는지 확인
 */
function isDateInRange(date, startDate, endDate) {
  if (!startDate) return false;
  if (endDate && date > endDate) return false;
  return date >= startDate;
}

/**
 * 특정 날짜가 반복 스케줄에 해당하는지 확인
 */
function matchesRepeatSchedule(notification, targetDate) {
  const { repeatType, startDate, endDate, dayOfWeek, dayOfMonth, notificationDate } = notification;
  
  // 시작일 이전이면 false
  if (startDate && targetDate < startDate) return false;
  
  // 종료일 이후면 false
  if (endDate && targetDate > endDate) return false;
  
  // interval은 하루에 여러 번 전송 가능하므로 lastSentDate로 차단하지 않음
  if (repeatType !== 'interval') {
    // 마지막 전송일과 같으면 false (하루에 한 번만)
    if (notification.lastSentDate === targetDate) return false;
  }
  
  switch (repeatType) {
    case 'daily':
      // 매일: startDate부터 endDate까지 (또는 무한)
      return true;
      
    case 'weekly':
      // 매주: dayOfWeek와 같은 요일
      if (dayOfWeek === null || dayOfWeek === undefined) return false;
      const targetDay = new Date(targetDate).getDay();
      return targetDay === dayOfWeek;
      
    case 'monthly':
      // 매월: dayOfMonth와 같은 일자
      if (dayOfMonth === null || dayOfMonth === undefined) return false;
      const targetDayOfMonth = parseInt(targetDate.split('-')[2], 10);
      return targetDayOfMonth === dayOfMonth;
      
    case 'specific':
      // 특정 날짜: notificationDate와 정확히 일치
      return notificationDate === targetDate;

    case 'interval':
      // 날짜 범위는 위에서 처리 (startDate/endDate). 시간 조건은 getPendingNotifications에서 처리.
      return true;
      
    default:
      return false;
  }
}

/**
 * 모든 업무 알림 조회
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>} 업무 알림 목록
 */
async function getAllNotifications(options = {}) {
  ensureWorkNotificationSchema();
  const { includeInactive = false } = options;
  
  return safeQuery(() => {
    let sql = 'SELECT * FROM WorkNotification WHERE 1=1';
    const params = [];
    
    if (!includeInactive) {
      sql += ' AND isActive = ?';
      params.push(1);
    }
    
    sql += ' ORDER BY startDate ASC, notificationTime ASC, createdAt DESC';
    
    const notifications = query(sql, params);
    
    return notifications.map(n => ({
      ...n,
      isActive: Boolean(n.isActive),
      dayOfWeek: n.dayOfWeek !== null ? parseInt(n.dayOfWeek, 10) : null,
      dayOfMonth: n.dayOfMonth !== null ? parseInt(n.dayOfMonth, 10) : null,
      intervalMinutes: n.intervalMinutes !== null && n.intervalMinutes !== undefined ? parseInt(n.intervalMinutes, 10) : null
    }));
  }, []);
}

/**
 * 전송 대기 중인 알림 조회 (현재 시간 기준, 반복 스케줄 포함)
 * @returns {Promise<Array>} 알림 목록
 */
async function getPendingNotifications() {
  ensureWorkNotificationSchema();
  return safeQuery(() => {
    const now = new Date();
    
    // KST 시간으로 변환 (Asia/Seoul, UTC+9)
    // Intl.DateTimeFormat을 사용하여 정확한 시간대 변환
    const kstFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const kstParts = kstFormatter.formatToParts(now);
    const kstYear = kstParts.find(p => p.type === 'year').value;
    const kstMonth = kstParts.find(p => p.type === 'month').value;
    const kstDay = kstParts.find(p => p.type === 'day').value;
    const kstHour = kstParts.find(p => p.type === 'hour').value;
    const kstMinute = kstParts.find(p => p.type === 'minute').value;
    
    const currentDate = `${kstYear}-${kstMonth}-${kstDay}`; // YYYY-MM-DD (KST 기준)
    const currentTime = `${kstHour}:${kstMinute}`; // HH:mm (KST 기준)

    /** lastSentAt이 KST 기준으로 오늘·현재 분과 같으면 true (같은 분 내 중복 전송 방지) */
    function sentInCurrentMinute(lastSentAtIso) {
      if (!lastSentAtIso) return false;
      const d = new Date(lastSentAtIso);
      if (Number.isNaN(d.getTime())) return false;
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      const parts = formatter.formatToParts(d);
      const sentDate = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
      const sentTime = `${parts.find(p => p.type === 'hour').value}:${parts.find(p => p.type === 'minute').value}`;
      return sentDate === currentDate && sentTime === currentTime;
    }
    
    logger.info('[WorkNotification] Checking pending notifications', {
      currentDate,
      currentTime,
      utcTime: now.toISOString(),
      kstHour: kstHour,
      kstMinute: kstMinute
    });
    
    // 1) 단일 시간 알림: 정확히 현재 시간과 일치하는 알림만 조회
    const timeBasedNotifications = query(
      `SELECT * FROM WorkNotification 
       WHERE isActive = 1 
       AND repeatType != 'interval'
       AND notificationTime = ?
       ORDER BY createdAt ASC`,
      [currentTime]
    );

    // 2) interval 알림: 매 분 전체 조회 후, 시간 창/간격으로 필터링
    const intervalNotifications = query(
      `SELECT * FROM WorkNotification 
       WHERE isActive = 1
       AND repeatType = 'interval'
       ORDER BY createdAt ASC`
    );
    
    logger.info('[WorkNotification] Found notifications with matching time', {
      count: timeBasedNotifications.length,
      currentTime,
      currentDate,
      notificationTimes: timeBasedNotifications.map(n => ({
        id: n.id,
        workName: n.workName,
        time: n.notificationTime,
        repeatType: n.repeatType
      }))
    });
    
    const pendingNotifications = [];

    // 현재 날짜에 해당하는 알림만 필터링 (단일 시간)
    for (const n of timeBasedNotifications) {
      logger.debug('[WorkNotification] Checking notification', {
        notificationId: n.id,
        workName: n.workName,
        repeatType: n.repeatType,
        notificationTime: n.notificationTime,
        startDate: n.startDate,
        endDate: n.endDate,
        lastSentDate: n.lastSentDate,
        isActive: n.isActive,
        currentDate,
        currentTime
      });
      
      const matches = matchesRepeatSchedule(n, currentDate);
      logger.info('[WorkNotification] Schedule match result', {
        notificationId: n.id,
        workName: n.workName,
        matches,
        repeatType: n.repeatType,
        startDate: n.startDate,
        endDate: n.endDate,
        lastSentDate: n.lastSentDate,
        targetDate: currentDate,
        notificationTime: n.notificationTime,
        currentTime
      });
      
      if (matches) {
        // 라인은 설정된 시간에 1건만 전송: 같은 분에 이미 전송된 알림은 제외
        if (sentInCurrentMinute(n.lastSentAt)) {
          logger.debug('[WorkNotification] Notification skipped (already sent this minute)', {
            notificationId: n.id,
            workName: n.workName,
            lastSentAt: n.lastSentAt,
            currentDate,
            currentTime
          });
          continue;
        }
        
        logger.info('[WorkNotification] Notification matches schedule - will send (1 send at scheduled time)', {
          notificationId: n.id,
          workName: n.workName,
          repeatType: n.repeatType,
          notificationDate: n.notificationDate,
          notificationTime: n.notificationTime,
          targetDate: currentDate,
          currentTime,
          lineChannelId: n.lineChannelId
        });
        pendingNotifications.push(n);
      }
    }

    // interval: 시간창(start/end) 안에서 intervalMinutes마다 전송
    const minuteOfDay = (h, m) => h * 60 + m;
    const parseHHmm = (s) => {
      if (!s || typeof s !== 'string' || !s.includes(':')) return null;
      const [hh, mm] = s.split(':');
      const h = parseInt(hh, 10);
      const m = parseInt(mm, 10);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return { h, m };
    };

    const currentHourInt = parseInt(kstHour, 10);
    const currentMinuteInt = parseInt(kstMinute, 10);

    for (const n of intervalNotifications) {
      const matchesDate = matchesRepeatSchedule(n, currentDate);
      if (!matchesDate) continue;

      const intervalMinutes = n.intervalMinutes !== null && n.intervalMinutes !== undefined
        ? parseInt(n.intervalMinutes, 10)
        : null;
      if (!intervalMinutes || intervalMinutes <= 0) continue;

      const start = parseHHmm(n.windowStartTime) || parseHHmm(n.notificationTime) || { h: 0, m: 0 };
      const end = parseHHmm(n.windowEndTime) || { h: 23, m: 59 };
      const startMin = minuteOfDay(start.h, start.m);
      const endMin = minuteOfDay(end.h, end.m);
      const nowMin = minuteOfDay(currentHourInt, currentMinuteInt);
      if (nowMin < startMin || nowMin > endMin) continue;

      if (((nowMin - startMin) % intervalMinutes) !== 0) continue;

      // 중복 방지: intervalMinutes의 80% 이상 경과했는지 확인 (예: 60분이면 최소 48분 경과)
      // 이렇게 하면 intervalMinutes가 정확히 맞지 않아도 중복 전송 방지
      if (n.lastSentAt) {
        const last = new Date(n.lastSentAt);
        if (!Number.isNaN(last.getTime())) {
          const timeSinceLastSent = now.getTime() - last.getTime();
          const minIntervalMs = (intervalMinutes * 60 * 1000) * 0.8; // 80% of interval
          if (timeSinceLastSent < minIntervalMs) {
            logger.debug('[WorkNotification] Interval notification skipped (too soon)', {
              notificationId: n.id,
              workName: n.workName,
              lastSentAt: n.lastSentAt,
              timeSinceLastSent: Math.round(timeSinceLastSent / 1000 / 60) + ' minutes',
              requiredInterval: intervalMinutes + ' minutes'
            });
            continue;
          }
        }
      }

      pendingNotifications.push(n);
    }
    
    logger.info('[WorkNotification] Pending notifications found', {
      total: timeBasedNotifications.length + intervalNotifications.length,
      pending: pendingNotifications.length,
      currentDate,
      currentTime,
      pendingDetails: pendingNotifications.map(n => ({
        id: n.id,
        workName: n.workName,
        time: n.notificationTime,
        channelId: n.lineChannelId
      }))
    });
    
    return pendingNotifications.map(n => ({
      ...n,
      isActive: Boolean(n.isActive),
      dayOfWeek: n.dayOfWeek !== null ? parseInt(n.dayOfWeek, 10) : null,
      dayOfMonth: n.dayOfMonth !== null ? parseInt(n.dayOfMonth, 10) : null,
      intervalMinutes: n.intervalMinutes !== null && n.intervalMinutes !== undefined ? parseInt(n.intervalMinutes, 10) : null
    }));
  }, []);
}

/**
 * 업무 알림 생성
 * @param {Object} notificationData - 알림 데이터
 * @returns {Promise<Object>} 생성된 알림
 */
async function createNotification(notificationData) {
  const {
    workName,
    repeatType = 'specific',
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
    discordWebhookUrl = null,
    discordMention = null,
    message = null,
    calendarEventId = null,
    isActive = true
  } = notificationData;

  ensureWorkNotificationSchema();
  
  // interval 타입은 notificationTime 대신 windowStartTime을 필수로 사용
  const effectiveTime = repeatType === 'interval' ? windowStartTime : notificationTime;
  
  const hasLine = lineChannelId && String(lineChannelId).trim();
  const hasDiscord = discordWebhookUrl && String(discordWebhookUrl).trim();
  if (!workName || !effectiveTime) {
    throw new Error('업무명, 시간은 필수입니다.');
  }
  if (!hasLine && !hasDiscord) {
    throw new Error('Line 채널 ID 또는 Discord 웹훅 URL 중 하나는 필수입니다.');
  }
  
  // 시간 형식 검증 (HH:mm)
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(effectiveTime)) {
    throw new Error('시간 형식이 올바르지 않습니다. (HH:mm 형식)');
  }
  
  // 반복 타입별 검증
  if (repeatType === 'specific' && !notificationDate) {
    throw new Error('특정 날짜 타입은 notificationDate가 필요합니다.');
  }
  
  if (repeatType === 'weekly' && (dayOfWeek === null || dayOfWeek === undefined)) {
    throw new Error('매주 타입은 dayOfWeek가 필요합니다. (0=일요일, 6=토요일)');
  }
  
  if (repeatType === 'monthly' && (dayOfMonth === null || dayOfMonth === undefined)) {
    throw new Error('매월 타입은 dayOfMonth가 필요합니다. (1-31)');
  }
  
  if ((repeatType === 'daily' || repeatType === 'weekly' || repeatType === 'monthly' || repeatType === 'interval') && !startDate) {
    throw new Error('반복 스케줄은 startDate가 필요합니다.');
  }

  if (repeatType === 'interval') {
    const iv = intervalMinutes !== null && intervalMinutes !== undefined ? parseInt(intervalMinutes, 10) : null;
    if (!iv || iv <= 0) throw new Error('간격 타입은 intervalMinutes(분)가 필요합니다. (예: 30, 120)');
    if (!windowStartTime) throw new Error('간격 타입은 windowStartTime(HH:mm)이 필요합니다.');
    if (!windowEndTime) throw new Error('간격 타입은 windowEndTime(HH:mm)이 필요합니다.');
    if (!timeRegex.test(windowStartTime) || !timeRegex.test(windowEndTime)) {
      throw new Error('시간 형식이 올바르지 않습니다. (HH:mm 형식)');
    }
  }
  
  // 날짜 형식 검증
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (notificationDate && !dateRegex.test(notificationDate)) {
    throw new Error('날짜 형식이 올바르지 않습니다. (YYYY-MM-DD 형식)');
  }
  if (startDate && !dateRegex.test(startDate)) {
    throw new Error('시작 날짜 형식이 올바르지 않습니다. (YYYY-MM-DD 형식)');
  }
  if (endDate && !dateRegex.test(endDate)) {
    throw new Error('종료 날짜 형식이 올바르지 않습니다. (YYYY-MM-DD 형식)');
  }
  
  return executeTransaction(() => {
    const { nanoid } = require('nanoid');
    const notificationId = nanoid();
    const now = new Date().toISOString();
    
    const mentionVal = discordMention && String(discordMention).trim() ? discordMention.trim() : null;
    execute(
      `INSERT INTO WorkNotification 
       (id, workName, repeatType, notificationDate, notificationTime, startDate, endDate, dayOfWeek, dayOfMonth, intervalMinutes, windowStartTime, windowEndTime, lineChannelId, discordWebhookUrl, discordMention, message, calendarEventId, isActive, lastSentDate, lastSentAt, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        notificationId,
        workName,
        repeatType,
        repeatType === 'specific' ? notificationDate : null,
        repeatType === 'interval' ? windowStartTime : notificationTime,
        startDate || null,
        endDate || null,
        repeatType === 'weekly' ? dayOfWeek : null,
        repeatType === 'monthly' ? dayOfMonth : null,
        repeatType === 'interval' ? (intervalMinutes !== null && intervalMinutes !== undefined ? parseInt(intervalMinutes, 10) : null) : null,
        repeatType === 'interval' ? windowStartTime : null,
        repeatType === 'interval' ? windowEndTime : null,
        hasLine ? lineChannelId.trim() : '',
        hasDiscord ? discordWebhookUrl.trim() : null,
        mentionVal,
        message,
        calendarEventId !== null && calendarEventId !== undefined ? calendarEventId : null,
        isActive ? 1 : 0,
        null,
        null,
        now,
        now
      ]
    );
    
    const notification = queryOne('SELECT * FROM WorkNotification WHERE id = ?', [notificationId]);
    
    logger.info('Work notification created', { 
      notificationId, 
      workName, 
      repeatType,
      notificationDate,
      startDate,
      endDate
    });
    return {
      ...notification,
      isActive: Boolean(notification.isActive),
      dayOfWeek: notification.dayOfWeek !== null ? parseInt(notification.dayOfWeek, 10) : null,
      dayOfMonth: notification.dayOfMonth !== null ? parseInt(notification.dayOfMonth, 10) : null,
      intervalMinutes: notification.intervalMinutes !== null && notification.intervalMinutes !== undefined ? parseInt(notification.intervalMinutes, 10) : null
    };
  });
}

/**
 * 업무 알림 수정
 * @param {string} notificationId - 알림 ID
 * @param {Object} updateData - 수정 데이터
 * @returns {Promise<Object>} 수정된 알림
 */
async function updateNotification(notificationId, updateData) {
  const updateFields = [];
  const params = [];
  
  ensureWorkNotificationSchema();
  
  if (updateData.workName !== undefined) {
    updateFields.push('workName = ?');
    params.push(updateData.workName);
  }
  if (updateData.repeatType !== undefined) {
    updateFields.push('repeatType = ?');
    params.push(updateData.repeatType);
  }
  if (updateData.notificationDate !== undefined) {
    if (updateData.notificationDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(updateData.notificationDate)) {
        throw new Error('날짜 형식이 올바르지 않습니다. (YYYY-MM-DD 형식)');
      }
    }
    updateFields.push('notificationDate = ?');
    params.push(updateData.notificationDate || null);
  }
  if (updateData.notificationTime !== undefined) {
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(updateData.notificationTime)) {
      throw new Error('시간 형식이 올바르지 않습니다. (HH:mm 형식)');
    }
    updateFields.push('notificationTime = ?');
    params.push(updateData.notificationTime);
  }
  if (updateData.startDate !== undefined) {
    if (updateData.startDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(updateData.startDate)) {
        throw new Error('시작 날짜 형식이 올바르지 않습니다. (YYYY-MM-DD 형식)');
      }
    }
    updateFields.push('startDate = ?');
    params.push(updateData.startDate || null);
  }
  if (updateData.endDate !== undefined) {
    if (updateData.endDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(updateData.endDate)) {
        throw new Error('종료 날짜 형식이 올바르지 않습니다. (YYYY-MM-DD 형식)');
      }
    }
    updateFields.push('endDate = ?');
    params.push(updateData.endDate || null);
  }
  if (updateData.dayOfWeek !== undefined) {
    updateFields.push('dayOfWeek = ?');
    params.push(updateData.dayOfWeek !== null && updateData.dayOfWeek !== undefined ? updateData.dayOfWeek : null);
  }
  if (updateData.dayOfMonth !== undefined) {
    updateFields.push('dayOfMonth = ?');
    params.push(updateData.dayOfMonth !== null && updateData.dayOfMonth !== undefined ? updateData.dayOfMonth : null);
  }
  if (updateData.intervalMinutes !== undefined) {
    updateFields.push('intervalMinutes = ?');
    params.push(updateData.intervalMinutes !== null && updateData.intervalMinutes !== undefined ? parseInt(updateData.intervalMinutes, 10) : null);
  }
  if (updateData.windowStartTime !== undefined) {
    updateFields.push('windowStartTime = ?');
    params.push(updateData.windowStartTime || null);
  }
  if (updateData.windowEndTime !== undefined) {
    updateFields.push('windowEndTime = ?');
    params.push(updateData.windowEndTime || null);
  }
  if (updateData.lineChannelId !== undefined) {
    updateFields.push('lineChannelId = ?');
    params.push(updateData.lineChannelId ?? '');
  }
  if (updateData.discordWebhookUrl !== undefined) {
    updateFields.push('discordWebhookUrl = ?');
    params.push(updateData.discordWebhookUrl && String(updateData.discordWebhookUrl).trim() ? updateData.discordWebhookUrl.trim() : null);
  }
  if (updateData.discordMention !== undefined) {
    updateFields.push('discordMention = ?');
    params.push(updateData.discordMention && String(updateData.discordMention).trim() ? updateData.discordMention.trim() : null);
  }
  if (updateData.calendarEventId !== undefined) {
    updateFields.push('calendarEventId = ?');
    params.push(updateData.calendarEventId !== null && updateData.calendarEventId !== undefined ? updateData.calendarEventId : null);
  }
  if (updateData.message !== undefined) {
    updateFields.push('message = ?');
    params.push(updateData.message);
  }
  if (updateData.isActive !== undefined) {
    updateFields.push('isActive = ?');
    params.push(updateData.isActive ? 1 : 0);
  }
  
  if (updateFields.length === 0) {
    const notification = queryOne('SELECT * FROM WorkNotification WHERE id = ?', [notificationId]);
    if (!notification) return null;
    return {
      ...notification,
      isActive: Boolean(notification.isActive),
      dayOfWeek: notification.dayOfWeek !== null ? parseInt(notification.dayOfWeek, 10) : null,
      dayOfMonth: notification.dayOfMonth !== null ? parseInt(notification.dayOfMonth, 10) : null
    };
  }
  
  updateFields.push('updatedAt = ?');
  params.push(new Date().toISOString());
  params.push(notificationId);
  
  return executeTransaction(() => {
    execute(
      `UPDATE WorkNotification SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    
    const notification = queryOne('SELECT * FROM WorkNotification WHERE id = ?', [notificationId]);
    
    if (!notification) {
      throw new Error(`Notification with ID '${notificationId}' not found`);
    }
    
    logger.info('Work notification updated', { notificationId });
    return {
      ...notification,
      isActive: Boolean(notification.isActive),
      dayOfWeek: notification.dayOfWeek !== null ? parseInt(notification.dayOfWeek, 10) : null,
      dayOfMonth: notification.dayOfMonth !== null ? parseInt(notification.dayOfMonth, 10) : null
    };
  });
}

/**
 * 업무 알림 삭제
 * @param {string} notificationId - 알림 ID
 * @returns {Promise<void>}
 */
async function deleteNotification(notificationId) {
  ensureWorkNotificationSchema();
  return executeTransaction(() => {
    execute('DELETE FROM WorkNotification WHERE id = ?', [notificationId]);
    logger.info('Work notification deleted', { notificationId });
  });
}

function extractKstDateTimeParts(isoLike) {
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid startDate');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const y = get('year');
  const m = get('month');
  const day = get('day');
  const h = get('hour');
  const min = get('minute');
  if (!y || !m || !day || !h || !min) throw new Error('Invalid startDate parts');
  return { notificationDate: `${y}-${m}-${day}`, notificationTime: `${h}:${min}` };
}

async function upsertFromCalendarEvent(calendarEvent) {
  ensureWorkNotificationSchema();
  if (!calendarEvent || calendarEvent.id === undefined || calendarEvent.id === null) {
    throw new Error('calendarEvent.id is required');
  }

  const hasLine = calendarEvent.lineChannelId && String(calendarEvent.lineChannelId).trim();
  const hasDiscord = calendarEvent.discordWebhookUrl && String(calendarEvent.discordWebhookUrl).trim();
  if (!hasLine && !hasDiscord) {
    throw new Error('Line 채널 ID 또는 Discord 웹훅 URL 중 하나는 필수입니다.');
  }

  const workName = String(calendarEvent.title || '').trim();
  if (!workName) throw new Error('calendarEvent.title is required');

  const { notificationDate, notificationTime } = extractKstDateTimeParts(calendarEvent.startDate);

  const existing = queryOne('SELECT * FROM WorkNotification WHERE calendarEventId = ?', [calendarEvent.id]);
  if (!existing) {
    return createNotification({
      workName,
      repeatType: 'specific',
      notificationDate,
      notificationTime,
      lineChannelId: hasLine ? String(calendarEvent.lineChannelId).trim() : '',
      discordWebhookUrl: hasDiscord ? String(calendarEvent.discordWebhookUrl).trim() : null,
      discordMention: calendarEvent.discordMention && String(calendarEvent.discordMention).trim() ? String(calendarEvent.discordMention).trim() : null,
      message: calendarEvent.message || null,
      calendarEventId: calendarEvent.id,
      isActive: true,
    });
  }

  // keep user-managed activation flag, only sync schedule/content/targets
  return updateNotification(existing.id, {
    workName,
    repeatType: 'specific',
    notificationDate,
    notificationTime,
    lineChannelId: hasLine ? String(calendarEvent.lineChannelId).trim() : '',
    discordWebhookUrl: hasDiscord ? String(calendarEvent.discordWebhookUrl).trim() : null,
    discordMention: calendarEvent.discordMention && String(calendarEvent.discordMention).trim() ? String(calendarEvent.discordMention).trim() : null,
    message: calendarEvent.message || null,
    calendarEventId: calendarEvent.id,
  });
}

async function deleteByCalendarEventId(calendarEventId) {
  ensureWorkNotificationSchema();
  if (calendarEventId === null || calendarEventId === undefined) return;
  execute('DELETE FROM WorkNotification WHERE calendarEventId = ?', [calendarEventId]);
}

/**
 * 알림 전송 완료 처리 (lastSentDate 업데이트)
 * @param {string} notificationId - 알림 ID
 * @param {string} sentDate - 전송 날짜 (YYYY-MM-DD)
 * @returns {Promise<void>}
 */
async function markAsSent(notificationId, sentDate) {
  ensureWorkNotificationSchema();
  return executeTransaction(() => {
    const now = new Date().toISOString();
    execute(
      'UPDATE WorkNotification SET lastSentDate = ?, lastSentAt = ?, updatedAt = ? WHERE id = ?',
      [sentDate, now, now, notificationId]
    );
    logger.info('Work notification marked as sent', { notificationId, sentDate });
  });
}

/**
 * 여러 알림을 한꺼번에 전송 완료 처리 (중복 전송 방지용)
 * @param {string[]} notificationIds - 알림 ID 배열
 * @param {string} sentDate - 전송 날짜 (YYYY-MM-DD)
 * @returns {Promise<void>}
 */
async function markManyAsSent(notificationIds, sentDate) {
  if (!notificationIds || notificationIds.length === 0) return;
  ensureWorkNotificationSchema();
  return executeTransaction(() => {
    const now = new Date().toISOString();
    for (const id of notificationIds) {
      execute(
        'UPDATE WorkNotification SET lastSentDate = ?, lastSentAt = ?, updatedAt = ? WHERE id = ?',
        [sentDate, now, now, id]
      );
    }
    logger.info('Work notifications marked as sent (dedup)', { count: notificationIds.length, ids: notificationIds, sentDate });
  });
}

module.exports = {
  getAllNotifications,
  getPendingNotifications,
  createNotification,
  updateNotification,
  deleteNotification,
  upsertFromCalendarEvent,
  deleteByCalendarEventId,
  markAsSent,
  markManyAsSent,
  matchesRepeatSchedule
};
