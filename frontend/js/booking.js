// js/booking.js (owner: Eman)
// Pages: request-booking.html (customer), my-bookings.html (customer), staff-requests.html (staff).
// The page names itself with <script src="/js/booking.js" data-page="request">.
// Booking API (Eman):  GET /bookings, POST /bookings, DELETE /bookings/{id}, PATCH /bookings/{id}/decision
// Catalogue API (Jana, public routes only): GET /cars, GET /cars/{id}, GET /offices  -> car and office names
// Everything from the server is shown with textContent (never innerHTML), so no data can run as code.
// The checks here are only for quick feedback: the Booking service checks everything again.
(function () {
  'use strict';

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_DAYS = 30;
  const STATUS_TEXT = {
    pending: 'Pending (waiting for the office)',
    confirmed: 'Confirmed',
    declined: 'Declined',
    cancelled: 'Cancelled',
    picked_up: 'Picked up',
    completed: 'Completed',
  };

  const cfg = () => window.APP_CONFIG;
  const bookingApi = (method, path, body) => window.Api.request(cfg().bookingApi, method, path, body);
  const $ = (id) => document.getElementById(id);

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function showMessage(text, isError) {
    const box = $('result');
    box.className = 'status' + (isError ? ' error' : '');
    box.textContent = text;
    box.hidden = !text;
  }

  // ---------- Catalogue's public routes (no login needed) ----------

  async function catalogue(path) {
    const base = cfg().catalogueApi;
    if (!base) throw new Error('The Catalogue API address is missing in js/config.js');
    let response;
    try {
      response = await fetch(base + path);
    } catch (err) {
      throw new Error('Cannot reach the car service right now.');
    }
    if (!response.ok) {
      const error = new Error('Car service answered ' + response.status);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  // Names for the cars and offices in a list of bookings. Missing names fall back to a short id.
  async function loadNames(bookings) {
    const names = { cars: {}, offices: {} };
    try {
      const offices = await catalogue('/offices');
      offices.forEach((o) => { names.offices[o.id] = o.name + ', ' + o.city; });
    } catch (err) { /* names are nice to have, not required */ }

    const carIds = [...new Set(bookings.map((b) => b.car_id))];
    await Promise.all(carIds.map(async (id) => {
      try {
        const car = await catalogue('/cars/' + encodeURIComponent(id));
        names.cars[id] = car.make + ' ' + car.model;
      } catch (err) { /* e.g. a retired car */ }
    }));
    return names;
  }

  // ---------- small helpers ----------

  const shortId = (id) => String(id).slice(0, 8);
  const egp = (value) => Number(value).toLocaleString('en-EG', { maximumFractionDigits: 2 }) + ' EGP';

  function today() {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
  }

  function daysBetween(start, end) {
    return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000);
  }

  function realDate(s) {
    if (!DATE_RE.test(s || '')) return false;
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  // Returns an error message, or null when the dates look fine
  function checkDates(start, end) {
    if (!realDate(start) || !realDate(end)) return 'Choose both a pick-up and a return date.';
    if (start < today()) return 'The pick-up date cannot be in the past.';
    const days = daysBetween(start, end);
    if (days < 1) return 'The return date must be after the pick-up date.';
    if (days > MAX_DAYS) return 'A rental can be 1 to ' + MAX_DAYS + ' days.';
    return null;
  }

  function fromAddress(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  // One booking as a list item: title, status badge, facts, then any buttons/links
  function bookingItem(b, names, showCustomer) {
    const li = el('li');
    li.append(el('h2', names.cars[b.car_id] || 'Car ' + shortId(b.car_id)));
    li.append(el('span', STATUS_TEXT[b.status] || b.status, 'badge'));

    const facts = el('dl', null, 'facts');
    const add = (name, value) => facts.append(el('dt', name), el('dd', value));
    add('Dates', b.start_date + ' to ' + b.end_date + ' (' + daysBetween(b.start_date, b.end_date) + ' days)');
    add('Price', egp(b.daily_price) + ' / day, total ' + egp(b.total_price));
    add('Office', names.offices[b.office_id] || shortId(b.office_id));
    if (showCustomer) add('Customer', shortId(b.customer_id));
    add('Booking ID', b.id);
    li.append(facts);
    return li;
  }

  function link(text, href, secondary) {
    const a = el('a', text, 'btn' + (secondary ? ' secondary' : ''));
    a.href = href;
    return a;
  }

  // ---------- request-booking.html ----------

  async function setupRequestPage() {
    if (!window.Auth.requireLogin(['customer'])) return;
    const select = $('car');
    const facts = $('car-facts');
    const estimate = $('estimate');
    let cars = [];

    $('start').min = today();
    $('end').min = today();
    $('start').value = realDate(fromAddress('from')) ? fromAddress('from') : '';
    $('end').value = realDate(fromAddress('to')) ? fromAddress('to') : '';

    function chosenCar() {
      return cars.find((c) => c.id === select.value) || null;
    }

    function update() {
      const car = chosenCar();
      facts.replaceChildren();
      facts.hidden = !car;
      if (car) {
        const dl = el('dl', null, 'facts');
        dl.append(el('dt', 'Office'), el('dd', car.office_name + ', ' + car.city));
        dl.append(el('dt', 'Category'), el('dd', car.category));
        dl.append(el('dt', 'Price'), el('dd', egp(car.daily_price) + ' / day'));
        facts.append(dl);
      }
      const start = $('start').value;
      const end = $('end').value;
      const problem = checkDates(start, end);
      if (car && !problem) {
        const days = daysBetween(start, end);
        estimate.textContent = 'Estimated total: ' + egp(Number(car.daily_price) * days) + ' for ' + days +
          ' day(s). The office confirms the final price.';
        estimate.hidden = false;
      } else {
        estimate.hidden = true;
      }
    }

    try {
      cars = await catalogue('/cars');      // only available cars are returned
      select.replaceChildren(el('option', 'Choose a car'));
      select.firstChild.value = '';
      cars.forEach((car) => {
        const option = el('option', car.make + ' ' + car.model + ' - ' + car.office_name + ' (' + egp(car.daily_price) + '/day)');
        option.value = car.id;
        select.append(option);
      });
      const wanted = fromAddress('carId');
      if (UUID_RE.test(wanted)) {
        if (cars.some((c) => c.id === wanted)) select.value = wanted;
        else showMessage('That car is not available any more. Please choose another one.', true);
      }
    } catch (err) {
      select.replaceChildren(el('option', 'Could not load cars'));
      showMessage(err.message, true);
    }
    update();
    [select, $('start'), $('end')].forEach((input) => input.addEventListener('change', update));

    $('booking-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const car = chosenCar();
      if (!car) return showMessage('Choose a car first.', true);
      const startDate = $('start').value;
      const endDate = $('end').value;
      const problem = checkDates(startDate, endDate);
      if (problem) return showMessage(problem, true);

      const button = $('submit');
      button.disabled = true;
      showMessage('Sending your request...', false);
      try {
        const booking = await bookingApi('POST', '/bookings', { carId: car.id, startDate, endDate });
        showMessage('Request sent! Total ' + egp(booking.total_price) + '. It is pending until the office confirms it. ' +
          'You can follow it on My bookings.', false);
        $('booking-form').reset();
        estimate.hidden = true;
        facts.hidden = true;
      } catch (err) {
        showMessage(err.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  // ---------- my-bookings.html ----------

  async function setupMyBookingsPage() {
    if (!window.Auth.requireLogin(['customer'])) return;
    const list = $('bookings');

    async function load(note) {
      showMessage('Loading your bookings...', false);
      try {
        const bookings = await bookingApi('GET', '/bookings');
        const names = await loadNames(bookings);
        list.replaceChildren(...bookings.map((b) => {
          const li = bookingItem(b, names, false);
          if (b.status === 'pending' || b.status === 'confirmed') {
            const cancel = el('button', 'Cancel this booking', 'secondary');
            cancel.type = 'button';
            cancel.addEventListener('click', async () => {
              if (!window.confirm('Cancel this booking? This cannot be undone.')) return;
              cancel.disabled = true;
              try {
                await bookingApi('DELETE', '/bookings/' + encodeURIComponent(b.id));
                load('Booking cancelled.');
              } catch (err) {
                showMessage(err.message, true);
                cancel.disabled = false;
              }
            });
            li.append(cancel);
          }
          if (b.status === 'picked_up' || b.status === 'completed') {
            li.append(link('Inspection report', '/pages/report.html?booking=' + encodeURIComponent(b.id), true));
          }
          return li;
        }));
        $('list-panel').hidden = bookings.length === 0;
        showMessage(note || (bookings.length ? '' : 'You have no bookings yet.'), false);
      } catch (err) {
        showMessage(err.message, true);
      }
    }
    load();
  }

  // ---------- staff-requests.html ----------

  async function setupStaffPage() {
    if (!window.Auth.requireLogin(['staff'])) return;
    const list = $('bookings');
    const filter = $('filter');
    const FILTERS = {
      pending: (b) => b.status === 'pending',
      active: (b) => ['pending', 'confirmed', 'picked_up'].includes(b.status),
      all: () => true,
    };

    function decideButton(b, decision, label, secondary) {
      const button = el('button', label, secondary ? 'secondary' : '');
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await bookingApi('PATCH', '/bookings/' + encodeURIComponent(b.id) + '/decision', { decision });
          load('Booking ' + shortId(b.id) + (decision === 'confirm' ? ' confirmed.' : ' declined.'));
        } catch (err) {
          showMessage(err.message, true);    // e.g. 409: the car is already booked for those dates
          button.disabled = false;
        }
      });
      return button;
    }

    async function load(note) {
      showMessage('Loading bookings...', false);
      try {
        const bookings = (await bookingApi('GET', '/bookings')).filter(FILTERS[filter.value]);
        const names = await loadNames(bookings);
        list.replaceChildren(...bookings.map((b) => {
          const li = bookingItem(b, names, true);
          const id = encodeURIComponent(b.id);
          if (b.status === 'pending') {
            li.append(decideButton(b, 'confirm', 'Confirm', false), decideButton(b, 'decline', 'Decline', true));
          }
          if (b.status === 'confirmed') {
            li.append(link('Pick-up inspection', '/pages/pickup.html?booking=' + id, false));
            li.append(link('Return inspection', '/pages/return.html?booking=' + id, true));
          }
          if (b.status === 'picked_up') li.append(link('Return inspection', '/pages/return.html?booking=' + id, false));
          if (b.status === 'picked_up' || b.status === 'completed') {
            li.append(link('Inspection report', '/pages/report.html?booking=' + id, true));
          }
          return li;
        }));
        $('list-panel').hidden = bookings.length === 0;
        showMessage(note || (bookings.length ? '' : 'Nothing to show for this filter.'), false);
      } catch (err) {
        showMessage(err.message, true);     // e.g. 403: staff account has no office
      }
    }

    filter.addEventListener('change', () => load());
    load();
  }

  // ---------- start the right page ----------

  const page = document.currentScript && document.currentScript.dataset.page;
  function start() {
    if (page === 'request') setupRequestPage();
    else if (page === 'mine') setupMyBookingsPage();
    else if (page === 'staff') setupStaffPage();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
