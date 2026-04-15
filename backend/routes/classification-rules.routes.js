const express = require('express');
const router = express.Router({ mergeParams: true });

const controller = require('../controllers/classification-rules.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/', controller.listRules);
router.post('/', requireRole(['ADMIN', 'LEAD']), controller.createRule);
router.put('/:ruleId', requireRole(['ADMIN', 'LEAD']), controller.updateRule);
router.delete('/:ruleId', requireRole(['ADMIN', 'LEAD']), controller.deleteRule);

module.exports = router;



