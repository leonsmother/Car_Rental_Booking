// node --test frontend/test/auth.test.js
const test = require('node:test');
const assert = require('node:assert');

const store = {};
global.sessionStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
let assigned = null;
global.window = {
  APP_CONFIG: { cognitoDomain: 'https://d.example', clientId: 'cid', redirectUri: 'http://x/callback.html', logoutUri: 'http://x/login.html' },
  location: { assign: (u) => { assigned = u; }, search: '', pathname: '/callback.html', origin: 'http://x' },
  history: { replaceState() {} },
};
global.window.location.href = '';

const Auth = require('./auth.js');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
const future = () => Math.floor(Date.now() / 1000) + 3600;

test('PKCE challenge matches the RFC 7636 example', async () => {
  assert.strictEqual(
    await Auth._pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('login redirects with S256 challenge and a state', async () => {
  await Auth.login();
  const u = new URL(assigned);
  assert.strictEqual(u.pathname, '/login');
  assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('state'), store.pkce_state);
  assert.ok(store.pkce_verifier.length >= 43);
  assert.ok(!assigned.includes(store.pkce_verifier));
});

test('signup uses the signup page', async () => {
  await Auth.signup();
  assert.strictEqual(new URL(assigned).pathname, '/signup');
});

test('callback rejects a wrong state', async () => {
  store.pkce_verifier = 'v'; store.pkce_state = 'good';
  window.location.search = '?code=abc&state=evil';
  await assert.rejects(Auth.handleCallback(), /did not match/);
  assert.strictEqual(store.pkce_verifier, undefined);   // used up
});

test('callback rejects when nothing was started', async () => {
  window.location.search = '?code=abc&state=s';
  await assert.rejects(Auth.handleCallback(), /not valid/);
});

test('callback exchanges the code and stores no refresh token', async () => {
  store.pkce_verifier = 'ver'; store.pkce_state = 's1';
  window.location.search = '?code=abc&state=s1';
  let body;
  global.fetch = async (url, opts) => {
    body = opts.body;
    assert.strictEqual(url, 'https://d.example/oauth2/token');
    return { ok: true, json: async () => ({
      access_token: jwt({ sub: 'u1', exp: future(), 'cognito:groups': ['staff'] }),
      id_token: jwt({ email: 'a@b.c' }), refresh_token: 'SECRET' }) };
  };
  const user = await Auth.handleCallback();
  assert.strictEqual(body.get('code_verifier'), 'ver');
  assert.strictEqual(user.role, 'staff');
  assert.strictEqual(user.email, 'a@b.c');
  assert.ok(!store.auth_tokens.includes('SECRET'));
  assert.ok(Auth.getAccessToken());
});

test('customer role, and no group means no role', () => {
  store.auth_tokens = JSON.stringify({ accessToken: jwt({ sub: 'u', 'cognito:groups': ['customer'] }), idToken: jwt({}), expiresAt: Date.now() + 5000 });
  assert.strictEqual(Auth.getUser().role, 'customer');
  store.auth_tokens = JSON.stringify({ accessToken: jwt({ sub: 'u' }), idToken: jwt({}), expiresAt: Date.now() + 5000 });
  assert.strictEqual(Auth.getUser().role, null);
});

test('expired token means signed out', () => {
  store.auth_tokens = JSON.stringify({ accessToken: jwt({ sub: 'u' }), idToken: jwt({}), expiresAt: Date.now() - 1 });
  assert.strictEqual(Auth.getUser(), null);
  assert.strictEqual(Auth.getAccessToken(), null);
});

test('requireLogin sends visitors and wrong roles away', () => {
  delete store.auth_tokens;
  assert.strictEqual(Auth.requireLogin(['staff']), null);
  assert.strictEqual(assigned, '/login.html');
  store.auth_tokens = JSON.stringify({ accessToken: jwt({ sub: 'u', 'cognito:groups': ['customer'] }), idToken: jwt({}), expiresAt: Date.now() + 5000 });
  assert.strictEqual(Auth.requireLogin(['staff']), null);
  assert.strictEqual(assigned, '/index.html');
  assert.ok(Auth.requireLogin(['customer']));
});

test('logout clears tokens and goes to Cognito logout', () => {
  Auth.logout();
  assert.strictEqual(store.auth_tokens, undefined);
  assert.strictEqual(new URL(assigned).pathname, '/logout');
});