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

module.exports = { list };