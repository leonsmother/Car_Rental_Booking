// backend/inspection/inspection.service.js
// Data logic for condition reports. This file never sees req or res.
// It connects to Neon with inspection_role, which can only INSERT and SELECT
// on the inspection schema, so a saved report can never be changed.

const { getPool } = require('../db/pool');
const bookingClient = require('./booking.client');
const { HttpError } = require('./inspection.validation');

const FUEL_DROP_LIMIT = 10;   // flag a return if fuel is more than 10 percentage points lower

// ---------- helpers ----------

function toReport(row, showRecorder) {
  const report = {
    id: row.id,
    bookingId: row.booking_id,
    type: row.report_type,
    mileage: row.mileage,
    fuelLevel: row.fuel_level,
    notes: row.notes,
    damageFlag: row.damage_flag,
    recordedAt: row.recorded_at,
  };
  if (showRecorder) report.recordedBy = row.recorded_by;
  return report;
}

// Compare a pick-up report with a return report. Pure function, easy to test.
function compareReports(pickup, ret) {
  const differences = [];

  if (ret.fuelLevel < pickup.fuelLevel - FUEL_DROP_LIMIT) {
    differences.push({
      type: 'fuel',
      description: `Fuel level dropped from ${pickup.fuelLevel}% to ${ret.fuelLevel}%`,
    });
  }
  if (ret.damageFlag) {
    differences.push({
      type: 'damage',
      description: pickup.damageFlag
        ? 'Damage flagged at return and at pick-up, compare the notes'
        : 'Damage reported at return',
    });
  }

  return {
    milesDriven: ret.mileage - pickup.mileage,
    fuelChange: ret.fuelLevel - pickup.fuelLevel,
    differences,
    flagged: differences.length > 0,
  };
}

// Finds the booking and checks it belongs to this user.
// Not yours or does not exist: the same 404, so nobody can probe for other people's ids.
async function loadBookingFor(user, bookingId) {
  const booking = await bookingClient.getBooking(bookingId);
  if (!booking) throw new HttpError(404, 'Booking not found');

  const isMine = user.role === 'staff'
    ? booking.officeId === user.officeId
    : booking.customerId === user.id;

  if (!isMine) throw new HttpError(404, 'Booking not found');
  return booking;
}

async function findReport(db, bookingId, type) {
  const { rows } = await db.query(
    `SELECT id, booking_id, report_type, mileage, fuel_level, notes, damage_flag, recorded_by, recorded_at
       FROM inspection.condition_reports
      WHERE booking_id = $1 AND report_type = $2`,
    [bookingId, type]
  );
  return rows[0] ? toReport(rows[0], true) : null;
}

// ---------- record a pick-up or a return ----------

async function recordReport(user, bookingId, type, data) {
  const booking = await loadBookingFor(user, bookingId);
  if (booking.status !== 'confirmed') {
    throw new HttpError(409, `Booking is ${booking.status}. Only confirmed bookings can be inspected`);
  }

  const pool = getPool('inspection');

  let pickup = null;
  if (type === 'return') {
    pickup = await findReport(pool, bookingId, 'pickup');
    if (!pickup) throw new HttpError(409, 'Record the pick-up before the return');
    if (data.mileage < pickup.mileage) {
      throw new HttpError(400, 'Return mileage cannot be lower than the pick-up mileage');
    }
  }

  const client = await pool.connect();
  let report;
  let comparison = null;

  try {
    await client.query('BEGIN');

    const inserted = await client.query(
      `INSERT INTO inspection.condition_reports
         (booking_id, office_id, report_type, mileage, fuel_level, notes, damage_flag, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, booking_id, report_type, mileage, fuel_level, notes, damage_flag, recorded_by, recorded_at`,
      [bookingId, booking.officeId, type, data.mileage, data.fuelLevel, data.notes, data.damageFlag, user.id]
    );
    report = toReport(inserted.rows[0], true);

    if (type === 'return') {
      comparison = compareReports(pickup, report);
      for (const difference of comparison.differences) {
        await client.query(
          `INSERT INTO inspection.damage_flags (booking_id, return_report_id, description)
           VALUES ($1, $2, $3)`,
          [bookingId, report.id, difference.description]
        );
      }
    }

    await client.query(
      `INSERT INTO inspection.audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, $2, 'condition_report', $3, $4)`,
      [user.id, `${type}_recorded`, report.id, { bookingId }]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {            // unique violation: one report per type per booking
      throw new HttpError(409, `A ${type} report already exists for this booking`);
    }
    throw err;
  } finally {
    client.release();
  }

  const result = { report };

  if (type === 'return') {
    result.comparison = comparison;
    // The report is saved for good now. If Booking cannot be updated, say so honestly.
    try {
      await bookingClient.markCompleted(bookingId, user.id);
      result.bookingCompleted = true;
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', where: 'inspection.markCompleted', bookingId, message: err.message }));
      result.bookingCompleted = false;
    }
  }

  return result;
}

// ---------- read reports of one booking ----------

async function getReports(user, bookingId) {
  await loadBookingFor(user, bookingId);
  const showRecorder = user.role === 'staff';

  const { rows } = await getPool('inspection').query(
    `SELECT id, booking_id, report_type, mileage, fuel_level, notes, damage_flag, recorded_by, recorded_at
       FROM inspection.condition_reports
      WHERE booking_id = $1
      ORDER BY recorded_at`,
    [bookingId]
  );

  const reports = rows.map((row) => toReport(row, showRecorder));
  return {
    bookingId,
    pickup: reports.find((r) => r.type === 'pickup') || null,
    return: reports.find((r) => r.type === 'return') || null,
  };
}

async function getComparison(user, bookingId) {
  const { pickup, return: ret } = await getReports(user, bookingId);
  if (!pickup || !ret) {
    throw new HttpError(404, 'The comparison needs both a pick-up and a return report');
  }
  return { bookingId, pickup, return: ret, ...compareReports(pickup, ret) };
}

// ---------- staff: returns flagged for damage, own office only ----------

async function listFlaggedReturns(user, { limit, offset }) {
  const { rows } = await getPool('inspection').query(
    `SELECT r.id, r.booking_id, r.recorded_at, r.damage_flag,
            COALESCE(
              json_agg(json_build_object('id', f.id, 'description', f.description) ORDER BY f.created_at)
                FILTER (WHERE f.id IS NOT NULL),
              '[]'::json
            ) AS flags
       FROM inspection.condition_reports r
       LEFT JOIN inspection.damage_flags f ON f.return_report_id = r.id
      WHERE r.office_id = $1 AND r.report_type = 'return'
      GROUP BY r.id
     HAVING r.damage_flag OR COUNT(f.id) > 0
      ORDER BY r.recorded_at DESC
      LIMIT $2 OFFSET $3`,
    [user.officeId, limit, offset]
  );

  return rows.map((row) => ({
    reportId: row.id,
    bookingId: row.booking_id,
    recordedAt: row.recorded_at,
    damageFlag: row.damage_flag,
    flags: row.flags,
  }));
}

module.exports = { recordReport, getReports, getComparison, listFlaggedReturns, compareReports };