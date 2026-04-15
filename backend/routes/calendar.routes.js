const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const calendarController = require('../controllers/calendar.controller');

router.get('/events', authenticate, calendarController.listEvents);
router.post('/events', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), calendarController.createEvent);
router.put('/events/:id', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), calendarController.updateEvent);
router.delete('/events/:id', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), calendarController.deleteEvent);

module.exports = router;
