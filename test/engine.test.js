const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const version = require("../src/lib/version.js");
const engine = require("../src/lib/engine.js");

test("version is the single source of truth", function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(version.SEMVER, "1.3.0");
  assert.equal(version.VERSION_LABEL, "v1");
  assert.equal(version.DISPLAY_NAME, "rPDU Power v1");
  assert.equal(pkg.version, version.SEMVER);
});

test("pocket-guide examples", function () {
  engine.GUIDE_CHECKS.forEach(function (check) {
    const found = engine.computeFinding(check.input);
    Object.entries(check.expect).forEach(function (entry) {
      assert.equal(found[entry[0]], entry[1], check.title + " " + entry[0]);
    });
  });
});

test("ohm wheel solves any two knowns", function () {
  const pairs = [
    [{ E: 120, I: 5 }, { P: 600, R: 24 }],
    [{ E: 120, P: 600 }, { I: 5, R: 24 }],
    [{ I: 5, R: 24 }, { E: 120, P: 600 }],
    [{ R: 24, P: 600 }, { E: 120, I: 5 }],
  ];
  pairs.forEach(function (pair) {
    const solved = engine.solveOhm(pair[0]);
    Object.entries(pair[1]).forEach(function (entry) {
      assert.equal(solved[entry[0]], entry[1]);
    });
  });
  assert.equal(engine.solveOhm({ E: 120 }), null);
});

test("three-phase watt formula uses 1.73", function () {
  const found = engine.computeFinding({ supply: "three", volts: 460, amps: 52, powerFactor: 0.8, breakerCount: 1 });
  assert.equal(found.formulaKw, "kW = (460 × 52 × 0.80 × 1.73) / 1000 = 33.105");
  assert.equal(found.formulaKva, "kVA = (460 × 52 × 1.73) / 1000 = 41.382");
});

test("quoted BDM names that contain commas stay intact", function () {
  const csv = [
    "Consumer Asset Type,Consumer Asset Name,Consumer Asset Number,Supplier Asset Type,Supplier Asset Name,Supplier Outlet,Connection Max kVA,Cabinet,Room",
    'Server,SERVER-01,1001,PDU,"PDU-NORTH-1, SEC2",4,2.5,A12,North Data Center',
  ].join("\n");
  const result = engine.applyImport(engine.emptyState(), csv);
  assert.equal(result.summary.ok, true);
  assert.equal(result.summary.linksAdded, 1);
  const pdu = engine.assetByName(result.state, "PDU-NORTH-1, SEC2");
  assert.equal(pdu.kind, "pdu");
  const server = engine.assetByName(result.state, "SERVER-01");
  assert.equal(server.cabinet, "A12");
  assert.equal(server.room, "North Data Center");
  assert.equal(result.state.links[0].maxKva, 2.5);
});

test("power chain impact marks single-cord devices", function () {
  const tsv = [
    ["Consumer Asset Type", "Consumer Asset Name", "Supplier Asset Type", "Supplier Asset Name", "Supplier Outlet", "Cabinet"].join("\t"),
    ["Server", "SERVER-01", "Powerstrip", "RPDU-A", "1", "A12"].join("\t"),
    ["Server", "SERVER-01", "Powerstrip", "RPDU-B", "1", "A12"].join("\t"),
    ["Server", "SERVER-02", "Powerstrip", "RPDU-A", "2", "A12"].join("\t"),
    ["Network", "SWITCH-01", "Powerstrip", "RPDU-A", "3", "A12"].join("\t"),
    ["Powerstrip", "RPDU-A", "PDU", "PDU-NORTH-1", "5", ""].join("\t"),
    ["Powerstrip", "RPDU-B", "PDU", "PDU-NORTH-1", "6", ""].join("\t"),
  ].join("\n");
  const imported = engine.applyImport(engine.emptyState(), tsv);
  assert.equal(imported.summary.linksAdded, 6);
  const strip = engine.assetByName(imported.state, "RPDU-A");
  assert.equal(strip.kind, "rpdu");
  const report = engine.impact(imported.state, "PDU-NORTH-1");
  const names = report.devices.map(function (row) { return row.name; }).sort();
  assert.deepEqual(names, ["SERVER-01", "SERVER-02", "SWITCH-01"]);
  assert.equal(report.equipment.length, 2);
  const onlyA = engine.impact(imported.state, "RPDU-A");
  const server2 = onlyA.devices.find(function (row) { return row.name === "SERVER-02"; });
  const server1 = onlyA.devices.find(function (row) { return row.name === "SERVER-01"; });
  assert.equal(server2.singleCord, true);
  assert.equal(server1.singleCord, false);
  assert.equal(server1.otherFeeds[0].supplierName, "RPDU-B");
  assert.equal(onlyA.singleCord, 2);
  const onPdu = report.devices.find(function (row) { return row.name === "SERVER-01"; });
  assert.equal(onPdu.singleCord, true);
  assert.equal(onPdu.samePathFeeds[0].supplierName, "RPDU-B");
  const view = engine.libraryView(imported.state, "cabinet", "");
  assert.equal(view[0].title, "A12");
  assert.equal(view[0].items.length, 2);
  const byPdu = engine.libraryView(imported.state, "pdu", "switch-01");
  assert.equal(byPdu.length, 1);
  assert.equal(byPdu[0].title, "PDU-NORTH-1");
  assert.equal(byPdu[0].items[0].asset.assetName, "RPDU-A");
});

test("three cabinet breakers at 208 V add up", function () {
  const found = engine.computeBreakers(208, [20, 20, 30], 1);
  assert.deepEqual(found.breakers.map(function (breaker) { return breaker.kilowatts; }), [4.16, 4.16, 6.24]);
  assert.equal(found.kilowatts, 14.56);
  assert.equal(found.kva, 14.56);
  assert.equal(found.kilowattHours, 14.56);
  assert.equal(found.continuousKilowatts, 11.648);
  assert.equal(found.overKilowatts, 2.912);
  assert.equal(engine.rpduNameFor("DU06", "A"), "DU06-A");
  assert.equal(engine.rpduNameFor("DU06", "B"), "DU06-B");
  assert.equal(engine.computeBreakers(120, [15], 1).kilowatts, 1.8);
});

test("cabinet import is filed under the site and room", function () {
  const csv = "Cabinet,Breaker 1,Breaker 2,Breaker 3,Volts\nDU06,20,20,30,208\nDU07,15,,,120\n";
  const missing = engine.applyImport(engine.emptyState(), csv);
  assert.equal(missing.summary.ok, false);
  const filed = engine.applyImport(engine.emptyState(), csv, { site: "USNY01", room: "East Data Center" });
  assert.equal(filed.summary.ok, true);
  assert.deepEqual(filed.summary.cabinets, ["DU06", "DU07"]);
  const tree = engine.placeLibrary(filed.state, "du06");
  assert.equal(tree[0].site, "USNY01");
  assert.equal(tree[0].rooms[0].room, "East Data Center");
  assert.equal(tree[0].rooms[0].cabinets[0].cabinet, "DU06");
  assert.equal(tree[0].rooms[0].cabinets[0].kilowatts, 14.56);
});

test("a breaker photo reading keeps the amp numbers and drops the voltage", function () {
  assert.deepEqual(engine.ampsFromText("208V 20A 20A 30A"), [20, 20, 30]);
  assert.deepEqual(engine.ampsFromText("breaker 15 A"), [15]);
  const found = engine.readAmps(engine.ampSampleImage(["20", "20", "30"]));
  assert.deepEqual(found.amps, [20, 20, 30]);
  assert.ok(found.confidence >= 0.9);
});

test("a reading file can move a cabinet from the phone to the library", function () {
  const file = engine.readingFile([{
    site: "USNY01",
    room: "East Data Center",
    cabinet: "DU06",
    rpduName: "RPDU-A",
    volts: 208,
    amps: [20, 20, 30],
    recordedAt: "2026-11-17T12:00:00.000Z",
  }]);
  const first = engine.applyReadingFile(engine.emptyState(), JSON.stringify(file));
  assert.equal(first.summary.ok, true);
  assert.equal(first.summary.added, 1);
  assert.equal(first.state.readings[0].kilowatts, 14.56);
  assert.equal(first.state.readings[0].rpduName, "RPDU-A");
  const tree = engine.placeLibrary(first.state, "rpdu-a");
  assert.equal(tree[0].rooms[0].cabinets[0].label, "RPDU-A");
  const second = engine.applyReadingFile(first.state, file);
  assert.equal(second.summary.added, 0);
  assert.equal(second.summary.duplicates, 1);
  assert.equal(second.state.readings.length, 1);
});

test("saved site, room, and cabinet lists return the latest reading", function () {
  const state = {
    readings: [
      { site: "USNY01", room: "East Data Center", cabinet: "DU06", rpduName: "DU06-A", recordedAt: "2026-01-01T00:00:00.000Z", breakers: [{ n: 1, amps: 15 }] },
      { site: "USNY01", room: "East Data Center", cabinet: "DU06", rpduName: "DU06-A", recordedAt: "2026-02-01T00:00:00.000Z", breakers: [{ n: 1, amps: 20.5 }] },
      { site: "USNY01", room: "East Data Center", cabinet: "DU06", rpduName: "DU06-B", recordedAt: "2026-02-02T00:00:00.000Z", breakers: [{ n: 1, amps: 30 }] },
      { site: "USNY01", room: "North Hall", cabinet: "DU07", rpduName: "DU07-A", recordedAt: "2026-02-03T00:00:00.000Z", breakers: [{ n: 1, amps: 10 }] },
    ],
    assets: [],
  };
  assert.deepEqual(engine.choicesFor(state, "room", "USNY01", ""), ["East Data Center", "North Hall"]);
  assert.deepEqual(engine.choicesFor(state, "cabinet", "USNY01", "East Data Center"), ["DU06"]);
  assert.equal(engine.readingForCabinet(state, { site: "usny01", room: "east data center", cabinet: "du06", rpduName: "DU06-A" }).breakers[0].amps, 20.5);
  assert.equal(engine.readingForCabinet(state, { site: "USNY01", room: "East Data Center", cabinet: "DU06", rpduName: "DU06-B" }).breakers[0].amps, 30);
  assert.equal(engine.readingForCabinet(state, { site: "USNY01", room: "East Data Center", cabinet: "DU07", rpduName: "DU07-A" }), null);
});

test("a second paste does not duplicate the same outlet", function () {
  const row = "Consumer Asset Type,Consumer Asset Name,Supplier Asset Type,Supplier Asset Name,Supplier Outlet\nServer,SERVER-01,Powerstrip,RPDU-A,1\n";
  const first = engine.applyImport(engine.emptyState(), row);
  const second = engine.applyImport(first.state, row);
  assert.equal(second.summary.linksAdded, 0);
  assert.equal(second.summary.duplicates, 1);
  assert.equal(second.state.links.length, 1);
});
