// Catalogue pages: search, offices map, staff cars, staff office (owner: Jana)
// Every page loads config.js first, then this file, then calls one of the init* functions.
// Safety: text from the API is always shown with textContent (never innerHTML), so a car
// model or office name can never inject a script into the page (XSS).

(function () {
  "use strict";

  const CATEGORIES = ["economy", "compact", "sedan", "suv", "van", "luxury"];
  const PAGES = location.pathname.includes("/pages/") ? "" : "pages/"; // path to pages/ from here
  const OFFICE_KEY = "catalogue.staffOfficeId"; // remembered office for the staff pages

  // ---------- small helpers ----------

  function api() {
    const base = (window.APP_CONFIG && window.APP_CONFIG.catalogueApi) || "";
    if (!base) throw new Error("catalogueApi is not set in js/config.js");
    return base.replace(/\/+$/, "");
  }

  // The login token, from Ghada's auth.js if it offers one, otherwise from storage
  function getToken() {
    try {
      if (window.Auth && typeof window.Auth.getIdToken === "function") return window.Auth.getIdToken();
    } catch (e) { /* fall through */ }
    try {
      return sessionStorage.getItem("id_token") || localStorage.getItem("id_token");
    } catch (e) {
      return null;
    }
  }

  // Calls the Catalogue API and returns the JSON (or throws an Error with the API's message)
  async function request(method, path, { body, auth = false } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const token = getToken();
      if (!token) throw new Error("Please log in as staff first.");
      headers.Authorization = "Bearer " + token;
    }
    let res;
    try {
      res = await fetch(api() + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new Error("Cannot reach the Catalogue service. Is it running?");
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* no JSON body */ }
    if (!res.ok) {
      const messages = {
        401: "Your login has expired or is missing. Please log in again.",
        403: "You are not allowed to do this.",
      };
      throw new Error((data && data.error) || messages[res.status] || "Request failed (" + res.status + ")");
    }
    return data;
  }

  // Creates an element safely: el("p", { className: "x" }, "text", childElement)
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node[k] = v;
    });
    children.flat().forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function $(id) { return document.getElementById(id); }

  function showMessage(box, text, kind) {
    box.textContent = text || "";
    box.className = "msg" + (kind ? " " + kind : "");
    box.hidden = !text;
  }

  function egp(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-EG", { maximumFractionDigits: 2 }) + " EGP" : "";
  }

  function cap(s) { return s === "suv" ? "SUV" : s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }

  async function fillOfficeSelect(select, { includeAll = false, selected = "" } = {}) {
    const offices = await request("GET", "/offices");
    select.replaceChildren(
      includeAll ? el("option", { value: "" }, "All offices") : el("option", { value: "" }, "Choose an office"),
      ...offices.map((o) => el("option", { value: o.id }, o.name + " (" + o.city + ")"))
    );
    if (selected) select.value = selected;
    return offices;
  }

  function fillCategorySelect(select, { includeAll = false } = {}) {
    select.replaceChildren(
      ...(includeAll ? [el("option", { value: "" }, "All categories")] : []),
      ...CATEGORIES.map((c) => el("option", { value: c }, cap(c)))
    );
  }

  // ---------- index.html: car search (C1, C2, C7) ----------

  async function initSearchPage() {
    const form = $("search-form");
    const results = $("results");
    const msg = $("search-msg");
    fillCategorySelect($("category"), { includeAll: true });

    // Dates: today or later, and "to" after "from"
    const today = new Date().toISOString().slice(0, 10);
    $("from").min = today;
    $("to").min = today;
    $("from").addEventListener("change", () => { $("to").min = $("from").value || today; });

    try {
      await fillOfficeSelect($("office"), { includeAll: true });
      const fromMap = new URLSearchParams(location.hash.slice(1)).get("office"); // link from the offices map
      if (fromMap) $("office").value = fromMap;
    } catch (e) {
      showMessage(msg, e.message, "error");
    }

    form.addEventListener("submit", (ev) => { ev.preventDefault(); search(); });
    search(); // show all available cars on first load

    async function search() {
      const params = new URLSearchParams();
      const category = $("category").value;
      const office = $("office").value;
      const maxPrice = $("maxPrice").value;
      const from = $("from").value;
      const to = $("to").value;

      if ((from && !to) || (!from && to)) return showMessage(msg, "Choose both a pick-up and a return date.", "error");
      if (from && to && to <= from) return showMessage(msg, "The return date must be after the pick-up date.", "error");
      if (maxPrice && !(Number(maxPrice) > 0)) return showMessage(msg, "Max price must be a number greater than 0.", "error");

      if (category) params.set("category", category);
      if (office) params.set("office", office);
      if (maxPrice) params.set("maxPrice", maxPrice);
      if (from && to) { params.set("from", from); params.set("to", to); }

      showMessage(msg, "Searching…");
      results.replaceChildren();
      try {
        const cars = await request("GET", "/cars" + (params.toString() ? "?" + params : ""));
        if (!cars.length) return showMessage(msg, "No cars match your search. Try other filters.");
        showMessage(msg, cars.length + " car(s) found");
        results.replaceChildren(...cars.map((car) => carCard(car, from, to)));
      } catch (e) {
        showMessage(msg, e.message, "error");
      }
    }
  }

  function carCard(car, from, to) {
    const details = el("div", { className: "details", hidden: true });
    const booking = new URLSearchParams({ carId: car.id });
    if (from && to) { booking.set("from", from); booking.set("to", to); }

    const detailsBtn = el("button", {
      type: "button",
      className: "secondary",
      onclick: async () => {
        if (!details.hidden) { details.hidden = true; detailsBtn.textContent = "Details"; return; }
        details.replaceChildren("Loading…");
        details.hidden = false;
        detailsBtn.textContent = "Hide details";
        try {
          const c = await request("GET", "/cars/" + encodeURIComponent(car.id));
          details.replaceChildren(
            el("p", {}, "Office: " + c.office_name + ", " + c.city),
            el("p", {}, "Category: " + cap(c.category)),
            el("p", {}, "Status: " + cap(c.status))
          );
        } catch (e) {
          details.replaceChildren(el("p", { className: "error" }, e.message));
        }
      },
    }, "Details");

    return el("article", { className: "card" },
      el("h3", {}, car.make + " " + car.model),
      el("p", { className: "muted" }, cap(car.category) + " · " + car.office_name + ", " + car.city),
      el("p", { className: "price" }, egp(car.daily_price) + " / day"),
      el("div", { className: "actions" },
        detailsBtn,
        el("a", { className: "button", href: PAGES + "request-booking.html?" + booking }, "Request booking")
      ),
      details
    );
  }

  // ---------- pages/offices-map.html: offices + nearest (C7, C8) ----------

  async function initOfficesMapPage() {
    const list = $("office-list");
    const msg = $("map-msg");
    const form = $("nearest-form");
    let map = null;
    let layer = null;               // all markers of the current view
    const markerById = new Map();   // office id -> its marker (for "Show on map")

    if (window.L) {
      map = window.L.map("map", { scrollWheelZoom: false }).setView([30.0444, 31.2357], 6); // Egypt
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      layer = window.L.featureGroup().addTo(map);
    } else {
      $("map").hidden = true; // map library did not load: the list still works
    }

    function seeCarsLink(o) {
      return el("a", { className: "button", href: "../index.html#office=" + o.id }, "See cars here");
    }

    // Offices with the exact same position would hide each other: nudge duplicates apart a little
    function positions(offices) {
      const seen = new Map();
      return offices.map((o) => {
        if (o.latitude === null || o.longitude === null) return null;
        const key = Number(o.latitude).toFixed(4) + "," + Number(o.longitude).toFixed(4);
        const n = seen.get(key) || 0;
        seen.set(key, n + 1);
        return [Number(o.latitude) + n * 0.004, Number(o.longitude) + n * 0.004];
      });
    }

    function show(offices, me) {
      const pos = positions(offices);

      list.replaceChildren(...offices.map((o, i) =>
        el("li", { className: "card" },
          el("h3", {}, o.name, me && i === 0 ? el("span", { className: "badge" }, " Nearest") : null),
          el("p", { className: "muted" }, o.address + ", " + o.city),
          o.phone ? el("p", {}, "Phone: ", el("a", { href: "tel:" + o.phone.replace(/[^+0-9]/g, "") }, o.phone)) : null,
          o.distance_km !== undefined ? el("p", {}, el("span", { className: "price" }, o.distance_km + " km away")) : null,
          pos[i] ? null : el("p", { className: "muted" }, "Not on the map yet"),
          el("div", { className: "actions" },
            map && pos[i]
              ? el("button", {
                  type: "button",
                  className: "secondary",
                  onclick: () => {
                    const m = markerById.get(o.id);
                    map.flyTo(m.getLatLng(), 14);
                    m.openPopup();
                    $("map").scrollIntoView({ behavior: "smooth", block: "center" });
                  },
                }, "Show on map")
              : null,
            seeCarsLink(o)
          )
        )
      ));

      if (!map) return;
      layer.clearLayers();
      markerById.clear();
      offices.forEach((o, i) => {
        if (!pos[i]) return;
        const popup = el("div", {},
          el("strong", {}, o.name), el("br"),
          o.address + ", " + o.city, el("br"),
          o.distance_km !== undefined ? o.distance_km + " km away" : "",
          o.distance_km !== undefined ? el("br") : null,
          el("a", { href: "../index.html#office=" + o.id }, "See cars here")
        );
        const m = window.L.marker(pos[i], { title: o.name }).bindPopup(popup).addTo(layer);
        markerById.set(o.id, m);
      });

      if (me) {
        const you = window.L.circleMarker([me.lat, me.lon], { radius: 9, color: "#c2255c", fillColor: "#c2255c", fillOpacity: 0.6 })
          .bindPopup(el("div", {}, el("strong", {}, "You are here"), el("br"), me.label))
          .addTo(layer);
        // Zoom to you + the 3 nearest offices, not the whole country
        const focus = [you.getLatLng(), ...offices.slice(0, 3).map((o) => markerById.get(o.id)).filter(Boolean).map((m) => m.getLatLng())];
        map.fitBounds(window.L.latLngBounds(focus).pad(0.3), { maxZoom: 13 });
        const nearest = markerById.get(offices[0] && offices[0].id);
        if (nearest) nearest.openPopup();
      } else if (layer.getLayers().length) {
        map.fitBounds(layer.getBounds().pad(0.2), { maxZoom: 12 });
      }
    }

    async function showAll() {
      try {
        showMessage(msg, "Loading offices…");
        const offices = await request("GET", "/offices");
        show(offices);
        showMessage(msg, offices.length + " office(s). Type where you are to find the nearest.");
      } catch (e) {
        showMessage(msg, e.message, "error");
      }
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const location = $("location").value.trim();
      if (location.length < 2) return showMessage(msg, "Type a city or area, e.g. Nasr City.", "error");
      showMessage(msg, "Looking up " + location + "…");
      try {
        const data = await request("GET", "/offices/nearest?" + new URLSearchParams({ location, limit: "5" }));
        if (!data.offices.length) return showMessage(msg, "No offices have a map position yet.", "error");
        const first = data.offices[0];
        showMessage(msg, "Nearest office to " + data.location.label + ": " + first.name + " (" + first.distance_km + " km)", "ok");
        show(data.offices, data.location);
      } catch (e) {
        showMessage(msg, e.message, "error");
      }
    });

    $("show-all").addEventListener("click", () => { $("location").value = ""; showAll(); });
    showAll();
  }

  // ---------- staff pages: shared office picker ----------
  // Staff can only use THEIR office: the API answers 404 for any other office,
  // so remembering a wrong choice cannot expose another office's data.

  async function initOfficePicker(onChange) {
    const select = $("staff-office");
    let saved = "";
    try { saved = localStorage.getItem(OFFICE_KEY) || ""; } catch (e) { /* storage blocked */ }
    await fillOfficeSelect(select, { selected: saved });
    select.addEventListener("change", () => {
      try { localStorage.setItem(OFFICE_KEY, select.value); } catch (e) { /* ignore */ }
      onChange(select.value);
    });
    if (select.value) onChange(select.value);
  }

  // ---------- pages/staff-cars.html: my office's cars (C6) + add (C3), edit (C4), retire (C5) ----------

  async function initStaffCarsPage() {
    const msg = $("cars-msg");
    const tbody = $("cars-body");
    const addForm = $("add-form");
    let officeId = "";
    fillCategorySelect($("new-category"));

    async function load() {
      tbody.replaceChildren();
      if (!officeId) return showMessage(msg, "Choose your office first.");
      showMessage(msg, "Loading cars…");
      try {
        const cars = await request("GET", "/offices/" + encodeURIComponent(officeId) + "/cars", { auth: true });
        showMessage(msg, cars.length ? "" : "No cars in this office yet.");
        tbody.replaceChildren(...cars.map(carRow));
      } catch (e) {
        showMessage(msg, e.message, "error");
      }
    }

    function carRow(car) {
      const retired = car.status === "retired";
      const category = el("select", { disabled: retired });
      fillCategorySelect(category);
      category.value = car.category;
      const price = el("input", { type: "number", min: "1", step: "0.01", value: String(Number(car.daily_price)), disabled: retired });
      const status = el("select", { disabled: retired },
        el("option", { value: "available" }, "Available"),
        el("option", { value: "maintenance" }, "Maintenance"),
        ...(retired ? [el("option", { value: "retired" }, "Retired")] : [])
      );
      status.value = car.status;

      const save = el("button", {
        type: "button",
        disabled: retired,
        onclick: async () => {
          const changes = {};
          if (category.value !== car.category) changes.category = category.value;
          if (Number(price.value) !== Number(car.daily_price)) changes.dailyPrice = Number(price.value);
          if (status.value !== car.status) changes.status = status.value;
          if (!Object.keys(changes).length) return showMessage(msg, "Nothing changed.");
          try {
            await request("PUT", "/cars/" + encodeURIComponent(car.id), { body: changes, auth: true });
            showMessage(msg, car.plate + " saved.", "ok");
            load();
          } catch (e) {
            showMessage(msg, e.message, "error");
          }
        },
      }, "Save");

      const retire = el("button", {
        type: "button",
        className: "danger",
        disabled: retired,
        onclick: async () => {
          if (!window.confirm("Retire " + car.plate + "? It will be hidden from customers. Its history is kept.")) return;
          try {
            await request("DELETE", "/cars/" + encodeURIComponent(car.id), { auth: true });
            showMessage(msg, car.plate + " retired.", "ok");
            load();
          } catch (e) {
            showMessage(msg, e.message, "error");
          }
        },
      }, "Retire");

      return el("tr", { className: retired ? "retired" : "" },
        el("td", {}, car.plate),
        el("td", {}, car.make + " " + car.model),
        el("td", {}, category),
        el("td", {}, price),
        el("td", {}, status),
        el("td", {}, save, " ", retire)
      );
    }

    addForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const car = {
        plate: $("new-plate").value.trim(),
        make: $("new-make").value.trim(),
        model: $("new-model").value.trim(),
        category: $("new-category").value,
        dailyPrice: Number($("new-price").value),
      };
      try {
        const created = await request("POST", "/cars", { body: car, auth: true });
        showMessage(msg, created.plate + " added to your office.", "ok");
        addForm.reset();
        load();
      } catch (e) {
        showMessage(msg, e.message, "error");
      }
    });

    try {
      await initOfficePicker((id) => { officeId = id; load(); });
      if (!officeId) showMessage(msg, "Choose your office first.");
    } catch (e) {
      showMessage(msg, e.message, "error");
    }
  }

  // ---------- pages/staff-office.html: edit my office (C9) ----------

  async function initStaffOfficePage() {
    const msg = $("office-msg");
    const form = $("office-form");
    const fields = ["name", "address", "city", "phone"];
    let officeId = "";
    let current = null;

    async function load() {
      form.hidden = true;
      if (!officeId) return showMessage(msg, "Choose your office first.");
      try {
        const offices = await request("GET", "/offices");
        current = offices.find((o) => o.id === officeId);
        if (!current) return showMessage(msg, "Office not found.", "error");
        fields.forEach((f) => { $("office-" + f).value = current[f] || ""; });
        form.hidden = false;
        showMessage(msg, "");
      } catch (e) {
        showMessage(msg, e.message, "error");
      }
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const changes = {};
      fields.forEach((f) => {
        const value = $("office-" + f).value.trim();
        if (value !== (current[f] || "")) changes[f] = value;
      });
      if (!Object.keys(changes).length) return showMessage(msg, "Nothing changed.");
      try {
        const updated = await request("PUT", "/offices/" + encodeURIComponent(officeId), { body: changes, auth: true });
        showMessage(msg, updated.warning || "Office saved.", updated.warning ? "warn" : "ok");
        load();
      } catch (e) {
        showMessage(msg, e.message, "error");
      }
    });

    try {
      await initOfficePicker((id) => { officeId = id; load(); });
      if (!officeId) showMessage(msg, "Choose your office first.");
    } catch (e) {
      showMessage(msg, e.message, "error");
    }
  }

  window.Catalogue = { initSearchPage, initOfficesMapPage, initStaffCarsPage, initStaffOfficePage };
})();
