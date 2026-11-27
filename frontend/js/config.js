// frontend/js/config.js
// Public settings only. No secrets belong in this file: everything here is visible in the browser.
// Owner: Jana. Ghada filled in the Cognito part; the three API URLs come from each stack's outputs.

window.APP_CONFIG = {
  // Cognito (auth stack outputs: LoginDomain and UserPoolClientId)
  cognitoDomain: 'https://carrent-g24-yarabntkhrg.auth.eu-central-1.amazoncognito.com',
  clientId: '5svfticq897g0tfr0j08hjalde',

  // Where Cognito sends the browser back to. Must match the callback and sign-out URLs of the app client.
  redirectUri: window.location.origin + '/callback.html',
  logoutUri: window.location.origin + '/login.html',

  // API base URLs (no trailing slash). Fill in from the stack outputs after each deploy.
  catalogueApi: '',
  bookingApi: '',
  inspectionApi: 'https://4mwvhy5106.execute-api.eu-central-1.amazonaws.com',
};
