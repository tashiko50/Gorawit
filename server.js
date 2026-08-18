const express = require("express");
const compression = require("compression");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(compression());

const MAX_EVENTS = 60;
const KM_PER_LEVEL = 20;

// Direct sheet export (not "Publish to web") — the /pub endpoint sits behind a Google-side
// cache that refreshes on its own schedule (sometimes minutes, outside our control), so a
// sheet edit could take far longer than SHEET_POLL_MS to actually show up here. /export
// reads the live sheet directly with no separate cache, same freshness as opening it in a
// browser. Requires the sheet's sharing set to "Anyone with the link" (Viewer is enough).
// Can be overridden via env var without touching code (e.g. if the sheet is ever recreated).
const SHEET_CSV_URL = process.env.SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1BN7R1un1QUTvVyXqTgT8ijxkpx692o2YY0HM0MkiDUs/export?format=csv&gid=475941001";
const SHEET_POLL_MS = Number(process.env.SHEET_POLL_MS) || 20 * 1000;

// Visit counter persistence — this Render free instance spins down on inactivity and loses
// all in-memory state on wake, so a plain in-process counter resets constantly. This Apps
// Script Web App (doGet increments+returns a value in PropertiesService, which survives our
// restarts) is the durable store instead. If unset, falls back to the old in-memory counter
// (works, just resets on every cold start).
const VISIT_COUNTER_URL = process.env.VISIT_COUNTER_URL || "";

// Same Apps Script Web App, different query param — returns name/team/km/submissions/streak
// per person, computed straight from the private "ตรวจสอบภายใน" sheet. Reuses
// VISIT_COUNTER_URL instead of a separate env var since it's the same deployment; this call
// never increments the visit counter (Code.gs branches on ?action=roster before touching it).
// Missing VISIT_COUNTER_URL just means the roster stays empty — the personal-search feature
// quietly has nothing to show instead of erroring.
const ROSTER_URL = VISIT_COUNTER_URL ? `${VISIT_COUNTER_URL}?action=roster` : "";
const ROSTER_POLL_MS = Number(process.env.ROSTER_POLL_MS) || 30 * 1000;

// Open-Meteo — free, no API key needed, supports current weather for many lat/lon pairs
// in a single request. Weather doesn't need to track km changes, so this polls on its
// own, much slower interval.
const WEATHER_POLL_MS = Number(process.env.WEATHER_POLL_MS) || 20 * 60 * 1000;
const WEATHER_API_BASE = process.env.WEATHER_API_BASE || "https://api.open-meteo.com/v1/forecast";
// Some emoji glyphs (pale cloud/fog symbols especially) render as low-contrast, hard-to-read
// shapes at small inline sizes across different OS emoji fonts. `color` gives each condition
// a small colored badge behind the emoji so the category reads at a glance from color alone,
// even if the glyph itself is hard to make out.
const WEATHER_CODE_MAP = {
  0: { emoji: "☀️", label: "ฟ้าใส", color: "#ffb74d" },
  1: { emoji: "🌤️", label: "แดดจัด มีเมฆบาง", color: "#ffc266" },
  2: { emoji: "⛅", label: "มีเมฆเป็นบางส่วน", color: "#9fb0c0" },
  3: { emoji: "☁️", label: "เมฆมาก", color: "#7c8ea0" },
  45: { emoji: "🌫️", label: "หมอกลง", color: "#c3ccd4" },
  48: { emoji: "🌫️", label: "หมอกน้ำแข็ง", color: "#c3ccd4" },
  51: { emoji: "🌦️", label: "ฝนปรอยเบา", color: "#6fa8dc" },
  53: { emoji: "🌦️", label: "ฝนปรอย", color: "#6fa8dc" },
  55: { emoji: "🌦️", label: "ฝนปรอยหนัก", color: "#5b93cc" },
  56: { emoji: "🌦️", label: "ฝนปรอยเยือกแข็ง", color: "#5b93cc" },
  57: { emoji: "🌦️", label: "ฝนปรอยเยือกแข็งหนัก", color: "#5b93cc" },
  61: { emoji: "🌧️", label: "ฝนตกเบา", color: "#4a7fc0" },
  63: { emoji: "🌧️", label: "ฝนตกปานกลาง", color: "#3f6fb0" },
  65: { emoji: "🌧️", label: "ฝนตกหนัก", color: "#33609e" },
  66: { emoji: "🌧️", label: "ฝนเยือกแข็งเบา", color: "#4a7fc0" },
  67: { emoji: "🌧️", label: "ฝนเยือกแข็งหนัก", color: "#33609e" },
  71: { emoji: "❄️", label: "หิมะตกเบา", color: "#bfe3f5" },
  73: { emoji: "❄️", label: "หิมะตกปานกลาง", color: "#a9d8ef" },
  75: { emoji: "❄️", label: "หิมะตกหนัก", color: "#93cdea" },
  77: { emoji: "❄️", label: "เกล็ดหิมะ", color: "#bfe3f5" },
  80: { emoji: "🌦️", label: "ฝนซู่เบา", color: "#6fa8dc" },
  81: { emoji: "🌧️", label: "ฝนซู่ปานกลาง", color: "#4a7fc0" },
  82: { emoji: "🌧️", label: "ฝนซู่หนักมาก", color: "#33609e" },
  85: { emoji: "🌨️", label: "หิมะซู่เบา", color: "#a9d8ef" },
  86: { emoji: "🌨️", label: "หิมะซู่หนัก", color: "#93cdea" },
  95: { emoji: "⛈️", label: "พายุฝนฟ้าคะนอง", color: "#5c4a8f" },
  96: { emoji: "⛈️", label: "พายุฝนฟ้าคะนอง มีลูกเห็บ", color: "#4e3d7a" },
  99: { emoji: "⛈️", label: "พายุฝนฟ้าคะนองรุนแรง มีลูกเห็บ", color: "#3e2f66" }
};

const MILESTONE_NAMES = {
  0: "แคมป์เริ่มต้น",
  10: "รังนกน้อย",
  20: "ไร่ชายามเช้า",
  30: "คฤหาสน์ใบชา",
  40: "ปราสาทสายลม",
  50: "อาณาจักรนักวิ่ง",
  60: "นักวิ่งไร้พรมแดน",
  70: "ตำนานที่ยังไม่จบ",
  80: "เหนือจินตนาการ",
  90: "ประตูสู่จักรวาล",
  100: "ทูตจากดวงดาว"
};
const MILESTONE_LEVELS = Object.keys(MILESTONE_NAMES).map(Number).sort((a, b) => a - b);

const PALETTE = ["#4A90D9", "#E2934A", "#4F9A5B", "#D1587A", "#8B6FD1", "#3FA9A0"];

// Real road-distance waypoints along Highway 1 (Phahonyothin), Bangkok -> Chiang Rai,
// with x/y pre-projected from each place's lat/lon onto a 520x860 map canvas (north = up).
// Chiang Rai (830km) is the race finish line; Mae Sai extends the map for teams that
// overrun the 1000km cap so they still have somewhere to go.
const ROUTE = [
  { name: "กรุงเทพฯ (TDFB HQ)", km: 0, x: 429, y: 830, lat: 13.7563, lon: 100.5018 },
  { name: "ปทุมธานี", km: 40, x: 424, y: 797, lat: 14.0208, lon: 100.5250 },
  { name: "อยุธยา", km: 80, x: 437, y: 757, lat: 14.3532, lon: 100.5648 },
  { name: "สิงห์บุรี", km: 142, x: 390, y: 692, lat: 14.8907, lon: 100.3970 },
  { name: "ชัยนาท", km: 195, x: 320, y: 657, lat: 15.1851, lon: 100.1251 },
  { name: "นครสวรรค์", km: 240, x: 320, y: 594, lat: 15.7047, lon: 100.1372 },
  { name: "กำแพงเพชร", km: 358, x: 161, y: 499, lat: 16.4827, lon: 99.5226 },
  { name: "ตาก", km: 426, x: 60, y: 452, lat: 16.8840, lon: 99.1258 },
  { name: "ลำปาง", km: 599, x: 156, y: 280, lat: 18.2855, lon: 99.5128 },
  { name: "พะเยา", km: 691, x: 260, y: 173, lat: 19.1664, lon: 99.9018 },
  { name: "เชียงราย 🏁", km: 830, x: 242, y: 84, lat: 19.9105, lon: 99.8406 },
  { name: "แม่สาย (ชายแดน)", km: 890, x: 255, y: 21, lat: 20.4258, lon: 99.8756 }
];
const ROUTE_VIEWBOX = { w: 520, h: 860 };
const ROUTE_FINISH_KM = 830;

// Chapter 2 — a "warp" chapter, not a driving continuation of chapter 1. แม่สาย becomes a
// portal instead of a border crossing to walk through: the map skips straight to ฮานอย
// (เวียดนาม) and continues through cities Thai people actually recognize (ฮ่องกง/ไทเป before
// the Taiwan Strait, then ญี่ปุ่น) rather than a literal drivable road from Thailand, which
// doesn't exist. Absolute km still continues straight on from chapter 1 (no reset at the
// border) so the whole-race progress bar stays continuous — the warp itself costs no km,
// ฮานอย just picks up numbering exactly where แม่สาย (890km) left off.
// The ไทเป → โอกินาว่า leg is flown, not run (no bridge/ferry route makes sense there) —
// marked `flight: true` on the ไทเป waypoint so computeSubTicks skips the usual 50km ticks
// across that specific gap (see run-view.js). Distances are approximate real-world
// city-to-city distances (driving where a road exists, flight distance across open sea),
// not verified routing data like ROUTE above — good enough for a pitch, not for real GPS.
// lat/lon are real city centers (Izumo for the Hikawa-cho/Shimane finish, since Hikawa-cho
// merged into Izumo City in 2011), close enough for the weather lookup.
const ROUTE_CHAPTER2 = [
  { name: "ฮานอย", km: 890, x: 130, y: 700, lat: 21.0285, lon: 105.8542 },
  { name: "ฮ่องกง", km: 1790, x: 230, y: 560, lat: 22.3193, lon: 114.1694 },
  { name: "ไทเป", km: 2595, x: 300, y: 430, lat: 25.0330, lon: 121.5654, flight: true },
  { name: "โอกินาว่า", km: 3225, x: 340, y: 300, lat: 26.2124, lon: 127.6809 },
  { name: "โอซาก้า", km: 4425, x: 310, y: 170, lat: 34.6937, lon: 135.5023 },
  { name: "HIKAWA CO., LTD. 🏁🏭", km: 4655, x: 370, y: 80, lat: 35.3667, lon: 132.7667 }
];
const ROUTE_CHAPTER2_VIEWBOX = { w: 480, h: 760 };
const ROUTE_CHAPTER2_FINISH_KM = 4655;
const ROUTE_CHAPTER2_LABEL = "บทใหม่ — วาร์ปสู่ญี่ปุ่น 🇯🇵";

function placeForKm(km) {
  const k = Math.max(0, Number(km) || 0);
  let current = ROUTE[0];
  for (const wp of ROUTE) {
    if (wp.km <= k) current = wp;
    else break;
  }
  return current;
}

function levelForKm(km) {
  return Math.max(0, Math.floor((Number(km) || 0) / KM_PER_LEVEL));
}

function milestoneNameForLevel(level) {
  let name = MILESTONE_NAMES[0];
  for (const lvl of MILESTONE_LEVELS) {
    if (lvl <= level) name = MILESTONE_NAMES[lvl];
    else break;
  }
  return name;
}

function makeTeam(id, name, color) {
  return { id, name, color, km: 0, lastVerified: "ยังไม่ตรวจ", topRunners: [] };
}

function defaultState() {
  return {
    title: "Run Mile",
    teams: [
      makeTeam("t1", "ออฟฟิศสามย่าน", PALETTE[0]),
      makeTeam("t2", "คลังสินค้า", PALETTE[1]),
      makeTeam("t3", "โรงงาน", PALETTE[2])
    ],
    events: [],
    visitCount: 0,
    roster: []
  };
}

const state = defaultState();

function pushEvent(text) {
  state.events.unshift({ id: crypto.randomUUID(), ts: Date.now(), text });
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
}

function applyKmChange(team, nextKm) {
  const prevLevel = levelForKm(team.km);
  const prevPlace = placeForKm(team.km).name;
  team.km = Math.max(0, nextKm);
  const newLevel = levelForKm(team.km);
  const newPlace = placeForKm(team.km).name;
  if (newPlace !== prevPlace) {
    const medal = newPlace.indexOf("เชียงราย") !== -1 ? "\u{1F3C5}" : "\u{1F4CD}";
    pushEvent(`${medal} ${team.name} วิ่งถึง${newPlace}แล้ว! (${team.km} กม.)`);
  }
  if (newLevel > prevLevel) {
    const newName = milestoneNameForLevel(newLevel);
    const prevName = milestoneNameForLevel(prevLevel);
    if (newName !== prevName) {
      const icon = newLevel >= 100 ? "\u{1F6F8}" : "\u{1F3D8}✨";
      pushEvent(`${icon} ${team.name} อัปเกรดหมู่บ้านเป็น "${newName}" แล้ว! (${newLevel * KM_PER_LEVEL} กม.)`);
    } else {
      pushEvent(`\u{1F331} ${team.name} หมู่บ้านคึกคักขึ้น! (ถึง ${newLevel * KM_PER_LEVEL} กม.)`);
    }
  } else if (newLevel < prevLevel) {
    pushEvent(`⬇️ ${team.name} กม. ลดลง หมู่บ้านเล็กลงเล็กน้อย`);
  }
}

// Minimal RFC4180-ish CSV parser — handles quoted fields with embedded commas/newlines,
// which is all we need since the published tab is just 3 plain columns.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function findColumn(headers, substring) {
  return headers.findIndex((h) => h.indexOf(substring) !== -1);
}

let sheetSyncOk = false;
let sheetSyncAt = null;
let firstSyncDone = false;

async function refreshFromSheet() {
  try {
    const res = await fetch(SHEET_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCsv(await res.text());
    if (rows.length < 2) throw new Error("sheet returned no data rows");

    const headers = rows[0];
    const nameCol = findColumn(headers, "สถานที่");
    const kmCol = findColumn(headers, "Total");
    const verifiedCol = findColumn(headers, "ตรวจล่าสุด");
    if (nameCol === -1 || kmCol === -1) throw new Error("sheet headers not recognized — check the published tab's column names");

    // Optional — only present once the "top runners" columns are added to the published
    // tab. Missing columns (-1) just mean no per-runner ranking shows for that rank yet.
    // Ranks 1-3 feed the always-visible summary on the main board; ranks up to 10 feed the
    // "🏆 Top 10" popup — a team with fewer than 10 real entrants just leaves the extra
    // columns blank, which the .filter(Boolean) below already drops cleanly.
    const topRunnerCols = Array.from({ length: 10 }, (_, i) => i + 1).map((rank) => ({
      nameCol: findColumn(headers, `อันดับ${rank}_ชื่อ`),
      kmCol: findColumn(headers, `อันดับ${rank}_กม.`)
    }));

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      const teamName = (cells[nameCol] || "").trim();
      if (!teamName) continue;
      const team = state.teams.find((t) => t.name === teamName);
      if (!team) {
        console.warn(`Run Mile: sheet has unrecognized team "${teamName}", skipping`);
        continue;
      }
      const km = Number(String(cells[kmCol] || "0").replace(/,/g, "").trim());
      if (Number.isFinite(km)) {
        if (!firstSyncDone) team.km = Math.max(0, km); // adopt silently on startup, no event burst
        else if (km !== team.km) applyKmChange(team, km);
      }
      if (verifiedCol !== -1) team.lastVerified = (cells[verifiedCol] || "").trim() || "ยังไม่ตรวจ";

      team.topRunners = topRunnerCols
        .map(({ nameCol: rNameCol, kmCol: rKmCol }) => {
          if (rNameCol === -1 || rKmCol === -1) return null;
          const runnerName = (cells[rNameCol] || "").trim();
          const runnerKm = Number(String(cells[rKmCol] || "0").replace(/,/g, "").trim());
          if (!runnerName || !Number.isFinite(runnerKm) || runnerKm <= 0) return null;
          return { name: runnerName, km: runnerKm };
        })
        .filter(Boolean);
    }

    firstSyncDone = true;
    sheetSyncOk = true;
    sheetSyncAt = Date.now();
  } catch (e) {
    sheetSyncOk = false;
    console.error("Run Mile: failed to refresh from sheet —", e.message);
  }
}

let rosterSyncOk = false;

async function refreshRoster() {
  if (!ROSTER_URL) return; // no Apps Script URL configured — feature just stays empty, not broken
  try {
    const res = await fetch(ROSTER_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("roster response was not an array");
    state.roster = data;
    rosterSyncOk = true;
  } catch (e) {
    rosterSyncOk = false;
    console.error("Run Mile: failed to refresh roster —", e.message);
  }
}

let weatherByPlace = {};

const ALL_ROUTE_WAYPOINTS = [...ROUTE, ...ROUTE_CHAPTER2];

async function refreshWeather() {
  try {
    const lats = ALL_ROUTE_WAYPOINTS.map((wp) => wp.lat).join(",");
    const lons = ALL_ROUTE_WAYPOINTS.map((wp) => wp.lon).join(",");
    const url = `${WEATHER_API_BASE}?latitude=${lats}&longitude=${lons}&current=temperature_2m,weather_code&timezone=Asia%2FBangkok`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data) ? data : [data];
    const next = {};
    ALL_ROUTE_WAYPOINTS.forEach((wp, i) => {
      const current = results[i] && results[i].current;
      if (!current) return;
      const code = WEATHER_CODE_MAP[current.weather_code] || { emoji: "🌡️", label: "ไม่ทราบสภาพอากาศ", color: "#8a97a6" };
      next[wp.name] = { emoji: code.emoji, label: code.label, color: code.color, temp: Math.round(current.temperature_2m), code: current.weather_code };
    });
    weatherByPlace = next;
  } catch (e) {
    console.error("Run Mile: failed to refresh weather —", e.message);
  }
}

// Fire-and-forget — never awaited in a route handler, so a slow (or unreachable) counter
// endpoint never delays a page load. Guards against overwriting with a smaller number in
// case two concurrent requests' responses arrive out of order.
function bumpVisitCounter() {
  if (!VISIT_COUNTER_URL) {
    state.visitCount++;
    return;
  }
  fetch(VISIT_COUNTER_URL)
    .then((r) => r.json())
    .then((data) => {
      if (Number.isFinite(data.count) && data.count > state.visitCount) state.visitCount = data.count;
    })
    .catch((e) => {
      console.error("Run Mile: visit counter fetch failed —", e.message);
      state.visitCount++;
    });
}

// Counts page loads only (not the /api/* polling that happens every few seconds per
// open tab) — anyone opening the board hits one of these two paths exactly once.
app.get("/", (req, res) => {
  bumpVisitCounter();
  res.redirect("/run-view.html");
});

app.get("/run-view.html", (req, res, next) => {
  bumpVisitCounter();
  next();
});

// bgm tracks barely ever change, so let browsers cache them for a week instead of
// re-checking with the server on every page load — if a track is ever swapped out,
// rename the file (e.g. track2-v2.mp3) so the new one isn't shadowed by the old cache.
app.use("/audio", express.static(path.join(__dirname, "public", "audio"), { maxAge: "7d" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => {
  res.json(state);
});

app.get("/api/route", (req, res) => {
  res.json({
    chapters: [
      { id: "th", startKm: 0, waypoints: ROUTE, viewBox: ROUTE_VIEWBOX, finishKm: ROUTE_FINISH_KM },
      { id: "jp", startKm: 890, label: ROUTE_CHAPTER2_LABEL, waypoints: ROUTE_CHAPTER2, viewBox: ROUTE_CHAPTER2_VIEWBOX, finishKm: ROUTE_CHAPTER2_FINISH_KM }
    ]
  });
});

app.get("/api/sheet-sync", (req, res) => {
  res.json({ ok: sheetSyncOk, lastSyncAt: sheetSyncAt });
});

app.get("/api/roster", (req, res) => {
  res.json(state.roster);
});

app.get("/api/weather", (req, res) => {
  res.json(weatherByPlace);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Run Mile listening on :${PORT}`);
  refreshFromSheet();
  setInterval(refreshFromSheet, SHEET_POLL_MS);
  refreshWeather();
  setInterval(refreshWeather, WEATHER_POLL_MS);
  refreshRoster();
  setInterval(refreshRoster, ROSTER_POLL_MS);
});
