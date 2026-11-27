const service = require('./booking.service');

async function list(req, res) {
  try {
    const rows = await service.listBookings(req.user);
    if (rows === null) {
      return res.status(403).json({ error: 'Staff account has no office' });
    }
    res.status(200).json(rows);
  } catch (err) {
    console.error(JSON.stringify({ msg: 'list bookings failed', error: err.message }));
    res.status(500).json({ error: 'Internal error' });
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function cancel(req, res) {
  const id = req.params.id;
  if (!UUID.test(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  try {
    const result = await service.cancelBooking(req.user, id, req.headers['x-request-id'] || null);
    if (result === 'not_found') return res.status(404).json({ error: 'Booking not found' });
    if (result === 'wrong_status') {
      return res.status(409).json({ error: 'Only pending or confirmed bookings can be cancelled' });
    }
    res.status(204).send();
  } catch (err) {
    console.error(JSON.stringify({ msg: 'cancel booking failed', error: err.message }));
    res.status(500).json({ error: 'Internal error' });
  }
}
async function decide(req, res) {
  const id = req.params.id;
  if (!UUID.test(id)) {
    return res.status(400).json({ error: 'Invalid booking id' });
  }
  const decision = req.body && req.body.decision;
  if (decision !== 'confirm' && decision !== 'decline') {
    return res.status(400).json({ error: "decision must be 'confirm' or 'decline'" });
  }
  if (!req.user.officeId) {
    return res.status(403).json({ error: 'Staff account has no office' });
  }
  try {
    const out = await service.decideBooking(
      req.user, id, decision, req.headers['x-request-id'] || null
    );
    if (out.result === 'not_found') return res.status(404).json({ error: 'Booking not found' });
    if (out.result === 'wrong_status') {
      return res.status(409).json({ error: 'Only pending bookings can be decided' });
    }
    if (out.result === 'overlap') {
      return res.status(409).json({ error: 'The car is already booked for those dates' });
    }
    res.status(200).json(out.booking);
  } catch (err) {
    console.error(JSON.stringify({ msg: 'decide booking failed', error: err.message }));
    res.status(500).json({ error: 'Internal error' });
  }
}
function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return d;
}

async function create(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be a JSON object' });
  }
  const allowed = ['carId', 'startDate', 'endDate'];
  if (Object.keys(body).some((k) => !allowed.includes(k))) {
    return res.status(400).json({ error: 'Unknown field in body' });
  }
  if (typeof body.carId !== 'string' || !UUID.test(body.carId)) {
    return res.status(400).json({ error: 'carId must be a valid id' });
  }
  const start = parseDate(body.startDate);
  const end = parseDate(body.endDate);
  if (!start || !end) {
    return res.status(400).json({ error: 'Dates must be real dates like 2026-12-10' });
  }
  if (end <= start) {
    return res.status(400).json({ error: 'endDate must be after startDate' });
  }
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  if (start < today) {
    return res.status(400).json({ error: 'startDate cannot be in the past' });
  }
  const days = Math.round((end - start) / 86400000);

  try {
    const out = await service.createBooking(
      req.user, body, days, req.headers['x-request-id'] || null
    );
    if (out.result === 'car_not_found') return res.status(404).json({ error: 'Car not found' });
    res.status(201).json(out.booking);
  } catch (err) {
    console.error(JSON.stringify({ msg: 'create booking failed', error: err.message }));
    res.status(500).json({ error: 'Internal error' });
  }
}
module.exports = { list, cancel, decide, create };