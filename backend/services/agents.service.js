// Agents 서비스

const { db, query, queryOne, execute, executeTransaction, safeQuery } = require('../libs/db');
const logger = require('../utils/logger');
const { resolveAgentDisplayName } = require('../utils/agentDisplayName');

/**
 * 모든 에이전트 조회
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>} 에이전트 목록
 */
async function getAllAgents(options = {}) {
  const { includeInactive = false, projectId } = options;
  
  return safeQuery(() => {
    let sql = 'SELECT * FROM Agent WHERE 1=1';
    const params = [];
    
    if (!includeInactive) {
      sql += ' AND isActive = ?';
      params.push(1);
    }
    
    if (projectId !== undefined && projectId !== null) {
      const parsed = Number(projectId);
      if (!Number.isNaN(parsed)) {
        sql += ' AND projectId = ?';
        params.push(parsed);
      }
    }
    
    sql += ' ORDER BY name ASC';
    
    const agents = query(sql, params);
    
    // 스케줄 조회
    const agentIds = agents.map(a => a.id);
    let schedules = [];
    if (agentIds.length > 0) {
      const placeholders = agentIds.map(() => '?').join(',');
      schedules = query(
        `SELECT * FROM AgentSchedule WHERE agentId IN (${placeholders}) AND isActive = ? ORDER BY dayOfWeek ASC, startTime ASC`,
        [...agentIds, 1]
      );
    }
    
    // 스케줄을 에이전트별로 그룹화
    const schedulesByAgent = {};
    schedules.forEach(schedule => {
      if (!schedulesByAgent[schedule.agentId]) {
        schedulesByAgent[schedule.agentId] = [];
      }
      schedulesByAgent[schedule.agentId].push(schedule);
    });
    
    // channelFocus를 JSON 문자열에서 배열로 변환
    const formattedAgents = agents.map(agent => ({
      ...agent,
      name: resolveAgentDisplayName(agent.name, agent.email),
      channelFocus: agent.channelFocus ? JSON.parse(agent.channelFocus) : [],
      schedules: schedulesByAgent[agent.id] || []
    }));
    
    logger.info('Agents retrieved', { count: formattedAgents.length });
    return formattedAgents;
  }, []);
}

/**
 * 특정 에이전트 조회
 * @param {string} agentId - 에이전트 ID
 * @returns {Promise<Object>} 에이전트 정보
 */
async function getAgentById(agentId) {
  return safeQuery(() => {
    const agent = queryOne('SELECT * FROM Agent WHERE id = ?', [agentId]);
    
    if (!agent) {
      return null;
    }
    
    // 스케줄 조회
    const schedules = query(
      'SELECT * FROM AgentSchedule WHERE agentId = ? AND isActive = ? ORDER BY dayOfWeek ASC, startTime ASC',
      [agentId, 1]
    );
    
    return {
      ...agent,
      name: resolveAgentDisplayName(agent.name, agent.email),
      channelFocus: agent.channelFocus ? JSON.parse(agent.channelFocus) : [],
      schedules
    };
  }, null);
}

/**
 * 에이전트 생성
 * @param {Object} agentData - 에이전트 데이터
 * @param {boolean} createUserAccount - User 계정도 함께 생성할지 여부
 * @param {string} userPassword - User 계정 비밀번호 (createUserAccount가 true일 때 필수)
 * @returns {Promise<Object>} 생성된 에이전트
 */
async function createAgent(agentData, createUserAccount = false, userPassword = null) {
  const {
    name,
    avatar,
    status = 'offline',
    handling = 0,
    todayResolved = 0,
    avgHandleSec = 0,
    channelFocus = [],
    email,
    phone,
    department,
    position,
    slackId,
    isActive = true,
    projectId
  } = agentData;
  
  if (!name) {
    throw new Error('Agent name is required');
  }

  // User 계정 생성 옵션이 켜져있으면 이메일과 비밀번호가 필요
  if (createUserAccount) {
    if (!email) {
      throw new Error('Email is required when creating user account');
    }
    if (!userPassword) {
      throw new Error('Password is required when creating user account');
    }
  }
  
  return executeTransaction(() => {
    let userId = null;

    // User 계정 생성
    if (createUserAccount && email && userPassword) {
      const bcrypt = require('bcryptjs');
      
      // 이메일 중복 확인
      const existingUser = queryOne('SELECT * FROM User WHERE email = ?', [String(email)]);
      if (existingUser) {
        throw new Error(`User with email ${email} already exists`);
      }

      // 비밀번호 해시
      const hashedPassword = bcrypt.hashSync(String(userPassword), 10);

      // User 생성
      const now = new Date().toISOString();
      const userResult = execute(
        'INSERT INTO User (email, password, name, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
        [String(email), hashedPassword, name || email.split('@')[0], 'AGENT', now, now]
      );
      
      userId = userResult.lastInsertRowid;
      logger.info('User account created for agent', { userId, email, agentName: name });
    }

    // Agent 생성 (CUID 생성 필요)
    const { nanoid } = require('nanoid');
    const agentId = nanoid();
    const now = new Date().toISOString();
    
    const agentResult = execute(
      `INSERT INTO Agent (id, name, avatar, status, handling, todayResolved, avgHandleSec, channelFocus, email, phone, department, position, slackId, isActive, userId, projectId, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agentId,
        name,
        avatar || null,
        status,
        handling,
        todayResolved,
        avgHandleSec,
        JSON.stringify(channelFocus),
        email || null,
        phone || null,
        department || null,
        position || null,
        slackId || null,
        isActive ? 1 : 0,
        userId,
        projectId || null,
        now,
        now
      ]
    );
    
    const agent = queryOne('SELECT * FROM Agent WHERE id = ?', [agentId]);
    
    logger.info('Agent created', { agentId, name, userId });
    
    return {
      ...agent,
      name: resolveAgentDisplayName(agent.name, agent.email),
      channelFocus: JSON.parse(agent.channelFocus),
      userId
    };
  });
}

/**
 * 에이전트 수정
 * @param {string} agentId - 에이전트 ID
 * @param {Object} updateData - 수정 데이터
 * @returns {Promise<Object>} 수정된 에이전트
 */
async function updateAgent(agentId, updateData) {
  const nextPassword = updateData?.password;
  // password는 Agent 테이블 컬럼이 아니라 User.password 변경용
  if (nextPassword !== undefined) {
    if (typeof nextPassword !== 'string' || nextPassword.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
  }

  const updateFields = [];
  const params = [];
  
  if (updateData.name !== undefined) {
    updateFields.push('name = ?');
    params.push(updateData.name);
  }
  if (updateData.avatar !== undefined) {
    updateFields.push('avatar = ?');
    params.push(updateData.avatar);
  }
  if (updateData.status !== undefined) {
    updateFields.push('status = ?');
    params.push(updateData.status);
  }
  if (updateData.handling !== undefined) {
    updateFields.push('handling = ?');
    params.push(updateData.handling);
  }
  if (updateData.todayResolved !== undefined) {
    updateFields.push('todayResolved = ?');
    params.push(updateData.todayResolved);
  }
  if (updateData.avgHandleSec !== undefined) {
    updateFields.push('avgHandleSec = ?');
    params.push(updateData.avgHandleSec);
  }
  if (updateData.channelFocus !== undefined) {
    updateFields.push('channelFocus = ?');
    params.push(JSON.stringify(updateData.channelFocus));
  }
  if (updateData.email !== undefined) {
    updateFields.push('email = ?');
    params.push(updateData.email);
  }
  if (updateData.phone !== undefined) {
    updateFields.push('phone = ?');
    params.push(updateData.phone);
  }
  if (updateData.department !== undefined) {
    updateFields.push('department = ?');
    params.push(updateData.department);
  }
  if (updateData.position !== undefined) {
    updateFields.push('position = ?');
    params.push(updateData.position);
  }
  if (updateData.slackId !== undefined) {
    updateFields.push('slackId = ?');
    params.push(updateData.slackId || null);
  }
  if (updateData.isActive !== undefined) {
    updateFields.push('isActive = ?');
    params.push(updateData.isActive ? 1 : 0);
  }
  if (updateData.projectId !== undefined) {
    updateFields.push('projectId = ?');
    params.push(updateData.projectId);
  }
  
  if (updateFields.length === 0) {
    return getAgentById(agentId);
  }
  
  updateFields.push('updatedAt = ?');
  params.push(new Date().toISOString());
  params.push(agentId);
  
  return executeTransaction(() => {
    if (nextPassword !== undefined) {
      const bcrypt = require('bcryptjs');
      const agentRow = queryOne('SELECT id, userId FROM Agent WHERE id = ?', [agentId]);
      if (!agentRow) {
        throw new Error('Agent not found');
      }
      if (!agentRow.userId) {
        throw new Error('Agent has no linked User account');
      }
      const hashedPassword = bcrypt.hashSync(String(nextPassword), 10);
      execute('UPDATE User SET password = ?, updatedAt = ? WHERE id = ?', [
        hashedPassword,
        new Date().toISOString(),
        agentRow.userId
      ]);
      logger.info('Agent user password updated', { agentId, userId: agentRow.userId });
    }

    execute(
      `UPDATE Agent SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    
    const agent = queryOne('SELECT * FROM Agent WHERE id = ?', [agentId]);
    
    logger.info('Agent updated', { agentId, name: agent.name });
    
    return {
      ...agent,
      name: resolveAgentDisplayName(agent.name, agent.email),
      channelFocus: agent.channelFocus ? JSON.parse(agent.channelFocus) : []
    };
  });
}

/**
 * 에이전트 삭제 (소프트 삭제)
 * @param {string} agentId - 에이전트 ID
 * @returns {Promise<Object>} 삭제된 에이전트
 */
async function deleteAgent(agentId) {
  return executeTransaction(() => {
    const now = new Date().toISOString();
    execute(
      'UPDATE Agent SET isActive = ?, updatedAt = ? WHERE id = ?',
      [0, now, agentId]
    );
    
    const agent = queryOne('SELECT * FROM Agent WHERE id = ?', [agentId]);
    
    logger.info('Agent deleted (soft)', { agentId, name: agent.name });
    
    return {
      ...agent,
      channelFocus: agent.channelFocus ? JSON.parse(agent.channelFocus) : []
    };
  });
}

/**
 * 에이전트 완전 삭제 (하드 삭제)
 * @param {string} agentId - 에이전트 ID
 * @returns {Promise<void>}
 */
async function hardDeleteAgent(agentId) {
  return executeTransaction(() => {
    // 관련 스케줄 먼저 삭제
    execute('DELETE FROM AgentSchedule WHERE agentId = ?', [agentId]);
    
    // 에이전트 삭제
    execute('DELETE FROM Agent WHERE id = ?', [agentId]);
    
    logger.info('Agent hard deleted', { agentId });
  });
}

module.exports = {
  getAllAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  hardDeleteAgent
};
