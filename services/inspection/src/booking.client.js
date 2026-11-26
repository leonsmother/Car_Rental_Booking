// services/inspection/src/booking.client.js
// The ONLY place Inspection talks to Booking. It never reads Booking's tables.
//
// Needs two internal Booking routes (B8, B9) and Eman's SigV4-signed client:
//   GET  {BOOKING_API_URL}/internal/bookings/{id}            -> 200 { id, customerId, officeId, carId, status } or 404
//   POST {BOOKING_API_URL}/internal/bookings/{id}/complete   -> 200   (only from 'confirmed')
// ./internalClient.js (copy of shared/internalClient.js, Eman) must export:
//   call(method, url, body?) -> Promise<{ status, body }>      (3 second timeout)
// Until that file exists, the record routes answer 503 instead of crashing.

const { HttpError } = require('./inspection.validation');

// LOCAL TESTING ONLY: pretend Booking returns one confirmed booking.
// Needs ALLOW_LOCAL_AUTH=true and LOCAL_BOOKING_ID in your .env, and is ignored inside Lambda.
function localBooking() {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return null;
  if (process.env.ALLOW_LOCAL_AUTH !== 'true' || !process.env.LOCAL_BOOKING_ID) return null;
  return {
    id: process.env.LOCAL_BOOKING_ID,
    customerId: process.env.LOCAL_CUSTOMER_ID,
    officeId: process.env.LOCAL_OFFICE_ID,
    carId: process.env.LOCAL_CAR_ID,
    status: 'confirmed',
  };
}

function connection() {
  const base = process.env.BOOKING_API_URL;
  let internal;
  try {
    internal = require('./internalClient');
  } catch (err) {
    internal = null;
  }
  if (!base || !internal || typeof internal.call !== 'function') {
    throw new HttpError(503, 'Booking service is not connected yet');
  }
  return { base: base.replace(/\/$/, ''), internal };
}

async function getBooking(bookingId) {
  const local = localBooking();
  if (local) return bookingId === local.id ? local : null;
  const { base, internal } = connection();
  const res = await internal.call('GET', `${base}/internal/bookings/${bookingId}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new HttpError(503, 'Booking service is not available');
  return res.body;
}

async function markCompleted(bookingId, actorId) {
  if (localBooking()) return;
  const { base, internal } = connection();
  const res = await internal.call('POST', `${base}/internal/bookings/${bookingId}/complete`, { actorId });
  if (res.status !== 200) throw new Error(`Booking answered ${res.status}`);
}

module.exports = { getBooking, markCompleted };
