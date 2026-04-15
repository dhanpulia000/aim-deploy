const express = require('express');
const router = express.Router();
const controller = require('../controllers/categories.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

// 트리 구조 조회 (Admin/Lead)
router.get('/categories/tree', authenticate, controller.getCategoryTree);

// 기존 목록 조회 (레거시 호환)
router.get('/category-groups', authenticate, controller.listCategoryGroups);

// 카테고리 그룹 관리 (Admin only)
router.post('/categories/groups', authenticate, requireRole(['ADMIN', 'LEAD']), controller.createCategoryGroup);
router.put('/categories/groups/:id', authenticate, requireRole(['ADMIN', 'LEAD']), controller.updateCategoryGroup);
router.delete('/categories/groups/:id', authenticate, requireRole(['ADMIN', 'LEAD']), controller.deleteCategoryGroup);

// 그룹별 카테고리 조회 (인증 필요 없음, 읽기 전용)
router.get('/category-groups/:groupId/categories', authenticate, controller.listCategoriesByGroup);

// 카테고리 관리 (Admin only)
router.post('/categories', authenticate, requireRole(['ADMIN', 'LEAD']), controller.createCategory);
router.put('/categories/:id', authenticate, requireRole(['ADMIN', 'LEAD']), controller.updateCategory);
router.delete('/categories/:id', authenticate, requireRole(['ADMIN', 'LEAD']), controller.deleteCategory);

// 다른 프로젝트에서 카테고리 트리 복사
router.post(
  '/categories/clone-from-project',
  authenticate,
  requireRole(['ADMIN', 'LEAD']),
  controller.cloneCategoriesFromProject
);

module.exports = router;












