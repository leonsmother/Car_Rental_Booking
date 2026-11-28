// js/inspection.js (owner: Ghada)
// Pages: pickup.html, return.html, report.html, damage.html.
// The page names itself with <script src="/js/inspection.js" data-page="pickup">.
// Everything the server sends is shown with textContent (never innerHTML), so notes cannot run code.
(function () {
  'use strict';

  const FUEL = { empty: 'Empty', quarter: '1/4', half: '1/2', three_quarter: '3/4', full: 'Full' };
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MAX_PHOTOS = 6;
  const MAX_BYTES = 5 * 1024 * 1024;
  const PHOTO_TYPES = ['image/jpeg', 'image/png'];

  const base = () => window.APP_CONFIG.inspectionApi;
  const api = (method, path, body) => window.Api.request(base(), method, path, body);
  const $ = (id) => document.getElementById(id);

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function showMessage(lines, isError) {
    const box = $('result');
    box.replaceChildren();
    box.className = 'status' + (isError ? ' error' : '');
    const list = Array.isArray(lines) ? lines : [lines];
    box.append(el('div', list[0]));
    if (list.length > 1) {
      const ul = el('ul');
      list.slice(1).forEach((line) => ul.append(el('li', line)));
      box.append(ul);
    }
    box.hidden = false;
  }

  function bookingFromAddress() {
    const value = new URLSearchParams(window.location.search).get('booking');
    return value && UUID_RE.test(value) ? value : '';
  }

  // ---------- photos: ask for a link, upload straight to S3, tell the server ----------

  async function uploadPhoto(bookingId, type, file) {
    const link = await api('POST', `/inspections/${bookingId}/photos/upload-url`, { type, contentType: file.type });
    const put = await fetch(link.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!put.ok) throw new Error('the upload to storage failed');
    await api('POST', `/inspections/${bookingId}/photos`, { type, key: link.key });
  }

  function checkFiles(files) {
    if (files.length > MAX_PHOTOS) return `Choose at most ${MAX_PHOTOS} photos.`;
    for (const file of files) {
      if (!PHOTO_TYPES.includes(file.type)) return `${file.name}: only JPEG and PNG photos are allowed.`;
      if (file.size > MAX_BYTES) return `${file.name}: photos must be 5 MB or smaller.`;
    }
    return null;
  }

  // ---------- pickup.html and return.html ----------

  function setupRecordPage(type) {
    if (!window.Auth.requireLogin(['staff'])) return;
    $('booking-id').value = bookingFromAddress();

    $('report-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const bookingId = $('booking-id').value.trim();
      const mileage = Number($('mileage').value);
      const fuelLevel = $('fuel').value;
      const files = Array.from($('photos').files);

      if (!UUID_RE.test(bookingId)) return showMessage('The booking ID is not valid.', true);
      if ($('mileage').value === '' || !Number.isInteger(mileage) || mileage < 0) return showMessage('Mileage must be a whole number.', true);
      if (!FUEL[fuelLevel]) return showMessage('Choose the fuel level.', true);
      const fileProblem = checkFiles(files);
      if (fileProblem) return showMessage(fileProblem, true);

      const body = { mileage, fuelLevel, notes: $('notes').value.trim() };
      if (type === 'return') body.damageFlag = $('damage').checked;

      const button = $('submit');
      button.disabled = true;
      try {
        const saved = await api('POST', `/inspections/${bookingId}/${type}`, body);
        const lines = [`The ${type} report was saved.`];

        for (const file of files) {                       // the report is saved even if a photo fails
          try {
            await uploadPhoto(bookingId, type, file);
            lines.push(`Photo uploaded: ${file.name}`);
          } catch (err) {
            lines.push(`Photo NOT saved (${file.name}): ${err.message}`);
          }
        }
        if (type === 'return') {
          if (saved.comparison && saved.comparison.flagged) {
            lines.push('Flagged: ' + saved.comparison.differences.map((d) => d.description).join('; '));
          }
          if (saved.bookingCompleted === false) lines.push('The booking could not be marked as completed yet. Tell a manager.');
        }
        showMessage(lines, false);
        $('report-form').reset();
      } catch (err) {
        showMessage(err.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  // ---------- report.html ----------

  function renderReport(title, report) {
    const section = el('section', null, 'panel');
    section.append(el('h2', title));
    if (!report) {
      section.append(el('p', 'No report recorded yet.', 'lead'));
      return section;
    }

    const facts = el('dl', null, 'facts');
    const add = (name, value) => { facts.append(el('dt', name), el('dd', value)); };
    add('Recorded', new Date(report.recordedAt).toLocaleString());
    add('Mileage', `${report.mileage} km`);
    add('Fuel', FUEL[report.fuelLevel] || report.fuelLevel);
    add('Notes', report.notes || 'None');
    if (report.recordedBy) add('Recorded by', report.recordedBy);
    section.append(facts);

    if (report.damageFlag) {
      section.append(el('p', 'Damage flagged', 'badge'));
      const list = el('ul');
      (report.damageFlags || []).forEach((flag) => list.append(el('li', flag.description)));
      section.append(list);
    }

    if (report.photos && report.photos.length > 0) {
      const strip = el('div', null, 'photos');
      report.photos.forEach((photo, index) => {
        const link = document.createElement('a');
        link.href = photo.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const img = document.createElement('img');
        img.src = photo.url;
        img.alt = `${report.type} photo ${index + 1}`;
        link.append(img);
        strip.append(link);
      });
      section.append(strip);
      section.append(el('p', 'Photo links expire after 5 minutes. Reload the page to refresh them.', 'hint'));
    }
    return section;
  }

  async function loadReport(bookingId) {
    const out = $('reports');
    out.replaceChildren();
    showMessage('Loading...', false);
    try {
      const data = await api('GET', `/inspections/${bookingId}`);
      out.append(renderReport('Pick-up', data.pickup), renderReport('Return', data.return));

      if (data.pickup && data.return) {
        const cmp = await api('GET', `/inspections/${bookingId}/comparison`);
        const panel = el('section', null, 'panel');
        panel.append(el('h2', 'Comparison'));
        const facts = el('dl', null, 'facts');
        facts.append(el('dt', 'Distance'), el('dd', `${cmp.milesDriven} km`));
        facts.append(el('dt', 'Fuel change'), el('dd', `${cmp.fuelChange} percentage points`));
        panel.append(facts);
        if (cmp.flagged) {
          const list = el('ul');
          cmp.differences.forEach((d) => list.append(el('li', d.description)));
          panel.append(el('p', 'Flagged', 'badge'), list);
        } else {
          panel.append(el('p', 'No differences found.', 'lead'));
        }
        out.append(panel);
      }
      $('result').hidden = true;
    } catch (err) {
      showMessage(err.status === 404 ? 'Booking not found.' : err.message, true);
    }
  }

  function setupReportPage() {
    if (!window.Auth.requireLogin(['staff', 'customer'])) return;
    const fromAddress = bookingFromAddress();
    if (fromAddress) { $('booking-id').value = fromAddress; loadReport(fromAddress); }
    $('lookup-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const id = $('booking-id').value.trim();
      if (!UUID_RE.test(id)) return showMessage('The booking ID is not valid.', true);
      loadReport(id);
    });
  }

  // ---------- damage.html ----------

  function setupDamagePage() {
    if (!window.Auth.requireLogin(['staff'])) return;
    const PAGE = 50;
    let offset = 0;

    async function loadMore() {
      try {
        const rows = await api('GET', `/inspections?damage=true&limit=${PAGE}&offset=${offset}`);
        rows.forEach((row) => {
          const item = el('li');
          const link = el('a', 'Open report', null);
          link.href = `/pages/report.html?booking=${encodeURIComponent(row.bookingId)}`;
          item.append(el('strong', new Date(row.flaggedAt).toLocaleString()), el('div', row.description), link);
          $('flags').append(item);
        });
        offset += rows.length;
        $('more').hidden = rows.length < PAGE;
        if (offset === 0) showMessage('No damage flags for your office.', false);
        else $('result').hidden = true;
      } catch (err) {
        showMessage(err.message, true);
      }
    }
    $('more').addEventListener('click', loadMore);
    loadMore();
  }

  // ---------- start ----------

  const script = document.currentScript;
  const page = script && script.dataset ? script.dataset.page : undefined;
  if (page === 'pickup') setupRecordPage('pickup');
  else if (page === 'return') setupRecordPage('return');
  else if (page === 'report') setupReportPage();
  else if (page === 'damage') setupDamagePage();
})();
