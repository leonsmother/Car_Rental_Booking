// services/inspection/src/inspection.service.js
// Data logic for condition reports. This file never sees req or res.
// It connects to Neon with inspection_role, which can only INSERT and SELECT
// on the inspection schema, so a saved report can never be changed.

const { getPool } = require('./db');
const photos = require('./photos');
const bookingClient = require('./booking.client');
const { HttpError } = require('./inspection.validation');

const FUEL_DROP_LIMIT = 10;   // flag a return if fuel is more than 10 percentage points lower
// Fuel is stored as a word. For the comparison we turn it into a percentage.
const FUEL_PERCENT = { empty: 0, quarter: 25, half: 50, three_quarter: 75, full: 100 };
const REPORT_COLUMNS = 'id, booking_id, car_id, office_id, type, odometer_km, fuel_level, notes, recorded_by, recorded_at';

// ---------- helpers ----------

function toReport(row, showRecorder) {
  const report = {
    id: row.id,
    bookingId: row.booking_id,
    carId: row.car_id,
    type: row.type,
    mileage: row.odometer_km,
    fuelLevel: row.fuel_level,
    notes: row.notes,
    damageFlag: false,                 // filled in from damage_flags (a return report only)
    recordedAt: row.recorded_at,
  };
  if (showRecorder) report.recordedBy = row.recorded_by;
  return report;
}

// Compare a pick-up report with a return report. Pure function, easy to test.
function compareReports(pickup, ret) {
  const differences = [];

  const fuelChange = FUEL_PERCENT[ret.fuelLevel] - FUEL_PERCENT[pickup.fuelLevel];
  if (fuelChange < -FUEL_DROP_LIMIT) {
    differences.push({
      type: 'fuel',
      description: `Fuel level dropped from ${pickup.fuelLevel} to ${ret.fuelLevel}`,
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
    fuelChange,
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
    `SELECT ${REPORT_COLUMNS}
       FROM inspection.condition_reports
      WHERE booking_id = $1 AND type = $2`,
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

  if (!booking.carId) throw new HttpError(503, 'Booking did not say which car this is');
  if (type === 'pickup' && data.damageFlag) {
    throw new HttpError(400, 'damageFlag is only for a return. Describe damage that is already there in notes');
  }

  const pool = await getPool();

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
         (booking_id, car_id, office_id, type, odometer_km, fuel_level, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${REPORT_COLUMNS}`,
      [bookingId, booking.carId, booking.officeId, type, data.mileage, data.fuelLevel, data.notes, user.id]
    );
    report = toReport(inserted.rows[0], true);

    if (type === 'return') {
      report.damageFlag = data.damageFlag;
      comparison = compareReports(pickup, report);
      for (const difference of comparison.differences) {
        // The staff member's own description is kept; the fuel rule writes its own sentence
        const description = (difference.type === 'damage' && data.notes
          ? `${difference.description}: ${data.notes}` : difference.description).slice(0, 2000);
        await client.query(
          `INSERT INTO inspection.damage_flags (car_id, office_id, return_report_id, pickup_report_id, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [booking.carId, booking.officeId, report.id, pickup.id, description]
        );
      }
    }

    await client.query(
      `INSERT INTO inspection.audit_log (actor, action, entity, entity_id)
       VALUES ($1, $2, 'condition_report', $3)`,
      [user.id, `${type}_recorded`, report.id]
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

  const { rows } = await (await getPool()).query(
    `SELECT ${REPORT_COLUMNS}
       FROM inspection.condition_reports
      WHERE booking_id = $1
      ORDER BY recorded_at`,
    [bookingId]
  );

  const reports = rows.map((row) => toReport(row, showRecorder));
  await attachFlags(reports);
  await attachPhotos(reports);
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

// A return report is "damaged" when it has damage flags. Adds the flags to each return report.
async function attachFlags(reports) {
  const returns = reports.filter((r) => r.type === 'return');
  if (returns.length === 0) return;
  const { rows } = await (await getPool()).query(
    `SELECT id, return_report_id, description, created_at
       FROM inspection.damage_flags
      WHERE return_report_id = ANY($1::uuid[])
      ORDER BY created_at`,
    [returns.map((r) => r.id)]
  );
  for (const report of returns) {
    report.damageFlags = rows
      .filter((f) => f.return_report_id === report.id)
      .map((f) => ({ id: f.id, description: f.description, createdAt: f.created_at }));
    report.damageFlag = report.damageFlags.length > 0;
  }
}

// ---------- photos (files live in S3, only the key is stored in Neon) ----------

const MAX_PHOTOS_PER_REPORT = 6;

// Adds short-lived view links (5 minutes) to each report. The bucket itself is private.
async function attachPhotos(reports) {
  if (reports.length === 0) return;
  const { rows } = await (await getPool()).query(
    `SELECT id, report_id, s3_key, content_type
       FROM inspection.photos
      WHERE report_id = ANY($1::uuid[])
      ORDER BY uploaded_at`,
    [reports.map((r) => r.id)]
  );
  for (const report of reports) {
    report.photos = [];
    for (const row of rows.filter((p) => p.report_id === report.id)) {
      report.photos.push({
        id: row.id,
        contentType: row.content_type,
        url: await photos.createViewUrl(row.s3_key),
        urlExpiresInSeconds: photos.VIEW_URL_SECONDS,
      });
    }
  }
}

// Staff only (route). The booking must belong to the staff member's office, and the report must exist.
async function loadReportId(user, bookingId, type) {
  await loadBookingFor(user, bookingId);
  const { rows } = await (await getPool()).query(
    `SELECT id FROM inspection.condition_reports WHERE booking_id = $1 AND type = $2`,
    [bookingId, type]
  );
  if (!rows[0]) throw new HttpError(404, `There is no ${type} report for this booking yet`);
  return rows[0].id;
}

// Step 1 of a photo upload: give the browser a short-lived link to upload ONE file straight to S3.
async function requestPhotoUpload(user, bookingId, { type, contentType }) {
  const reportId = await loadReportId(user, bookingId, type);
  return photos.createUploadUrl(reportId, contentType);
}

// Step 2: the browser says it uploaded. We check the real file in S3 before we record it.
async function confirmPhoto(user, bookingId, { type, key }) {
  const reportId = await loadReportId(user, bookingId, type);

  // The key must be one we issued for THIS report (stops a staff member recording someone else's file)
  if (!key.startsWith(`reports/${reportId}/`)) throw new HttpError(400, 'Invalid photo key');

  const pool = await getPool();
  const count = await pool.query('SELECT count(*)::int AS n FROM inspection.photos WHERE report_id = $1', [reportId]);
  if (count.rows[0].n >= MAX_PHOTOS_PER_REPORT) {
    throw new HttpError(409, `A report can have at most ${MAX_PHOTOS_PER_REPORT} photos`);
  }

  const file = await photos.verifyUploaded(key);      // 400 (and the file is deleted) if wrong type or too big

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO inspection.photos (report_id, s3_key, content_type, size_bytes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [reportId, key, file.contentType, file.size]
    );
    await client.query(
      `INSERT INTO inspection.audit_log (actor, action, entity, entity_id)
       VALUES ($1, 'photo_added', 'photo', $2)`,
      [user.id, rows[0].id]
    );
    await client.query('COMMIT');
    return { photo: { id: rows[0].id, reportId, contentType: file.contentType, size: file.size } };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw new HttpError(409, 'This photo is already recorded');
    throw err;
  } finally {
    client.release();
  }
}

// ---------- staff: damage flags of their own office ----------

async function listFlaggedReturns(user, { limit, offset }) {
  const { rows } = await (await getPool()).query(
    `SELECT f.id, f.car_id, f.description, f.created_at, f.return_report_id, r.booking_id
       FROM inspection.damage_flags f
       JOIN inspection.condition_reports r ON r.id = f.return_report_id
      WHERE f.office_id = $1
      ORDER BY f.created_at DESC
      LIMIT $2 OFFSET $3`,
    [user.officeId, limit, offset]
  );

  return rows.map((row) => ({
    flagId: row.id,
    carId: row.car_id,
    bookingId: row.booking_id,
    returnReportId: row.return_report_id,
    description: row.description,
    flaggedAt: row.created_at,
  }));
}

module.exports = {
  recordReport, getReports, getComparison, listFlaggedReturns, compareReports,
  requestPhotoUpload, confirmPhoto,
};