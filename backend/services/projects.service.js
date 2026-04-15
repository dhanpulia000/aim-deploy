const { PrismaClient } = require('@prisma/client');
const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');
const { seedCategoryTaxonomy } = require('../prisma/projectCategoryTaxonomy.seed');

let prismaSingleton;
function getPrisma() {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}

async function listProjectsForUser(/* user */) {
  const projects = query('SELECT * FROM Project ORDER BY createdAt ASC');
  
  // 각 프로젝트의 채널 조회
  const projectIds = projects.map(p => p.id);
  let channels = [];
  if (projectIds.length > 0) {
    const placeholders = projectIds.map(() => '?').join(',');
    channels = query(
      `SELECT * FROM Channel WHERE projectId IN (${placeholders}) AND isActive = ? ORDER BY createdAt ASC`,
      [...projectIds, 1]
    );
  }
  
  // 채널을 프로젝트별로 그룹화
  const channelsByProject = {};
  channels.forEach(channel => {
    if (!channelsByProject[channel.projectId]) {
      channelsByProject[channel.projectId] = [];
    }
    channelsByProject[channel.projectId].push(channel);
  });
  
  return projects.map(project => ({
    ...project,
    channels: channelsByProject[project.id] || []
  }));
}

async function getProjectById(projectId) {
  const id = Number(projectId);
  if (Number.isNaN(id)) {
    return null;
  }

  const project = queryOne('SELECT * FROM Project WHERE id = ?', [id]);
  if (!project) {
    return null;
  }
  
  const channels = query(
    'SELECT * FROM Channel WHERE projectId = ? AND isActive = ? ORDER BY createdAt ASC',
    [id, 1]
  );
  
  return {
    ...project,
    channels
  };
}

async function createProject(data) {
  const { name, description } = data;
  const prisma = getPrisma();

  let newId;
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          description: description || null
        }
      });
      newId = created.id;
      await seedCategoryTaxonomy(tx, created.id);
    });
  } catch (e) {
    logger.error('[ProjectsService] createProject failed', { error: e.message, stack: e.stack });
    throw e;
  }

  const project = queryOne('SELECT * FROM Project WHERE id = ?', [newId]);
  if (!project) {
    throw new Error('Project was created but could not be loaded');
  }

  logger.info('[ProjectsService] Project created with category taxonomy', { projectId: newId });

  const channels = query('SELECT * FROM Channel WHERE projectId = ? AND isActive = ? ORDER BY createdAt ASC', [
    project.id,
    1
  ]);

  return {
    ...project,
    channels
  };
}

async function updateProject(projectId, data) {
  const id = Number(projectId);
  if (Number.isNaN(id)) {
    return null;
  }

  const { name, description } = data;
  const now = new Date().toISOString();

  execute(
    'UPDATE Project SET name = ?, description = ?, updatedAt = ? WHERE id = ?',
    [name, description || null, now, id]
  );
  
  const project = queryOne('SELECT * FROM Project WHERE id = ?', [id]);
  const channels = query(
    'SELECT * FROM Channel WHERE projectId = ? AND isActive = ? ORDER BY createdAt ASC',
    [id, 1]
  );
  
  return {
    ...project,
    channels
  };
}

async function deleteProject(projectId) {
  const id = Number(projectId);
  if (Number.isNaN(id)) {
    return null;
  }

  // 프로젝트 존재 확인
  const project = queryOne('SELECT * FROM Project WHERE id = ?', [id]);
  if (!project) {
    return null;
  }

  // 연결된 데이터 확인
  const issuesCount = queryOne('SELECT COUNT(*) as count FROM ReportItemIssue WHERE projectId = ?', [id])?.count || 0;
  const agentsCount = queryOne('SELECT COUNT(*) as count FROM Agent WHERE projectId = ?', [id])?.count || 0;
  const categoryGroupsCount = queryOne('SELECT COUNT(*) as count FROM CategoryGroup WHERE projectId = ?', [id])?.count || 0;
  const monitoredBoardsCount = queryOne('SELECT COUNT(*) as count FROM MonitoredBoard WHERE projectId = ?', [id])?.count || 0;

  // 연결된 데이터가 있으면 삭제 불가
  if (issuesCount > 0 || agentsCount > 0 || categoryGroupsCount > 0 || monitoredBoardsCount > 0) {
    throw new Error('Cannot delete project with associated data');
  }

  execute('DELETE FROM Project WHERE id = ?', [id]);

  return { id };
}

module.exports = {
  listProjectsForUser,
  getProjectById,
  createProject,
  updateProject,
  deleteProject
};
