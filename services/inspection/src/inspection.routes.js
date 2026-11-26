// services/inspection/src/inspection.routes.js
// Maps method + path to a controller function and says which roles may call it.
// auth.js checks who the caller is (401); requireRole checks what they may do (403).
// Routes I1-I7 (the API Gateway template lists the same seven).

const express = require('express');
const { authenticate } = require('./auth');
const requireRole = require('./requireRole');
const controller = require('./inspection.controller');

const router = express.Router();

router.use(authenticate);

router.get('/',                          requireRole('staff'),             controller.listFlaggedReturns); // I1
router.post('/:bookingId/pickup',        requireRole('staff'),             controller.recordPickup);       // I2
router.post('/:bookingId/return',        requireRole('staff'),             controller.recordReturn);       // I3
router.get('/:bookingId/comparison',     requireRole('customer', 'staff'), controller.getComparison);      // I4
router.get('/:bookingId',                requireRole('customer', 'staff'), controller.getReports);         // I5 (includes photo links)
router.post('/:bookingId/photos/upload-url', requireRole('staff'),         controller.requestPhotoUpload); // I6
router.post('/:bookingId/photos',        requireRole('staff'),             controller.confirmPhoto);       // I7

module.exports = router;
