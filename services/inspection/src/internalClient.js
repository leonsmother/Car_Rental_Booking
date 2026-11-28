// services/inspection/src/internalClient.js
// Signed calls to another service's INTERNAL routes (Booking B8/B9, Catalogue C11).
// The routes are protected with IAM, so every request must carry a SigV4 signature made
// with this Lambda's own temporary credentials. A Cognito token does not work there.
//
// call(method, url, body?) -> Promise<{ status, body }>     (3 second timeout)
//
// If Eman's shared/internalClient.js exists, it is the same contract and can replace this file.

const crypto = require('crypto');

const TIMEOUT_MS = 3000;

function defaultSign(request, credentials) {
  const aws4 = require('aws4');          // small signing library (npm install aws4)
  return aws4.sign(request, credentials);
}

function createClient({ sign = defaultSign, fetchFn = (...args) => fetch(...args), env = process.env } = {}) {
  async function call(method, url, body) {
    const target = new URL(url);
    const payload = body === undefined ? undefined : JSON.stringify(body);

    const credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN,
    };
    if (!credentials.accessKeyId || !credentials.secretAccessKey) {
      throw new Error('No AWS credentials: internal calls only work inside Lambda');
    }

    const request = {
      host: target.host,
      path: target.pathname + target.search,
      method,
      service: 'execute-api',
      region: env.AWS_REGION || 'eu-central-1',
      headers: {
        'x-request-id': crypto.randomUUID(),
        ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload,
    };
    sign(request, credentials);

    // fetch sets these two itself; the signature already covers them
    const headers = { ...request.headers };
    delete headers.Host;
    delete headers.host;
    delete headers['Content-Length'];
    delete headers['content-length'];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchFn(target.toString(), { method, headers, body: payload, signal: controller.signal });
      let parsed = null;
      const text = await response.text();
      if (text) {
        try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
      }
      return { status: response.status, body: parsed };
    } finally {
      clearTimeout(timer);
    }
  }
  return { call };
}

module.exports = { ...createClient(), createClient, TIMEOUT_MS };