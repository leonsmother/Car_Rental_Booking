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
module.exports = { list, cancel, decide };