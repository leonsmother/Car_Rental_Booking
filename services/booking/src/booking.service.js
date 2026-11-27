const db = require('../../../shared/db');

const COLUMNS = `id, car_id, office_id, customer_id, start_date, end_date,
                 daily_price, total_price, status, created_at, updated_at`;

// Customer: only their own bookings. Staff: only their office's bookings.
async function listBookings(user) {
  if (user.groups.includes('staff')) {
    if (!user.officeId) return null; // staff with no office assigned
    const r = await db.query(
      `SELECT ${COLUMNS} FROM booking.bookings
       WHERE office_id = $1 ORDER BY created_at DESC`,
      [user.officeId]
    );
    return r.rows;
  }

  const r = await db.query(
    `SELECT ${COLUMNS} FROM booking.bookings
     WHERE customer_id = $1 ORDER BY created_at DESC`,
    [user.id]
  );
  return r.rows;
}

module.exports = { listBookings };