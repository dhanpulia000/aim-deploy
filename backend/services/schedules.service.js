// Agent Schedules 서비스

const { query, queryOne, execute, executeTransaction, safeQuery } = require('../libs/db');
const logger = require('../utils/logger');

/**
 * 에이전트의 모든 스케줄 조회
 * @param {string} agentId - 에이전트 ID
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>} 스케줄 목록
 */
async function getSchedulesByAgent(agentId, options = {}) {
  const { includeInactive = false } = options;
  
  return safeQuery(() => {
    let sql = 'SELECT * FROM AgentSchedule WHERE agentId = ?';
    const params = [agentId];
    
    if (!includeInactive) {
      sql += ' AND isActive = ?';
      params.push(1);
    }
    
    sql += ' ORDER BY dayOfWeek ASC, startTime ASC, specificDate ASC';
    
    const schedules = query(sql, params);
    
    logger.info('Schedules retrieved', { agentId, count: schedules.length });
    return schedules;
  }, []);
}

/**
 * 특정 날짜의 스케줄 조회
 * @param {string} date - 날짜 (YYYY-MM-DD)
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>} 스케줄 목록
 */
async function getSchedulesByDate(date, options = {}) {
  const { includeInactive = false } = options;
  
  return safeQuery(() => {
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay(); // 0=일요일, 6=토요일
    
    let sql = `SELECT s.*, a.id as agent_id, a.name as agent_name, a.status as agent_status 
               FROM AgentSchedule s
               JOIN Agent a ON s.agentId = a.id
               WHERE (
                 (s.scheduleType = ? AND s.dayOfWeek = ?) OR
                 (s.scheduleType = ? AND s.specificDate = ?)
               )`;
    const params = ['weekly', dayOfWeek, 'specific', date];
    
    if (!includeInactive) {
      sql += ' AND s.isActive = ?';
      params.push(1);
    }
    
    sql += ' ORDER BY s.startTime ASC';
    
    const schedules = query(sql, params);
    
    // 에이전트 정보 매핑
    const formatted = schedules.map(s => ({
      ...s,
      isActive: Boolean(s.isActive),
      agent: {
        id: s.agent_id,
        name: s.agent_name,
        status: s.agent_status
      }
    }));
    
    logger.info('Schedules retrieved by date', { date, count: formatted.length });
    return formatted;
  }, []);
}

/**
 * 날짜 범위의 스케줄 조회
 * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>} 스케줄 목록
 */
async function getSchedulesByDateRange(startDate, endDate, options = {}) {
  const { agentId, includeInactive = false } = options;
  
  return safeQuery(() => {
    let sql = `SELECT s.*, a.id as agent_id, a.name as agent_name, a.status as agent_status 
               FROM AgentSchedule s
               JOIN Agent a ON s.agentId = a.id
               WHERE (
                 s.scheduleType = ? OR
                 (s.scheduleType = ? AND s.specificDate >= ? AND s.specificDate <= ?)
               )`;
    const params = ['weekly', 'specific', startDate, endDate];
    
    if (agentId) {
      sql += ' AND s.agentId = ?';
      params.push(agentId);
    }
    
    if (!includeInactive) {
      sql += ' AND s.isActive = ?';
      params.push(1);
    }
    
    sql += ' ORDER BY s.specificDate ASC, s.dayOfWeek ASC, s.startTime ASC';
    
    const schedules = query(sql, params);
    
    // 에이전트 정보 매핑
    const formatted = schedules.map(s => ({
      ...s,
      isActive: Boolean(s.isActive),
      agent: {
        id: s.agent_id,
        name: s.agent_name,
        status: s.agent_status
      }
    }));
    
    logger.info('Schedules retrieved by date range', { startDate, endDate, count: formatted.length });
    return formatted;
  }, []);
}

/**
 * 스케줄 생성
 * @param {Object} scheduleData - 스케줄 데이터
 * @returns {Promise<Object>} 생성된 스케줄
 */
async function createSchedule(scheduleData) {
  const {
    agentId,
    scheduleType = 'weekly',
    dayOfWeek,
    specificDate,
    startTime,
    endTime,
    workType,
    isActive = true,
    notes
  } = scheduleData;
  
  if (!agentId) {
    throw new Error('Agent ID is required');
  }
  
  if (!startTime || !endTime) {
    throw new Error('Start time and end time are required');
  }
  
  if (scheduleType === 'weekly' && (dayOfWeek === null || dayOfWeek === undefined)) {
    throw new Error('Day of week is required for weekly schedule');
  }
  
  if (scheduleType === 'specific' && !specificDate) {
    throw new Error('Specific date is required for specific schedule');
  }
  
  return executeTransaction(() => {
    // 에이전트 존재 확인
    const agent = queryOne('SELECT * FROM Agent WHERE id = ?', [agentId]);
    
    if (!agent) {
      throw new Error(`Agent with ID '${agentId}' not found`);
    }
    
    const { nanoid } = require('nanoid');
    const scheduleId = nanoid();
    const now = new Date().toISOString();
    
    execute(
      `INSERT INTO AgentSchedule (id, agentId, scheduleType, dayOfWeek, specificDate, startTime, endTime, workType, isActive, notes, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scheduleId,
        agentId,
        scheduleType,
        scheduleType === 'weekly' ? dayOfWeek : null,
        scheduleType === 'specific' ? specificDate : null,
        startTime,
        endTime,
        workType || null,
        isActive ? 1 : 0,
        notes || null,
        now,
        now
      ]
    );
    
    const schedule = queryOne('SELECT * FROM AgentSchedule WHERE id = ?', [scheduleId]);
    const agentInfo = queryOne('SELECT id, name FROM Agent WHERE id = ?', [agentId]);
    
    logger.info('Schedule created', { scheduleId, agentId });
    return {
      ...schedule,
      isActive: Boolean(schedule.isActive),
      agent: agentInfo
    };
  });
}

/**
 * 스케줄 수정
 * @param {string} scheduleId - 스케줄 ID
 * @param {Object} updateData - 수정 데이터
 * @returns {Promise<Object>} 수정된 스케줄
 */
async function updateSchedule(scheduleId, updateData) {
  const updateFields = [];
  const params = [];
  
  if (updateData.scheduleType !== undefined) {
    updateFields.push('scheduleType = ?');
    params.push(updateData.scheduleType);
  }
  if (updateData.dayOfWeek !== undefined) {
    updateFields.push('dayOfWeek = ?');
    params.push(updateData.dayOfWeek);
  }
  if (updateData.specificDate !== undefined) {
    updateFields.push('specificDate = ?');
    params.push(updateData.specificDate);
  }
  if (updateData.startTime !== undefined) {
    updateFields.push('startTime = ?');
    params.push(updateData.startTime);
  }
  if (updateData.endTime !== undefined) {
    updateFields.push('endTime = ?');
    params.push(updateData.endTime);
  }
  if (updateData.workType !== undefined) {
    updateFields.push('workType = ?');
    params.push(updateData.workType);
  }
  if (updateData.isActive !== undefined) {
    updateFields.push('isActive = ?');
    params.push(updateData.isActive ? 1 : 0);
  }
  if (updateData.notes !== undefined) {
    updateFields.push('notes = ?');
    params.push(updateData.notes);
  }
  
  if (updateFields.length === 0) {
    const schedule = queryOne('SELECT * FROM AgentSchedule WHERE id = ?', [scheduleId]);
    if (!schedule) return null;
    const agent = queryOne('SELECT id, name FROM Agent WHERE id = ?', [schedule.agentId]);
    return {
      ...schedule,
      isActive: Boolean(schedule.isActive),
      agent
    };
  }
  
  updateFields.push('updatedAt = ?');
  params.push(new Date().toISOString());
  params.push(scheduleId);
  
  return executeTransaction(() => {
    execute(
      `UPDATE AgentSchedule SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    
    const schedule = queryOne('SELECT * FROM AgentSchedule WHERE id = ?', [scheduleId]);
    const agent = queryOne('SELECT id, name FROM Agent WHERE id = ?', [schedule.agentId]);
    
    logger.info('Schedule updated', { scheduleId });
    return {
      ...schedule,
      isActive: Boolean(schedule.isActive),
      agent
    };
  });
}

/**
 * 스케줄 삭제
 * @param {string} scheduleId - 스케줄 ID
 * @returns {Promise<void>}
 */
async function deleteSchedule(scheduleId) {
  return executeTransaction(() => {
    execute('DELETE FROM AgentSchedule WHERE id = ?', [scheduleId]);
    logger.info('Schedule deleted', { scheduleId });
  });
}

module.exports = {
  getSchedulesByAgent,
  getSchedulesByDate,
  getSchedulesByDateRange,
  createSchedule,
  updateSchedule,
  deleteSchedule
};
