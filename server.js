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
const MAX_DECORATION = 20;
const MAX_LEVEL = 3;

const PALETTE = ["#4A90D9", "#E2934A", "#4F9A5B", "#D1587A", "#8B6FD1", "#3FA9A0"];
const TOKEN_TYPES = ["star", "coin", "coins", "chest"];
const DECORATION_TYPES = ["trees", "flowers", "people", "animals", "teaField"];
const DECORATION_LABELS = {
  trees: "ต้นไม้",
  flowers: "ดอกไม้",
  people: "ผู้คน",
  animals: "สัตว์เลี้ยง",
  teaField: "แปลงชา"
};

function makeTeam(id, name, color, tokenType) {
  return {
    id,
    name,
    color,
    points: 0,
    tokenType,
    tokenCount: 0,
    level: 1,
    decorations: { trees: 0, flowers: 0, people: 0, animals: 0, teaField: 0 }
  };
}

function defaultState() {
  return {
    title: "Village Builders Scoreboard",
    teams: [
      makeTeam("t1", "Team “spacex”", PALETTE[0], "star"),
      makeTeam("t2", "Team “yes-or-no”", PALETTE[1], "coin"),
      makeTeam("t3", "Team “lerd-lerd”", PALETTE[2], "coins"),
      makeTeam("t4", "Team “plain-flavor-stars”", PALETTE[3], "chest")
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

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
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

  if (["renameTeam", "setColor", "adjustPoints", "setPoints", "setTokenType", "adjustTokenCount", "adjustLevel", "adjustDecoration", "removeTeam"].includes(type) && !team) {
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
      const tokenType = TOKEN_TYPES[state.teams.length % TOKEN_TYPES.length];
      const created = makeTeam(id, "New Team", color, tokenType);
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
    case "adjustPoints": {
      const delta = Math.trunc(Number(payload.delta)) || 0;
      team.points += delta;
      pushEvent(`${delta >= 0 ? "⭐" : "➖"} ${team.name} ${delta >= 0 ? "+" : ""}${delta} pts (รวม ${team.points})`);
      break;
    }
    case "setPoints": {
      const points = Math.trunc(Number(payload.points));
      if (Number.isFinite(points)) {
        team.points = points;
        pushEvent(`⭐ ${team.name} ตั้งคะแนนเป็น ${points} pts`);
      }
      break;
    }
    case "setTokenType": {
      if (TOKEN_TYPES.includes(payload.tokenType)) {
        team.tokenType = payload.tokenType;
        pushEvent(`\u{1F504} ${team.name} เปลี่ยนไอคอนรางวัล`);
      }
      break;
    }
    case "adjustTokenCount": {
      const delta = Math.trunc(Number(payload.delta)) || 0;
      const next = Math.max(0, team.tokenCount + delta);
      if (next !== team.tokenCount) {
        team.tokenCount = next;
        pushEvent(`\u{1FA99} ${team.name} เหรียญ ${delta >= 0 ? "+" : ""}${delta} (รวม ${team.tokenCount})`);
      }
      break;
    }
    case "adjustLevel": {
      const delta = Math.trunc(Number(payload.delta)) || 0;
      const next = clamp(team.level + delta, 1, MAX_LEVEL);
      if (next !== team.level) {
        team.level = next;
        pushEvent(`${delta > 0 ? "⬆️" : "⬇️"} ${team.name} ${delta > 0 ? "อัปเกรด" : "ลดระดับ"}บ้านเป็นระดับ ${next}`);
      }
      break;
    }
    case "adjustDecoration": {
      const decoType = payload.decoType;
      if (!DECORATION_TYPES.includes(decoType)) return res.status(400).json({ error: "bad_decoration_type" });
      const delta = Math.trunc(Number(payload.delta)) || 0;
      const next = clamp(team.decorations[decoType] + delta, 0, MAX_DECORATION);
      if (next !== team.decorations[decoType]) {
        team.decorations[decoType] = next;
        pushEvent(`${delta >= 0 ? "\u{1F331}" : "\u{1F9F9}"} ${team.name} ${delta >= 0 ? "เพิ่ม" : "ลด"}${DECORATION_LABELS[decoType]}`);
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
