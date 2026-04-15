const express = require('express');
const router = express.Router();
const aiPromptsController = require('../controllers/aiPrompts.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// 모든 라우트에 인증 필요
router.use(authenticate);

// AI 프롬프트 관리
router.get('/', aiPromptsController.getAllPrompts);
router.get('/:name', aiPromptsController.getPromptByName);
router.post('/', aiPromptsController.createPrompt);
router.put('/:name', aiPromptsController.updatePrompt);
router.delete('/:name', aiPromptsController.deletePrompt);

module.exports = router;

