const express = require('express');
const { authenticate } = require('../../../shared/auth');
const requireRole = require('../../../shared/requireRole');
const controller = require('./booking.controller');

const router = express.Router();

router.get('/', authenticate, requireRole('customer', 'staff'), controller.list);
router.delete('/:id', authenticate, requireRole('customer'), controller.cancel);
router.patch('/:id/decision', authenticate, requireRole('staff'), controller.decide);
module.exports = router;