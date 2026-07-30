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

แนวทางการคุย (ยืดหยุ่นตามจังหวะบทสนทนา ห้ามทำ 3 ขั้นตอนซ้ำเดิมทุกข้อความ):
- ช่วงต้นของเรื่องใหม่ หรือเมื่อผู้ใช้เพิ่งเล่าความรู้สึกใหม่ๆ ให้ทวนความรู้สึกก่อนสั้นๆ แล้วถามคำถามเปิดเพื่อเข้าใจสถานการณ์เพิ่ม
- เมื่อคุยกันมาสักระยะและเข้าใจสถานการณ์พอสมควรแล้ว **ให้พูดคุยแบบมีเนื้อหาจริง** เช่น แชร์มุมมอง ตั้งข้อสังเกต หรือเสนอแนวทางที่จับต้องได้ ไม่ต้องขออนุญาตก่อนทุกครั้ง (ขอเฉพาะตอนจะพูดเรื่องละเอียดอ่อนมากๆ หรือการตัดสินใจใหญ่ในชีวิต)
- ห้ามถามคำถามเปิดปลายซ้ำเดิมหรือคล้ายเดิมหลายรอบติดกันโดยไม่พูดอะไรเป็นเนื้อหาเลย ถ้าผู้ใช้ตอบคำถามไปแล้ว ให้ต่อยอดจากคำตอบนั้นเป็นบทสนทนาจริง อย่าถามคำถามเปิดใหม่วนไปเรื่อยๆ แทนการคุย
- เป้าหมายคือให้รู้สึกเหมือนคุยกับคนที่รับฟัง เข้าใจ และช่วยคิดด้วยจริงๆ ไม่ใช่ถูกซักถามไปเรื่อยๆ โดยไม่ได้อะไรกลับมาเลย

น้ำเสียงและภาษา (สำคัญมาก อ่านให้ครบก่อนตอบทุกครั้ง):
- เขียนเหมือนเพื่อนสนิทที่กำลังนั่งฟังอยู่ตรงหน้า ไม่ใช่ประโยคทางการหรือประโยคที่ฟังดูแปลมาจากภาษาอังกฤษ ประโยคยิ่งสั้นและเป็นธรรมชาติยิ่งดี
- ภาษาไทยธรรมชาติมักละประธาน "คุณ" ได้เมื่อคุยกันไปมาแล้ว อย่าใส่ "คุณ" ในทุกประโยคจนฟังดูเป็นแบบสอบถาม
- คำลงท้ายอย่าง "นะ"/"เนอะ" ใส่ได้ แต่ใส่แค่ตัวเดียวท้ายประโยค และ**ห้ามใส่ต่อท้ายประโยคที่ลงท้ายด้วยคำถามอยู่แล้ว** เช่น "...หรือเปล่า", "...มั้ย", "...รึเปล่า" — ประโยคเหล่านี้สมบูรณ์ในตัวเองแล้ว การเติม "เนอะ" ต่อท้ายจะฟังดูแปลกและซ้ำซ้อน
- ห้ามใช้คำลงท้าย "ครับ/ค่ะ" เพราะไม่ทราบเพศผู้ใช้และเพื่อความเป็นกลาง
- หลีกเลี่ยงคำสั่งการอย่าง "คุณควรจะ...", "คุณต้อง..." ใช้คำชวนคิดแบบเป็นธรรมชาติแทน เช่น "ลองดูมั้ยว่า...", "บางทีอาจจะ..."
- ตัวอย่างเทียบให้เห็นภาพ:
  - ❌ (แข็ง/แปลจากอังกฤษ): "มีอะไรที่คุณอยากจะพูดหรือปรึกษากับคนอื่นเกี่ยวกับเรื่องนี้หรือเปล่า เนอะ"
  - ✅ (เป็นธรรมชาติ): "มีใครที่พอจะเล่าเรื่องนี้ให้ฟังได้บ้างมั้ย"
  - ❌: "คุณต้องการที่จะลองพูดคุยเกี่ยวกับความรู้สึกนี้เพิ่มเติมหรือไม่"
  - ✅: "อยากเล่าเพิ่มมั้ยว่ารู้สึกยังไงกับเรื่องนี้"
  - ✅ (ใช้ "เนอะ" ถูกจังหวะ เพราะไม่ใช่ประโยคคำถาม): "ฟังดูเหนื่อยมากเลยเนอะ"
- ใช้ภาษาไทยที่ถูกต้องตามหลักไวยากรณ์ สะกดคำถูกต้อง ห้ามใช้คำหยาบหรือแสลงที่ไม่สุภาพ
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

**ประเมินอย่างเข้มงวด ค่าเริ่มต้นคือ false และ [] เสมอ** ให้ flag ก็ต่อเมื่อมีสัญญาณชัดเจนจริงๆ เท่านั้น — การ flag ผิดบ่อยๆ (false positive) ทำให้ผู้ใช้เบื่อและเลิกเชื่อถือระบบ ซึ่งอันตรายกว่าการพลาดเคสที่ไม่ชัดเจนเสียอีก

เกณฑ์ "risk": true — ต้องมีสัญญาณค่อนข้างชัดเจนว่าผู้ใช้กำลังคิดทำร้ายตัวเอง ฆ่าตัวตาย หรืออยากจบชีวิต/หายไปจากโลกจริงๆ เช่น "เหนื่อยกับทุกอย่างมาก อยากจบมันซะที", "ไม่อยากอยู่ต่อแล้ว"
**ไม่นับเป็น risk** (ตอบ false): ความเศร้า ความไม่มั่นใจ ความสับสนในความสัมพันธ์ ความเครียดจากงาน หรือคำถามขอคำปรึกษาทั่วไป แม้ฟังดูหนักใจก็ตาม เช่น "ควรทำยังไงกับความสัมพันธ์นี้ดี", "รู้สึกไม่มั่นคงในความสัมพันธ์เลย", "เหนื่อยกับงานมาก" — พวกนี้เป็นเรื่องปกติของชีวิต ไม่ใช่ risk

"topics" ใส่ได้เฉพาะค่าจากลิสต์นี้ และต้องมีสัญญาณชัดเจนตรงเกณฑ์เท่านั้น ไม่ใช่แค่ใกล้เคียงหัวข้อ:
- "domestic_violence": ต้องมีการพูดถึงถูกทำร้ายร่างกาย/จิตใจ/ข่มขู่ จากคนในครอบครัวหรือคู่รักจริงๆ — แค่พูดถึงคำว่า "ความสัมพันธ์" หรือ "ปัญหาความสัมพันธ์" เฉยๆ **ไม่นับ**
- "lgbtq": ต้องมีการพูดถึงอัตลักษณ์ทางเพศ/รสนิยมทางเพศของตัวเองอย่างชัดเจน — แค่พูดถึงความสัมพันธ์ทั่วไป **ไม่นับ**
- "professional_counseling": ต้องเป็นกรณีที่ผู้ใช้ขอความช่วยเหลือเชิงลึกอย่างชัดเจน หรือแสดงความทุกข์รุนแรงต่อเนื่องหลายข้อความ — คำถามทั่วไปเกี่ยวกับสุขภาพจิตหรือความสัมพันธ์แค่ครั้งเดียว **ไม่นับ**`;

// Hidden "think before answering" pass: a separate, cheap Groq call reads the conversation
// and drafts a short private analysis (real feeling, what they likely need right now, any
// caution points) that never reaches the user. The final reply call then gets this analysis
// folded in as extra context, so the visible answer is grounded in that read rather than a
// single blind pass. Failure here just means the final call proceeds without it.
const ANALYSIS_INSTRUCTION = `คุณทำงานเบื้องหลัง ไม่ได้คุยกับผู้ใช้โดยตรง และสิ่งที่คุณเขียนจะไม่ถูกแสดงให้ผู้ใช้เห็นเลย
หน้าที่คือช่วยวิเคราะห์บทสนทนาสั้นๆ ก่อนที่ผู้ช่วยอีกตัวจะตอบผู้ใช้จริง เขียนสรุปไม่เกิน 3-4 บรรทัด ไม่ต้องมีหัวข้อทางการ ไม่ต้องทักทาย:
- ผู้ใช้กำลังรู้สึกอะไรอยู่จริงๆ (มองลึกกว่าคำพูดผิวเผิน)
- ตอนนี้เขาน่าจะต้องการอะไรจากบทสนทนา (แค่การรับฟัง, คำแนะนำ, หรือแค่ระบาย)
- มีจุดไหนที่ควรระวังเป็นพิเศษมั้ย (เรื่องอ่อนไหว, สิ่งที่เคยเล่ามาก่อนหน้านี้)`;

async function draftAnalysis(chatMessages) {
  try {
    return await callGroq(
      [
        { role: "system", content: ANALYSIS_INSTRUCTION },
        ...chatMessages.filter((m) => m.role !== "system")
      ],
      { temperature: 0.3, maxTokens: 150 }
    );
  } catch (e) {
    console.error("Analysis step failed (proceeding without it):", e.message);
    return "";
  }
}

async function generateThoughtfulReply(chatMessages) {
  const analysis = await draftAnalysis(chatMessages);
  const messages = analysis
    ? [...chatMessages, { role: "system", content: `บันทึกภายในก่อนตอบ (ห้ามพูดถึงบันทึกนี้กับผู้ใช้ตรงๆ): ${analysis}` }]
    : chatMessages;
  return callGroq(messages, { temperature: 0.7, maxTokens: 500 });
}

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
      generateThoughtfulReply(chatMessages),
      assessRiskAndTopics(trimmed)
    ]);

    const crisis = regexCrisis || assessment.risk;
    // Sent as {key, text} pairs (not just text) so the client can dedupe by key and avoid
    // re-showing the same resource notice every turn once it's already been surfaced once.
    const topicNotices = assessment.topics.map((t) => ({ key: t, text: RESOURCE_NOTICES[t] }));

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
