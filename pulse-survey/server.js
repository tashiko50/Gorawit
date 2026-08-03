require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const { OAuth2Client } = require("google-auth-library");
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || "tdfb.co").toLowerCase();
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const CONFIG_ISSUES = [];
if (!SESSION_SECRET) CONFIG_ISSUES.push("SESSION_SECRET ยังไม่ตั้งค่า (จำเป็นสำหรับเซ็นชื่อ cookie ล็อกอินอย่างปลอดภัย)");
if (!GOOGLE_CLIENT_ID) CONFIG_ISSUES.push("GOOGLE_CLIENT_ID ยังไม่ตั้งค่า (ล็อกอินด้วย Google จะใช้งานไม่ได้)");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) CONFIG_ISSUES.push("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ยังไม่ตั้งค่า (บันทึก/อ่านข้อมูลจะใช้งานไม่ได้)");
if (CONFIG_ISSUES.length) {
  console.warn("[pulse-survey] ยังตั้งค่าไม่ครบ — ดู pulse-survey/README.md:");
  CONFIG_ISSUES.forEach((issue) => console.warn("  - " + issue));
}

const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const app = express();
app.use(express.json());
app.use(cookieParser(SESSION_SECRET || undefined));
app.use(express.static(path.join(__dirname, "public")));

const COOKIE_NAME = "tdfb_pulse_session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 วัน

function requireSupabase(res) {
  if (!supabase) {
    res.status(503).json({ error: "ระบบยังไม่ได้ตั้งค่า Supabase — แจ้งผู้ดูแลระบบ" });
    return false;
  }
  return true;
}

function setSession(res, user) {
  res.cookie(COOKIE_NAME, JSON.stringify(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    signed: true,
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function getSessionUser(req) {
  const raw = req.signedCookies && req.signedCookies[COOKIE_NAME];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบก่อน" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_EMAILS.includes(req.user.email.toLowerCase())) {
    return res.status(403).json({ error: "หน้านี้สำหรับทีม GM/HR เท่านั้น" });
  }
  next();
}

// ---- Public config (client ID is not secret; needed by the Google Sign-In button) ----
app.get("/api/config", (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID, allowedEmailDomain: ALLOWED_EMAIL_DOMAIN });
});

// ---- Auth ----
app.post("/api/auth/google", async (req, res) => {
  if (!oauthClient) return res.status(503).json({ error: "ระบบยังไม่ได้ตั้งค่า Google Sign-In" });
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: "ไม่พบ credential" });

  let payload;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "ยืนยันตัวตนกับ Google ไม่สำเร็จ" });
  }

  const email = (payload.email || "").toLowerCase();
  const domain = email.split("@")[1] || "";
  if (!payload.email_verified || domain !== ALLOWED_EMAIL_DOMAIN) {
    return res.status(403).json({ error: `ต้องใช้บัญชี @${ALLOWED_EMAIL_DOMAIN} เท่านั้น` });
  }

  const user = { email, name: payload.name || email, picture: payload.picture || "" };
  setSession(res, user);
  res.json({ ok: true, user, isAdmin: ADMIN_EMAILS.includes(email) });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: "ยังไม่ได้เข้าสู่ระบบ" });
  res.json({ user, isAdmin: ADMIN_EMAILS.includes(user.email.toLowerCase()) });
});

// ---- Survey ----
app.get("/api/activities/current", requireAuth, async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data: activity, error } = await supabase
    .from("activities")
    .select("id, name, quarter, topics")
    .eq("is_open", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!activity) return res.status(404).json({ error: "ยังไม่มีแบบสำรวจที่เปิดอยู่ในขณะนี้" });

  const { data: existing } = await supabase
    .from("responses")
    .select("answers, praise, ask")
    .eq("activity_id", activity.id)
    .eq("user_email", req.user.email)
    .maybeSingle();

  res.json({ activity, previousResponse: existing || null });
});

app.post("/api/responses", requireAuth, async (req, res) => {
  if (!requireSupabase(res)) return;
  const { activityId, answers, praise, ask } = req.body || {};
  if (!activityId || !answers || typeof answers !== "object") {
    return res.status(400).json({ error: "ข้อมูลไม่ครบ" });
  }

  const { error } = await supabase.from("responses").upsert(
    {
      activity_id: activityId,
      user_email: req.user.email,
      answers,
      praise: praise || null,
      ask: ask || null,
      submitted_at: new Date().toISOString(),
    },
    { onConflict: "activity_id,user_email" }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---- Dashboard (GM/HR only) ----
app.get("/api/dashboard/current", requireAuth, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data: activity, error: activityErr } = await supabase
    .from("activities")
    .select("id, name, quarter, topics")
    .eq("is_open", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activityErr) return res.status(500).json({ error: activityErr.message });
  if (!activity) return res.status(404).json({ error: "ยังไม่มีกิจกรรมที่เปิดอยู่" });

  const { data: responses, error: respErr } = await supabase
    .from("responses")
    .select("answers, praise, ask, submitted_at")
    .eq("activity_id", activity.id);
  if (respErr) return res.status(500).json({ error: respErr.message });

  const topicStats = activity.topics.map((topic) => {
    const values = responses
      .map((r) => r.answers && r.answers[topic.key])
      .filter((v) => typeof v === "number");
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { key: topic.key, label: topic.label, avg, count: values.length };
  });
  topicStats.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));

  const praise = responses.map((r) => r.praise).filter(Boolean).slice(-20).reverse();
  const ask = responses.map((r) => r.ask).filter(Boolean).slice(-20).reverse();

  res.json({
    activity: { name: activity.name, quarter: activity.quarter },
    totalResponses: responses.length,
    topicStats,
    comments: { praise, ask },
  });
});

// ---- Admin: create a new activity ----
app.post("/api/admin/activities", requireAuth, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  const { name, quarter, topics, closeOthers } = req.body || {};
  if (!name || !quarter || !Array.isArray(topics) || !topics.length) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมีชื่อ, ไตรมาส, และหัวข้ออย่างน้อย 1 หัวข้อ)" });
  }
  if (closeOthers !== false) {
    await supabase.from("activities").update({ is_open: false }).eq("is_open", true);
  }
  const { data, error } = await supabase
    .from("activities")
    .insert({ name, quarter, topics, is_open: true })
    .select("id")
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, id: data.id });
});

app.get("/", (req, res) => res.redirect("/login.html"));

app.listen(PORT, () => {
  console.log(`[pulse-survey] listening on http://localhost:${PORT}`);
});
