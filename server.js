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
  { name: "กรุงเทพฯ (TDFB HQ)", km: 0, x: 429, y: 830 },
  { name: "ปทุมธานี", km: 40, x: 424, y: 797 },
  { name: "พระนครศรีอยุธยา", km: 80, x: 437, y: 757 },
  { name: "สิงห์บุรี", km: 142, x: 390, y: 692 },
  { name: "ชัยนาท", km: 195, x: 320, y: 657 },
  { name: "นครสวรรค์", km: 240, x: 320, y: 594 },
  { name: "กำแพงเพชร", km: 358, x: 161, y: 499 },
  { name: "ตาก", km: 426, x: 60, y: 452 },
  { name: "ลำปาง", km: 599, x: 156, y: 280 },
  { name: "พะเยา", km: 691, x: 260, y: 173 },
  { name: "เชียงราย 🏁", km: 830, x: 242, y: 84 },
  { name: "แม่สาย (ชายแดน)", km: 890, x: 255, y: 21 }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Run Mile listening on :${PORT}`);
  refreshFromSheet();
  setInterval(refreshFromSheet, SHEET_POLL_MS);
});
