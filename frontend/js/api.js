// js/api.js
// One place that calls our APIs. It adds the access token, and turns errors into readable messages.
// Needs auth.js loaded first.
(function () {
  'use strict';

  async function request(baseUrl, method, path, body) {
    if (!baseUrl) throw new Error('The API address is missing in js/config.js');
    const token = window.Auth.getAccessToken();
    if (!token) {
      window.location.assign('/login.html');
      throw new Error('Please sign in again.');
    }

    const headers = { Authorization: 'Bearer ' + token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await response.json(); } catch (err) { /* no body */ }

    if (response.status === 401) {                      // token refused: sign in again
      sessionStorage.removeItem('auth_tokens');
      window.location.assign('/login.html');
      throw new Error('Your session ended. Please sign in again.');
    }
    if (!response.ok) {
      const error = new Error((data && (data.error || data.message)) || 'Request failed (' + response.status + ')');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  window.Api = { request };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.Api;
})();
