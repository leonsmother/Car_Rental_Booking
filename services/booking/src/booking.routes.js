const express = require('express');
const { authenticate } = require('../../../shared/auth');
const requireRole = require('../../../shared/requireRole');
const controller = require('./booking.controller');

const router = express.Router();

router.get('/', authenticate, requireRole('customer', 'staff'), controller.list);

module.exports = router;