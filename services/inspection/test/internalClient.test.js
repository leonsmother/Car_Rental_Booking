// npm test runs this file with the others (node --test test/*.test.js)
const test = require('node:test');
const assert = require('node:assert');
const { createClient } = require('../src/internalClient');

const ENV = { AWS_ACCESS_KEY_ID: 'AKIATEST', AWS_SECRET_ACCESS_KEY: 'secret', AWS_SESSION_TOKEN: 'tok', AWS_REGION: 'eu-central-1' };
const fakeSign = (request, creds) => { request.headers.Authorization = 'AWS4-HMAC-SHA256 fake'; request.headers.Host = request.host; request.headers['Content-Length'] = '5'; request.signedWith = creds; return request; };
const reply = (status, text) => async () => ({ status, text: async () => text });

test('signs for execute-api and sends the JSON body', async () => {
  let seen; let signed;
  const client = createClient({
    env: ENV,
    sign: (r, c) => { signed = { r, c }; return fakeSign(r, c); },
    fetchFn: async (url, opts) => { seen = { url, opts }; return { status: 200, text: async () => '{"ok":true}' }; },
  });
  const res = await client.call('POST', 'https://abc.execute-api.eu-central-1.amazonaws.com/internal/bookings/1/complete', { actorId: 'u1' });
  assert.deepStrictEqual(res, { status: 200, body: { ok: true } });
  assert.strictEqual(signed.r.service, 'execute-api');
  assert.strictEqual(signed.r.region, 'eu-central-1');
  assert.strictEqual(signed.r.path, '/internal/bookings/1/complete');
  assert.strictEqual(signed.c.sessionToken, 'tok');
  assert.strictEqual(seen.opts.body, '{"actorId":"u1"}');
  assert.ok(seen.opts.headers.Authorization.startsWith('AWS4-HMAC-SHA256'));
  assert.ok(seen.opts.headers['x-request-id']);
  assert.strictEqual(seen.opts.headers.Host, undefined);
  assert.strictEqual(seen.opts.headers['Content-Length'], undefined);
});

test('404 comes back as a status, not an exception', async () => {
  const client = createClient({ env: ENV, sign: fakeSign, fetchFn: reply(404, '{"error":"Not found"}') });
  assert.deepStrictEqual(await client.call('GET', 'https://abc.execute-api.eu-central-1.amazonaws.com/internal/bookings/9'), { status: 404, body: { error: 'Not found' } });
});

test('an empty or non-JSON reply gives body null', async () => {
  const client = createClient({ env: ENV, sign: fakeSign, fetchFn: reply(200, '') });
  assert.strictEqual((await client.call('GET', 'https://a.execute-api.eu-central-1.amazonaws.com/x')).body, null);
});

test('no credentials means a clear error (not inside Lambda)', async () => {
  const client = createClient({ env: {}, sign: fakeSign, fetchFn: reply(200, '{}') });
  await assert.rejects(client.call('GET', 'https://a.execute-api.eu-central-1.amazonaws.com/x'), /No AWS credentials/);
});

test('a slow answer is cut off after the timeout', async () => {
  const client = createClient({
    env: ENV, sign: fakeSign,
    fetchFn: (url, opts) => new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  });
  const t0 = Date.now();
  await assert.rejects(client.call('GET', 'https://a.execute-api.eu-central-1.amazonaws.com/x'), /aborted/);
  assert.ok(Date.now() - t0 < 4500);
});