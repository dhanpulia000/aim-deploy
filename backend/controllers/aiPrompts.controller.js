const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');

/**
 * 모든 AI 프롬프트 조회
 */
async function getAllPrompts(req, res) {
  try {
    const prompts = query(
      'SELECT * FROM AIPromptConfig ORDER BY name ASC'
    );
    
    sendSuccess(res, prompts, 'AI prompts retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve AI prompts', { error: error.message });
    sendError(res, 'Failed to retrieve AI prompts', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 특정 AI 프롬프트 조회 (by name)
 */
async function getPromptByName(req, res) {
  try {
    const { name } = req.params;
    
    const prompt = queryOne(
      'SELECT * FROM AIPromptConfig WHERE name = ?',
      [name]
    );
    
    if (!prompt) {
      return sendError(res, 'AI prompt not found', HTTP_STATUS.NOT_FOUND);
    }
    
    sendSuccess(res, prompt, 'AI prompt retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve AI prompt', { error: error.message, name: req.params.name });
    sendError(res, 'Failed to retrieve AI prompt', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * AI 프롬프트 생성
 */
async function createPrompt(req, res) {
  try {
    const { name, displayName, description, systemPrompt, userPromptTemplate, isActive } = req.body;
    
    // 유효성 검사
    if (!name || !displayName || !systemPrompt) {
      return sendValidationError(res, 'name, displayName, systemPrompt are required');
    }
    
    // 중복 확인
    const existing = queryOne(
      'SELECT id FROM AIPromptConfig WHERE name = ?',
      [name]
    );
    
    if (existing) {
      return sendValidationError(res, `Prompt with name "${name}" already exists`);
    }
    
    // 삽입
    const result = execute(
      `INSERT INTO AIPromptConfig (name, displayName, description, systemPrompt, userPromptTemplate, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        name,
        displayName,
        description || null,
        systemPrompt,
        userPromptTemplate || null,
        isActive !== undefined ? (isActive ? 1 : 0) : 1
      ]
    );
    
    const newPrompt = queryOne(
      'SELECT * FROM AIPromptConfig WHERE id = ?',
      [result.lastInsertRowid]
    );
    
    logger.info('AI prompt created', { name, id: result.lastInsertRowid });
    sendSuccess(res, newPrompt, 'AI prompt created successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create AI prompt', { error: error.message });
    sendError(res, 'Failed to create AI prompt', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * AI 프롬프트 수정
 */
async function updatePrompt(req, res) {
  try {
    const { name } = req.params;
    const { displayName, description, systemPrompt, userPromptTemplate, isActive } = req.body;
    
    // 존재 확인
    const existing = queryOne(
      'SELECT id, version FROM AIPromptConfig WHERE name = ?',
      [name]
    );
    
    if (!existing) {
      return sendError(res, 'AI prompt not found', HTTP_STATUS.NOT_FOUND);
    }
    
    // 수정할 필드만 업데이트
    const updates = [];
    const params = [];
    
    if (displayName !== undefined) {
      updates.push('displayName = ?');
      params.push(displayName);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (systemPrompt !== undefined) {
      updates.push('systemPrompt = ?');
      params.push(systemPrompt);
      // 프롬프트가 변경되면 버전 증가
      updates.push('version = version + 1');
    }
    if (userPromptTemplate !== undefined) {
      updates.push('userPromptTemplate = ?');
      params.push(userPromptTemplate);
    }
    if (isActive !== undefined) {
      updates.push('isActive = ?');
      params.push(isActive ? 1 : 0);
    }
    
    if (updates.length === 0) {
      return sendValidationError(res, 'No fields to update');
    }
    
    updates.push("updatedAt = datetime('now')");
    params.push(name);
    
    execute(
      `UPDATE AIPromptConfig SET ${updates.join(', ')} WHERE name = ?`,
      params
    );
    
    const updated = queryOne(
      'SELECT * FROM AIPromptConfig WHERE name = ?',
      [name]
    );
    
    logger.info('AI prompt updated', { name, version: updated.version });
    sendSuccess(res, updated, 'AI prompt updated successfully');
  } catch (error) {
    logger.error('Failed to update AI prompt', { error: error.message, name: req.params.name });
    sendError(res, 'Failed to update AI prompt', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * AI 프롬프트 삭제
 */
async function deletePrompt(req, res) {
  try {
    const { name } = req.params;
    
    // 존재 확인
    const existing = queryOne(
      'SELECT id FROM AIPromptConfig WHERE name = ?',
      [name]
    );
    
    if (!existing) {
      return sendError(res, 'AI prompt not found', HTTP_STATUS.NOT_FOUND);
    }
    
    // 삭제
    execute(
      'DELETE FROM AIPromptConfig WHERE name = ?',
      [name]
    );
    
    logger.info('AI prompt deleted', { name });
    sendSuccess(res, null, 'AI prompt deleted successfully');
  } catch (error) {
    logger.error('Failed to delete AI prompt', { error: error.message, name: req.params.name });
    sendError(res, 'Failed to delete AI prompt', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  getAllPrompts,
  getPromptByName,
  createPrompt,
  updatePrompt,
  deletePrompt
};



