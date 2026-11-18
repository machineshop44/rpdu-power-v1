(function () {
  const version = window.RPDU_VERSION;
  const E = window.RpduEngine;
  const app = document.querySelector("#app");
  let state = E.emptyState();
  let page = "cabinet";
  let cabinetDraft = null;
  let libraryMode = "cabinet";
  let libraryQuery = "";
  let pendingDeleteId = "";
  let openName = "";
  let queuedPick = "";
  let pendingPhoto = "";
  let ampsBeforeShot = null;
  let cameraStream = null;
  let scanTimer = null;
  let glyphTemplates = null;
  let importPlace = { site: "", room: "" };
  let eraseArmed = false;
  let persistChain = Promise.resolve();
  let loadedPlaceKey = "";

  document.querySelector("[data-version-label]").textContent = version.VERSION_LABEL;
  document.querySelector("[data-display]").textContent = version.DISPLAY_NAME;
  document.querySelector("[data-semver]").textContent = version.SEMVER;
  document.title = version.DISPLAY_NAME;

  function esc(value) {
    return String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function countLabel(count, word) {
    return count + " " + word + (count === 1 ? "" : "s");
  }

  function safeImage(url) {
    return typeof url === "string" && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(url) ? url : "";
  }

  function numberOrNull(value) {
    if (String(value).trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  function when(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString();
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function setStatus(text) {
    const node = document.querySelector("#save-state");
    if (node) node.textContent = text;
  }

  function renderStatus() {
    const counts = E.counts(state);
    const node = document.querySelector("#status");
    if (!node) return;
    const bits = [];
    if (counts.rpdu || counts.device || counts.readings) {
      bits.push(counts.rpdu + " rPDUs");
      bits.push(counts.pdu + " room PDUs");
      bits.push(counts.device + " devices");
      bits.push(counts.readings + " readings");
    } else bits.push("Library is empty until you import a Power BDM sheet or save a reading.");
    node.textContent = bits.join(" · ");
  }

  function hydrate(raw) {
    const next = E.emptyState();
    if (!raw || typeof raw !== "object") return next;
    next.assets = Array.isArray(raw.assets) ? raw.assets : [];
    next.links = Array.isArray(raw.links) ? raw.links : [];
    next.readings = Array.isArray(raw.readings) ? raw.readings : [];
    next.rooms = Array.isArray(raw.rooms) ? raw.rooms : [];
    return next;
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open("rpdu-power-v1", 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv");
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function loadState() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const request = db.transaction("kv", "readonly").objectStore("kv").get("state");
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    }).catch(function () {
      try {
        const raw = localStorage.getItem("rpdu-power-v1");
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    });
  }

  function writeState(snapshot) {
    const copy = JSON.parse(JSON.stringify(snapshot));
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(copy, "state");
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () {
      localStorage.setItem("rpdu-power-v1", JSON.stringify(copy));
    });
  }

  function persist() {
    persistChain = persistChain.then(function () { return writeState(state); }, function () { return writeState(state); });
    return persistChain.then(function () {
      setStatus("Saved in this browser");
      renderStatus();
    }).catch(function () {
      setStatus("Could not store the library. Download a backup from Import.");
    });
  }

  function currentPage() {
    let name = (location.hash || "#cabinet").replace("#", "").split("?")[0];
    if (name === "find") name = "convert";
    return ["cabinet", "convert", "library", "powerdown", "import"].indexOf(name) === -1 ? "cabinet" : name;
  }

  function markTabs() {
    document.querySelectorAll(".tabs a").forEach(function (link) {
      if (link.dataset.page === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function show(next) {
    stopCamera();
    page = next || currentPage();
    history.replaceState(null, "", "#" + page);
    markTabs();
    if (page === "cabinet") renderCabinet();
    else if (page === "convert") renderConvert();
    else if (page === "library") renderLibrary();
    else if (page === "powerdown") renderPowerdown();
    else renderImport();
    renderStatus();
  }

  function banner(kind, text) {
    if (!text) return "";
    return '<div class="banner ' + kind + '" role="status">' + esc(text) + "</div>";
  }

  function defaults() {
    try { return JSON.parse(localStorage.getItem("rpdu-power-v1-defaults") || "{}"); }
    catch (error) { return {}; }
  }

  function namesFor(field) {
    const values = [];
    function add(value) {
      const name = E.cleanName(value);
      if (name && values.indexOf(name) === -1) values.push(name);
    }
    state.readings.forEach(function (reading) { add(reading[field]); });
    state.assets.forEach(function (asset) { add(asset[field]); });
    values.sort(E.naturalCompare);
    return values;
  }

  function optionList(id, values) {
    return '<datalist id="' + id + '">' + values.map(function (name) {
      return '<option value="' + esc(name) + '">';
    }).join("") + "</datalist>";
  }

  function voltChip(value, current) {
    return '<button type="button" class="chip" data-volt="' + value + '" aria-pressed="' + (String(current) === String(value) ? "true" : "false") + '">' + value + " V</button>";
  }

  function cabinetForm() {
    const saved = defaults();
    const draft = cabinetDraft || {};
    const volts = String(draft.volts || saved.volts || "208") === "120" ? "120" : "208";
    return {
      site: draft.site !== undefined && draft.site !== null ? draft.site : (saved.site || ""),
      room: draft.room !== undefined && draft.room !== null ? draft.room : (saved.room || ""),
      cabinet: draft.cabinet || "",
      feed: draft.feed === "B" ? "B" : "A",
      pdu: draft.pdu || "",
      circuits: draft.circuits || "",
      volts: volts,
      amps: draft.amps || ["", "", ""],
      note: draft.note || "",
    };
  }

  function readCabinetForm() {
    return {
      site: document.querySelector("#site").value,
      room: document.querySelector("#room").value,
      cabinet: document.querySelector("#cabinet").value,
      rpdu: E.rpduNameFor(document.querySelector("#cabinet").value, selectedFeed()),
      pdu: document.querySelector("#pdu").value,
      circuits: document.querySelector("#circuits").value,
      volts: selectedVolts(),
      amps: [1, 2, 3].map(function (n) { return document.querySelector("#amp-" + n).value; }),
      note: document.querySelector("#cabinet-note").value,
    };
  }

  function selectedVolts() {
    const button = app.querySelector("[data-volt][aria-pressed='true']");
    return button && button.dataset.volt === "120" ? 120 : 208;
  }

  function selectedFeed() {
    const button = app.querySelector("[data-feed][aria-pressed='true']");
    return button && button.dataset.feed === "B" ? "B" : "A";
  }

  function feedChip(feed, current) {
    return '<button type="button" class="chip" data-feed="' + feed + '" aria-pressed="' + (feed === current ? "true" : "false") + '">rPDU ' + feed + "</button>";
  }

  function renderCabinet() {
    const form = cabinetForm();
    app.innerHTML =
      '<div class="layout">' +
        '<section class="panel">' +
          '<h1>Cabinet reading</h1>' +
          '<p class="lead">Enter the site, the room, and the cabinet. Saved names are in each list. Example: cabinet DU06 in East Data Center at USNY01. Choosing a saved cabinet fills the breaker amps, PDU, and circuits. Breaker amps convert at power factor 1.0, then the scale uses 80% of that total once.</p>' +
          '<div id="cabinet-banner"></div>' +
          '<div class="fields">' +
            '<label class="field">Site ID<input id="site" list="site-list" autocomplete="off" spellcheck="false" placeholder="USNY01" value="' + esc(form.site) + '"></label>' +
            '<label class="field">Room<input id="room" list="room-list" autocomplete="off" spellcheck="false" placeholder="East Data Center" value="' + esc(form.room) + '"></label>' +
            '<label class="field">Cabinet<input id="cabinet" list="cabinet-list" autocomplete="off" spellcheck="false" placeholder="DU06" value="' + esc(form.cabinet) + '"></label>' +
            '<div class="field"><span>rPDU</span><div class="chips" role="group" aria-label="rPDU">' +
              feedChip("A", form.feed) + feedChip("B", form.feed) +
            '</div><p class="meta" id="rpdu-preview"></p></div>' +
            '<label class="field">PDU<input id="pdu" list="pdu-list" autocomplete="off" spellcheck="false" placeholder="Optional" value="' + esc(form.pdu) + '"></label>' +
            '<label class="field">Circuits<input id="circuits" autocomplete="off" spellcheck="false" placeholder="Optional" value="' + esc(form.circuits) + '"></label>' +
            '<div class="span-2"><div class="chips" role="group" aria-label="Voltage">' +
              voltChip(120, form.volts) + voltChip(208, form.volts) +
            "</div></div>" +
            '<label class="field">rPDU breaker 1<input id="amp-1" inputmode="decimal" value="' + esc(form.amps[0] || "") + '"></label>' +
            '<label class="field">rPDU breaker 2<input id="amp-2" inputmode="decimal" value="' + esc(form.amps[1] || "") + '"></label>' +
            '<label class="field">rPDU breaker 3<input id="amp-3" inputmode="decimal" value="' + esc(form.amps[2] || "") + '"></label>' +
            '<label class="field span-2">Note<textarea id="cabinet-note" style="min-height:72px">' + esc(form.note) + "</textarea></label>" +
          "</div>" +
          optionList("site-list", namesFor("site")) +
          optionList("room-list", E.choicesFor(state, "room", form.site, "")) +
          optionList("cabinet-list", E.choicesFor(state, "cabinet", form.site, form.room)) +
          optionList("pdu-list", namesFor("pdu")) +
          '<div class="photo-box" style="margin-top:12px">' +
            '<strong>Breaker photo</strong>' +
            '<p class="meta">Take photo opens the camera and reads the breaker amps into the three boxes. Live scan does the same while the camera stays open. Check the numbers, then save.</p>' +
            '<video id="camera" class="viewfinder" autoplay playsinline muted hidden></video>' +
            '<div class="actions">' +
              '<button type="button" class="btn btn-ghost" id="live-scan">Live scan</button>' +
              '<button type="button" class="btn btn-ghost" id="snap-photo" hidden>Use this frame</button>' +
              '<button type="button" class="btn btn-ghost" id="reset-shot">Reset shot</button>' +
              '<label class="btn btn-ghost">Take photo<input id="camera-photo" type="file" accept="image/*" capture="environment" hidden></label>' +
              '<label class="btn btn-ghost">Choose a picture<input id="photo" type="file" accept="image/*" hidden></label>' +
            "</div>" +
            '<img id="preview" class="preview" alt="" hidden>' +
          "</div>" +
          '<div class="actions"><button type="button" class="btn btn-primary" id="save-cabinet">Save</button>' +
          '<button type="button" class="btn btn-ghost" id="download-reading">Download reading file</button>' +
          '<button type="button" class="btn btn-ghost" id="next-cabinet">Next cabinet</button></div>' +
        "</section>" +
        '<aside class="readout" id="readout" aria-live="polite"></aside>' +
      "</div>";
    bindCabinet();
    refreshRpduName();
    updateCabinet();
    loadedPlaceKey = currentPlaceKey();
  }

  function refreshRpduName() {
    const preview = document.querySelector("#rpdu-preview");
    if (!preview) return;
    const name = E.rpduNameFor(document.querySelector("#cabinet").value, selectedFeed());
    preview.textContent = name ? "rPDU name " + name : "Type the cabinet and the rPDU name fills in.";
  }

  function currentPlaceKey() {
    const site = document.querySelector("#site");
    const room = document.querySelector("#room");
    const cabinet = document.querySelector("#cabinet");
    if (!site || !room || !cabinet) return "";
    return E.keyOf(site.value) + "|" + E.keyOf(room.value) + "|" + E.keyOf(cabinet.value) + "|" + selectedFeed();
  }

  function fillList(id, values) {
    const list = document.querySelector("#" + id);
    if (!list) return;
    list.innerHTML = values.map(function (name) {
      return '<option value="' + esc(name) + '">';
    }).join("");
  }

  function refreshPlaceLists() {
    const site = document.querySelector("#site");
    const room = document.querySelector("#room");
    if (!site || !room) return;
    fillList("room-list", E.choicesFor(state, "room", site.value, ""));
    fillList("cabinet-list", E.choicesFor(state, "cabinet", site.value, room.value));
  }

  function fillSavedCabinet() {
    const key = currentPlaceKey();
    if (!key || key === loadedPlaceKey) return;
    const form = readCabinetForm();
    loadedPlaceKey = key;
    if (!E.cleanName(form.site) || !E.cleanName(form.room) || !E.cleanName(form.cabinet)) return;
    const found = E.readingForCabinet(state, {
      site: form.site,
      room: form.room,
      cabinet: form.cabinet,
      rpduName: form.rpdu,
    });
    const box = document.querySelector("#cabinet-banner");
    if (!found) {
      if (box && box.textContent.indexOf("Loaded ") === 0) box.innerHTML = "";
      return;
    }
    const pdu = document.querySelector("#pdu");
    const circuits = document.querySelector("#circuits");
    const note = document.querySelector("#cabinet-note");
    if (pdu) pdu.value = found.pdu || "";
    if (circuits) circuits.value = found.circuits || "";
    if (note) note.value = found.notes || "";
    const amps = ["", "", ""];
    (found.breakers || []).forEach(function (breaker) {
      if (breaker.n >= 1 && breaker.n <= 3) amps[breaker.n - 1] = String(breaker.amps);
    });
    for (let i = 0; i < 3; i++) {
      const input = document.querySelector("#amp-" + (i + 1));
      if (input) input.value = amps[i];
    }
    const volts = found.volts === 120 ? "120" : "208";
    app.querySelectorAll("[data-volt]").forEach(function (button) {
      button.setAttribute("aria-pressed", button.dataset.volt === volts ? "true" : "false");
    });
    ampsBeforeShot = null;
    pendingPhoto = safeImage(found.photoDataUrl);
    const preview = document.querySelector("#preview");
    if (preview) {
      if (pendingPhoto) {
        preview.src = pendingPhoto;
        preview.hidden = false;
      } else {
        preview.removeAttribute("src");
        preview.hidden = true;
      }
    }
    updateCabinet();
    if (box) box.innerHTML = banner("ok", "Loaded " + (found.rpduName || form.rpdu) + ". Breaker amps, PDU, and circuits are filled from the saved reading. Change what you need, then save.");
  }

  function bindCabinet() {
    app.querySelectorAll("[data-volt]").forEach(function (button) {
      button.addEventListener("click", function () {
        app.querySelectorAll("[data-volt]").forEach(function (item) {
          item.setAttribute("aria-pressed", item === button ? "true" : "false");
        });
        updateCabinet();
      });
    });
    ["#site", "#room", "#cabinet", "#amp-1", "#amp-2", "#amp-3"].forEach(function (selector) {
      document.querySelector(selector).addEventListener("input", function () {
        if (selector === "#site" || selector === "#room") refreshPlaceLists();
        refreshRpduName();
        updateCabinet();
      });
    });
    ["#site", "#room", "#cabinet"].forEach(function (selector) {
      document.querySelector(selector).addEventListener("change", fillSavedCabinet);
    });
    app.querySelectorAll("[data-feed]").forEach(function (button) {
      button.addEventListener("click", function () {
        app.querySelectorAll("[data-feed]").forEach(function (item) {
          item.setAttribute("aria-pressed", item === button ? "true" : "false");
        });
        refreshRpduName();
        fillSavedCabinet();
      });
    });
    document.querySelector("#photo").addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      if (file) readPhotoFile(file);
    });
    document.querySelector("#camera-photo").addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      if (file) readPhotoFile(file);
    });
    document.querySelector("#live-scan").addEventListener("click", startLiveScan);
    document.querySelector("#reset-shot").addEventListener("click", resetShot);
    document.querySelector("#snap-photo").addEventListener("click", function () {
      const video = document.querySelector("#camera");
      if (!video || !video.videoWidth) return;
      rememberAmpsBeforeShot();
      const canvas = frameFromVideo(video);
      pendingPhoto = canvas.toDataURL("image/jpeg", 0.72);
      showPreview(pendingPhoto);
      recognizeCanvas(canvas);
    });
    if (pendingPhoto) {
      const preview = document.querySelector("#preview");
      preview.src = pendingPhoto;
      preview.hidden = false;
    }
    document.querySelector("#save-cabinet").addEventListener("click", saveCabinet);
    document.querySelector("#download-reading").addEventListener("click", downloadCurrentReading);
    document.querySelector("#next-cabinet").addEventListener("click", function () {
      const current = readCabinetForm();
      cabinetDraft = { site: current.site, room: current.room, cabinet: "", feed: selectedFeed(), pdu: current.pdu, circuits: "", volts: current.volts, amps: ["", "", ""], note: "" };
      pendingPhoto = "";
      stopCamera();
      renderCabinet();
    });
  }

  function gaugeHtml(kilowatts) {
    const status = E.thresholdFromKilowatts(kilowatts);
    return '<div class="gauge"><div class="gauge-track" aria-hidden="true"><span class="gauge-safe"></span><span class="gauge-mark"></span></div>' +
      '<p class="gauge-copy">Power factor 1.0. Breaker total ' + E.formatQty(status.kilowatts, 3) + " kW. The scale is 80% of that total: " +
      E.formatQty(status.limitKilowatts, 3) + " kW, " + E.formatQty(status.limitKilowattHours, 3) + " kWh each hour.</p></div>";
  }

  function updateCabinet() {
    const box = document.querySelector("#readout");
    if (!box) return;
    const volts = selectedVolts();
    const texts = [1, 2, 3].map(function (n) { return document.querySelector("#amp-" + n).value.trim(); });
    const amps = texts.map(function (text) { return text === "" ? 0 : Number(text); });
    if (!texts.some(function (text) { return text !== ""; })) {
      box.innerHTML = '<div class="kicker">' + volts + ' V · PF 1.0</div><p>Type the three breaker amps.</p><p class="meta">Each breaker converts at power factor 1.0. The scale is 80% of the total, applied once.</p>';
      return;
    }
    if (amps.some(function (amp, index) { return texts[index] !== "" && !(amp > 0); })) {
      box.innerHTML = '<div class="kicker">Result</div><p>Breaker amps need to be greater than 0.</p>';
      return;
    }
    const found = E.computeBreakers(volts, amps, 1);
    const rows = found.breakers.map(function (breaker) {
      return "<div>Breaker " + breaker.n + " · " + E.formatQty(breaker.amps, 2) + " A · " + E.formatQty(breaker.kilowatts, 3) + " kW · 80% " + E.formatQty(breaker.continuousKilowatts, 3) + " kW</div>";
    }).join("");
    box.innerHTML =
      '<div class="kicker">80% scale · PF 1.0 · ' + volts + " V</div>" +
      '<div class="figure">' + E.formatQty(found.continuousKilowatts, 3) + '<span class="unit">kW</span></div>' +
      '<div class="figure-sub">' + E.formatQty(found.limitKilowattHours, 3) + " kWh each hour</div>" +
      '<div class="figure-sub">Breaker total at PF 1.0: ' + E.formatQty(found.kilowatts, 3) + " kW · " + E.formatQty(found.kva, 3) + " kVA</div>" +
      gaugeHtml(found.kilowatts) +
      '<div class="formula">' + rows + "</div>" +
      '<p class="meta">' + E.formatQty(found.watts, 2) + " W across " + found.breakers.length + (found.breakers.length === 1 ? " breaker." : " breakers.") + "</p>";
  }

  function renderConvert() {
    const saved = defaults();
    const supply = saved.convertSupply === "three" ? "three" : "single";
    const volts = String(saved.volts) === "120" ? "120" : "208";
    app.innerHTML =
      '<div class="layout">' +
        '<section class="panel">' +
          '<h1>Convert</h1>' +
          '<p class="lead">Power math only. Field voltages are 120 V and 208 V.</p>' +
          '<div class="fields">' +
            '<div class="span-2"><div class="chips" role="group" aria-label="Supply">' +
              '<button type="button" class="chip" data-supply="single" aria-pressed="' + (supply === "single" ? "true" : "false") + '">Single-phase</button>' +
              '<button type="button" class="chip" data-supply="three" aria-pressed="' + (supply === "three" ? "true" : "false") + '">Three-phase</button>' +
            "</div></div>" +
            '<div class="span-2"><div class="chips" role="group" aria-label="Voltage">' +
              voltChip(120, volts) + voltChip(208, volts) +
            "</div></div>" +
            '<label class="field">Volts<input id="volts" inputmode="decimal" value="' + volts + '"></label>' +
            '<label class="field">Amps<input id="amps" inputmode="decimal"></label>' +
            '<label class="field">Power factor<input id="pf" inputmode="decimal" value="' + esc(saved.powerFactor || "1") + '"></label>' +
          "</div>" +
          '<details class="fold"><summary>Ohm\'s law wheel</summary><p class="meta">Enter any two of volts (E), amps (I), ohms (R), or watts (P).</p>' +
            '<div class="fields"><label class="field">Volts (E)<input id="ohm-e" inputmode="decimal"></label>' +
            '<label class="field">Amps (I)<input id="ohm-i" inputmode="decimal"></label>' +
            '<label class="field">Ohms (R)<input id="ohm-r" inputmode="decimal"></label>' +
            '<label class="field">Watts (P)<input id="ohm-p" inputmode="decimal"></label></div><p id="ohm-out" class="meta"></p></details>' +
        "</section>" +
        '<aside class="readout" id="readout" aria-live="polite"></aside>' +
      "</div>";
    bindConvert();
    updateConvert();
  }

  function bindConvert() {
    app.querySelectorAll("[data-supply]").forEach(function (button) {
      button.addEventListener("click", function () {
        app.querySelectorAll("[data-supply]").forEach(function (item) {
          item.setAttribute("aria-pressed", item === button ? "true" : "false");
        });
        updateConvert();
      });
    });
    app.querySelectorAll("[data-volt]").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelector("#volts").value = button.dataset.volt;
        app.querySelectorAll("[data-volt]").forEach(function (item) {
          item.setAttribute("aria-pressed", item === button ? "true" : "false");
        });
        updateConvert();
      });
    });
    ["#volts", "#amps", "#pf"].forEach(function (selector) {
      document.querySelector(selector).addEventListener("input", function () {
        const volts = document.querySelector("#volts").value.trim();
        app.querySelectorAll("[data-volt]").forEach(function (item) {
          item.setAttribute("aria-pressed", item.dataset.volt === volts ? "true" : "false");
        });
        updateConvert();
      });
    });
    ["#ohm-e", "#ohm-i", "#ohm-r", "#ohm-p"].forEach(function (selector) {
      document.querySelector(selector).addEventListener("input", updateOhm);
    });
  }

  function updateConvert() {
    const box = document.querySelector("#readout");
    const supplyButton = app.querySelector("[data-supply][aria-pressed='true']");
    const supply = supplyButton ? supplyButton.dataset.supply : "single";
    const voltsText = document.querySelector("#volts").value.trim();
    const ampsText = document.querySelector("#amps").value.trim();
    const pfValue = numberOrNull(document.querySelector("#pf").value);
    const voltsNumber = Number(voltsText);
    if (voltsText && voltsNumber !== 120 && voltsNumber !== 208) {
      box.innerHTML = '<div class="kicker">Result</div><p>Field voltage is 120 V or 208 V.</p>';
      return;
    }
    if (!voltsText || !ampsText) {
      box.innerHTML = '<div class="kicker">Result</div><p>' + (voltsText ? "Type the amps." : "Pick 120 V or 208 V, then type the amps.") + "</p>";
      return;
    }
    const error = E.findingError({
      supply: supply,
      volts: numberOrNull(voltsText),
      amps: numberOrNull(ampsText),
      powerFactor: pfValue === null ? NaN : pfValue,
      breakerCount: 1,
    });
    if (error) {
      box.innerHTML = '<div class="kicker">Result</div><p>' + esc(error) + "</p>";
      return;
    }
    const found = E.computeFinding({
      supply: supply,
      volts: numberOrNull(voltsText),
      amps: numberOrNull(ampsText),
      powerFactor: pfValue === null ? 1 : pfValue,
      breakerCount: 1,
    });
    box.innerHTML =
      '<div class="kicker">Nameplate</div>' +
      '<div class="figure">' + E.formatQty(found.kilowatts, 3) + '<span class="unit">kW</span></div>' +
      (found.kva === null ? "" : '<div class="figure-sub">' + E.formatQty(found.kva, 3) + ' <span class="unit">kVA</span></div>') +
      '<div class="formula">' + esc(found.formulaKw) + (found.formulaKva ? "\n" + esc(found.formulaKva) : "") + "</div>";
  }

  function updateOhm() {
    const solved = E.solveOhm({
      E: document.querySelector("#ohm-e").value,
      I: document.querySelector("#ohm-i").value,
      R: document.querySelector("#ohm-r").value,
      P: document.querySelector("#ohm-p").value,
    });
    const filled = ["#ohm-e", "#ohm-i", "#ohm-r", "#ohm-p"].filter(function (selector) {
      return String(document.querySelector(selector).value).trim() !== "";
    }).length;
    const out = document.querySelector("#ohm-out");
    if (filled < 2) out.textContent = "Enter two values.";
    else if (filled > 2) out.textContent = "Clear one field. The wheel uses two values.";
    else if (!solved) out.textContent = "Use numbers greater than zero.";
    else out.textContent = "E " + solved.E + " V · I " + solved.I + " A · R " + solved.R + " ohms · P " + solved.P + " W";
  }

  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error("Could not read that photo.")); };
      reader.onload = function () {
        const image = new Image();
        image.onload = function () {
          const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("Could not store that photo.")); return; }
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        };
        image.onerror = function () { reject(new Error("Use a JPEG or PNG photo.")); };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function stopCamera() {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (track) { track.stop(); });
      cameraStream = null;
    }
    const video = document.querySelector("#camera");
    if (video) video.srcObject = null;
  }

  function rememberAmpsBeforeShot() {
    if (ampsBeforeShot) return;
    ampsBeforeShot = [1, 2, 3].map(function (n) {
      const input = document.querySelector("#amp-" + n);
      return input ? input.value : "";
    });
  }

  function resetShot() {
    stopCamera();
    const video = document.querySelector("#camera");
    if (video) video.hidden = true;
    const snap = document.querySelector("#snap-photo");
    if (snap) snap.hidden = true;
    pendingPhoto = "";
    const preview = document.querySelector("#preview");
    if (preview) {
      preview.removeAttribute("src");
      preview.hidden = true;
    }
    const photo = document.querySelector("#photo");
    const cameraPhoto = document.querySelector("#camera-photo");
    if (photo) photo.value = "";
    if (cameraPhoto) cameraPhoto.value = "";
    const restored = ampsBeforeShot || [1, 2, 3].map(function (n) {
      const input = document.querySelector("#amp-" + n);
      return input ? input.value : "";
    });
    for (let i = 0; i < 3; i++) {
      const input = document.querySelector("#amp-" + (i + 1));
      if (input) input.value = restored[i] || "";
    }
    ampsBeforeShot = null;
    if (cabinetDraft) cabinetDraft.amps = restored.slice();
    const box = document.querySelector("#cabinet-banner");
    if (box) box.innerHTML = banner("ok", "Shot cleared. Scan again, or type the breaker amps.");
    updateCabinet();
  }

  function drawGlyph(ch, font) {
    const w = 20;
    const h = 28;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#000000";
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ch, w / 2, h / 2 + 1);
    const image = ctx.getImageData(0, 0, w, h);
    const data = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const lum = image.data[i * 4] * 0.3 + image.data[i * 4 + 1] * 0.59 + image.data[i * 4 + 2] * 0.11;
      data[i] = lum < 170 ? 1 : 0;
    }
    return { ch: ch, w: w, h: h, data: data };
  }

  function fontTemplates() {
    if (glyphTemplates) return glyphTemplates;
    const list = [];
    ["Arial", "Segoe UI", "Tahoma", "Verdana", "Consolas"].forEach(function (font) {
      "0123456789".split("").forEach(function (ch) {
        list.push(drawGlyph(ch, "bold 36px " + font));
      });
    });
    glyphTemplates = list;
    return list;
  }

  function frameFromVideo(video) {
    const scale = Math.min(1, 900 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function showPreview(url) {
    const preview = document.querySelector("#preview");
    if (!preview) return;
    preview.src = url;
    preview.hidden = false;
  }

  function applyReadAmps(result) {
    const box = document.querySelector("#cabinet-banner");
    if (!result.amps.length) {
      if (box) box.innerHTML = banner("bad", "No amp numbers showed up in that picture. Type the three breaker amps.");
      return;
    }
    for (let i = 0; i < 3; i++) {
      const input = document.querySelector("#amp-" + (i + 1));
      if (input) input.value = result.amps[i] ? String(result.amps[i]) : "";
    }
    updateCabinet();
    const volts = selectedVolts();
    const found = E.computeBreakers(volts, result.amps, 1);
    const list = result.amps.map(function (amp) { return amp + " A"; }).join(", ");
    if (box) box.innerHTML = banner("ok", "Read " + list + ". Power factor 1.0 gives " + E.formatQty(found.kilowatts, 3) + " kW. The 80% scale is " + E.formatQty(found.continuousKilowatts, 3) + " kW.");
  }

  function recognizeCanvas(canvas) {
    const box = document.querySelector("#cabinet-banner");
    if (box) box.innerHTML = banner("ok", "Reading the amp numbers from this photo.");
    const local = function () {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      applyReadAmps(E.readAmps(ctx.getImageData(0, 0, canvas.width, canvas.height), fontTemplates()));
    };
    if (typeof TextDetector === "function") {
      try {
        const detector = new TextDetector();
        detector.detect(canvas).then(function (blocks) {
          const text = blocks.map(function (block) { return block.rawValue || ""; }).join(" ");
          const amps = E.ampsFromText(text);
          if (amps.length) applyReadAmps({ amps: amps, confidence: 1 });
          else local();
        }).catch(local);
        return;
      } catch (error) { /* the on-page reader still runs */ }
    }
    local();
  }

  function recognizeUrl(url) {
    const image = new Image();
    image.onload = function () {
      const scale = Math.min(1, 900 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      recognizeCanvas(canvas);
    };
    image.src = url;
  }

  function readPhotoFile(file) {
    rememberAmpsBeforeShot();
    const box = document.querySelector("#cabinet-banner");
    if (box) box.innerHTML = banner("ok", "Reading the amp numbers from this photo.");
    shrinkImage(file).then(function (url) {
      pendingPhoto = url;
      showPreview(url);
      recognizeUrl(url);
    }).catch(function (error) {
      const box = document.querySelector("#cabinet-banner");
      if (box) box.innerHTML = banner("bad", error.message);
    });
  }

  function startLiveScan() {
    const box = document.querySelector("#cabinet-banner");
    const video = document.querySelector("#camera");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (box) box.innerHTML = banner("bad", "Use Take photo. That button opens the camera on a phone.");
      return;
    }
    stopCamera();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (stream) {
      cameraStream = stream;
      if (!video) return;
      video.srcObject = stream;
      video.hidden = false;
      const snap = document.querySelector("#snap-photo");
      if (snap) snap.hidden = false;
      video.play();
      let last = "";
      let stable = 0;
      scanTimer = setInterval(function () {
        if (!video.videoWidth) return;
        const canvas = frameFromVideo(video);
        const result = E.readAmps(canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height), fontTemplates());
        const key = result.amps.join(",");
        if (result.amps.length && key === last) stable += 1;
        else stable = 0;
        last = key;
        if (stable >= 1) {
          rememberAmpsBeforeShot();
          pendingPhoto = canvas.toDataURL("image/jpeg", 0.72);
          showPreview(pendingPhoto);
          applyReadAmps(result);
          stopCamera();
          video.hidden = true;
          if (snap) snap.hidden = true;
        }
      }, 700);
    }).catch(function () {
      if (box) box.innerHTML = banner("bad", "Use Take photo. That button opens the camera on a phone.");
    });
  }

  function currentReadingDraft() {
    const form = readCabinetForm();
    const site = E.cleanName(form.site);
    const room = E.cleanName(form.room);
    const cabinet = E.cleanName(form.cabinet);
    const rpdu = E.cleanName(form.rpdu);
    const amps = form.amps.map(function (text) {
      const trimmed = String(text).trim();
      return trimmed === "" ? 0 : Number(trimmed);
    });
    return {
      site: site,
      room: room,
      cabinet: cabinet,
      rpduName: rpdu,
      pdu: E.cleanName(form.pdu),
      circuits: E.cleanName(form.circuits),
      volts: form.volts,
      amps: amps,
      notes: E.cleanName(form.note),
      recordedAt: new Date().toISOString(),
      photoDataUrl: pendingPhoto,
    };
  }

  function downloadCurrentReading() {
    const box = document.querySelector("#cabinet-banner");
    const draft = currentReadingDraft();
    if (!draft.site || !draft.room || (!draft.cabinet && !draft.rpduName)) {
      if (box) box.innerHTML = banner("bad", "Enter the site, the room, and a cabinet or rPDU name before downloading the file.");
      return;
    }
    if (!draft.amps.some(function (amp) { return amp > 0; })) {
      if (box) box.innerHTML = banner("bad", "Enter at least one breaker amp before downloading the file.");
      return;
    }
    const packet = E.readingFile([draft]);
    const name = (draft.cabinet || draft.rpduName || "reading").replace(/[^\w.-]+/g, "-");
    download(name + "-reading.json", JSON.stringify(packet, null, 2), "application/json");
    if (box) box.innerHTML = banner("ok", "Reading file downloaded. Email that file to the work PC, then use Import there.");
  }

  function saveCabinet() {
    const form = readCabinetForm();
    const box = document.querySelector("#cabinet-banner");
    const site = E.cleanName(form.site);
    const room = E.cleanName(form.room);
    const cabinet = E.cleanName(form.cabinet);
    if (!site) { box.innerHTML = banner("bad", "Enter the site ID, such as USNY01."); return; }
    if (!room) { box.innerHTML = banner("bad", "Enter the room, such as East Data Center."); return; }
    if (!cabinet) { box.innerHTML = banner("bad", "Enter the cabinet, such as DU06."); return; }
    const rpdu = E.rpduNameFor(cabinet, selectedFeed());
    const amps = form.amps.map(function (text) {
      const trimmed = String(text).trim();
      return trimmed === "" ? 0 : Number(trimmed);
    });
    if (amps.some(function (amp, index) { return String(form.amps[index]).trim() !== "" && !(amp > 0); })) {
      box.innerHTML = banner("bad", "Breaker amps need to be greater than 0.");
      return;
    }
    const found = E.computeBreakers(form.volts, amps, 1);
    if (!found.breakers.length) {
      box.innerHTML = banner("bad", "Enter at least one breaker amp.");
      return;
    }
    state.readings.push({
      id: E.makeId(),
      recordedAt: new Date().toISOString(),
      site: site,
      room: room,
      cabinet: cabinet,
      rpduName: rpdu,
      pdu: E.cleanName(form.pdu),
      circuits: E.cleanName(form.circuits),
      volts: form.volts,
      breakers: found.breakers,
      watts: found.watts,
      kilowatts: found.kilowatts,
      kva: found.kva,
      notes: E.cleanName(form.note),
      photoDataUrl: pendingPhoto,
    });
    if (cabinet) {
      const existing = state.assets.find(function (asset) {
        return E.keyOf(asset.assetName) === E.keyOf(cabinet) && E.keyOf(asset.site || "") === E.keyOf(site) && E.keyOf(asset.room || "") === E.keyOf(room);
      });
      if (!existing) {
        state.assets.push({
          id: E.makeId(),
          assetName: cabinet,
          assetNumber: "",
          assetType: "Cabinet",
          materialName: "",
          operationalStatus: "",
          room: room,
          cabinet: cabinet,
          site: site,
          kind: "other",
          notes: "",
          updatedAt: new Date().toISOString(),
        });
      }
    }
    if (rpdu) {
      const existingRpdu = state.assets.find(function (asset) {
        return E.keyOf(asset.assetName) === E.keyOf(rpdu) && E.keyOf(asset.site || "") === E.keyOf(site) && E.keyOf(asset.room || "") === E.keyOf(room);
      });
      if (!existingRpdu) {
        state.assets.push({
          id: E.makeId(),
          assetName: rpdu,
          assetNumber: "",
          assetType: "Powerstrip",
          materialName: "",
          operationalStatus: "",
          room: room,
          cabinet: cabinet,
          site: site,
          kind: "rpdu",
          notes: "",
          updatedAt: new Date().toISOString(),
        });
      }
    }
    try {
      const saved = defaults();
      saved.site = site;
      saved.room = room;
      saved.volts = String(form.volts);
      localStorage.setItem("rpdu-power-v1-defaults", JSON.stringify(saved));
    } catch (ignored) { /* the reading itself is still stored */ }
    cabinetDraft = { site: site, room: room, cabinet: cabinet, feed: selectedFeed(), rpdu: rpdu, pdu: E.cleanName(form.pdu), circuits: E.cleanName(form.circuits), volts: form.volts, amps: form.amps, note: form.note };
    box.innerHTML = banner("ok", "Saved " + E.formatQty(found.continuousKilowatts, 3) + " kW on the 80% scale for " + rpdu + " in " + room + " at " + site + ". Breaker total at PF 1.0 is " + E.formatQty(found.kilowatts, 3) + " kW.");
    persist();
  }

  function renderLibrary() {
    app.innerHTML =
      '<section>' +
        '<h1>Library</h1>' +
        '<p class="lead">Cabinets are filed under the site, then the room. Each save stays in the list, including a second save of the same rPDU. Delete removes that one reading.</p>' +
        '<div class="toolbar">' +
          '<input class="search" id="library-search" placeholder="Search site, room, cabinet, or rPDU" value="' + esc(libraryQuery) + '">' +
        "</div>" +
        '<div id="list"></div>' +
      "</section>";
    document.querySelector("#library-search").addEventListener("input", function (event) {
      libraryQuery = event.target.value;
      renderList();
    });
    document.querySelector("#list").addEventListener("click", onLibraryClick);
    renderList();
  }

  function renderList() {
    const tree = E.placeLibrary(state, libraryQuery);
    const list = document.querySelector("#list");
    if (!list) return;
    if (!tree.length) {
      list.innerHTML = '<div class="empty panel">' + (libraryQuery ? "Nothing matches that search." : "No cabinet readings yet. Save one on the Cabinet screen, or import a sheet under a site and room.") + "</div>";
      return;
    }
    list.innerHTML = tree.map(function (site) {
      return '<section class="group"><div class="group-title">' + esc(site.site) + "</div>" +
        site.rooms.map(function (room) {
          return '<div class="meta" style="margin-top:10px">' + esc(room.room) + "</div>" +
            room.cabinets.map(function (item) {
              const amps = (item.breakers || []).map(function (breaker) { return E.formatQty(breaker.amps, 2) + " A"; }).join(" · ");
              const scale = item.kilowatts === null || item.kilowatts === undefined ? null : E.thresholdFromKilowatts(item.kilowatts);
              const kw = scale ? E.formatQty(scale.limitKilowatts, 3) + " kW" : "No reading";
              const gauge = scale ? gaugeHtml(item.kilowatts) : "";
              const placeBits = [amps, item.volts ? item.volts + " V" : "", item.pdu || "", item.circuits || "", item.recordedAt ? when(item.recordedAt) : ""].filter(Boolean);
              const deleteLabel = pendingDeleteId === item.id ? "Confirm delete" : "Delete";
              return '<article class="item"><div class="library-row"><button type="button" class="item-toggle" data-action="open-cabinet" data-id="' + esc(item.id || "") + '" data-site="' + esc(item.site || site.site) + '" data-room="' + esc(item.room || room.room) + '" data-cabinet="' + esc(item.cabinet || "") + '" data-rpdu="' + esc(item.rpduName || "") + '">' +
                '<span><span class="item-name">' + esc(item.label || item.cabinet) + '</span><span class="meta" style="display:block">' + esc(placeBits.join(" · ")) + "</span>" +
                gauge +
                "</span>" +
                '<span class="metric"><strong>' + esc(kw) + '</strong><span class="meta">' + (scale ? "80% of " + E.formatQty(item.kilowatts, 3) + " kW at PF 1.0" : "") + "</span></span></button>" +
                (item.id ? '<button type="button" class="btn btn-danger btn-small" data-action="delete-reading" data-id="' + esc(item.id) + '">' + deleteLabel + "</button>" : "") +
                "</div></article>";
            }).join("");
        }).join("") +
        "</section>";
    }).join("");
  }

  function itemHtml(row) {
    const asset = row.asset;
    const open = E.keyOf(openName) === E.keyOf(asset.assetName);
    const latest = row.latest ? E.formatQty(row.latest.kilowatts, 3) + " kW" : "No reading";
    const place = [row.cabinet ? (row.cabinetInferred ? row.cabinet + " (from devices)" : row.cabinet) : "", row.roomPdus.join(", ")].filter(Boolean).join(" · ");
    const readings = state.readings.filter(function (reading) { return E.keyOf(reading.rpduName) === E.keyOf(asset.assetName); })
      .sort(function (a, b) { return a.recordedAt < b.recordedAt ? 1 : -1; });
    return '<article class="item"><button type="button" class="item-toggle" data-action="toggle" data-name="' + esc(asset.assetName) + '">' +
      '<span><span class="item-name">' + esc(asset.assetName) + '</span><span class="meta" style="display:block">' + esc(place || "No cabinet or room PDU yet") + "</span></span>" +
      '<span class="metric"><strong>' + esc(latest) + "</strong><span class=\"meta\">" + esc(countLabel(row.deviceCount, "device")) + "</span></span></button>" +
      (open ? detailHtml(asset, row, readings) : "") +
      "</article>";
  }

  function detailHtml(asset, row, readings) {
    const kva = row.connectedKva === null ? "" : '<p class="meta">BDM connection max kVA on the devices: ' + E.formatQty(row.connectedKva, 3) + "</p>";
    return '<div class="detail"><div class="fields">' +
      '<label class="field">Cabinet<input name="cabinet" value="' + esc(asset.cabinet) + '"></label>' +
      '<label class="field">Room<input name="room" value="' + esc(asset.room) + '"></label>' +
      '<label class="field span-2">Notes<input name="notes" value="' + esc(asset.notes) + '"></label>' +
      "</div><div class=\"actions\">" +
      '<button type="button" class="btn btn-primary btn-small" data-action="save-place" data-name="' + esc(asset.assetName) + '">Save place</button>' +
      '<button type="button" class="btn btn-ghost btn-small" data-action="powerdown" data-name="' + esc(asset.assetName) + '">Devices on this rPDU</button>' +
      "</div>" + kva +
      (readings.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Breaker</th><th>kW</th><th>kVA</th><th></th></tr></thead><tbody>' +
        readings.map(function (reading) {
          const photo = safeImage(reading.photoDataUrl);
          return "<tr><td>" + esc(when(reading.recordedAt)) + "</td><td>" + esc(reading.volts + " V, " + reading.amps + " A " + E.supplyLabel(reading.supply)) +
            (photo ? '<br><img class="preview" alt="Breaker photo" src="' + photo + '">' : "") +
            "</td><td>" + E.formatQty(reading.kilowatts, 3) + "</td><td>" + (reading.kva === null ? "—" : E.formatQty(reading.kva, 3)) +
            '</td><td><button type="button" class="btn btn-ghost btn-small" data-action="delete-reading" data-id="' + esc(reading.id) + '">Delete</button></td></tr>';
        }).join("") + "</tbody></table></div>" : '<p class="meta">No breaker reading saved yet.</p>') +
      "</div>";
  }

  function onLibraryClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "open-cabinet") {
      pendingDeleteId = "";
      const reading = state.readings.find(function (item) { return item.id === target.dataset.id; });
      const source = reading || {
        site: target.dataset.site,
        room: target.dataset.room,
        cabinet: target.dataset.cabinet,
        rpduName: target.dataset.rpdu,
        volts: 208,
        breakers: [],
        notes: "",
        photoDataUrl: "",
      };
      const amps = ["", "", ""];
      (source.breakers || []).forEach(function (breaker) {
        if (breaker.n >= 1 && breaker.n <= 3) amps[breaker.n - 1] = String(breaker.amps);
      });
      cabinetDraft = {
        site: source.site || "",
        room: source.room || "",
        cabinet: source.cabinet || "",
        rpdu: source.rpduName || "",
        feed: /-B$/i.test(source.rpduName || "") ? "B" : "A",
        volts: source.volts === 120 ? 120 : 208,
        amps: amps,
        note: source.notes || "",
        pdu: source.pdu || "",
        circuits: source.circuits || "",
      };
      pendingPhoto = source.photoDataUrl || "";
      if ((location.hash || "").replace("#", "") === "cabinet") show("cabinet");
      else location.hash = "#cabinet";
      return;
    }
    if (action === "toggle") {
      openName = E.keyOf(openName) === E.keyOf(target.dataset.name) ? "" : target.dataset.name;
      renderList();
    } else if (action === "save-place") {
      const asset = E.assetByName(state, target.dataset.name);
      const article = target.closest("article");
      if (!asset || !article) return;
      asset.cabinet = E.cleanName(article.querySelector("[name=cabinet]").value);
      asset.room = E.cleanName(article.querySelector("[name=room]").value);
      asset.notes = E.cleanName(article.querySelector("[name=notes]").value);
      asset.updatedAt = new Date().toISOString();
      rememberRoom(asset.room);
      persist();
      renderList();
    } else if (action === "powerdown") {
      queuedPick = target.dataset.name;
      location.hash = "#powerdown";
    } else if (action === "delete-reading") {
      if (pendingDeleteId !== target.dataset.id) {
        pendingDeleteId = target.dataset.id;
        renderList();
        return;
      }
      const reading = state.readings.find(function (item) { return item.id === target.dataset.id; });
      state.readings = state.readings.filter(function (item) { return item.id !== target.dataset.id; });
      if (reading) {
        const samePlace = function (asset) {
          return E.keyOf(asset.site || "") === E.keyOf(reading.site || "") && E.keyOf(asset.room || "") === E.keyOf(reading.room || "");
        };
        const rpduLeft = state.readings.some(function (item) { return E.keyOf(item.rpduName) === E.keyOf(reading.rpduName); });
        const cabinetLeft = state.readings.some(function (item) {
          return E.keyOf(item.cabinet) === E.keyOf(reading.cabinet) && E.keyOf(item.site || "") === E.keyOf(reading.site || "") && E.keyOf(item.room || "") === E.keyOf(reading.room || "");
        });
        state.assets = state.assets.filter(function (asset) {
          if (reading.rpduName && !rpduLeft && E.keyOf(asset.assetName) === E.keyOf(reading.rpduName) && samePlace(asset)) return false;
          if (reading.cabinet && !cabinetLeft && E.keyOf(asset.assetName) === E.keyOf(reading.cabinet) && samePlace(asset)) return false;
          return true;
        });
      }
      pendingDeleteId = "";
      persist();
      renderList();
    }
  }

  function rememberRoom(name) {
    if (!name) return;
    if (state.rooms.some(function (room) { return E.keyOf(room.name) === E.keyOf(name); })) return;
    state.rooms.push({ name: name, imageDataUrl: "" });
  }

  function onLibraryChange(event) {
    const input = event.target;
    if (input.dataset.action !== "room-image" || !input.files || !input.files[0]) return;
    const roomName = input.dataset.room;
    shrinkImage(input.files[0]).then(function (url) {
      let room = roomFor(roomName);
      if (!room) {
        room = { name: roomName, imageDataUrl: "" };
        state.rooms.push(room);
      }
      room.imageDataUrl = url;
      persist();
      renderList();
    }).catch(function (error) {
      window.alert(error.message);
    });
  }

  function renderPowerdown() {
    app.innerHTML =
      '<section class="panel">' +
        '<h1>Powerdown</h1>' +
        '<p class="lead">Pick an rPDU or a room PDU. The list is every device downstream of it. A device with no other feed drops if this source is opened. A device with another feed stays up on that cord.</p>' +
        '<label class="field">rPDU or room PDU<input id="pick" autocomplete="off" placeholder="Start typing a name"></label>' +
        '<div class="matches" id="matches"></div>' +
        '<div id="report"></div>' +
      "</section>";
    const pick = document.querySelector("#pick");
    pick.addEventListener("input", function () {
      const matches = E.searchAssets(state, pick.value, ["rpdu", "pdu", "device"]);
      document.querySelector("#matches").innerHTML = matches.map(function (asset) {
        return '<button type="button" class="btn btn-ghost" data-pick="' + esc(asset.assetName) + '">' + esc(asset.assetName) + " · " + esc(E.kindLabel(asset.kind)) + "</button>";
      }).join("");
    });
    document.querySelector("#matches").addEventListener("click", function (event) {
      const button = event.target.closest("[data-pick]");
      if (!button) return;
      pick.value = button.dataset.pick;
      document.querySelector("#matches").innerHTML = "";
      renderReport(button.dataset.pick);
    });
    document.querySelector("#report").addEventListener("click", function (event) {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "download-impact") {
        const report = E.impact(state, pick.value);
        if (!report) return;
        download("powerdown-" + report.name.replace(/[^\w.-]+/g, "_") + ".csv", E.impactCsv(report), "text/csv;charset=utf-8");
      } else if (button.dataset.action === "print-impact") window.print();
      else if (button.dataset.action === "open-feed") {
        pick.value = button.dataset.name;
        renderReport(button.dataset.name);
      }
    });
    if (queuedPick) {
      pick.value = queuedPick;
      renderReport(queuedPick);
      queuedPick = "";
    }
  }

  function renderReport(name) {
    const report = E.impact(state, name);
    const node = document.querySelector("#report");
    if (!report) { node.innerHTML = ""; return; }
    const latest = E.latestReading(state, report.name);
    const upstream = report.upstream.map(function (row) {
      return esc(E.kindLabel(row.kind) + " " + row.name);
    }).join(" ← ");
    const equipment = report.equipment.length
      ? '<h2>Power equipment downstream</h2><div class="matches">' + report.equipment.map(function (row) {
          return '<button type="button" class="btn btn-ghost" data-action="open-feed" data-name="' + esc(row.name) + '">' + esc(row.name) + " · " + esc(E.kindLabel(row.kind)) + "</button>";
        }).join("") + "</div>"
      : "";
    node.innerHTML =
      "<h2>" + esc(report.name) + "</h2>" +
      (upstream ? '<p class="meta">Upstream: ' + upstream + "</p>" : "") +
      (latest ? '<p class="meta">Latest breaker reading: ' + E.formatQty(latest.kilowatts, 3) + " kW · " + esc(latest.volts + " V, " + latest.amps + " A") + "</p>" : "") +
      '<p><strong>' + report.devices.length + "</strong> devices on this path. <strong>" + report.singleCord + "</strong> have no other feed.</p>" +
      '<div class="actions"><button type="button" class="btn btn-primary" data-action="download-impact">Download impact list</button>' +
      '<button type="button" class="btn btn-ghost" data-action="print-impact">Print list</button></div>' +
      equipment +
      (report.devices.length ? deviceTable(report.devices) : '<p class="meta">No downstream devices are in the library for that name.</p>');
  }

  function deviceTable(devices) {
    return '<div class="table-wrap"><table class="data"><thead><tr><th>Device</th><th>Type</th><th>Cabinet</th><th>Fed by</th><th>Outlet</th><th>Other feed</th><th>Max kVA</th></tr></thead><tbody>' +
      devices.map(function (row) {
        const other = row.otherFeeds.length
          ? row.otherFeeds.map(function (feed) { return feed.supplierName + (feed.outlet ? " outlet " + feed.outlet : ""); }).join(", ")
          : (row.samePathFeeds && row.samePathFeeds.length
            ? "Also on this path: " + row.samePathFeeds.map(function (feed) { return feed.supplierName; }).join(", ")
            : "None");
        return '<tr class="' + (row.singleCord ? "single" : "") + '"><td>' + esc(row.name) + "</td><td>" + esc(row.assetType) + "</td><td>" + esc(row.cabinet) +
          "</td><td>" + esc(row.via) + "</td><td>" + esc(row.outlet || row.plugPosition) + "</td><td>" + esc(other) + "</td><td>" +
          (row.maxKva === null || row.maxKva === undefined ? "" : E.formatQty(row.maxKva, 3)) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderImport() {
    const counts = E.counts(state);
    const saved = defaults();
    const site = importPlace.site || saved.site || "";
    const room = importPlace.room || saved.room || "";
    app.innerHTML =
      '<section class="paste">' +
        '<h1>Import</h1>' +
        '<p class="lead">Enter the site, then the room. Paste a cabinet sheet or a Power BDM sheet and it is filed there. A reading file from the phone can be imported below. The file already carries its site, room, cabinet, and amps.</p>' +
        '<div class="fields">' +
          '<label class="field">Site ID<input id="import-site" list="import-site-list" autocomplete="off" spellcheck="false" placeholder="USNY01" value="' + esc(site) + '"></label>' +
          '<label class="field">Room<input id="import-room" list="import-room-list" autocomplete="off" spellcheck="false" placeholder="East Data Center" value="' + esc(room) + '"></label>' +
        "</div>" +
        optionList("import-site-list", namesFor("site")) +
        optionList("import-room-list", namesFor("room")) +
        '<p class="meta">Cabinet sheet columns: Cabinet, Breaker 1, Breaker 2, Breaker 3, Volts. Volts can be 120 or 208. For BDM, paste Asset to Asset, then Breaker to Asset.</p>' +
        '<div class="stats"><span class="stat">' + counts.rpdu + ' rPDUs</span><span class="stat">' + counts.pdu + ' room PDUs</span><span class="stat">' + counts.device + ' devices</span><span class="stat">' + state.readings.length + " readings</span></div>" +
        '<div id="import-banner"></div>' +
        '<textarea id="sheet" placeholder="Paste the sheet here"></textarea>' +
        '<div class="actions"><button type="button" class="btn btn-primary" id="add-sheet">Add this sheet</button>' +
        '<label class="btn btn-ghost">CSV file<input id="csv-file" type="file" accept=".csv,text/csv" hidden></label>' +
        '<label class="btn btn-ghost">Reading file<input id="reading-file" type="file" accept="application/json,.json" hidden></label></div>' +
        '<h2>Keep a copy</h2>' +
        '<p class="meta">The library stays in this browser. On a phone, download a reading file and email it to the work PC. Open rPDU Power v1.html there and import the file. A full backup is the whole library.</p>' +
        '<div class="actions"><button type="button" class="btn btn-ghost" id="backup">Download backup</button>' +
        '<button type="button" class="btn btn-ghost" id="download-all-readings">Download all readings</button>' +
        '<label class="btn btn-ghost">Restore backup<input id="restore" type="file" accept="application/json,.json" hidden></label>' +
        '<button type="button" class="btn btn-danger" id="erase">' + (eraseArmed ? "Delete the library in this browser" : "Erase this browser's copy") + "</button></div>" +
        (eraseArmed ? '<p class="meta">The Excel workbook and any emailed reading files are left as they are. This only clears the copy in this browser.</p>' : "") +
      "</section>";
    document.querySelector("#add-sheet").addEventListener("click", function () {
      takeSheet(document.querySelector("#sheet").value);
    });
    document.querySelector("#csv-file").addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () { takeSheet(String(reader.result)); };
      reader.readAsText(file);
    });
    document.querySelector("#reading-file").addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () { takeReadingFile(String(reader.result)); };
      reader.readAsText(file);
    });
    document.querySelector("#download-all-readings").addEventListener("click", function () {
      const packet = E.readingFile(state.readings);
      download("rpdu-power-readings.json", JSON.stringify(packet, null, 2), "application/json");
      document.querySelector("#import-banner").innerHTML = banner("ok", "Reading file downloaded. Email it, then import it on the work PC.");
    });
        '<label class="btn btn-ghost">Restore backup<input id="restore" type="file" accept="application/json,.json" hidden></label>' +
        '<button type="button" class="btn btn-danger" id="erase">' + (eraseArmed ? "Delete the library in this browser" : "Erase this browser's copy") + "</button></div>" +
        (eraseArmed ? '<p class="meta">The Excel workbook is left as it is. This only clears the copy in this browser.</p>' : "") +
      "</section>";
    document.querySelector("#add-sheet").addEventListener("click", function () {
      takeSheet(document.querySelector("#sheet").value);
    });
    document.querySelector("#csv-file").addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () { takeSheet(String(reader.result)); };
      reader.readAsText(file);
    });
    document.querySelector("#backup").addEventListener("click", function () {
      download("rpdu-power-v1-backup.json", JSON.stringify({
        app: version.DISPLAY_NAME,
        version: version.SEMVER,
        exportedAt: new Date().toISOString(),
        assets: state.assets,
        links: state.links,
        readings: state.readings,
        rooms: state.rooms,
      }, null, 2), "application/json");
    });
    document.querySelector("#restore").addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const raw = JSON.parse(String(reader.result));
          state = hydrate(raw);
          eraseArmed = false;
          persist();
          renderImport();
          document.querySelector("#import-banner").innerHTML = banner("ok", "Backup restored.");
        } catch (error) {
          document.querySelector("#import-banner").innerHTML = banner("bad", "That file is not an rPDU Power backup.");
        }
      };
      reader.readAsText(file);
    });
    document.querySelector("#erase").addEventListener("click", function () {
      if (!eraseArmed) {
        eraseArmed = true;
        renderImport();
        return;
      }
      state = E.emptyState();
      eraseArmed = false;
      persist();
      renderImport();
    });
  }

  function takeSheet(text) {
    const site = E.cleanName(document.querySelector("#import-site").value);
    const room = E.cleanName(document.querySelector("#import-room").value);
    importPlace = { site: site, room: room };
    const box = document.querySelector("#import-banner");
    if (!site || !room) {
      box.innerHTML = banner("bad", "Enter the site ID, then the room. The sheet is filed under that room.");
      return;
    }
    const result = E.applyImport(state, text, { site: site, room: room });
    if (!result.summary.ok) {
      box.innerHTML = banner("bad", result.summary.message);
      return;
    }
    state = result.state;
    persist();
    try {
      const saved = defaults();
      saved.site = site;
      saved.room = room;
      localStorage.setItem("rpdu-power-v1-defaults", JSON.stringify(saved));
    } catch (ignored) { /* the sheet itself is stored */ }
    const summary = result.summary;
    const line = summary.message || (summary.sheet === "links"
      ? "Added " + summary.linksAdded + " connections under " + site + " / " + room + "."
      : "Filed under " + site + " / " + room + ".");
    renderImport();
    const fresh = document.querySelector("#import-banner");
    if (fresh) fresh.innerHTML = banner("ok", line);
  }

  function takeReadingFile(text) {
    const siteField = document.querySelector("#import-site");
    const roomField = document.querySelector("#import-room");
    const site = siteField ? E.cleanName(siteField.value) : "";
    const room = roomField ? E.cleanName(roomField.value) : "";
    importPlace = { site: site, room: room };
    const result = E.applyReadingFile(state, text, { site: site, room: room });
    const box = document.querySelector("#import-banner");
    if (!result.summary.ok) {
      if (box) box.innerHTML = banner("bad", result.summary.message);
      return;
    }
    state = result.state;
    persist();
    renderImport();
    const fresh = document.querySelector("#import-banner");
    if (fresh) fresh.innerHTML = banner("ok", result.summary.message);
  }

  window.addEventListener("hashchange", function () { show(currentPage()); });
  loadState().then(function (raw) {
    state = hydrate(raw);
    show(currentPage());
  });
})();
