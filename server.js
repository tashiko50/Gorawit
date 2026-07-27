const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();

const MAX_EVENTS = 60;
const KM_PER_LEVEL = 20;

// Google Sheet: File > Share > Publish to web, published from the "🌐 สรุปคะแนน" tab only,
// format CSV. Can be overridden via env var without touching code (e.g. if the sheet is
// ever recreated and gets a new published link).
const SHEET_CSV_URL = process.env.SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR8wr9dyMr-UW5dX5_Wz1M0htcG_Ks8Sezeidtxr-TL2VHoXngf4sPddgGHW0xeSDEUL_v8zII6pbG3/pub?gid=475941001&single=true&output=csv";
const SHEET_POLL_MS = Number(process.env.SHEET_POLL_MS) || 90 * 1000;

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
  return { id, name, color, km: 0, lastVerified: "ยังไม่ตรวจ" };
}

function defaultState() {
  return {
    title: "Run Mile",
    teams: [
      makeTeam("t1", "ออฟฟิศสามย่าน", PALETTE[0]),
      makeTeam("t2", "คลังสินค้า", PALETTE[1]),
      makeTeam("t3", "โรงงาน", PALETTE[2])
    ],
    events: []
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
    }

    firstSyncDone = true;
    sheetSyncOk = true;
    sheetSyncAt = Date.now();
  } catch (e) {
    sheetSyncOk = false;
    console.error("Run Mile: failed to refresh from sheet —", e.message);
  }
}

let weatherByPlace = {};

async function refreshWeather() {
  try {
    const lats = ROUTE.map((wp) => wp.lat).join(",");
    const lons = ROUTE.map((wp) => wp.lon).join(",");
    const url = `${WEATHER_API_BASE}?latitude=${lats}&longitude=${lons}&current=temperature_2m,weather_code&timezone=Asia%2FBangkok`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data) ? data : [data];
    const next = {};
    ROUTE.forEach((wp, i) => {
      const current = results[i] && results[i].current;
      if (!current) return;
      const code = WEATHER_CODE_MAP[current.weather_code] || { emoji: "🌡️", label: "ไม่ทราบสภาพอากาศ", color: "#8a97a6" };
      next[wp.name] = { emoji: code.emoji, label: code.label, color: code.color, temp: Math.round(current.temperature_2m) };
    });
    weatherByPlace = next;
  } catch (e) {
    console.error("Run Mile: failed to refresh weather —", e.message);
  }
}

app.get("/", (req, res) => {
  res.redirect("/run-view.html");
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => {
  res.json(state);
});

app.get("/api/route", (req, res) => {
  res.json({ waypoints: ROUTE, viewBox: ROUTE_VIEWBOX, finishKm: ROUTE_FINISH_KM });
});

app.get("/api/sheet-sync", (req, res) => {
  res.json({ ok: sheetSyncOk, lastSyncAt: sheetSyncAt });
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
});
