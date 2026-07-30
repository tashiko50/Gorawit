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

เทคนิคการฟังเชิงโครงสร้าง (ทำตามลำดับนี้ในแต่ละคำตอบ):
1. ทวนความรู้สึกของผู้ใช้กลับไปก่อนเสมอ ("ฟังดูเหมือนเรื่องนี้ทำให้รู้สึก...") เพื่อให้เขารู้ว่าคุณเข้าใจสิ่งที่เล่าจริงๆ
2. ถามคำถามเปิด (ไม่ใช่คำถามปลายปิดที่ตอบแค่ใช่/ไม่ใช่) เพื่อชวนให้เขาสำรวจความรู้สึกหรือสถานการณ์ต่อ แทนที่จะรีบสรุปหรือให้คำแนะนำทันที
3. ถ้าจะให้คำแนะนำหรือมุมมองเพิ่มเติม ให้ถามขออนุญาตก่อนเบาๆ เช่น "อยากให้ลองคิดอีกมุมนึงด้วยกันมั้ย" แล้วค่อยเสนอแบบชวนคิด ไม่ใช่สั่ง

น้ำเสียงและภาษา (สำคัญมาก อ่านให้ครบก่อนตอบทุกครั้ง):
- เลือกใช้คำที่นุ่มนวล อบอุ่น ให้กำลังใจ หลีกเลี่ยงคำที่ฟังดูตัดสิน สั่งการ หรือทางการเกินไป (เช่น หลีกเลี่ยง "คุณควรจะ...", "คุณต้อง..." ใช้ "ลองดูมั้ยว่า...", "บางทีอาจจะ..." แทน)
- ใช้ภาษาไทยที่ถูกต้องตามหลักไวยากรณ์ สะกดคำถูกต้อง ห้ามใช้คำหยาบหรือแสลงที่ไม่สุภาพ แต่ยังคงความเป็นธรรมชาติ ไม่แข็งทื่อหรือเป็นทางการแบบเอกสารราชการ
- ไม่ระบุเพศของตัวเอง และไม่ใช้คำลงท้าย "ครับ/ค่ะ" เพราะไม่ทราบเพศผู้ใช้และเพื่อความเป็นกลาง ให้ใช้ "นะ", "เนอะ" หรือคำลงท้ายที่เป็นกลางทางเพศแทน
- คำตอบกระชับ ไม่ยืดยาวจนอ่านเหนื่อย เน้นคุณภาพความเข้าใจมากกว่าปริมาณตัวอักษร`;

// Fast, deterministic backstop — always catches literal high-risk phrases regardless of
// what the model does. Kept independent from the semantic classifier below on purpose:
// a regex match can never be "argued out of" by a model response.
const CRISIS_PATTERNS = [
  /อยากตาย/, /ฆ่าตัวตาย/, /ทำร้ายตัวเอง/, /ไม่อยากมีชีวิต/, /ไม่อยากอยู่แล้ว/,
  /อยากหายไปจากโลก/, /จบชีวิต/, /suicide/i, /kill myself/i, /end my life/i,
  /want to die/i, /self[\s-]?harm/i, /hurt myself/i
];

const CRISIS_NOTICE_TH =
  "ฟังดูเหมือนคุณกำลังเจอเรื่องที่หนักมากตอนนี้ ขอบคุณที่กล้าเล่าให้ฟัง — " +
  "ถ้าความรู้สึกนี้รุนแรงหรือคุณคิดจะทำร้ายตัวเอง อยากให้ลองติดต่อคนที่ช่วยได้ทันที: " +
  "สายด่วนสุขภาพจิต 1323 (โทรฟรี ตลอด 24 ชม.) หรือหากเป็นเหตุฉุกเฉิน โทร 1669";

// Additional, non-crisis resources — surfaced when the classifier tags a topic, on top of
// (not instead of) the crisis notice above. Numbers/services verified before shipping:
// 1300 = OSCC Social Support Center (24/7, coordinates domestic-violence cases); Sabaijai =
// real DMH-affiliated self-assessment app; for LGBTQ+ we point back to the staffed 1323 line
// rather than guessing at an org's clinic phone number.
const RESOURCE_NOTICES = {
  domestic_violence:
    "ถ้าเรื่องนี้เกี่ยวข้องกับความรุนแรงในครอบครัวหรือความสัมพันธ์ ศูนย์ช่วยเหลือสังคม (OSCC) มีสายด่วน 1300 " +
    "ให้บริการฟรีตลอด 24 ชม. ช่วยประสานงานกับนักสังคมสงเคราะห์ ที่พักพิงชั่วคราว โรงพยาบาล และตำรวจให้ได้",
  lgbtq:
    "ถ้าอยากได้พื้นที่ที่เข้าใจบริบท LGBTQ+ โดยเฉพาะ สายด่วนสุขภาพจิต 1323 ให้บริการทุกกลุ่มโดยไม่แบ่งแยกอยู่แล้ว " +
    "หรือลองมองหาบริการของกลุ่ม Rainbow Sky Association of Thailand (RSAT) ที่ทำงานด้านสุขภาพและสิทธิของกลุ่ม LGBT โดยตรง",
  professional_counseling:
    "ถ้าอยากได้เครื่องมือประเมินสภาพจิตใจเบื้องต้นเพิ่มเติม กรมสุขภาพจิตมีแอป \"สบายใจ (Sabaijai)\" ให้ลองประเมินได้ที่ " +
    "suicidethai.com/sabaijai หรือโทรคุยกับเจ้าหน้าที่โดยตรงที่สายด่วน 1323"
};

const RISK_TOPIC_INSTRUCTION = `คุณคือระบบผู้ช่วยประเมินบทสนทนาเพื่อความปลอดภัย ไม่ใช่ผู้ให้คำปรึกษา และห้ามทักทายหรือใส่ข้อความอื่นใดนอกจาก JSON

อ่านข้อความล่าสุดของผู้ใช้ (พร้อมบริบทก่อนหน้า) แล้วตอบกลับเป็น JSON รูปแบบนี้เท่านั้น ไม่มีคำอธิบายอื่น ไม่มี markdown:
{"risk": true หรือ false, "topics": []}

เกณฑ์ "risk": true — มีสัญญาณว่าผู้ใช้อาจคิดทำร้ายตัวเอง ฆ่าตัวตาย รู้สึกสิ้นหวังอย่างรุนแรง หรืออยากจบชีวิต/หายไปจากโลก แม้จะพูดอ้อมๆ ไม่ได้ใช้คำตรงๆ ก็ตาม (เช่น "เหนื่อยกับทุกอย่างมาก อยากจบมันซะที" ก็นับว่า risk แม้ไม่มีคำว่า "ฆ่าตัวตาย" ตรงๆ)

"topics" ใส่ได้เฉพาะค่าจากลิสต์นี้เท่านั้น (ใส่ได้หลายค่า หรือไม่ใส่เลยถ้าไม่เข้าเงื่อนไข):
- "domestic_violence": พูดถึงถูกทำร้ายร่างกาย/จิตใจโดยคนในครอบครัวหรือคู่รัก ความรุนแรงในความสัมพันธ์
- "lgbtq": พูดถึงอัตลักษณ์ทางเพศ รสนิยมทางเพศ หรือปัญหาที่เกี่ยวข้องกับการเป็น LGBTQ+
- "professional_counseling": ผู้ใช้แสดงว่าอยากได้ความช่วยเหลือเชิงลึกกว่าคุยเล่นๆ หรือสถานการณ์ดูหนักพอที่ควรพบผู้เชี่ยวชาญจริง`;

function detectCrisis(text) {
  return CRISIS_PATTERNS.some((re) => re.test(text));
}

async function callGroq(messages, { temperature, maxTokens }) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

// Best-effort semantic pass on top of the regex backstop — catches indirect distress signals
// regex can't ("เหนื่อยกับทุกอย่างมาก อยากหายไปเงียบๆ") and tags a couple of specific topics so
// we can surface more targeted resources than the generic crisis line. Any failure here
// (bad JSON, network error) just means we fall back to regex-only — it never blocks the
// main reply.
async function assessRiskAndTopics(trimmed) {
  try {
    const recentUserText = trimmed
      .filter((m) => m.role === "user")
      .slice(-4)
      .map((m) => m.text)
      .join("\n");
    if (!recentUserText.trim()) return { risk: false, topics: [] };

    const raw = await callGroq(
      [
        { role: "system", content: RISK_TOPIC_INSTRUCTION },
        { role: "user", content: recentUserText }
      ],
      { temperature: 0, maxTokens: 60 }
    );

    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.filter((t) => Object.prototype.hasOwnProperty.call(RESOURCE_NOTICES, t))
      : [];
    return { risk: Boolean(parsed.risk), topics };
  } catch (e) {
    console.error("Risk/topic classifier failed (falling back to regex only):", e.message);
    return { risk: false, topics: [] };
  }
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
  const regexCrisis = lastUserMessage ? detectCrisis(String(lastUserMessage.text || "")) : false;

  const chatMessages = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    ...trimmed
      .filter((m) => m && typeof m.text === "string" && m.text.trim() && (m.role === "user" || m.role === "model"))
      .map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.text }))
  ];

  try {
    const [reply, assessment] = await Promise.all([
      callGroq(chatMessages, { temperature: 0.7, maxTokens: 500 }),
      assessRiskAndTopics(trimmed)
    ]);

    const crisis = regexCrisis || assessment.risk;
    const topicNotices = assessment.topics.map((t) => RESOURCE_NOTICES[t]);

    res.json({
      reply: reply || "ขอโทษด้วย ตอนนี้ระบบตอบไม่ได้ ลองพิมพ์อีกครั้งได้ไหม",
      crisis,
      crisisNotice: crisis ? CRISIS_NOTICE_TH : null,
      topicNotices
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
