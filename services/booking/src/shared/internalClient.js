const { SignatureV4 } = require('@smithy/signature-v4');
const { Sha256 } = require('@aws-crypto/sha256-js');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

// Calls another service's IAM-protected route.
// Returns { status, body }. The Lambda's own IAM role signs the request.
async function call(method, url, body) {
  const u = new URL(url);
  const payload = body === undefined ? undefined : JSON.stringify(body);

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: process.env.AWS_REGION || 'eu-central-1',
    service: 'execute-api',
    sha256: Sha256,
  });

  const headers = { host: u.host };
  if (payload) headers['content-type'] = 'application/json';

  const signed = await signer.sign({
    method,
    protocol: u.protocol,
    hostname: u.hostname,
    path: u.pathname,
    query: Object.fromEntries(u.searchParams),
    headers,
    body: payload,
  });
  delete signed.headers.host; // fetch sets the host itself

  const res = await fetch(url, { method, headers: signed.headers, body: payload });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

module.exports = { call };