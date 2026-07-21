const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const ADMIN_PIN = process.env.ADMIN_PIN || "0000";
const MAX_EVENTS = 60;
const MAX_TEAMS = 12;
const KM_PER_LEVEL = 20;

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
  return { id, name, color, km: 0 };
}

function defaultState() {
  return {
    title: "Village Builders Scoreboard",
    teams: [
      makeTeam("t1", "Team “spacex”", PALETTE[0]),
      makeTeam("t2", "Team “yes-or-no”", PALETTE[1]),
      makeTeam("t3", "Team “lerd-lerd”", PALETTE[2]),
      makeTeam("t4", "Team “plain-flavor-stars”", PALETTE[3])
    ],
    events: []
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.teams)) throw new Error("malformed state file");
    return parsed;
  } catch (e) {
    return defaultState();
  }
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();

function pushEvent(text) {
  state.events.unshift({ id: crypto.randomUUID(), ts: Date.now(), text });
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
}

function findTeam(id) {
  return state.teams.find((t) => t.id === id) || null;
}

function nextTeamId() {
  const ids = new Set(state.teams.map((t) => t.id));
  let n = 1;
  while (ids.has("t" + n)) n++;
  return "t" + n;
}

function applyKmChange(team, nextKm) {
  const prevLevel = levelForKm(team.km);
  team.km = Math.max(0, nextKm);
  const newLevel = levelForKm(team.km);
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

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => {
  res.json(state);
});

function requirePin(req, res, next) {
  if ((req.get("x-admin-pin") || "") !== ADMIN_PIN) {
    return res.status(401).json({ error: "invalid_pin" });
  }
  next();
}

app.post("/api/actions", requirePin, (req, res) => {
  const body = req.body || {};
  const type = body.type;
  const teamId = body.teamId;
  const payload = body.payload || {};
  const team = teamId ? findTeam(teamId) : null;
  let createdTeamId = null;

  if (["renameTeam", "setColor", "adjustKm", "setKm", "removeTeam"].includes(type) && !team) {
    return res.status(404).json({ error: "team_not_found" });
  }

  switch (type) {
    case "renameBoard": {
      state.title = String(payload.title || "").trim().slice(0, 80) || "Village Builders Scoreboard";
      pushEvent(`✏️ เปลี่ยนชื่อบอร์ดเป็น “${state.title}”`);
      break;
    }
    case "addTeam": {
      if (state.teams.length >= MAX_TEAMS) return res.status(400).json({ error: "max_teams" });
      const id = nextTeamId();
      const color = PALETTE[state.teams.length % PALETTE.length];
      const created = makeTeam(id, "New Team", color);
      state.teams.push(created);
      createdTeamId = id;
      pushEvent(`\u{1F3D8}️ เพิ่มทีมใหม่: ${created.name}`);
      break;
    }
    case "removeTeam": {
      state.teams = state.teams.filter((t) => t.id !== teamId);
      pushEvent(`❌ ลบทีม ${team.name}`);
      break;
    }
    case "renameTeam": {
      const oldName = team.name;
      team.name = String(payload.name || "").trim().slice(0, 60) || "New Team";
      if (team.name !== oldName) {
        pushEvent(`✏️ เปลี่ยนชื่อทีม “${oldName}” เป็น “${team.name}”`);
      }
      break;
    }
    case "setColor": {
      if (/^#[0-9a-fA-F]{6}$/.test(payload.color)) {
        team.color = payload.color;
        pushEvent(`\u{1F3A8} ${team.name} เปลี่ยนสีบ้าน`);
      }
      break;
    }
    case "adjustKm": {
      const delta = Math.trunc(Number(payload.delta)) || 0;
      applyKmChange(team, team.km + delta);
      pushEvent(`\u{1F3C3} ${team.name} ${delta >= 0 ? "+" : ""}${delta} กม. (รวม ${team.km} กม.)`);
      break;
    }
    case "setKm": {
      const km = Math.trunc(Number(payload.km));
      if (Number.isFinite(km)) {
        applyKmChange(team, km);
        pushEvent(`\u{1F3C3} ${team.name} ตั้งระยะทางเป็น ${km} กม.`);
      }
      break;
    }
    case "resetAll": {
      state = defaultState();
      pushEvent("\u{1F504} รีเซ็ตสกอร์บอร์ดทั้งหมด");
      break;
    }
    default:
      return res.status(400).json({ error: "unknown_action" });
  }

  saveState();
  res.json(createdTeamId ? { ...state, createdTeamId } : state);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Village Builders Scoreboard listening on :${PORT}`);
  if (!process.env.ADMIN_PIN) {
    console.log("ADMIN_PIN not set — using default \"0000\". Set ADMIN_PIN before deploying.");
  }
});
