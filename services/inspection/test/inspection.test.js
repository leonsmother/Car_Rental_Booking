// npm test  (no AWS, no database: everything outside is replaced by small fakes)
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');

// ---- fake AWS SDK so the tests run without installing it ----
const sent = [];
const fakeS3Module = {
  S3Client: class {},
  PutObjectCommand: class { constructor(i) { this.input = i; this.kind = 'put'; } },
  GetObjectCommand: class { constructor(i) { this.input = i; this.kind = 'get'; } },
  HeadObjectCommand: class { constructor(i) { this.input = i; this.kind = 'head'; } },
  DeleteObjectCommand: class { constructor(i) { this.input = i; this.kind = 'delete'; } },
};
const fakePresigner = { getSignedUrl: async (c, cmd, o) => `https://signed.example/${cmd.input.Key}?exp=${o.expiresIn}` };
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@aws-sdk/client-s3') return fakeS3Module;
  if (request === '@aws-sdk/s3-request-presigner') return fakePresigner;
  if (request === 'pg') return { Pool: class { on() {} } };
  return origLoad.call(this, request, ...rest);
};

const src = (f) => path.join(__dirname, '..', 'src', f);
process.env.PHOTO_BUCKET = 'test-bucket';

// ---------- validation ----------
const v = require(src('inspection.validation'));

test('photo upload body: only jpeg/png and known fields', () => {
  assert.deepStrictEqual(v.parsePhotoUploadBody({ type: 'pickup', contentType: 'image/png' }), { type: 'pickup', contentType: 'image/png' });
  assert.throws(() => v.parsePhotoUploadBody({ type: 'pickup', contentType: 'application/pdf' }), /jpeg and image\/png/);
  assert.throws(() => v.parsePhotoUploadBody({ type: 'other', contentType: 'image/png' }), /pickup/);
  assert.throws(() => v.parsePhotoUploadBody({ type: 'pickup', contentType: 'image/png', extra: 1 }), /Unknown field/);
  assert.throws(() => v.parsePhotoUploadBody(null), /JSON object/);
});

test('photo confirm body', () => {
  assert.ok(v.parsePhotoConfirmBody({ type: 'return', key: 'reports/x/y.jpg' }));
  assert.throws(() => v.parsePhotoConfirmBody({ type: 'return', key: '' }), /key/);
  assert.throws(() => v.parsePhotoConfirmBody({ type: 'return', key: 'a'.repeat(201) }), /key/);
});

// ---------- requireRole + auth ----------
const requireRole = require(src('requireRole'));
function run(mw, req) {
  return new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    mw(req, res, () => resolve({ code: 'next', req }));
  });
}

test('requireRole: 401 without user, 403 wrong role, next when allowed', async () => {
  assert.strictEqual((await run(requireRole('staff'), {})).code, 401);
  assert.strictEqual((await run(requireRole('staff'), { user: { role: 'customer' } })).code, 403);
  assert.strictEqual((await run(requireRole('staff', 'customer'), { user: { role: 'customer' } })).code, 'next');
});

const dbPath = require.resolve(src('db'));
let officeRow = [{ office_id: 'office-1' }];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: officeRow }), getPool: async () => fakePool } };
const { authenticate } = require(src('auth'));
const claimsReq = (claims) => ({ headers: {}, apiGateway: { event: { requestContext: { authorizer: { jwt: { claims } } } } } });

test('auth: no token claims -> 401', async () => {
  assert.strictEqual((await run(authenticate, { headers: {} })).code, 401);
});
test('auth: customer gets id and role, no office', async () => {
  const r = await run(authenticate, claimsReq({ sub: 'c1', 'cognito:groups': '[customer]' }));
  assert.deepStrictEqual(r.req.user, { id: 'c1', role: 'customer', officeId: null });
});
test('auth: staff office comes from the database', async () => {
  const r = await run(authenticate, claimsReq({ sub: 's1', 'cognito:groups': '[staff]' }));
  assert.deepStrictEqual(r.req.user, { id: 's1', role: 'staff', officeId: 'office-1' });
});
test('auth: staff without an office -> 403, no group -> 403', async () => {
  officeRow = [];
  assert.strictEqual((await run(authenticate, claimsReq({ sub: 's2', 'cognito:groups': '[staff]' }))).code, 403);
  officeRow = [{ office_id: 'office-1' }];
  assert.strictEqual((await run(authenticate, claimsReq({ sub: 'x', 'cognito:groups': '[]' }))).code, 403);
});
test('auth: local test headers are ignored unless ALLOW_LOCAL_AUTH=true', async () => {
  const req = () => ({ headers: { 'x-local-user': 'evil', 'x-local-groups': 'staff' } });
  delete process.env.ALLOW_LOCAL_AUTH;
  assert.strictEqual((await run(authenticate, req())).code, 401);
  process.env.ALLOW_LOCAL_AUTH = 'true';
  assert.strictEqual((await run(authenticate, req())).code, 'next');
  delete process.env.ALLOW_LOCAL_AUTH;
});

// ---------- photos (S3) ----------
const photos = require(src('photos'));
const fakeS3 = (head) => ({ send: async (cmd) => { sent.push(cmd.kind); if (cmd.kind === 'head') { if (head instanceof Error) throw head; return head; } return {}; } });

test('photos: upload link has a key under the report and expires in 5 minutes', async () => {
  const r = await photos.createUploadUrl('rep-1', 'image/jpeg');
  assert.match(r.key, /^reports\/rep-1\/[0-9a-f-]{36}\.jpg$/);
  assert.strictEqual(r.expiresInSeconds, 300);
  assert.strictEqual(r.maxBytes, 5 * 1024 * 1024);
  await assert.rejects(photos.createUploadUrl('rep-1', 'image/gif'), /jpeg and image\/png/);
});
test('photos: file too big or wrong type is deleted and refused', async () => {
  sent.length = 0;
  photos._setClientForTests(fakeS3({ ContentLength: 6 * 1024 * 1024, ContentType: 'image/jpeg' }));
  await assert.rejects(photos.verifyUploaded('reports/r/a.jpg'), /5 MB/);
  assert.ok(sent.includes('delete'));
  photos._setClientForTests(fakeS3({ ContentLength: 1000, ContentType: 'text/html' }));
  await assert.rejects(photos.verifyUploaded('reports/r/a.jpg'), /JPEG or PNG/);
});
test('photos: missing file -> 400, good file -> size and type', async () => {
  const nf = Object.assign(new Error('nf'), { name: 'NotFound' });
  photos._setClientForTests(fakeS3(nf));
  await assert.rejects(photos.verifyUploaded('reports/r/a.jpg'), /No uploaded file/);
  photos._setClientForTests(fakeS3({ ContentLength: 2048, ContentType: 'image/png' }));
  assert.deepStrictEqual(await photos.verifyUploaded('reports/r/a.png'), { size: 2048, contentType: 'image/png' });
});

// ---------- service: confirmPhoto ----------
const queries = [];
const pickupRow = { id: 'pick-1', booking_id: 'mine', car_id: 'car-1', office_id: 'office-1', type: 'pickup',
  odometer_km: 1000, fuel_level: 'full', notes: null, recorded_by: 's1', recorded_at: new Date() };
const fakeClient = {
  query: async (sql, p) => {
    queries.push([sql, p]);
    if (/INSERT INTO inspection.condition_reports/.test(sql)) {
      return { rows: [{ ...pickupRow, id: 'ret-1', type: p[3], odometer_km: p[4], fuel_level: p[5], notes: p[6] }] };
    }
    return { rows: [{ id: 'photo-1' }] };
  },
  release() {},
};
const fakePool = {
  query: async (sql) => {
    if (/odometer_km/.test(sql)) return { rows: [pickupRow] };            // findReport (the pick-up)
    if (/SELECT id FROM inspection.condition_reports/.test(sql)) return { rows: [{ id: 'rep-1' }] };
    return { rows: [{ n: 0 }] };
  },
  connect: async () => fakeClient,
};
const bcPath = require.resolve(src('booking.client'));
require.cache[bcPath] = { id: bcPath, filename: bcPath, loaded: true, exports: {
  getBooking: async (id) => (id === 'mine' ? { id, customerId: 'c1', officeId: 'office-1', carId: 'car-1', status: 'confirmed' } : null),
  markCompleted: async () => {},
} };
const service = require(src('inspection.service'));
const staff = { id: 's1', role: 'staff', officeId: 'office-1' };

test('service: staff of another office cannot add a photo (404)', async () => {
  await assert.rejects(service.confirmPhoto({ ...staff, officeId: 'office-2' }, 'mine', { type: 'pickup', key: 'reports/rep-1/a.jpg' }), (e) => e.status === 404);
});
test('service: a key that belongs to another report is refused (400)', async () => {
  await assert.rejects(service.confirmPhoto(staff, 'mine', { type: 'pickup', key: 'reports/other/a.jpg' }), (e) => e.status === 400);
});
test('service: valid photo is recorded with the token user, and audited', async () => {
  photos._setClientForTests(fakeS3({ ContentLength: 2048, ContentType: 'image/jpeg' }));
  queries.length = 0;
  const r = await service.confirmPhoto(staff, 'mine', { type: 'pickup', key: 'reports/rep-1/a.jpg' });
  assert.strictEqual(r.photo.id, 'photo-1');
  const audit = queries.find(([sql]) => /INSERT INTO inspection.audit_log/.test(sql));
  assert.strictEqual(audit[1][0], 's1');                        // the actor comes from the token
  assert.ok(queries.some(([sql]) => /INSERT INTO inspection.photos/.test(sql)));
  assert.strictEqual(queries[queries.length - 1][0], 'COMMIT');
});
test('service: upload link needs an existing report', async () => {
  const link = await service.requestPhotoUpload(staff, 'mine', { type: 'pickup', contentType: 'image/png' });
  assert.match(link.key, /^reports\/rep-1\//);
});

// ---------- comparison rule ----------
test('compareReports: fuel drop over 10 points or damage is flagged', () => {
  const pick = { mileage: 1000, fuelLevel: 'three_quarter', damageFlag: false };
  assert.strictEqual(service.compareReports(pick, { mileage: 1100, fuelLevel: 'three_quarter', damageFlag: false }).flagged, false);
  assert.strictEqual(service.compareReports(pick, { mileage: 1100, fuelLevel: 'full', damageFlag: false }).flagged, false);
  const low = service.compareReports(pick, { mileage: 1100, fuelLevel: 'quarter', damageFlag: false });
  assert.strictEqual(low.flagged, true);
  assert.strictEqual(low.fuelChange, -50);
  assert.strictEqual(service.compareReports(pick, { mileage: 1100, fuelLevel: 'three_quarter', damageFlag: true }).flagged, true);
});

test('validation: fuelLevel is one of the five words, notes up to 2000', () => {
  const ok = v.parseConditionBody({ mileage: 5, fuelLevel: 'half' });
  assert.strictEqual(ok.fuelLevel, 'half');
  assert.throws(() => v.parseConditionBody({ mileage: 5, fuelLevel: 50 }), /fuelLevel must be one of/);
  assert.throws(() => v.parseConditionBody({ mileage: 5, fuelLevel: 'half', notes: 'x'.repeat(2001) }), /2000/);
});

// ---------- service: recording reports ----------
test('record: damageFlag on a pick-up is refused', async () => {
  await assert.rejects(service.recordReport(staff, 'mine', 'pickup', { mileage: 1, fuelLevel: 'full', notes: null, damageFlag: true }),
    (e) => e.status === 400);
});
test('record: return with less fuel and damage writes two flags that point at both reports', async () => {
  queries.length = 0;
  const r = await service.recordReport(staff, 'mine', 'return', { mileage: 1200, fuelLevel: 'quarter', notes: 'Scratch on door', damageFlag: true });
  assert.strictEqual(r.report.id, 'ret-1');
  assert.strictEqual(r.comparison.flagged, true);
  const flags = queries.filter(([sql]) => /INSERT INTO inspection.damage_flags/.test(sql));
  assert.strictEqual(flags.length, 2);
  assert.deepStrictEqual(flags[0][1].slice(0, 4), ['car-1', 'office-1', 'ret-1', 'pick-1']);
  assert.match(flags[1][1][4], /Scratch on door/);
  const report = queries.find(([sql]) => /INSERT INTO inspection.condition_reports/.test(sql));
  assert.strictEqual(report[1][7], 's1');                       // recorded_by is the token user
  assert.strictEqual(r.bookingCompleted, true);
});
test('record: return mileage lower than pick-up is refused', async () => {
  await assert.rejects(service.recordReport(staff, 'mine', 'return', { mileage: 500, fuelLevel: 'full', notes: null, damageFlag: false }),
    (e) => e.status === 400 && /mileage/.test(e.message));
});

// ---------- local stand-in for Booking ----------
test('booking.client: local stand-in works only on a laptop with the flag, never in Lambda', async () => {
  delete require.cache[require.resolve(src('booking.client'))];
  const real = require(src('booking.client'));
  const keep = { ...process.env };
  Object.assign(process.env, { ALLOW_LOCAL_AUTH: 'true', LOCAL_BOOKING_ID: 'b1', LOCAL_OFFICE_ID: 'o1', LOCAL_CAR_ID: 'c1', LOCAL_CUSTOMER_ID: 'u1' });
  assert.deepStrictEqual(await real.getBooking('b1'), { id: 'b1', customerId: 'u1', officeId: 'o1', carId: 'c1', status: 'confirmed' });
  assert.strictEqual(await real.getBooking('other'), null);
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'x';
  await assert.rejects(real.getBooking('b1'), (e) => e.status === 503);   // in Lambda it is ignored
  Object.keys(process.env).forEach((k) => { if (!(k in keep)) delete process.env[k]; });
  Object.assign(process.env, keep);
});
