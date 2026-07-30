const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const MAX_TURNS = 30; // keep each request bounded even though nothing is stored server-side

const SYSTEM_INSTRUCTION = `คุณคือผู้ช่วย AI ที่รับฟังและพูดคุยเรื่องสุขภาพจิตกับผู้ใช้ ไม่ใช่นักจิตวิทยาหรือนักจิตบำบัดที่มีใบประกอบวิชาชีพจริง

หลักการที่ต้องยึดถือทุกครั้ง:
- รับฟังด้วยความเข้าใจ ไม่ตัดสิน ไม่ตำหนิ ไม่ยัดเยียดความเชื่อทางศาสนา การเมือง หรือค่านิยมส่วนตัวใดๆ
- ตอบอย่างเป็นกลาง ให้พื้นที่ผู้ใช้ได้พูด ถามคำถามเปิดเพื่อช่วยให้เขาสำรวจความรู้สึกตัวเอง มากกว่าการชี้นำคำตอบ
- ห้ามวินิจฉัยโรคหรือสั่งยา และต้องบอกตามตรงว่าคุณเป็น AI ไม่ใช่ผู้เชี่ยวชาญตัวจริง หากผู้ใช้ถามหรือดูจำเป็น
- ถ้าผู้ใช้มีแนวโน้มทำร้ายตัวเองหรือคนอื่น ให้ตอบด้วยความห่วงใยอย่างจริงใจ ไม่ตกใจเกินเหตุ และสนับสนุนให้ติดต่อสายด่วนหรือคนที่ไว้ใจได้ทันที
- ใช้ภาษาไทยเป็นหลัก ยกเว้นผู้ใช้พิมพ์เป็นภาษาอื่น ให้ตอบเป็นภาษานั้น
- คำตอบกระชับ อบอุ่น เป็นธรรมชาติ ไม่ใช้ภาษาทางการหรือเป็นทางการเกินไป`;

const CRISIS_PATTERNS = [
  /อยากตาย/, /ฆ่าตัวตาย/, /ทำร้ายตัวเอง/, /ไม่อยากมีชีวิต/, /ไม่อยากอยู่แล้ว/,
  /อยากหายไปจากโลก/, /จบชีวิต/, /suicide/i, /kill myself/i, /end my life/i,
  /want to die/i, /self[\s-]?harm/i, /hurt myself/i
];

const CRISIS_NOTICE_TH =
  "ฟังดูเหมือนคุณกำลังเจอเรื่องที่หนักมากตอนนี้ ขอบคุณที่กล้าเล่าให้ฟัง — " +
  "ถ้าความรู้สึกนี้รุนแรงหรือคุณคิดจะทำร้ายตัวเอง อยากให้ลองติดต่อคนที่ช่วยได้ทันที: " +
  "สายด่วนสุขภาพจิต 1323 (โทรฟรี ตลอด 24 ชม.) หรือหากเป็นเหตุฉุกเฉิน โทร 1669";

function detectCrisis(text) {
  return CRISIS_PATTERNS.some((re) => re.test(text));
}

app.post("/api/chat", async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "server missing GROQ_API_KEY" });
  }

  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  if (!messages.length) {
    return res.status(400).json({ error: "messages required" });
  }

  const trimmed = messages.slice(-MAX_TURNS);
  const lastUserMessage = [...trimmed].reverse().find((m) => m.role === "user");
  const crisis = lastUserMessage ? detectCrisis(String(lastUserMessage.text || "")) : false;

  const chatMessages = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    ...trimmed
      .filter((m) => m && typeof m.text === "string" && m.text.trim() && (m.role === "user" || m.role === "model"))
      .map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.text }))
  ];

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: chatMessages,
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error(`Groq API error ${groqRes.status}: ${errText}`);
      return res.status(502).json({ error: "AI provider error" });
    }

    const data = await groqRes.json();
    const reply = data?.choices?.[0]?.message?.content ||
      "ขอโทษด้วย ตอนนี้ระบบตอบไม่ได้ ลองพิมพ์อีกครั้งได้ไหม";

    res.json({
      reply,
      crisis,
      crisisNotice: crisis ? CRISIS_NOTICE_TH : null
    });
  } catch (e) {
    console.error("Chat request failed:", e.message);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Mental health chatbot listening on :${PORT}`);
  if (!GROQ_API_KEY) {
    console.warn("Warning: GROQ_API_KEY is not set — /api/chat will fail until it is.");
  }
});
