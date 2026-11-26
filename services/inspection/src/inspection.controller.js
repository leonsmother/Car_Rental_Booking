// backend/inspection/inspection.controller.js
// HTTP side only: validate the input, call the service, send the status code and JSON.
// Who is allowed (401 / 403) is decided earlier by the auth and requireRole middleware.

const service = require('./inspection.service');
const { HttpError, parseUuid, parseConditionBody, parseListQuery } = require('./inspection.validation');

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      // Our own bug or the database failed. Log it, never send details to the browser.
      console.error(JSON.stringify({
        level: 'error', where: 'inspection', method: req.method, path: req.path, message: err.message,
      }));
      return res.status(500).json({ error: 'Something went wrong on our side' });
    }
  };
}

const recordPickup = handle(async (req, res) => {
  const bookingId = parseUuid(req.params.bookingId, 'bookingId');
  const data = parseConditionBody(req.body);
  const result = await service.recordReport(req.user, bookingId, 'pickup', data);
  res.status(201).json(result);
});

const recordReturn = handle(async (req, res) => {
  const bookingId = parseUuid(req.params.bookingId, 'bookingId');
  const data = parseConditionBody(req.body);
  const result = await service.recordReport(req.user, bookingId, 'return', data);
  res.status(201).json(result);
});

const getReports = handle(async (req, res) => {
  const bookingId = parseUuid(req.params.bookingId, 'bookingId');
  res.status(200).json(await service.getReports(req.user, bookingId));
});

const getComparison = handle(async (req, res) => {
  const bookingId = parseUuid(req.params.bookingId, 'bookingId');
  res.status(200).json(await service.getComparison(req.user, bookingId));
});

const listFlaggedReturns = handle(async (req, res) => {
  const paging = parseListQuery(req.query);
  res.status(200).json(await service.listFlaggedReturns(req.user, paging));
});

module.exports = { recordPickup, recordReturn, getReports, getComparison, listFlaggedReturns };
