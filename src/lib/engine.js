(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RpduEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PHASE_FACTOR = 1.73;
  const PHASE_TEXT = "1.73";
  const WATTS_PER_HP = 745.6;
  const CONTINUOUS = 0.8;

  function roundTo(value, digits) {
    return Number(value.toFixed(digits));
  }

  function formatQty(value, digits) {
    if (!Number.isFinite(value)) return "—";
    const places = digits === undefined ? 3 : digits;
    return Number(value.toFixed(places)).toLocaleString("en-US", {
      maximumFractionDigits: places,
    });
  }

  function formatPlain(value) {
    if (!Number.isFinite(value)) return "—";
    const rounded = Number(value.toFixed(4));
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  }

  function formatPf(value) {
    if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
    return value.toFixed(2);
  }

  function supplyLabel(supply) {
    if (supply === "dc") return "DC";
    if (supply === "single") return "Single-phase";
    return "Three-phase";
  }

  function ruleText(supply) {
    if (supply === "dc") return ["Kilowatts = volts × amps / 1000"];
    if (supply === "single") {
      return [
        "Kilowatts = volts × amps × power factor / 1000",
        "kVA = volts × amps / 1000",
      ];
    }
    return [
      "Kilowatts = volts × amps × power factor × " + PHASE_TEXT + " / 1000",
      "kVA = volts × amps × " + PHASE_TEXT + " / 1000",
    ];
  }

  function findingError(input) {
    if (!input) return "Enter volts and breaker amps.";
    if (!(input.volts > 0) || input.volts > 1000) return "Volts need to be greater than 0 and at most 1000.";
    if (!(input.amps > 0) || input.amps > 5000) return "Breaker amps need to be greater than 0.";
    if (input.supply !== "dc" && (!(input.powerFactor > 0) || input.powerFactor > 1)) {
      return "Power factor needs to be above 0 and at most 1.";
    }
    if (!Number.isInteger(input.breakerCount) || input.breakerCount < 1 || input.breakerCount > 48) {
      return "Matching breakers needs to be a whole number from 1 to 48.";
    }
    if (["dc", "single", "three"].indexOf(input.supply) === -1) {
      return "Choose DC, single-phase, or three-phase.";
    }
    return "";
  }

  function productParts(volts, amps, extras) {
    const parts = [formatPlain(volts), formatPlain(amps)];
    for (let i = 0; i < extras.length; i++) parts.push(extras[i]);
    return parts.join(" × ");
  }

  function computeFinding(input) {
    const error = findingError(input);
    if (error) throw new Error(error);
    const supply = input.supply;
    const volts = input.volts;
    const amps = input.amps;
    const count = input.breakerCount;
    const powerFactorUsed = supply === "dc" ? 1 : input.powerFactor;
    const phase = supply === "three" ? PHASE_FACTOR : 1;
    const extras = [];
    if (supply !== "dc" && Math.abs(powerFactorUsed - 1) > 1e-9) extras.push(formatPf(powerFactorUsed));
    if (supply === "three") extras.push(PHASE_TEXT);
    const kvaExtras = supply === "three" ? [PHASE_TEXT] : [];

    const real = volts * amps * powerFactorUsed * phase * count;
    const watts = roundTo(real, 2);
    const kilowatts = roundTo(real / 1000, 3);
    const apparent = volts * amps * phase * count;
    const kva = supply === "dc" ? null : roundTo(apparent / 1000, 3);
    const horsepower = roundTo(real / WATTS_PER_HP, 3);
    const continuousReal = volts * amps * CONTINUOUS * powerFactorUsed * phase * count;
    const continuousAmps = roundTo(amps * CONTINUOUS * count, 2);
    const continuousKilowatts = roundTo(continuousReal / 1000, 3);
    const continuousKva = supply === "dc" ? null : roundTo((volts * amps * CONTINUOUS * phase * count) / 1000, 3);

    const core = productParts(volts, amps, extras);
    const countSuffix = count === 1 ? "" : " × " + count;
    const formulaWatts = "P = " + core + countSuffix + " = " + formatQty(watts, 2) + " W";
    const formulaKw =
      "kW = (" + core + ") / 1000" + countSuffix + " = " + formatQty(kilowatts, 3);
    let formulaKva = null;
    if (kva !== null) {
      const kvaCore = productParts(volts, amps, kvaExtras);
      formulaKva = "kVA = (" + kvaCore + ") / 1000" + countSuffix + " = " + formatQty(kva, 3);
    }

    let resistanceOhms = null;
    let formulaResistance = null;
    if ((supply === "dc" || supply === "single") && count === 1 && Math.abs(powerFactorUsed - 1) < 1e-9) {
      const simpleWatts = roundTo(volts * amps, 2);
      resistanceOhms = roundTo(volts / amps, 3);
      const fromPower = roundTo(simpleWatts / (amps * amps), 3);
      formulaResistance =
        "R = E / I = " + formatPlain(volts) + " / " + formatPlain(amps) + " = " + formatQty(resistanceOhms, 3) + " ohms\n" +
        "R = P / I² = " + formatQty(simpleWatts, 2) + " / " + formatQty(amps * amps, 2) + " = " + formatQty(fromPower, 3) + " ohms";
    }

    const perBreaker = formatPlain(amps) + " × 0.80 = " + formatQty(roundTo(amps * CONTINUOUS, 2), 2) + " A";
    const formulaContinuous = count === 1
      ? "Continuous amps = " + perBreaker
      : "Continuous amps = (" + perBreaker + ") × " + count + " = " + formatQty(continuousAmps, 2) + " A";

    return {
      watts: watts,
      kilowatts: kilowatts,
      kva: kva,
      resistanceOhms: resistanceOhms,
      horsepower: horsepower,
      continuousAmps: continuousAmps,
      continuousKilowatts: continuousKilowatts,
      continuousKva: continuousKva,
      powerFactorUsed: powerFactorUsed,
      formulaWatts: formulaWatts,
      formulaKw: formulaKw,
      formulaKva: formulaKva,
      formulaResistance: formulaResistance,
      formulaContinuous: formulaContinuous,
    };
  }

  function solveOhm(known) {
    const keys = ["E", "I", "R", "P"].filter(function (key) {
      return known && known[key] !== undefined && known[key] !== null && known[key] !== "" && Number(known[key]) > 0;
    });
    if (keys.length !== 2) return null;
    const map = {};
    keys.forEach(function (key) { map[key] = Number(known[key]); });
    const has = function (key) { return Object.prototype.hasOwnProperty.call(map, key); };
    let E;
    let I;
    let R;
    let P;
    if (has("E") && has("I")) {
      E = map.E; I = map.I; P = E * I; R = E / I;
    } else if (has("E") && has("R")) {
      E = map.E; R = map.R; I = E / R; P = (E * E) / R;
    } else if (has("E") && has("P")) {
      E = map.E; P = map.P; I = P / E; R = (E * E) / P;
    } else if (has("I") && has("R")) {
      I = map.I; R = map.R; E = I * R; P = I * I * R;
    } else if (has("I") && has("P")) {
      I = map.I; P = map.P; E = P / I; R = P / (I * I);
    } else if (has("R") && has("P")) {
      R = map.R; P = map.P; I = Math.sqrt(P / R); E = Math.sqrt(P * R);
    } else return null;
    return { E: roundTo(E, 4), I: roundTo(I, 4), R: roundTo(R, 4), P: roundTo(P, 4) };
  }

  const GUIDE_CHECKS = [
    {
      id: "watts",
      title: "Watts and ohms",
      inputs: "120 V, 5 A",
      input: { supply: "single", volts: 120, amps: 5, powerFactor: 1, breakerCount: 1 },
      expect: { watts: 600, resistanceOhms: 24 },
    },
    {
      id: "dc",
      title: "Direct-current kilowatts",
      inputs: "120 V DC, 40 A",
      input: { supply: "dc", volts: 120, amps: 40, powerFactor: 1, breakerCount: 1 },
      expect: { watts: 4800, kilowatts: 4.8, kva: null },
    },
    {
      id: "single-kw",
      title: "Single-phase kilowatts",
      inputs: "115 V, 20 A, power factor 0.86",
      input: { supply: "single", volts: 115, amps: 20, powerFactor: 0.86, breakerCount: 1 },
      expect: { watts: 1978, kilowatts: 1.978, kva: 2.3 },
    },
    {
      id: "three-kw",
      title: "Three-phase kilowatts",
      inputs: "460 V, 52 A, power factor 0.80",
      input: { supply: "three", volts: 460, amps: 52, powerFactor: 0.8, breakerCount: 1 },
      expect: { kilowatts: 33.105, kva: 41.382, continuousAmps: 41.6, continuousKilowatts: 26.484 },
    },
    {
      id: "single-kva",
      title: "Single-phase kVA",
      inputs: "240 V, 41.66 A",
      input: { supply: "single", volts: 240, amps: 41.66, powerFactor: 1, breakerCount: 1 },
      expect: { kva: 9.998 },
    },
    {
      id: "three-kva",
      title: "Three-phase kVA",
      inputs: "460 V, 52 A",
      input: { supply: "three", volts: 460, amps: 52, powerFactor: 1, breakerCount: 1 },
      expect: { kilowatts: 41.382, kva: 41.382 },
    },
  ];

  function emptyState() {
    return { assets: [], links: [], readings: [], rooms: [] };
  }

  function makeId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function cleanName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function rpduNameFor(cabinet, feed) {
    const name = cleanName(cabinet);
    if (!name) return "";
    return name + "-" + (String(feed || "A").toUpperCase() === "B" ? "B" : "A");
  }

  function keyOf(value) {
    return cleanName(value).toLowerCase();
  }

  function kindFromType(type) {
    const t = String(type || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!t) return "other";
    if (t.includes("power strip") || t.includes("powerstrip") || t === "rpdu" || t.includes("rack pdu") || t.includes("r-pdu")) {
      return "rpdu";
    }
    if (t === "pdu" || t.includes("floor pdu") || t.includes("remote power panel") || t === "rpp") return "pdu";
    if (t.includes("ups") || t.includes("static switch") || t.includes("utility feed") || t === "utility") return "power";
    return "device";
  }

  function kindLabel(kind) {
    if (kind === "rpdu") return "rPDU";
    if (kind === "pdu") return "Room PDU";
    if (kind === "power") return "Power equipment";
    if (kind === "device") return "Device";
    return "Other";
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const source = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (inQuotes) {
        if (ch === '"') {
          if (source[i + 1] === '"') {
            cell += '"';
            i++;
          } else inQuotes = false;
        } else cell += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delimiter) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") cell += ch;
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter(function (cells) {
      return cells.some(function (value) { return String(value).trim() !== ""; });
    });
  }

  function detectDelimiter(text) {
    const line = String(text || "").split(/\r?\n/).find(function (item) { return item.trim(); }) || "";
    const tabs = (line.match(/\t/g) || []).length;
    const commas = (line.match(/,/g) || []).length;
    return tabs > commas ? "\t" : ",";
  }

  function normalizeHeader(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  const HEADER_MAP = {
    "consumer asset type": "consumerType",
    "consumer material name": "consumerMaterial",
    "consumer asset name": "consumerName",
    "consumer asset number": "consumerNumber",
    "consumer operational status": "consumerStatus",
    "consumer plug position": "plugPosition",
    "supplier asset type": "supplierType",
    "supplier material name": "supplierMaterial",
    "supplier asset name": "supplierName",
    "supplier asset number": "supplierNumber",
    "supplier operational status": "supplierStatus",
    "supplier outlet": "supplierOutlet",
    "connection name": "connectionName",
    "connection max kva": "maxKva",
    "connection max kw": "maxKw",
    breaker: "breaker",
    "breaker name": "breaker",
    "breaker position": "breaker",
    panel: "panel",
    "pdu panel": "panel",
    cabinet: "cabinet",
    "cabinet name": "cabinet",
    "consumer cabinet": "cabinet",
    "breaker 1": "breaker1",
    "breaker 1 amps": "breaker1",
    "breaker1": "breaker1",
    "amps 1": "breaker1",
    "breaker 2": "breaker2",
    "breaker 2 amps": "breaker2",
    "breaker2": "breaker2",
    "amps 2": "breaker2",
    "breaker 3": "breaker3",
    "breaker 3 amps": "breaker3",
    "breaker3": "breaker3",
    "amps 3": "breaker3",
    volts: "volts",
    voltage: "volts",
    site: "site",
    "site id": "site",
    "site name": "site",
    room: "room",
    "room name": "room",
    location: "room",
    "data hall": "room",
    "asset name": "assetName",
    "asset number": "assetNumber",
    "asset type": "assetType",
    "material name": "materialName",
    "operational status": "operationalStatus",
    "power strip asset name": "assetName",
    "power strip name": "assetName",
    "pdu asset name": "assetName",
    "pdu name": "assetName",
  };

  function mapHeaders(cells) {
    return cells.map(function (cell) {
      return HEADER_MAP[normalizeHeader(cell)] || "";
    });
  }

  function findHeader(rows) {
    for (let i = 0; i < rows.length && i < 15; i++) {
      const mapped = mapHeaders(rows[i]);
      const joined = mapped.filter(Boolean);
      if (joined.indexOf("consumerName") !== -1 || joined.indexOf("supplierName") !== -1 || joined.indexOf("assetName") !== -1 || (joined.indexOf("cabinet") !== -1 && (joined.indexOf("breaker1") !== -1 || joined.indexOf("breaker2") !== -1 || joined.indexOf("breaker3") !== -1))) {
        return { index: i, mapped: mapped };
      }
    }
    return null;
  }

  function sheetKind(mapped) {
    if (mapped.indexOf("consumerName") !== -1 && mapped.indexOf("supplierName") !== -1) return "links";
    if (mapped.indexOf("cabinet") !== -1 && (mapped.indexOf("breaker1") !== -1 || mapped.indexOf("breaker2") !== -1 || mapped.indexOf("breaker3") !== -1)) return "cabinets";
    if (mapped.indexOf("assetName") !== -1) return "assets";
    return "unknown";
  }

  const FIELD_VOLTS = [120, 208];

  function computeBreakers(volts, ampList, powerFactor) {
    const pf = powerFactor === undefined || powerFactor === null ? 1 : powerFactor;
    const breakers = [];
    for (let i = 0; i < ampList.length; i++) {
      const amps = Number(ampList[i]);
      if (!(amps > 0)) continue;
      const found = computeFinding({ supply: "single", volts: volts, amps: amps, powerFactor: pf, breakerCount: 1 });
      breakers.push({
        n: i + 1,
        amps: amps,
        watts: found.watts,
        kilowatts: found.kilowatts,
        kva: found.kva,
        continuousWatts: found.continuousWatts === undefined ? roundTo(found.watts * CONTINUOUS, 2) : found.continuousWatts,
        continuousKilowatts: found.continuousKilowatts,
        continuousKva: found.continuousKva,
        formulaKw: found.formulaKw,
      });
    }
    let watts = 0;
    let kilowatts = 0;
    let kva = 0;
    let continuousWatts = 0;
    let continuousKilowatts = 0;
    let continuousKva = 0;
    breakers.forEach(function (breaker) {
      watts += breaker.watts;
      kilowatts += breaker.kilowatts;
      kva += breaker.kva;
      continuousWatts += breaker.continuousWatts;
      continuousKilowatts += breaker.continuousKilowatts;
      continuousKva += breaker.continuousKva;
    });
    const totalKw = roundTo(kilowatts, 3);
    const limitKw = roundTo(continuousKilowatts, 3);
    return {
      volts: volts,
      breakers: breakers,
      watts: roundTo(watts, 2),
      kilowatts: totalKw,
      kva: roundTo(kva, 3),
      kilowattHours: totalKw,
      continuousWatts: roundTo(continuousWatts, 2),
      continuousKilowatts: limitKw,
      continuousKva: roundTo(continuousKva, 3),
      limitKilowattHours: limitKw,
      overKilowatts: roundTo(totalKw - limitKw, 3),
    };
  }

  const DIGIT_FONT = {
    "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["01110", "10001", "00001", "00110", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  };

  function paintGlyph(ch, scale) {
    const rows = DIGIT_FONT[ch];
    const w = 5 * scale;
    const h = 7 * scale;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (rows[y].charAt(x) !== "1") continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) data[(y * scale + dy) * w + (x * scale + dx)] = 1;
        }
      }
    }
    return { ch: ch, w: w, h: h, data: data };
  }

  function builtinDigitTemplates() {
    return "0123456789".split("").map(function (ch) { return paintGlyph(ch, 4); });
  }

  function ampSampleImage(labels) {
    const scale = 4;
    const cellW = 5 * scale;
    const cellH = 7 * scale;
    const digitGap = scale;
    const wordGap = scale * 6;
    const pad = 16;
    const words = labels.map(function (label) { return String(label); });
    let width = pad * 2;
    words.forEach(function (word, index) {
      width += word.length * cellW + Math.max(0, word.length - 1) * digitGap;
      if (index < words.length - 1) width += wordGap;
    });
    const height = pad * 2 + cellH;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = 255;
    }
    let cursor = pad;
    words.forEach(function (word, wordIndex) {
      for (let d = 0; d < word.length; d++) {
        const glyph = paintGlyph(word.charAt(d), scale);
        for (let y = 0; y < glyph.h; y++) {
          for (let x = 0; x < glyph.w; x++) {
            if (!glyph.data[y * glyph.w + x]) continue;
            const pixel = ((pad + y) * width + (cursor + x)) * 4;
            data[pixel] = 0;
            data[pixel + 1] = 0;
            data[pixel + 2] = 0;
          }
        }
        cursor += cellW;
        if (d < word.length - 1) cursor += digitGap;
      }
      if (wordIndex < words.length - 1) cursor += wordGap;
    });
    return { width: width, height: height, data: data };
  }

  function ampsFromText(text) {
    const found = [];
    const source = String(text || "");
    const pattern = /(?:^|[^\d])(\d{1,3})(?:\s*[aA])?(?=$|[^\d])/g;
    let match = pattern.exec(source);
    while (match) {
      const value = Number(match[1]);
      if (value >= 5 && value <= 100 && value !== 120 && value !== 208) found.push(value);
      if (found.length === 3) break;
      match = pattern.exec(source);
    }
    return found;
  }

  function readAmps(image, templates) {
    const empty = { amps: [], confidence: 0 };
    if (!image || !(image.width > 0) || !(image.height > 0) || !image.data) return empty;
    const width = image.width;
    const height = image.height;
    const pixels = image.data;
    const channels = pixels.length >= width * height * 4 ? 4 : 1;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      if (channels === 4) {
        gray[i] = Math.round(pixels[i * 4] * 0.3 + pixels[i * 4 + 1] * 0.59 + pixels[i * 4 + 2] * 0.11);
      } else gray[i] = pixels[i];
    }
    const threshold = otsuThreshold(gray);
    let dark = 0;
    for (let i = 0; i < gray.length; i++) if (gray[i] < threshold) dark++;
    const inkIsDark = dark <= gray.length * 0.55;
    const ink = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) ink[i] = (inkIsDark ? gray[i] < threshold : gray[i] > threshold) ? 1 : 0;
    const boxes = inkComponents(ink, width, height);
    const set = normalizedTemplates(templates && templates.length ? templates : builtinDigitTemplates());
    const glyphs = [];
    boxes.forEach(function (box) {
      if (box.w < 2 || box.h < 8) return;
      if (box.h / box.w > 6 || box.w / box.h > 3) return;
      const sample = resizeBinary(cropBinary(ink, width, box), box.w, box.h, 20, 28);
      let bestChar = "";
      let bestScore = 0;
      let second = 0;
      const byChar = {};
      set.forEach(function (template) {
        const score = glyphScore(sample, template.data);
        if (byChar[template.ch] === undefined || score > byChar[template.ch]) byChar[template.ch] = score;
      });
      Object.keys(byChar).forEach(function (ch) {
        const score = byChar[ch];
        if (score > bestScore) {
          second = bestScore;
          bestScore = score;
          bestChar = ch;
        } else if (score > second) second = score;
      });
      if (!bestChar || bestScore < 0.5 || bestScore - second < 0.04) return;
      glyphs.push({ x: box.x, y: box.y, w: box.w, h: box.h, ch: bestChar, score: bestScore });
    });
    const numbers = groupAmpNumbers(glyphs);
    const amps = [];
    let scoreSum = 0;
    let scoreCount = 0;
    numbers.forEach(function (number) {
      if (amps.length >= 3) return;
      const value = Number(number.digits.map(function (digit) { return digit.ch; }).join(""));
      if (!(value >= 5 && value <= 100) || value === 120 || value === 208) return;
      amps.push(value);
      number.digits.forEach(function (digit) {
        scoreSum += digit.score;
        scoreCount++;
      });
    });
    return { amps: amps, confidence: scoreCount ? roundTo(scoreSum / scoreCount, 3) : 0 };
  }

  function normalizedTemplates(templates) {
    return templates.map(function (template) {
      const box = contentBox(template.data, template.w, template.h);
      if (!box) return { ch: template.ch, w: 20, h: 28, data: new Uint8Array(20 * 28) };
      const cropped = cropBinary(template.data, template.w, box);
      return { ch: template.ch, w: 20, h: 28, data: resizeBinary(cropped, box.w, box.h, 20, 28) };
    });
  }

  function contentBox(data, w, h) {
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let any = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!data[y * w + x]) continue;
        any = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (!any) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0;
    let weightB = 0;
    let max = 0;
    let threshold = 127;
    for (let t = 0; t < 256; t++) {
      weightB += hist[t];
      if (!weightB) continue;
      const weightF = gray.length - weightB;
      if (!weightF) break;
      sumB += t * hist[t];
      const meanB = sumB / weightB;
      const meanF = (sum - sumB) / weightF;
      const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);
      if (between >= max) {
        max = between;
        threshold = t;
      }
    }
    return threshold;
  }

  function inkComponents(ink, width, height) {
    const seen = new Uint8Array(ink.length);
    const boxes = [];
    const stack = [];
    for (let start = 0; start < ink.length; start++) {
      if (!ink[start] || seen[start]) continue;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      let count = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const index = stack.pop();
        const x = index % width;
        const y = (index - x) / width;
        count++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        const x0 = x > 0 ? x - 1 : x;
        const x1 = x + 1 < width ? x + 1 : x;
        const y0 = y > 0 ? y - 1 : y;
        const y1 = y + 1 < height ? y + 1 : y;
        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) {
            const next = ny * width + nx;
            if (ink[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
          }
        }
      }
      if (count >= 12 && count < ink.length * 0.25) {
        boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
      }
    }
    return boxes;
  }

  function cropBinary(ink, width, box) {
    const data = new Uint8Array(box.w * box.h);
    for (let y = 0; y < box.h; y++) {
      for (let x = 0; x < box.w; x++) data[y * box.w + x] = ink[(box.y + y) * width + box.x + x];
    }
    return data;
  }

  function resizeBinary(src, sw, sh, dw, dh) {
    const out = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * sh / dh);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / dh));
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * sw / dw);
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / dw));
        let hits = 0;
        let total = 0;
        for (let yy = y0; yy < y1 && yy < sh; yy++) {
          for (let xx = x0; xx < x1 && xx < sw; xx++) {
            total++;
            hits += src[yy * sw + xx];
          }
        }
        out[y * dw + x] = total && hits / total >= 0.35 ? 1 : 0;
      }
    }
    return out;
  }

  function glyphScore(sample, template) {
    let both = 0;
    let either = 0;
    const length = Math.min(sample.length, template.length);
    for (let i = 0; i < length; i++) {
      if (sample[i] || template[i]) either++;
      if (sample[i] && template[i]) both++;
    }
    return either ? both / either : 0;
  }

  function groupAmpNumbers(glyphs) {
    const lines = [];
    glyphs.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (glyph) {
      let line = null;
      for (let i = 0; i < lines.length; i++) {
        const overlap = Math.min(lines[i].bottom, glyph.y + glyph.h) - Math.max(lines[i].top, glyph.y);
        if (overlap > 0.4 * Math.min(lines[i].bottom - lines[i].top, glyph.h)) line = lines[i];
      }
      if (!line) lines.push({ top: glyph.y, bottom: glyph.y + glyph.h, glyphs: [glyph] });
      else {
        line.top = Math.min(line.top, glyph.y);
        line.bottom = Math.max(line.bottom, glyph.y + glyph.h);
        line.glyphs.push(glyph);
      }
    });
    const numbers = [];
    lines.forEach(function (line) {
      const ordered = line.glyphs.slice().sort(function (a, b) { return a.x - b.x; });
      let current = null;
      ordered.forEach(function (glyph) {
        if (!current) {
          current = { digits: [glyph], right: glyph.x + glyph.w };
          return;
        }
        const previous = current.digits[current.digits.length - 1];
        const gap = glyph.x - current.right;
        const limit = Math.max(previous.w, glyph.w) * 0.7;
        if (gap <= limit && current.digits.length < 3) {
          current.digits.push(glyph);
          current.right = glyph.x + glyph.w;
        } else {
          numbers.push(current);
          current = { digits: [glyph], right: glyph.x + glyph.w };
        }
      });
      if (current) numbers.push(current);
    });
    return numbers;
  }

  function thresholdFromKilowatts(kilowatts) {
    const nameplate = roundTo(Number(kilowatts) || 0, 3);
    const limit = roundTo(nameplate * CONTINUOUS, 3);
    return {
      kilowatts: nameplate,
      kilowattHours: nameplate,
      limitKilowatts: limit,
      limitKilowattHours: limit,
      overKilowatts: roundTo(nameplate - limit, 3),
    };
  }

  function rowObject(mapped, cells) {
    const record = {};
    for (let i = 0; i < mapped.length; i++) {
      if (!mapped[i]) continue;
      record[mapped[i]] = cells[i] === undefined ? "" : String(cells[i]).trim();
    }
    return record;
  }

  function parseNumber(value) {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const n = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function indexAssets(assets) {
    const map = new Map();
    assets.forEach(function (asset) {
      map.set(keyOf(asset.assetName), asset);
    });
    return map;
  }

  function upsertAsset(bucket, spec) {
    const name = cleanName(spec.assetName);
    if (!name) return { asset: null, created: false, updated: false };
    const existing = bucket.get(keyOf(name));
    const kind = spec.assetType ? kindFromType(spec.assetType) : (spec.defaultKind || "");
    if (!existing) {
      const asset = {
        id: makeId(),
        assetName: name,
        assetNumber: cleanName(spec.assetNumber),
        assetType: cleanName(spec.assetType),
        materialName: cleanName(spec.materialName),
        operationalStatus: cleanName(spec.operationalStatus),
        room: cleanName(spec.room),
        cabinet: cleanName(spec.cabinet),
        site: cleanName(spec.site),
        kind: kind || "other",
        notes: "",
        updatedAt: new Date().toISOString(),
      };
      bucket.set(keyOf(name), asset);
      return { asset: asset, created: true, updated: false };
    }
    let updated = false;
    function fill(field, value) {
      const next = cleanName(value);
      if (next && existing[field] !== next) {
        existing[field] = next;
        updated = true;
      }
    }
    fill("assetNumber", spec.assetNumber);
    fill("assetType", spec.assetType);
    fill("materialName", spec.materialName);
    fill("operationalStatus", spec.operationalStatus);
    fill("room", spec.room);
    fill("cabinet", spec.cabinet);
    fill("site", spec.site);
    if (spec.assetType) {
      const nextKind = kindFromType(spec.assetType);
      if (existing.kind !== nextKind) {
        existing.kind = nextKind;
        updated = true;
      }
    } else if (spec.defaultKind && (existing.kind === "other" || !existing.kind)) {
      existing.kind = spec.defaultKind;
      updated = true;
    }
    if (updated) existing.updatedAt = new Date().toISOString();
    return { asset: existing, created: false, updated: updated };
  }

  function defaultKindFor(mapped) {
    const headers = mapped.join(" ");
    if (headers.indexOf("power strip") !== -1) return "rpdu";
    return "";
  }

  function applyImport(state, text, place) {
    const source = String(text || "").trim();
    const filedSite = place && cleanName(place.site);
    const filedRoom = place && cleanName(place.room);
    if (!source) {
      return { state: state, summary: { ok: false, message: "Paste a sheet first." } };
    }
    const delimiter = detectDelimiter(source);
    const table = parseDelimited(source, delimiter);
    const header = findHeader(table);
    if (!header) {
      return {
        state: state,
        summary: {
          ok: false,
          message: "No header row found. Include the row that says Consumer Asset Name, Supplier Asset Name, or Asset Name.",
        },
      };
    }
    const kind = sheetKind(header.mapped);
    if (kind === "unknown") {
      return {
        state: state,
        summary: { ok: false, message: "Those columns are not a cabinet sheet or a Power BDM sheet yet." },
      };
    }
    if (kind === "cabinets" && (!filedSite || !filedRoom)) {
      return {
        state: state,
        summary: { ok: false, message: "Enter the site ID and the room before importing cabinets." },
      };
    }
    const next = {
      assets: state.assets.map(function (asset) { return Object.assign({}, asset); }),
      links: state.links.map(function (link) { return Object.assign({}, link); }),
      readings: state.readings.slice(),
      rooms: state.rooms.map(function (room) { return Object.assign({}, room); }),
    };
    const bucket = indexAssets(next.assets);
    const linkKeys = new Set(next.links.map(linkKey));
    let created = 0;
    let updated = 0;
    let linksAdded = 0;
    let duplicates = 0;
    let incomplete = 0;
    const used = header.mapped.filter(function (name, index, all) {
      return name && all.indexOf(name) === index;
    });
    const fallbackKind = defaultKindFor(header.mapped);

    let cabinetsTouched = [];
    function rememberCabinet(name) {
      const cabinet = cleanName(name);
      if (cabinet && cabinetsTouched.indexOf(cabinet) === -1) cabinetsTouched.push(cabinet);
    }
    function placedRoom(record) {
      return cleanName(record.room) || filedRoom || "";
    }
    function placedSite(record) {
      return cleanName(record.site) || filedSite || "";
    }

    for (let r = header.index + 1; r < table.length; r++) {
      const record = rowObject(header.mapped, table[r]);
      if (kind === "cabinets") {
        const cabinet = cleanName(record.cabinet);
        if (!cabinet) {
          incomplete++;
          continue;
        }
        const volts = record.volts === "120" || Number(record.volts) === 120 ? 120 : 208;
        const result = computeBreakers(volts, [record.breaker1, record.breaker2, record.breaker3], 1);
        if (!result.breakers.length) {
          incomplete++;
          continue;
        }
        upsertAsset(bucket, {
          assetName: cabinet,
          assetType: "Cabinet",
          room: filedRoom,
          site: filedSite,
          cabinet: cabinet,
          defaultKind: "other",
        });
        next.readings.push({
          id: makeId(),
          recordedAt: new Date().toISOString(),
          site: filedSite,
          room: filedRoom,
          cabinet: cabinet,
          volts: volts,
          breakers: result.breakers,
          watts: result.watts,
          kilowatts: result.kilowatts,
          kva: result.kva,
          rpduName: cabinet,
        });
        rememberCabinet(cabinet);
        created++;
        continue;
      }
      if (kind === "assets") {
        const result = upsertAsset(bucket, {
          assetName: record.assetName,
          assetNumber: record.assetNumber,
          assetType: record.assetType,
          materialName: record.materialName,
          operationalStatus: record.operationalStatus,
          room: placedRoom(record),
          cabinet: record.cabinet,
          site: placedSite(record),
          defaultKind: fallbackKind,
        });
        if (result.created) created++;
        else if (result.updated) updated++;
        continue;
      }
      const consumerName = cleanName(record.consumerName);
      const supplierName = cleanName(record.supplierName);
      if (!consumerName || !supplierName) {
        incomplete++;
        continue;
      }
      const consumer = upsertAsset(bucket, {
        assetName: consumerName,
        assetNumber: record.consumerNumber,
        assetType: record.consumerType,
        materialName: record.consumerMaterial,
        operationalStatus: record.consumerStatus,
        room: placedRoom(record),
        cabinet: record.cabinet,
        site: placedSite(record),
      });
      const supplier = upsertAsset(bucket, {
        assetName: supplierName,
        assetNumber: record.supplierNumber,
        assetType: record.supplierType,
        materialName: record.supplierMaterial,
        operationalStatus: record.supplierStatus,
        site: filedSite || "",
      });
      if (consumer.created) created++;
      else if (consumer.updated) updated++;
      if (supplier.created) created++;
      else if (supplier.updated) updated++;
      rememberCabinet(record.cabinet);
      const link = {
        id: makeId(),
        consumerName: consumer.asset.assetName,
        consumerType: consumer.asset.assetType,
        supplierName: supplier.asset.assetName,
        supplierType: supplier.asset.assetType,
        plugPosition: cleanName(record.plugPosition),
        supplierOutlet: cleanName(record.supplierOutlet),
        connectionName: cleanName(record.connectionName),
        breaker: cleanName(record.breaker),
        panel: cleanName(record.panel),
        maxKva: parseNumber(record.maxKva),
        maxKw: parseNumber(record.maxKw),
      };
      const signature = linkKey(link);
      if (linkKeys.has(signature)) {
        duplicates++;
        continue;
      }
      linkKeys.add(signature);
      next.links.push(link);
      linksAdded++;
    }
    next.assets = Array.from(bucket.values()).sort(function (a, b) {
      return naturalCompare(a.assetName, b.assetName);
    });
    const summary = {
      ok: true,
      sheet: kind,
      dataRows: table.length - header.index - 1,
      created: created,
      updated: updated,
      linksAdded: linksAdded,
      duplicates: duplicates,
      incomplete: incomplete,
      columns: used,
      site: filedSite || "",
      room: filedRoom || "",
      cabinets: cabinetsTouched.sort(naturalCompare),
      message: kind === "cabinets"
        ? "Saved " + cabinetsTouched.length + " cabinets in " + filedSite + " / " + filedRoom + "."
        : kind === "links"
        ? "Added " + linksAdded + " power connections" + (filedSite ? " under " + filedSite + " / " + filedRoom + "." : ".")
        : "Updated the asset list" + (filedSite ? " under " + filedSite + " / " + filedRoom + "." : "."),
    };
    return { state: next, summary: summary };
  }

  function linkKey(link) {
    return [
      keyOf(link.consumerName),
      keyOf(link.supplierName),
      keyOf(link.supplierOutlet),
      keyOf(link.plugPosition),
      keyOf(link.breaker),
      keyOf(link.panel),
    ].join("|");
  }

  function assetByName(state, name) {
    const wanted = keyOf(name);
    if (!wanted) return null;
    if (state.assetsByKey) return state.assetsByKey.get(wanted) || null;
    for (let i = 0; i < state.assets.length; i++) {
      if (keyOf(state.assets[i].assetName) === wanted) return state.assets[i];
    }
    return null;
  }

  function makeIndex(state) {
    const bySupplier = new Map();
    const byConsumer = new Map();
    for (let i = 0; i < state.links.length; i++) {
      const link = state.links[i];
      const supplier = keyOf(link.supplierName);
      const consumer = keyOf(link.consumerName);
      if (!bySupplier.has(supplier)) bySupplier.set(supplier, []);
      bySupplier.get(supplier).push(link);
      if (!byConsumer.has(consumer)) byConsumer.set(consumer, []);
      byConsumer.get(consumer).push(link);
    }
    return {
      assets: state.assets,
      assetsByKey: indexAssets(state.assets),
      links: state.links,
      readings: state.readings,
      rooms: state.rooms,
      bySupplier: bySupplier,
      byConsumer: byConsumer,
    };
  }

  function fromSupplier(index, name) {
    return index.bySupplier.get(keyOf(name)) || [];
  }

  function toConsumer(index, name) {
    return index.byConsumer.get(keyOf(name)) || [];
  }

  function downstream(index, name) {
    const start = assetByName(index, name);
    const startName = start ? start.assetName : cleanName(name);
    const seen = new Set([keyOf(startName)]);
    const queue = [{ name: startName, depth: 0 }];
    const rows = [];
    while (queue.length) {
      const current = queue.shift();
      if (current.depth >= 6) continue;
      const links = fromSupplier(index, current.name);
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const id = keyOf(link.consumerName);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const asset = assetByName(index, link.consumerName);
        const row = {
          name: asset ? asset.assetName : link.consumerName,
          assetType: asset ? asset.assetType : link.consumerType,
          materialName: asset ? asset.materialName : "",
          assetNumber: asset ? asset.assetNumber : "",
          operationalStatus: asset ? asset.operationalStatus : "",
          cabinet: asset ? asset.cabinet : "",
          room: asset ? asset.room : "",
          kind: asset ? asset.kind : kindFromType(link.consumerType),
          via: current.name,
          outlet: link.supplierOutlet,
          plugPosition: link.plugPosition,
          breaker: link.breaker,
          panel: link.panel,
          maxKva: link.maxKva,
          depth: current.depth + 1,
        };
        rows.push(row);
        queue.push({ name: row.name, depth: row.depth });
      }
    }
    return rows;
  }

  function otherFeeds(index, consumerName, currentSupplier) {
    return toConsumer(index, consumerName).filter(function (link) {
      return keyOf(link.supplierName) !== keyOf(currentSupplier);
    }).map(function (link) {
      return { supplierName: link.supplierName, outlet: link.supplierOutlet, plugPosition: link.plugPosition };
    });
  }

  function impact(state, name) {
    const index = state.bySupplier ? state : makeIndex(state);
    const asset = assetByName(index, name);
    const displayName = asset ? asset.assetName : cleanName(name);
    if (!displayName) return null;
    const down = downstream(index, displayName);
    const lostNames = new Set([keyOf(displayName)]);
    down.forEach(function (row) { lostNames.add(keyOf(row.name)); });
    const withFeeds = down.map(function (row) {
      const feeds = otherFeeds(index, row.name, row.via);
      const surviving = feeds.filter(function (feed) { return !lostNames.has(keyOf(feed.supplierName)); });
      const samePath = feeds.filter(function (feed) { return lostNames.has(keyOf(feed.supplierName)); });
      return Object.assign({}, row, {
        otherFeeds: surviving,
        samePathFeeds: samePath,
        singleCord: surviving.length === 0 && (row.kind === "device" || row.kind === "other"),
      });
    });
    const upstream = [];
    const seen = new Set([keyOf(displayName)]);
    let frontier = [displayName];
    let depth = 0;
    while (frontier.length && depth < 6) {
      const next = [];
      frontier.forEach(function (current) {
        toConsumer(index, current).forEach(function (link) {
          const id = keyOf(link.supplierName);
          if (!id || seen.has(id)) return;
          seen.add(id);
          const supplier = assetByName(index, link.supplierName);
          upstream.push({
            name: supplier ? supplier.assetName : link.supplierName,
            kind: supplier ? supplier.kind : kindFromType(link.supplierType),
            assetType: supplier ? supplier.assetType : link.supplierType,
            outlet: link.supplierOutlet,
            plugPosition: link.plugPosition,
            depth: depth + 1,
            feeds: current,
          });
          next.push(supplier ? supplier.assetName : link.supplierName);
        });
      });
      frontier = next;
      depth++;
    }
    const devices = withFeeds.filter(function (row) { return row.kind === "device" || row.kind === "other"; });
    devices.sort(function (a, b) {
      if (a.singleCord !== b.singleCord) return a.singleCord ? -1 : 1;
      return naturalCompare(a.name, b.name);
    });
    const equipment = withFeeds.filter(function (row) { return row.kind === "rpdu" || row.kind === "pdu" || row.kind === "power"; });
    return {
      name: displayName,
      asset: asset,
      upstream: upstream,
      devices: devices,
      equipment: equipment,
      singleCord: devices.filter(function (row) { return row.singleCord; }).length,
    };
  }

  function roomPdusFor(index, assetName) {
    const found = [];
    const seen = new Set([keyOf(assetName)]);
    let frontier = [assetName];
    let depth = 0;
    while (frontier.length && depth < 6) {
      const next = [];
      frontier.forEach(function (current) {
        toConsumer(index, current).forEach(function (link) {
          const id = keyOf(link.supplierName);
          if (!id || seen.has(id)) return;
          seen.add(id);
          const asset = assetByName(index, link.supplierName);
          const name = asset ? asset.assetName : link.supplierName;
          const kind = asset ? asset.kind : kindFromType(link.supplierType);
          if (kind === "pdu") found.push(name);
          next.push(name);
        });
      });
      frontier = next;
      depth++;
    }
    return found.sort(naturalCompare);
  }

  function inferredPlace(index, assetName, field) {
    const values = [];
    fromSupplier(index, assetName).forEach(function (link) {
      const consumer = assetByName(index, link.consumerName);
      if (consumer && consumer[field]) values.push(consumer[field]);
    });
    const unique = values.filter(function (value, index) { return values.indexOf(value) === index; });
    return unique.length === 1 ? unique[0] : "";
  }

  function latestReading(state, assetName) {
    const wanted = keyOf(assetName);
    const matches = state.readings.filter(function (reading) { return keyOf(reading.rpduName) === wanted; });
    matches.sort(function (a, b) { return a.recordedAt < b.recordedAt ? 1 : -1; });
    return matches[0] || null;
  }

  function choicesFor(state, field, site, room) {
    const siteKey = keyOf(site);
    const roomKey = keyOf(room);
    const values = [];
    function add(value) {
      const name = cleanName(value);
      if (name && values.indexOf(name) === -1) values.push(name);
    }
    (state.readings || []).forEach(function (reading) {
      if (siteKey && keyOf(reading.site) !== siteKey) return;
      if (field === "cabinet" && roomKey && keyOf(reading.room) !== roomKey) return;
      add(field === "room" ? reading.room : field === "cabinet" ? reading.cabinet : reading[field]);
    });
    (state.assets || []).forEach(function (asset) {
      if (siteKey && keyOf(asset.site) !== siteKey) return;
      if (field === "cabinet" && roomKey && keyOf(asset.room) !== roomKey) return;
      if (field === "room") add(asset.room);
      if (field === "cabinet") add(asset.cabinet);
    });
    values.sort(naturalCompare);
    return values;
  }

  function readingForCabinet(state, place) {
    const site = keyOf(place && place.site);
    const room = keyOf(place && place.room);
    const cabinet = keyOf(place && place.cabinet);
    const rpdu = keyOf(place && place.rpduName);
    if (!site || !room || !cabinet) return null;
    const matches = (state.readings || []).filter(function (reading) {
      if (keyOf(reading.site) !== site || keyOf(reading.room) !== room || keyOf(reading.cabinet) !== cabinet) return false;
      const named = keyOf(reading.rpduName);
      if (rpdu && named && named !== rpdu) return false;
      return true;
    });
    matches.sort(function (a, b) { return String(a.recordedAt) < String(b.recordedAt) ? 1 : -1; });
    return matches[0] || null;
  }

  function decorateRpdu(state, asset) {
    const index = state.bySupplier ? state : makeIndex(state);
    const cabinetInferred = asset.cabinet ? "" : inferredPlace(index, asset.assetName, "cabinet");
    const roomInferred = asset.room ? "" : inferredPlace(index, asset.assetName, "room");
    const direct = fromSupplier(index, asset.assetName);
    let connectedKva = 0;
    let kvaKnown = false;
    let singleCord = 0;
    direct.forEach(function (link) {
      const consumer = assetByName(index, link.consumerName);
      const kind = consumer ? consumer.kind : kindFromType(link.consumerType);
      if (kind === "device" || kind === "other") {
        if (otherFeeds(index, link.consumerName, asset.assetName).length === 0) singleCord++;
        if (link.maxKva !== null) {
          connectedKva += link.maxKva;
          kvaKnown = true;
        }
      }
    });
    const deviceNames = direct.map(function (link) { return link.consumerName; }).join(" ");
    const roomPdus = roomPdusFor(index, asset.assetName);
    const cabinet = asset.cabinet || cabinetInferred;
    const room = asset.room || roomInferred;
    return {
      asset: asset,
      cabinet: cabinet,
      cabinetInferred: Boolean(cabinetInferred),
      room: room,
      roomInferred: Boolean(roomInferred),
      roomPdus: roomPdus,
      deviceCount: direct.filter(function (link) {
        const consumer = assetByName(index, link.consumerName);
        const kind = consumer ? consumer.kind : kindFromType(link.consumerType);
        return kind === "device" || kind === "other";
      }).length,
      singleCord: singleCord,
      connectedKva: kvaKnown ? roundTo(connectedKva, 3) : null,
      latest: latestReading(state, asset.assetName),
      haystack: [
        asset.assetName,
        asset.assetNumber,
        asset.materialName,
        cabinet,
        room,
        roomPdus.join(" "),
        deviceNames,
      ].join(" ").toLowerCase(),
    };
  }

  function naturalCompare(a, b) {
    return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
  }

  function libraryView(state, mode, query) {
    const index = makeIndex(state);
    const q = String(query || "").trim().toLowerCase();
    let rows = state.assets.filter(function (asset) { return asset.kind === "rpdu"; }).map(function (asset) {
      return decorateRpdu(index, asset);
    });
    if (q) rows = rows.filter(function (row) { return row.haystack.indexOf(q) !== -1; });
    rows.sort(function (a, b) { return naturalCompare(a.asset.assetName, b.asset.assetName); });
    if (mode === "name") return [{ title: "rPDUs", key: "all", items: rows }];
    if (mode === "pdu") {
      const groups = new Map();
      rows.forEach(function (row) {
        const keys = row.roomPdus.length ? row.roomPdus : ["No room PDU yet"];
        keys.forEach(function (title) {
          if (!groups.has(title)) groups.set(title, []);
          groups.get(title).push(row);
        });
      });
      return Array.from(groups.entries()).sort(function (a, b) {
        return naturalCompare(a[0], b[0]);
      }).map(function (entry) {
        return { title: entry[0], key: "pdu:" + entry[0], items: entry[1] };
      });
    }
    const field = mode === "room" ? "room" : "cabinet";
    const empty = mode === "room" ? "No room yet" : "No cabinet yet";
    const groups = new Map();
    rows.forEach(function (row) {
      const title = row[field] || empty;
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(row);
    });
    return Array.from(groups.entries()).sort(function (a, b) {
      if (a[0] === empty) return 1;
      if (b[0] === empty) return -1;
      return naturalCompare(a[0], b[0]);
    }).map(function (entry) {
      return { title: entry[0], key: field + ":" + entry[0], items: entry[1] };
    });
  }

  function placeLibrary(state, query) {
    const q = String(query || "").trim().toLowerCase();
    const sites = new Map();
    function ensure(site, room) {
      const siteName = cleanName(site) || "No site yet";
      const roomName = cleanName(room) || "No room yet";
      if (!sites.has(siteName)) sites.set(siteName, new Map());
      const rooms = sites.get(siteName);
      if (!rooms.has(roomName)) rooms.set(roomName, new Map());
      return rooms.get(roomName);
    }
    state.readings.forEach(function (reading) {
      const label = cleanName(reading.rpduName) || cleanName(reading.cabinet);
      if (!label) return;
      const cabinets = ensure(reading.site, reading.room);
      const key = reading.id || keyOf(label) + "|" + String(reading.recordedAt || "");
      cabinets.set(key, Object.assign({}, reading, { label: label }));
    });
    state.assets.forEach(function (asset) {
      const covered = state.readings.some(function (reading) {
        return keyOf(reading.rpduName) === keyOf(asset.assetName) || (asset.cabinet && keyOf(reading.cabinet) === keyOf(asset.cabinet) && keyOf(reading.site) === keyOf(asset.site) && keyOf(reading.room) === keyOf(asset.room));
      });
      if (covered || !asset.cabinet) return;
      const cabinets = ensure(asset.site, asset.room);
      if (!cabinets.has(keyOf(asset.cabinet))) {
        cabinets.set(keyOf(asset.cabinet), {
          cabinet: asset.cabinet,
          label: asset.cabinet,
          site: asset.site || "",
          room: asset.room || "",
          rpduName: asset.kind === "rpdu" ? asset.assetName : "",
          kilowatts: null,
          kva: null,
          volts: null,
          breakers: [],
        });
      }
    });
    const tree = [];
    sites.forEach(function (rooms, site) {
      const roomList = [];
      rooms.forEach(function (cabinets, room) {
        let items = Array.from(cabinets.values());
        if (q) {
          items = items.filter(function (item) {
            return (site + " " + room + " " + (item.label || item.cabinet) + " " + (item.rpduName || "") + " " + (item.pdu || "") + " " + (item.circuits || "")).toLowerCase().indexOf(q) !== -1;
          });
        }
        items.sort(function (a, b) { return naturalCompare(a.label || a.cabinet, b.label || b.cabinet); });
        if (items.length || !q) roomList.push({ room: room, cabinets: items });
      });
      roomList.sort(function (a, b) { return naturalCompare(a.room, b.room); });
      const visible = q ? roomList.filter(function (room) { return room.cabinets.length; }) : roomList;
      if (visible.length) tree.push({ site: site, rooms: visible });
    });
    tree.sort(function (a, b) {
      if (a.site === "No site yet") return 1;
      if (b.site === "No site yet") return -1;
      return naturalCompare(a.site, b.site);
    });
    return tree;
  }

  function counts(state) {
    const tally = { rpdu: 0, pdu: 0, device: 0, power: 0, other: 0 };
    state.assets.forEach(function (asset) {
      if (tally[asset.kind] === undefined) tally.other++;
      else tally[asset.kind]++;
    });
    return {
      rpdu: tally.rpdu,
      pdu: tally.pdu,
      device: tally.device,
      power: tally.power,
      other: tally.other,
      links: state.links.length,
      readings: state.readings.length,
    };
  }

  function searchAssets(state, query, kinds) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    return state.assets.filter(function (asset) {
      if (kinds && kinds.indexOf(asset.kind) === -1) return false;
      return (asset.assetName + " " + asset.assetNumber + " " + asset.cabinet + " " + asset.room).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return naturalCompare(a.assetName, b.assetName); }).slice(0, 12);
  }

  function csvField(value) {
    if (value === null || value === undefined) return "";
    const text = String(value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function readingSignature(reading) {
    const amps = [0, 0, 0];
    if (reading.breakers && reading.breakers.length) {
      reading.breakers.forEach(function (breaker) {
        if (breaker.n >= 1 && breaker.n <= 3) amps[breaker.n - 1] = Number(breaker.amps) || 0;
      });
    } else {
      const list = reading.amps || [];
      for (let i = 0; i < 3 && i < list.length; i++) amps[i] = Number(list[i]) || 0;
    }
    return [
      keyOf(reading.site),
      keyOf(reading.room),
      keyOf(reading.cabinet),
      keyOf(reading.rpduName),
      keyOf(reading.pdu),
      keyOf(reading.circuits),
      String(reading.recordedAt || ""),
      amps.join(","),
    ].join("|");
  }

  function readingFile(readings) {
    const list = Array.isArray(readings) ? readings : ((readings && readings.readings) || []);
    return {
      app: "rPDU Power v1",
      kind: "readings",
      readings: list.map(function (reading) {
        const amps = [0, 0, 0];
        if (reading.breakers && reading.breakers.length) {
          reading.breakers.forEach(function (breaker) {
            if (breaker.n >= 1 && breaker.n <= 3) amps[breaker.n - 1] = Number(breaker.amps) || 0;
          });
        } else {
          const values = reading.amps || [];
          for (let i = 0; i < 3 && i < values.length; i++) amps[i] = Number(values[i]) || 0;
        }
        return {
          site: cleanName(reading.site),
          room: cleanName(reading.room),
          cabinet: cleanName(reading.cabinet),
          rpduName: cleanName(reading.rpduName),
          pdu: cleanName(reading.pdu),
          circuits: cleanName(reading.circuits),
          volts: Number(reading.volts) === 120 ? 120 : 208,
          amps: amps,
          notes: cleanName(reading.notes),
          recordedAt: reading.recordedAt || "",
          photoDataUrl: typeof reading.photoDataUrl === "string" ? reading.photoDataUrl : "",
        };
      }),
    };
  }

  function applyReadingFile(state, raw, place) {
    let parsed = raw;
    if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); }
      catch (error) {
        return { state: state, summary: { ok: false, message: "That file is not a reading file." } };
      }
    }
    const packet = parsed && parsed.kind === "readings" ? parsed : (parsed && parsed.readings ? parsed : null);
    const rows = packet ? packet.readings : (parsed && (parsed.cabinet || parsed.rpduName || parsed.amps) ? [parsed] : null);
    if (!rows) {
      return { state: state, summary: { ok: false, message: "That file is not a reading file." } };
    }
    const filedSite = place && cleanName(place.site);
    const filedRoom = place && cleanName(place.room);
    const next = {
      assets: state.assets.map(function (asset) { return Object.assign({}, asset); }),
      links: state.links.map(function (link) { return Object.assign({}, link); }),
      readings: state.readings.slice(),
      rooms: state.rooms.map(function (room) { return Object.assign({}, room); }),
    };
    const seen = new Set(next.readings.map(readingSignature));
    let added = 0;
    let duplicates = 0;
    let incomplete = 0;
    rows.forEach(function (row) {
      const site = cleanName(row.site) || filedSite || "";
      const room = cleanName(row.room) || filedRoom || "";
      const cabinet = cleanName(row.cabinet);
      const rpduName = cleanName(row.rpduName);
      if (!site || !room || (!cabinet && !rpduName)) {
        incomplete++;
        return;
      }
      const volts = Number(row.volts) === 120 ? 120 : 208;
      const slots = [0, 0, 0];
      if (row.breakers && row.breakers.length) {
        row.breakers.forEach(function (breaker) {
          if (breaker.n >= 1 && breaker.n <= 3) slots[breaker.n - 1] = Number(breaker.amps) || 0;
        });
      } else {
        const values = row.amps || [];
        for (let i = 0; i < 3 && i < values.length; i++) slots[i] = Number(values[i]) || 0;
      }
      const found = computeBreakers(volts, slots, 1);
      if (!found.breakers.length) {
        incomplete++;
        return;
      }
      const recordedAt = row.recordedAt || new Date().toISOString();
      const reading = {
        id: makeId(),
        recordedAt: recordedAt,
        site: site,
        room: room,
        cabinet: cabinet,
        rpduName: rpduName,
        pdu: cleanName(row.pdu),
        circuits: cleanName(row.circuits),
        volts: volts,
        breakers: found.breakers,
        watts: found.watts,
        kilowatts: found.kilowatts,
        kva: found.kva,
        notes: cleanName(row.notes),
        photoDataUrl: typeof row.photoDataUrl === "string" ? row.photoDataUrl : "",
      };
      const signature = readingSignature(reading);
      if (seen.has(signature)) {
        duplicates++;
        return;
      }
      seen.add(signature);
      next.readings.push(reading);
      added++;
      if (cabinet) ensurePlaceAsset(next, { assetName: cabinet, assetType: "Cabinet", room: room, site: site, cabinet: cabinet, kind: "other" });
      if (rpduName) ensurePlaceAsset(next, { assetName: rpduName, assetType: "Powerstrip", room: room, site: site, cabinet: cabinet, kind: "rpdu" });
    });
    if (!added && !duplicates) {
      return { state: state, summary: { ok: false, added: 0, duplicates: 0, incomplete: incomplete, message: "No cabinet readings were in that file." } };
    }
    return {
      state: next,
      summary: {
        ok: true,
        added: added,
        duplicates: duplicates,
        incomplete: incomplete,
        message: "Added " + added + " cabinet readings." + (duplicates ? " Already in the library: " + duplicates + "." : ""),
      },
    };
  }

  function ensurePlaceAsset(bucket, spec) {
    const found = bucket.assets.find(function (asset) {
      return keyOf(asset.assetName) === keyOf(spec.assetName) && keyOf(asset.site || "") === keyOf(spec.site || "") && keyOf(asset.room || "") === keyOf(spec.room || "");
    });
    if (found) return;
    bucket.assets.push({
      id: makeId(),
      assetName: spec.assetName,
      assetNumber: "",
      assetType: spec.assetType,
      materialName: "",
      operationalStatus: "",
      room: spec.room,
      cabinet: spec.cabinet || "",
      site: spec.site,
      kind: spec.kind,
      notes: "",
      updatedAt: new Date().toISOString(),
    });
  }

  function toCsv(rows) {
    return "\uFEFF" + rows.map(function (row) {
      return row.map(csvField).join(",");
    }).join("\r\n") + "\r\n";
  }

  function impactCsv(report) {
    const header = ["Single cord", "Device", "Type", "Material", "Asset number", "Status", "Cabinet", "Room", "Fed by", "Outlet", "Plug", "Breaker", "Panel", "Connection max kVA", "Other feeds"];
    const body = report.devices.map(function (row) {
      return [
        row.singleCord ? "Yes" : "",
        row.name,
        row.assetType,
        row.materialName,
        row.assetNumber,
        row.operationalStatus,
        row.cabinet,
        row.room,
        row.via,
        row.outlet,
        row.plugPosition,
        row.breaker,
        row.panel,
        row.maxKva === null || row.maxKva === undefined ? "" : row.maxKva,
        row.otherFeeds.map(function (feed) {
          return feed.supplierName + (feed.outlet ? " outlet " + feed.outlet : "");
        }).join("; "),
      ];
    });
    return toCsv([header].concat(body));
  }

  return {
    PHASE_FACTOR: PHASE_FACTOR,
    WATTS_PER_HP: WATTS_PER_HP,
    roundTo: roundTo,
    formatQty: formatQty,
    formatPlain: formatPlain,
    supplyLabel: supplyLabel,
    ruleText: ruleText,
    findingError: findingError,
    computeFinding: computeFinding,
    solveOhm: solveOhm,
    GUIDE_CHECKS: GUIDE_CHECKS,
    emptyState: emptyState,
    makeId: makeId,
    cleanName: cleanName,
    rpduNameFor: rpduNameFor,
    kindFromType: kindFromType,
    kindLabel: kindLabel,
    parseDelimited: parseDelimited,
    detectDelimiter: detectDelimiter,
    applyImport: applyImport,
    assetByName: assetByName,
    impact: impact,
    roomPdusFor: roomPdusFor,
    latestReading: latestReading,
    choicesFor: choicesFor,
    readingForCabinet: readingForCabinet,
    decorateRpdu: decorateRpdu,
    libraryView: libraryView,
    placeLibrary: placeLibrary,
    computeBreakers: computeBreakers,
    thresholdFromKilowatts: thresholdFromKilowatts,
    ampsFromText: ampsFromText,
    readAmps: readAmps,
    ampSampleImage: ampSampleImage,
    readingFile: readingFile,
    applyReadingFile: applyReadingFile,
    FIELD_VOLTS: FIELD_VOLTS,
    counts: counts,
    searchAssets: searchAssets,
    naturalCompare: naturalCompare,
    toCsv: toCsv,
    impactCsv: impactCsv,
    keyOf: keyOf,
  };
});
