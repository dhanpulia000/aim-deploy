const express = require('express');
const router = express.Router();
const stepFloatingController = require('../controllers/stepFloating.controller');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');

// 조회: 로그인 사용자 (에이전트용)
router.get('/items', authenticate, stepFloatingController.listItems);
router.get('/items/:id', authenticate, stepFloatingController.getItem);

// 관리자 전용: CRUD
router.post('/items', authenticate, requireAdmin(), express.json(), stepFloatingController.createItem);
router.patch('/items/:id', authenticate, requireAdmin(), express.json(), stepFloatingController.updateItem);
router.delete('/items/:id', authenticate, requireAdmin(), stepFloatingController.deleteItem);
router.post('/items/reorder', authenticate, requireAdmin(), express.json(), stepFloatingController.reorderItems);

module.exports = router;
