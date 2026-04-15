const express = require('express');
const router = express.Router();

const controller = require('../controllers/metrics.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/overview', controller.getOverview);

module.exports = router;



