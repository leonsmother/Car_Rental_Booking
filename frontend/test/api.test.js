<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.s3.eu-central-1.amazonaws.com; connect-src 'self' https://*.amazoncognito.com https://*.execute-api.eu-central-1.amazonaws.com https://*.s3.eu-central-1.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'">
  <title>Damage flags - CarRent Cloud</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/index.html">CarRent Cloud</a>
    <nav>
      <a href="/pages/pickup.html" data-role="staff" hidden>Pick-up</a>
      <a href="/pages/return.html" data-role="staff" hidden>Return</a>
      <a href="/pages/damage.html" data-role="staff" hidden>Damage flags</a>
      <a href="/pages/my-bookings.html" data-role="customer" hidden>My bookings</a>
    </nav>
    <span class="who" data-user-email></span>
    <a href="#" data-action="logout">Sign out</a>
  </header>
  <main class="container">
    <section class="panel">
      <h1>Damage flags</h1>
      <p class="lead">Returns at your office that were flagged for damage or low fuel.</p>
      <div id="result" class="status" role="status" hidden></div>
      <ul id="flags" class="flag-list"></ul>
      <button id="more" type="button" class="secondary" hidden>Load more</button>
    </section>
  </main>
  <script src="/js/config.js"></script>
  <script src="/js/auth.js"></script>
  <script src="/js/api.js"></script>
  <script src="/js/inspection.js" data-page="damage"></script>
</body>
</html>
