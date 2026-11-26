// services/inspection/src/inspection.validation.js
// Input checks for the Inspection module. The controller calls these BEFORE the
// service runs: this is the trust boundary. Anything that fails gets a 400.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONDITION_FIELDS = ['mileage', 'fuelLevel', 'notes', 'damageFlag'];
const FUEL_LEVELS = ['empty', 'quarter', 'half', 'three_quarter', 'full'];   // same list as the database check

function parseUuid(value, name) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new HttpError(400, `${name} must be a valid id`);
  }
  return value.toLowerCase();
}

// Body of POST /inspections/:bookingId/pickup and /return
function parseConditionBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }

  const unknown = Object.keys(body).filter((key) => !CONDITION_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown field(s): ${unknown.join(', ')}`);
  }

  const { mileage, fuelLevel, notes, damageFlag } = body;

  if (!Number.isInteger(mileage) || mileage < 0 || mileage > 2000000) {
    throw new HttpError(400, 'mileage must be a whole number between 0 and 2,000,000');
  }
  if (!FUEL_LEVELS.includes(fuelLevel)) {
    throw new HttpError(400, `fuelLevel must be one of: ${FUEL_LEVELS.join(', ')}`);
  }

  let cleanNotes = null;
  if (notes !== undefined && notes !== null) {
    if (typeof notes !== 'string') {
      throw new HttpError(400, 'notes must be text');
    }
    cleanNotes = notes.trim();
    if (cleanNotes.length > 2000) {
      throw new HttpError(400, 'notes can be at most 2000 characters');
    }
    if (cleanNotes === '') cleanNotes = null;
  }

  if (damageFlag !== undefined && typeof damageFlag !== 'boolean') {
    throw new HttpError(400, 'damageFlag must be true or false');
  }

  return { mileage, fuelLevel, notes: cleanNotes, damageFlag: damageFlag === true };
}

// Query string of GET /inspections?damage=true&limit=50&offset=0
function parseListQuery(query) {
  if (query.damage !== 'true') {
    throw new HttpError(400, 'damage=true is required');
  }

  let limit = 50;
  let offset = 0;

  if (query.limit !== undefined) {
    if (!/^\d+$/.test(query.limit) || Number(query.limit) < 1 || Number(query.limit) > 100) {
      throw new HttpError(400, 'limit must be a whole number between 1 and 100');
    }
    limit = Number(query.limit);
  }
  if (query.offset !== undefined) {
    if (!/^\d+$/.test(query.offset)) {
      throw new HttpError(400, 'offset must be a whole number, 0 or more');
    }
    offset = Number(query.offset);
  }
  return { limit, offset };
}

const REPORT_TYPES = ['pickup', 'return'];
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

function rejectUnknown(body, allowed) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new HttpError(400, `Unknown field(s): ${unknown.join(', ')}`);
}

// Body of POST /inspections/:bookingId/photos/upload-url
function parsePhotoUploadBody(body) {
  rejectUnknown(body, ['type', 'contentType']);
  if (!REPORT_TYPES.includes(body.type)) throw new HttpError(400, "type must be 'pickup' or 'return'");
  if (!PHOTO_TYPES.includes(body.contentType)) throw new HttpError(400, 'Only image/jpeg and image/png photos are allowed');
  return { type: body.type, contentType: body.contentType };
}

// Body of POST /inspections/:bookingId/photos
function parsePhotoConfirmBody(body) {
  rejectUnknown(body, ['type', 'key']);
  if (!REPORT_TYPES.includes(body.type)) throw new HttpError(400, "type must be 'pickup' or 'return'");
  if (typeof body.key !== 'string' || body.key.length === 0 || body.key.length > 200) {
    throw new HttpError(400, 'key must be a text of at most 200 characters');
  }
  return { type: body.type, key: body.key };
}

module.exports = { HttpError, parseUuid, parseConditionBody, parseListQuery, parsePhotoUploadBody, parsePhotoConfirmBody };
