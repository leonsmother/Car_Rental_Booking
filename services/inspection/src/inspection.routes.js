// backend/inspection/inspection.routes.js
// Maps method + path to a controller function and says which roles may call it.
//
// Assumes (see the notes next to this file):
//   ../middleware/auth.js        exports a function that verifies the token (401 if missing or bad)
//                                and sets req.user = { id, role, officeId }
//   ../middleware/requireRole.js exports requireRole(...roles) which answers 403 for other roles

const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const controller = require('./inspection.controller');

const router = express.Router();

router.use(auth);

router.get('/',                      requireRole('staff'),             controller.listFlaggedReturns);
router.post('/:bookingId/pickup',    requireRole('staff'),             controller.recordPickup);
router.post('/:bookingId/return',    requireRole('staff'),             controller.recordReturn);
router.get('/:bookingId/comparison', requireRole('customer', 'staff'), controller.getComparison);
router.get('/:bookingId',            requireRole('customer', 'staff'), controller.getReports);

module.exports = router;
