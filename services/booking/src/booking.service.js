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
// Returns 'ok', 'not_found' or 'wrong_status'
async function cancelBooking(user, bookingId, requestId) {
  const pool = await db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ownership is checked in the query: someone else's booking looks like "not found"
    const found = await client.query(
      `SELECT status FROM booking.bookings
       WHERE id = $1 AND customer_id = $2
       FOR UPDATE`,
      [bookingId, user.id]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return 'not_found';
    }

    const oldStatus = found.rows[0].status;
    if (!['pending', 'confirmed'].includes(oldStatus)) {
      await client.query('ROLLBACK');
      return 'wrong_status';
    }

    await client.query(
      `UPDATE booking.bookings SET status = 'cancelled' WHERE id = $1`,
      [bookingId]
    );
    await client.query(
      `INSERT INTO booking.audit_log
         (booking_id, actor_id, actor_role, action, old_status, new_status, request_id)
       VALUES ($1, $2, 'customer', 'cancelled', $3, 'cancelled', $4)`,
      [bookingId, user.id, oldStatus, requestId]
    );

    await client.query('COMMIT');
    return 'ok';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
module.exports = { listBookings, cancelBooking};