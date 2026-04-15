const express = require('express');
const router = express.Router();
const handoverController = require('../controllers/handover.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// 로그인 사용자 모두 조회·작성 가능
router.get('/records', authenticate, handoverController.listRecords);
router.get('/records/:workDate/:workType', authenticate, handoverController.getRecord);
router.put('/records', authenticate, express.json(), handoverController.upsertRecord);

module.exports = router;
