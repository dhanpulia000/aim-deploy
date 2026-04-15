const projectsService = require('../services/projects.service');
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');

const listProjects = asyncMiddleware(async (req, res) => {
  const projects = await projectsService.listProjectsForUser(req.user);
  return sendSuccess(res, projects, 'Projects retrieved successfully');
});

const getProject = asyncMiddleware(async (req, res) => {
  const { id } = req.params;
  const project = await projectsService.getProjectById(id);

  if (!project) {
    return sendError(res, 'Project not found', HTTP_STATUS.NOT_FOUND);
  }

  return sendSuccess(res, project, 'Project retrieved successfully');
});

const createProject = asyncMiddleware(async (req, res) => {
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    return sendError(res, 'Project name is required', HTTP_STATUS.BAD_REQUEST);
  }

  const project = await projectsService.createProject({
    name: name.trim(),
    description: description?.trim() || null
  });

  return sendSuccess(res, project, 'Project created successfully');
});

const updateProject = asyncMiddleware(async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    return sendError(res, 'Project name is required', HTTP_STATUS.BAD_REQUEST);
  }

  const project = await projectsService.updateProject(id, {
    name: name.trim(),
    description: description?.trim() || null
  });

  if (!project) {
    return sendError(res, 'Project not found', HTTP_STATUS.NOT_FOUND);
  }

  return sendSuccess(res, project, 'Project updated successfully');
});

const deleteProject = asyncMiddleware(async (req, res) => {
  const { id } = req.params;

  const deleted = await projectsService.deleteProject(id);

  if (!deleted) {
    return sendError(res, 'Project not found', HTTP_STATUS.NOT_FOUND);
  }

  return sendSuccess(res, { id }, 'Project deleted successfully');
});

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject
};


