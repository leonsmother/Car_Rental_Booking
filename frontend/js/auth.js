// frontend/js/auth.js  (owner: Ghada)
// Sign-in with Cognito's hosted login page, using the authorization code flow with PKCE.
//
// How it works:
//   1. login() makes a random secret (the "verifier"), sends only its fingerprint (the "challenge")
//      to Cognito, and keeps the verifier in this tab.
//   2. Cognito shows its login page. After sign-in it sends the browser back to callback.html with a code.
//   3. callback.html sends the code AND the verifier to Cognito. Only the tab that started the login knows
//      the verifier, so a stolen code is useless to anyone else.
//   4. We keep the tokens in sessionStorage (cleared when the tab closes), never in localStorage,
//      and we never keep the refresh token in the browser.
//
// Hiding buttons here is for convenience only. The services check the token and the role on every request.

(function () {
  'use strict';

  const cfg = window.APP_CONFIG;
  const KEY_TOKENS = 'auth_tokens';
  const KEY_VERIFIER = 'pkce_verifier';
  const KEY_STATE = 'pkce_state';

  // ---------- small helpers ----------

  function base64url(bytes) {
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString(byteCount) {
    const bytes = new Uint8Array(byteCount);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }

  // PKCE challenge = base64url( SHA-256( verifier ) )
  async function pkceChallenge(verifier) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(hash));
  }

  // Reads the claims inside a token. This does NOT check the signature: the browser only uses it
  // to decide what to show. API Gateway does the real check on every call.
  function decodeToken(token) {
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(payload).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
      );
      return JSON.parse(json);
    } catch (err) {
      return null;
    }
  }

  function readTokens() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY_TOKENS));
    } catch (err) {
      return null;
    }
  }

  // ---------- start a login or sign-up ----------

  // path is 'login' or 'signup' (both are pages of Cognito's hosted UI)
  async function startAuth(path) {
    const verifier = randomString(64);
    const state = randomString(16);
    sessionStorage.setItem(KEY_VERIFIER, verifier);
    sessionStorage.setItem(KEY_STATE, state);

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'code',
      scope: 'openid email',
      redirect_uri: cfg.redirectUri,
      state,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: 'S256',
    });
    window.location.assign(`${cfg.cognitoDomain}/${path}?${params.toString()}`);
  }

  const login = () => startAuth('login');
  const signup = () => startAuth('signup');

  // ---------- finish the login (runs on callback.html) ----------

  async function handleCallback() {
    const query = new URLSearchParams(window.location.search);
    const verifier = sessionStorage.getItem(KEY_VERIFIER);
    const expectedState = sessionStorage.getItem(KEY_STATE);

    // One try only: whatever happens next, these are used up
    sessionStorage.removeItem(KEY_VERIFIER);
    sessionStorage.removeItem(KEY_STATE);
    window.history.replaceState({}, '', window.location.pathname);   // take the code out of the address bar

    if (query.get('error')) {
      throw new Error('Sign-in was not completed (' + query.get('error') + ')');
    }
    const code = query.get('code');
    if (!code || !verifier || !expectedState) {
      throw new Error('This sign-in link is not valid any more. Please start again.');
    }
    if (query.get('state') !== expectedState) {
      throw new Error('The sign-in answer did not match the request. Please start again.');
    }

    const response = await fetch(`${cfg.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.clientId,
        code,
        redirect_uri: cfg.redirectUri,
        code_verifier: verifier,
      }),
    });
    if (!response.ok) throw new Error('Could not complete the sign-in. Please start again.');

    const data = await response.json();
    const access = decodeToken(data.access_token);
    if (!access) throw new Error('Cognito sent a token we could not read.');

    // The refresh token is deliberately NOT stored. When the access token ends, the user signs in again.
    sessionStorage.setItem(KEY_TOKENS, JSON.stringify({
      accessToken: data.access_token,
      idToken: data.id_token,
      expiresAt: access.exp * 1000,
    }));
    return getUser();
  }

  // ---------- who is signed in ----------

  function getUser() {
    const tokens = readTokens();
    if (!tokens || Date.now() >= tokens.expiresAt) return null;

    const access = decodeToken(tokens.accessToken) || {};
    const id = decodeToken(tokens.idToken) || {};
    const groups = Array.isArray(access['cognito:groups']) ? access['cognito:groups'] : [];
    const role = groups.includes('staff') ? 'staff' : groups.includes('customer') ? 'customer' : null;
    return { id: access.sub, email: id.email || null, groups, role };
  }

  const isLoggedIn = () => getUser() !== null;

  // The token api.js puts in the Authorization header
  function getAccessToken() {
    const tokens = readTokens();
    return tokens && Date.now() < tokens.expiresAt ? tokens.accessToken : null;
  }

  // Call at the top of a protected page. Returns the user, or sends the browser away and returns null.
  function requireLogin(allowedRoles) {
    const user = getUser();
    if (!user) {
      window.location.assign('/login.html');
      return null;
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      window.location.assign('/index.html');
      return null;
    }
    return user;
  }

  function logout() {
    sessionStorage.removeItem(KEY_TOKENS);
    const params = new URLSearchParams({ client_id: cfg.clientId, logout_uri: cfg.logoutUri });
    window.location.assign(`${cfg.cognitoDomain}/logout?${params.toString()}`);
  }

  // ---------- role-based navigation ----------
  //   data-auth="in"         only when signed in        data-auth="out"        only when signed out
  //   data-role="staff"      only for staff             data-role="customer"   only for customers
  //   data-user-email        filled with the user's email (as plain text)
  //   data-action="logout"   click signs out

  function applyNav(root) {
    const user = getUser();
    const scope = root || document;

    scope.querySelectorAll('[data-auth]').forEach((el) => {
      el.hidden = (el.dataset.auth === 'in') !== Boolean(user);
    });
    scope.querySelectorAll('[data-role]').forEach((el) => {
      el.hidden = !user || el.dataset.role !== user.role;
    });
    scope.querySelectorAll('[data-user-email]').forEach((el) => {
      el.textContent = user && user.email ? user.email : '';      // textContent: never innerHTML
    });
    scope.querySelectorAll('[data-action="logout"]').forEach((el) => {
      el.addEventListener('click', (event) => { event.preventDefault(); logout(); });
    });
  }

  // ---------- page wiring (the page names itself: <script src="js/auth.js" data-page="login">) ----------

  function wirePage(page) {
    if (page === 'login') {
      if (isLoggedIn()) { window.location.replace('/index.html'); return; }
      const loginButton = document.getElementById('btn-login');
      const signupButton = document.getElementById('btn-signup');
      if (loginButton) loginButton.addEventListener('click', login);
      if (signupButton) signupButton.addEventListener('click', signup);
    } else if (page === 'signup') {
      signup();
    } else if (page === 'callback') {
      const message = document.getElementById('message');
      handleCallback()
        .then((user) => {
          if (message) message.textContent = 'Signed in. Redirecting...';
          window.location.replace('/index.html');
        })
        .catch((err) => {
          if (message) message.textContent = err.message;             // textContent: never innerHTML
          const back = document.getElementById('back');
          if (back) back.hidden = false;
        });
    } else {
      applyNav();
    }
  }

  const Auth = {
    login, signup, logout, handleCallback, getUser, isLoggedIn, getAccessToken, requireLogin, applyNav,
    _pkceChallenge: pkceChallenge, _decodeToken: decodeToken,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Auth;                                            // for the Node tests
  } else {
    window.Auth = Auth;
    const script = document.currentScript;
    const start = () => wirePage(script && script.dataset ? script.dataset.page : undefined);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})();