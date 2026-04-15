const express = require('express');
const router = express.Router();

const projectsController = require('../controllers/projects.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { asyncHandler } = require('../middlewares/async.middleware');
const classificationRulesRoutes = require('./classification-rules.routes');

router.use(authenticate);

router.get('/', asyncHandler(projectsController.listProjects));
router.get('/:id', asyncHandler(projectsController.getProject));
router.post('/', requireRole(['ADMIN', 'LEAD']), asyncHandler(projectsController.createProject));
router.put('/:id', requireRole(['ADMIN', 'LEAD']), asyncHandler(projectsController.updateProject));
router.delete('/:id', requireRole(['ADMIN', 'LEAD']), asyncHandler(projectsController.deleteProject));
router.use('/:projectId/rules', classificationRulesRoutes);

module.exports = router;


