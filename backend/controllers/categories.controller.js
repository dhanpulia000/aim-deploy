const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');
const { invalidateCache } = require('../services/issueClassifier');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');

/**
 * 카테고리 트리 조회 (활성 그룹/카테고리)
 */
async function getCategoryTree(req, res) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    
    // projectId로 필터링
    let sql = 'SELECT * FROM CategoryGroup WHERE isActive = ?';
    const params = [1];
    
    if (projectId) {
      sql += ' AND projectId = ?';
      params.push(projectId);
    }
    
    sql += ' ORDER BY name ASC';
    
    const groups = query(sql, params);

    const groupIds = groups.map(g => g.id);
    let categories = [];
    if (groupIds.length > 0) {
      const placeholders = groupIds.map(() => '?').join(',');
      categories = query(
        `SELECT * FROM Category WHERE groupId IN (${placeholders}) AND isActive = ? ORDER BY name ASC`,
        [...groupIds, 1]
      );
    }

    const categoriesByGroup = {};
    categories.forEach(category => {
      if (!categoriesByGroup[category.groupId]) {
        categoriesByGroup[category.groupId] = [];
      }
      categoriesByGroup[category.groupId].push({
        ...category,
        isActive: Boolean(category.isActive)
      });
    });

    const tree = groups.map(group => ({
      ...group,
      isActive: Boolean(group.isActive),
      categories: categoriesByGroup[group.id] || []
    }));

    logger.info('Category tree loaded', { projectId, groupCount: tree.length });
    sendSuccess(res, tree, 'Category tree retrieved successfully');
  } catch (error) {
    logger.error('Failed to load category tree', { error: error.message });
    sendError(res, 'Failed to load category tree', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 카테고리 그룹 목록 조회
 */
async function listCategoryGroups(req, res) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    
    let sql = 'SELECT * FROM CategoryGroup WHERE 1=1';
    const params = [];
    
    if (projectId) {
      sql += ' AND projectId = ?';
      params.push(projectId);
    }
    
    sql += ' ORDER BY name ASC';
    
    const groups = query(sql, params);
    
    // 각 그룹의 카테고리 조회
    const groupIds = groups.map(g => g.id);
    let categories = [];
    if (groupIds.length > 0) {
      const placeholders = groupIds.map(() => '?').join(',');
      categories = query(
        `SELECT * FROM Category WHERE groupId IN (${placeholders}) AND isActive = ? ORDER BY name ASC`,
        [...groupIds, 1]
      );
    }
    
    // 각 그룹의 이슈 개수 조회
    const issueCounts = {};
    if (groupIds.length > 0) {
      const placeholders = groupIds.map(() => '?').join(',');
      const counts = query(
        `SELECT categoryGroupId, COUNT(*) as count FROM ReportItemIssue WHERE categoryGroupId IN (${placeholders}) GROUP BY categoryGroupId`,
        groupIds
      );
      counts.forEach(c => {
        issueCounts[c.categoryGroupId] = c.count;
      });
    }
    
    // 카테고리를 그룹별로 그룹화
    const categoriesByGroup = {};
    categories.forEach(category => {
      if (!categoriesByGroup[category.groupId]) {
        categoriesByGroup[category.groupId] = [];
      }
      categoriesByGroup[category.groupId].push(category);
    });
    
    // 카테고리 개수 추가
    const groupsWithCounts = groups.map(group => ({
      ...group,
      isActive: Boolean(group.isActive),
      categories: categoriesByGroup[group.id] || [],
      categoryCount: (categoriesByGroup[group.id] || []).length,
      issueCount: issueCounts[group.id] || 0
    }));

    sendSuccess(res, groupsWithCounts, 'Category groups retrieved successfully');
  } catch (error) {
    logger.error('Failed to list category groups', { error: error.message });
    sendError(res, 'Failed to list category groups', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 카테고리 그룹 생성
 */
async function createCategoryGroup(req, res) {
  try {
    const { name, code, color, description, projectId } = req.body;

    if (!name) {
      return sendValidationError(res, [
        { field: 'name', message: 'Name is required' }
      ]);
    }

    // projectId 검증 (필수)
    const finalProjectId = projectId ? parseInt(projectId) : 1; // 기본값 1 (Default Project)
    if (isNaN(finalProjectId)) {
      return sendValidationError(res, [
        { field: 'projectId', message: 'Invalid projectId' }
      ]);
    }

    // 프로젝트 존재 확인
    const project = queryOne('SELECT * FROM Project WHERE id = ?', [finalProjectId]);
    if (!project) {
      return sendValidationError(res, [
        { field: 'projectId', message: 'Project not found' }
      ]);
    }

    // code가 없으면 name에서 생성
    let finalCode = code;
    if (!finalCode) {
      finalCode = name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    }

    // 프로젝트 내에서 code 중복 확인 및 처리
    let existingGroup = queryOne(
      'SELECT * FROM CategoryGroup WHERE projectId = ? AND code = ?',
      [finalProjectId, finalCode]
    );

    if (existingGroup) {
      // 중복이면 숫자를 추가하여 고유한 code 생성
      let counter = 1;
      let uniqueCode = `${finalCode}_${counter}`;
      while (queryOne(
        'SELECT * FROM CategoryGroup WHERE projectId = ? AND code = ?',
        [finalProjectId, uniqueCode]
      )) {
        counter++;
        uniqueCode = `${finalCode}_${counter}`;
      }
      finalCode = uniqueCode;
    }

    const now = new Date().toISOString();
    const result = execute(
      'INSERT INTO CategoryGroup (name, code, color, description, isActive, projectId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, finalCode, color || null, description || null, 1, finalProjectId, now, now]
    );
    
    const group = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [result.lastInsertRowid]);
    const groupCategories = query('SELECT * FROM Category WHERE groupId = ?', [group.id]);

    invalidateCache();
    logger.info('Category group created', { groupId: group.id, name: group.name });
    sendSuccess(res, { ...group, isActive: Boolean(group.isActive), categories: groupCategories }, 'Category group created successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create category group', { error: error.message });
    sendError(res, 'Failed to create category group', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 카테고리 그룹 수정
 */
async function updateCategoryGroup(req, res) {
  try {
    const { id } = req.params;
    const { name, isActive, color, description } = req.body;

    const updateFields = [];
    const params = [];
    
    if (name !== undefined) {
      updateFields.push('name = ?');
      params.push(name);
    }
    if (isActive !== undefined) {
      updateFields.push('isActive = ?');
      params.push(isActive ? 1 : 0);
    }
    if (color !== undefined) {
      updateFields.push('color = ?');
      params.push(color);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      params.push(description);
    }
    
    if (updateFields.length === 0) {
      const group = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [parseInt(id)]);
      if (!group) {
        return sendError(res, 'Category group not found', HTTP_STATUS.NOT_FOUND);
      }
      const categories = query('SELECT * FROM Category WHERE groupId = ? AND isActive = ?', [group.id, 1]);
      return sendSuccess(res, { ...group, isActive: Boolean(group.isActive), categories }, 'Category group updated successfully');
    }
    
    updateFields.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(parseInt(id));
    
    execute(
      `UPDATE CategoryGroup SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    
    const group = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [parseInt(id)]);
    if (!group) {
      return sendError(res, 'Category group not found', HTTP_STATUS.NOT_FOUND);
    }
    
    const categories = query('SELECT * FROM Category WHERE groupId = ? AND isActive = ?', [group.id, 1]);

    invalidateCache();
    logger.info('Category group updated', { groupId: group.id });
    sendSuccess(res, { ...group, isActive: Boolean(group.isActive), categories }, 'Category group updated successfully');
  } catch (error) {
    logger.error('Failed to update category group', { error: error.message });
    sendError(res, 'Failed to update category group', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 카테고리 그룹 삭제 (soft delete)
 */
async function deleteCategoryGroup(req, res) {
  try {
    const id = parseInt(req.params.id);
    const cascade = req.query.cascade === 'true';

    if (Number.isNaN(id)) {
      return sendValidationError(res, [{ field: 'id', message: 'Invalid group id' }]);
    }

    const categoryCountResult = queryOne(
      'SELECT COUNT(*) as count FROM Category WHERE groupId = ? AND isActive = ?',
      [id, 1]
    );
    const categoryCount = categoryCountResult?.count || 0;

    if (categoryCount > 0 && !cascade) {
      return sendError(
        res,
        `Group has ${categoryCount} active sub categories. Pass ?cascade=true to delete all.`,
        HTTP_STATUS.BAD_REQUEST
      );
    }

    if (cascade && categoryCount > 0) {
      // 카테고리도 함께 비활성화
      execute('UPDATE Category SET isActive = ?, updatedAt = ? WHERE groupId = ?', [0, new Date().toISOString(), id]);
    }

    // 그룹 비활성화
    execute('UPDATE CategoryGroup SET isActive = ?, updatedAt = ? WHERE id = ?', [0, new Date().toISOString(), id]);

    invalidateCache();
    logger.info('Category group deleted', { groupId: id });
    sendSuccess(res, { id }, 'Category group deleted successfully');
  } catch (error) {
    logger.error('Failed to delete category group', { error: error.message });
    sendError(res, 'Failed to delete category group', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 특정 그룹의 카테고리 조회
 */
async function listCategoriesByGroup(req, res) {
  try {
    const groupId = parseInt(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return sendValidationError(res, [{ field: 'groupId', message: 'Invalid groupId' }]);
    }

    const categories = query(
      'SELECT * FROM Category WHERE groupId = ? AND isActive = ? ORDER BY name ASC',
      [groupId, 1]
    );

    sendSuccess(res, categories.map(c => ({ ...c, isActive: Boolean(c.isActive) })), 'Categories retrieved successfully');
  } catch (error) {
    logger.error('Failed to list categories by group', { error: error.message });
    sendError(res, 'Failed to list categories', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 카테고리 생성
 */
async function createCategory(req, res) {
  try {
    const { groupId, name, code, importance, description, isActive } = req.body;
    const finalGroupId = parseInt(groupId);
    if (Number.isNaN(finalGroupId)) {
      return sendValidationError(res, [{ field: 'groupId', message: 'Invalid groupId' }]);
    }
    if (!name) {
      return sendValidationError(res, [{ field: 'name', message: 'Name is required' }]);
    }

    const group = queryOne('SELECT * FROM CategoryGroup WHERE id = ?', [finalGroupId]);
    if (!group) {
      return sendValidationError(res, [{ field: 'groupId', message: 'Group not found' }]);
    }

    // code 생성/검증
    let finalCode = code;
    if (!finalCode) {
      finalCode = name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    }
    // 고유성 확보
    let uniqueCode = finalCode;
    let counter = 1;
    while (queryOne('SELECT id FROM Category WHERE groupId = ? AND code = ?', [finalGroupId, uniqueCode])) {
      uniqueCode = `${finalCode}_${counter}`;
      counter++;
    }
    finalCode = uniqueCode;

    const now = new Date().toISOString();
    const result = execute(
      'INSERT INTO Category (groupId, name, code, importance, description, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        finalGroupId,
        name,
        finalCode || null,
        importance || 'MEDIUM',
        description || null,
        isActive === undefined ? 1 : (isActive ? 1 : 0),
        now,
        now
      ]
    );

    const category = queryOne('SELECT * FROM Category WHERE id = ?', [result.lastInsertRowid]);
    invalidateCache();
    sendSuccess(res, { ...category, isActive: Boolean(category.isActive) }, 'Category created successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create category', { error: error.message });
    sendError(res, 'Failed to create category', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 카테고리 수정
 */
async function updateCategory(req, res) {
  try {
    const { id } = req.params;
    const { name, isActive, importance, description, code } = req.body;
    const categoryId = parseInt(id);
    if (Number.isNaN(categoryId)) {
      return sendValidationError(res, [{ field: 'id', message: 'Invalid category id' }]);
    }

    const category = queryOne('SELECT * FROM Category WHERE id = ?', [categoryId]);
    if (!category) {
      return sendError(res, 'Category not found', HTTP_STATUS.NOT_FOUND);
    }

    const updateFields = [];
    const params = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      params.push(name);
    }
    if (importance !== undefined) {
      updateFields.push('importance = ?');
      params.push(importance);
    }
    if (description !== undefined) {
      updateFields.push('description = ?');
      params.push(description);
    }
    if (isActive !== undefined) {
      updateFields.push('isActive = ?');
      params.push(isActive ? 1 : 0);
    }
    if (code !== undefined) {
      // code 고유성 확인
      const existing = queryOne(
        'SELECT id FROM Category WHERE groupId = ? AND code = ? AND id != ?',
        [category.groupId, code, categoryId]
      );
      if (existing) {
        return sendValidationError(res, [{ field: 'code', message: 'Code already exists in the group' }]);
      }
      updateFields.push('code = ?');
      params.push(code);
    }

    if (updateFields.length === 0) {
      return sendSuccess(res, { ...category, isActive: Boolean(category.isActive) }, 'Category updated successfully');
    }

    updateFields.push('updatedAt = ?');
    params.push(new Date().toISOString(), categoryId);

    execute(
      `UPDATE Category SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    const updated = queryOne('SELECT * FROM Category WHERE id = ?', [categoryId]);
    invalidateCache();
    sendSuccess(res, { ...updated, isActive: Boolean(updated.isActive) }, 'Category updated successfully');
  } catch (error) {
    logger.error('Failed to update category', { error: error.message });
    sendError(res, 'Failed to update category', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 카테고리 삭제 (soft delete)
 */
async function deleteCategory(req, res) {
  try {
    const categoryId = parseInt(req.params.id);
    if (Number.isNaN(categoryId)) {
      return sendValidationError(res, [{ field: 'id', message: 'Invalid category id' }]);
    }

    const category = queryOne('SELECT * FROM Category WHERE id = ?', [categoryId]);
    if (!category) {
      return sendError(res, 'Category not found', HTTP_STATUS.NOT_FOUND);
    }

    execute(
      'UPDATE Category SET isActive = ?, updatedAt = ? WHERE id = ?',
      [0, new Date().toISOString(), categoryId]
    );

    invalidateCache();
    sendSuccess(res, { id: categoryId }, 'Category deleted successfully');
  } catch (error) {
    logger.error('Failed to delete category', { error: error.message });
    sendError(res, 'Failed to delete category', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 다른 프로젝트에서 카테고리 트리 복사 (미구현)
 */
async function cloneCategoriesFromProject(req, res) {
  return sendError(res, 'Not implemented', HTTP_STATUS.NOT_IMPLEMENTED);
}

module.exports = {
  getCategoryTree,
  listCategoryGroups,
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
  listCategoriesByGroup,
  createCategory,
  updateCategory,
  deleteCategory,
  cloneCategoriesFromProject
};
