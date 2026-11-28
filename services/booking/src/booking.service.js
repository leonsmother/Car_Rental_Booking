const db = require('./shared/db');

const COLUMNS = `id, car_id, office_id, customer_id,
                 to_char(start_date, 'YYYY-MM-DD') AS start_date,
                 to_char(end_date, 'YYYY-MM-DD') AS end_date,
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
// Returns { result: 'ok', booking } or { result: 'not_found' | 'wrong_status' | 'overlap' }
async function decideBooking(user, bookingId, decision, requestId) {
  const newStatus = decision === 'confirm' ? 'confirmed' : 'declined';
  const action = decision === 'confirm' ? 'confirmed' : 'declined';

  const pool = await db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Office check is in the query: another office's booking looks like "not found"
    const found = await client.query(
      `SELECT status FROM booking.bookings
       WHERE id = $1 AND office_id = $2
       FOR UPDATE`,
      [bookingId, user.officeId]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return { result: 'not_found' };
    }

    const oldStatus = found.rows[0].status;
    if (oldStatus !== 'pending') {
      await client.query('ROLLBACK');
      return { result: 'wrong_status' };
    }

    const updated = await client.query(
      `UPDATE booking.bookings SET status = $1 WHERE id = $2
       RETURNING ${COLUMNS}`,
      [newStatus, bookingId]
    );
    await client.query(
      `INSERT INTO booking.audit_log
         (booking_id, actor_id, actor_role, action, old_status, new_status, request_id)
       VALUES ($1, $2, 'staff', $3, $4, $5, $6)`,
      [bookingId, user.id, action, oldStatus, newStatus, requestId]
    );

    await client.query('COMMIT');
    return { result: 'ok', booking: updated.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23P01') return { result: 'overlap' }; // exclusion constraint
    throw err;
  } finally {
    client.release();
  }
}
// TEMPORARY: fake quote. Replace with the real Catalogue call
// (shared/internalClient.js + CATALOGUE_API_URL) when Jana's URL is ready.
// Asks the Catalogue service for the car's office and price.
// Returns { officeId, dailyPrice, total }, null if the car does not exist,
// { unavailable: true } if it is not available, or { badRequest: true }.
// If CATALOGUE_API_URL is empty, falls back to a fake quote (local tests only).
async function getCarQuote(input, days) {
  const base = process.env.CATALOGUE_API_URL;
  if (!base) {
    return { officeId: '11111111-1111-1111-1111-111111111111', dailyPrice: 500, total: 500 * days };
  }
  const down = (msg) => { const e = new Error(msg); e.code = 'CATALOGUE_DOWN'; return e; };

  // On AWS: signed call to Catalogue C10
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const internalClient = require('./shared/internalClient');
    let r;
    try {
      r = await internalClient.call('POST', `${base}/internal/quote`, {
        carId: input.carId, startDate: input.startDate, endDate: input.endDate,
      });
    } catch (err) {
      throw down('Catalogue is not reachable');
    }
    if (r.status === 404) return null;
    if (r.status === 409) return { unavailable: true };
    if (r.status === 400) return { badRequest: true };
    if (r.status !== 200 || !r.body) throw down(`Catalogue answered ${r.status}`);
    return { officeId: r.body.officeId, dailyPrice: r.body.dailyPrice, total: r.body.total };
  }

  // Local only: the public car route (no signing needed)
  let res;
  try {
    res = await fetch(`${base}/cars/${input.carId}`, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    throw down('Catalogue service is not reachable');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw down(`Catalogue answered ${res.status}`);
  const car = await res.json();
  if (car.status && car.status !== 'available') return { unavailable: true };
  const dailyPrice = Number(car.daily_price);
  if (!car.office_id || !Number.isFinite(dailyPrice) || dailyPrice <= 0) {
    throw down('Catalogue returned an unexpected car format');
  }
  return { officeId: car.office_id, dailyPrice, total: dailyPrice * days };
}

// Returns { result: 'ok', booking } or { result: 'car_not_found' }
async function createBooking(user, input, days, requestId) {
  const quote = await getCarQuote(input, days);
  if (!quote) return { result: 'car_not_found' };
  if (quote.unavailable) return { result: 'car_unavailable' };
  if (quote.badRequest) return { result: 'bad_request' };
  const total = quote.total;

  const pool = await db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO booking.bookings
         (car_id, office_id, customer_id, start_date, end_date, daily_price, total_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [input.carId, quote.officeId, user.id, input.startDate, input.endDate, quote.dailyPrice, total]
    );
    const booking = created.rows[0];
    await client.query(
      `INSERT INTO booking.audit_log
         (booking_id, actor_id, actor_role, action, old_status, new_status, request_id)
       VALUES ($1, $2, 'customer', 'created', NULL, 'pending', $3)`,
      [booking.id, user.id, requestId]
    );
    await client.query('COMMIT');
    return { result: 'ok', booking };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
// Internal (service to service). Returns the booking or null.
async function getBookingForService(bookingId) {
  const r = await db.query(
    `SELECT id, customer_id, office_id, car_id, status
     FROM booking.bookings WHERE id = $1`,
    [bookingId]
  );
  return r.rows[0] || null;
}

// Internal: confirmed -> picked_up -> completed in one transaction.
// Returns { result: 'ok', booking } or { result: 'not_found' | 'wrong_status' }
async function completeBooking(bookingId, actorId, requestId) {
  const pool = await db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT status FROM booking.bookings WHERE id = $1 FOR UPDATE`,
      [bookingId]
    );
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return { result: 'not_found' };
    }
    if (found.rows[0].status !== 'confirmed') {
      await client.query('ROLLBACK');
      return { result: 'wrong_status' };
    }

    const steps = [['confirmed', 'picked_up', 'picked_up'], ['picked_up', 'completed', 'completed']];
    let booking;
    for (const [from, to, action] of steps) {
      const u = await client.query(
        `UPDATE booking.bookings SET status = $1 WHERE id = $2 RETURNING ${COLUMNS}`,
        [to, bookingId]
      );
      booking = u.rows[0];
      await client.query(
        `INSERT INTO booking.audit_log
           (booking_id, actor_id, actor_role, action, old_status, new_status, request_id)
         VALUES ($1, $2, 'service', $3, $4, $5, $6)`,
        [bookingId, actorId, action, from, to, requestId]
      );
    }

    await client.query('COMMIT');
    return { result: 'ok', booking };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
module.exports = { listBookings, cancelBooking, decideBooking, createBooking, getBookingForService, completeBooking};