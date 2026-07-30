// Conversation lives only in this variable, in this tab, for this page load.
// It is never written to localStorage/sessionStorage/cookies/any backend store —
// a refresh or navigating away wipes it completely, by design.
let conversation = [];
// Tracks which resource-notice keys (e.g. "domestic_violence") have already been shown
// this conversation, so a repeat classification doesn't spam the same notice every turn.
const shownTopics = new Set();

const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const downloadBtn = document.getElementById("downloadBtn");
const topicChipsEl = document.getElementById("topicChips");
const micBtn = document.getElementById("micBtn");
const ttsBtn = document.getElementById("ttsBtn");
const breatheBtn = document.getElementById("breatheBtn");
const breatheOverlay = document.getElementById("breatheOverlay");
const breatheLabel = document.getElementById("breatheLabel");
const breatheCloseBtn = document.getElementById("breatheCloseBtn");
const helpFab = document.getElementById("helpFab");
const helpPanel = document.getElementById("helpPanel");
const helpPanelClose = document.getElementById("helpPanelClose");
const fontDecBtn = document.getElementById("fontDecBtn");
const fontIncBtn = document.getElementById("fontIncBtn");
const moodLayer = document.getElementById("moodLayer");

// Ambient mood tint — two overlay divs crossfaded via opacity (see style.css .mood-layer).
// "calm" is the default/neutral state: no overlay, just the base gradient.
const MOODS = ["heavy", "warm"];
MOODS.forEach((m) => {
  const div = document.createElement("div");
  div.className = `mood-${m}`;
  moodLayer.appendChild(div);
});

function setMood(mood) {
  MOODS.forEach((m) => {
    moodLayer.querySelector(`.mood-${m}`).classList.toggle("active", mood === m);
  });
}

let ttsEnabled = false;
function speak(text) {
  if (!ttsEnabled || !("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "th-TH";
  window.speechSynthesis.speak(utter);
}

function renderMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderNotice(className, text) {
  const div = document.createElement("div");
  div.className = `msg ${className}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "typing-indicator";
  div.id = "typingIndicator";
  div.innerHTML = "<span></span><span></span><span></span>";
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

function createStreamingBubble() {
  const div = document.createElement("div");
  div.className = "msg model";
  const textSpan = document.createElement("span");
  textSpan.className = "typed-text";
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  cursor.textContent = "▌";
  div.appendChild(textSpan);
  div.appendChild(cursor);
  messagesEl.appendChild(div);
  return { div, textSpan, cursor };
}

// Groq's inference is fast enough that a whole reply can arrive within a few hundred ms —
// rendering each network chunk the instant it lands would make the "typing" feel skip past
// too fast to register as motion. So the reveal is decoupled from network speed entirely:
// chunks just accumulate into a buffer, and a fixed-pace loop drains it into the DOM a few
// characters at a time. Content is always real (never fabricated ahead of arrival) — only the
// reveal *pace* is deliberate, same technique many chat UIs use to smooth out bursty delivery.
const MIN_THINKING_MS = 1100; // guarantees a visible "thinking" pause even on an instant reply
const REVEAL_CHARS_PER_TICK = 2;
const REVEAL_INTERVAL_MS = 35; // ~57 chars/sec — closer to watching someone actually type

async function sendText(text) {
  if (!text.trim()) return;

  conversation.push({ role: "user", text });
  renderMessage("user", text);
  sendBtn.disabled = true;
  topicChipsEl.querySelectorAll(".chip").forEach((c) => (c.disabled = true));
  showTyping();
  const startedAt = Date.now();

  let bubble = null;
  let bubbleReady = false;
  let accumulated = "";
  let revealed = "";
  let revealTimer = null;
  let doneData = null;

  function startRevealLoop() {
    if (revealTimer) return;
    revealTimer = setInterval(() => {
      if (revealed.length < accumulated.length) {
        revealed = accumulated.slice(0, revealed.length + REVEAL_CHARS_PER_TICK);
        bubble.textSpan.textContent = revealed;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }, REVEAL_INTERVAL_MS);
  }

  async function ensureBubbleReady() {
    if (bubbleReady) return;
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_THINKING_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_THINKING_MS - elapsed));
    }
    hideTyping();
    bubble = createStreamingBubble();
    bubbleReady = true;
    startRevealLoop();
  }

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation })
    });

    if (!res.ok || !res.body) {
      hideTyping();
      renderMessage("model", "ขอโทษด้วย เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะ");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.type === "chunk") {
          accumulated += event.text;
          if (!bubbleReady) await ensureBubbleReady();
        } else if (event.type === "done") {
          doneData = event;
        } else if (event.type === "error") {
          hideTyping();
          renderMessage("model", "ขอโทษด้วย เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะ");
        }
      }
    }

    // Network side is done, but the paced reveal may still be catching up — let it finish
    // draining the buffer before wrapping up, so the animation always plays out in full.
    if (bubbleReady) {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (revealed.length >= accumulated.length) {
            clearInterval(check);
            clearInterval(revealTimer);
            revealTimer = null;
            resolve();
          }
        }, REVEAL_INTERVAL_MS);
      });
    }

    hideTyping();
    if (bubble) bubble.cursor.remove();

    if (!accumulated && doneData && doneData.reply) {
      accumulated = doneData.reply;
      if (!bubble) bubble = createStreamingBubble();
      bubble.textSpan.textContent = accumulated;
      bubble.cursor.remove();
    }
    if (accumulated) {
      conversation.push({ role: "model", text: accumulated });
      speak(accumulated);
    }

    if (doneData) {
      if (doneData.mood) setMood(doneData.mood);
      if (doneData.crisis && doneData.crisisNotice) {
        renderNotice("crisis", doneData.crisisNotice);
      }
      if (Array.isArray(doneData.topicNotices)) {
        doneData.topicNotices.forEach(({ key, text }) => {
          if (shownTopics.has(key)) return;
          shownTopics.add(key);
          renderNotice("resource", text);
        });
      }
    }
  } catch (err) {
    if (revealTimer) clearInterval(revealTimer);
    hideTyping();
    renderMessage("model", "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้งนะ");
  } finally {
    sendBtn.disabled = false;
    topicChipsEl.querySelectorAll(".chip").forEach((c) => (c.disabled = false));
    topicChipsEl.style.display = "none"; // one-time starters, hide once the chat has begun
  }
}

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  await sendText(text);
  inputEl.focus();
});

topicChipsEl.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => sendText(chip.dataset.message));
});

function resetConversation() {
  conversation = [];
  shownTopics.clear();
  messagesEl.innerHTML = "";
  topicChipsEl.style.display = "flex";
  setMood("calm");
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

clearBtn.addEventListener("click", () => {
  const bubbles = Array.from(messagesEl.children);
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion || !bubbles.length) {
    resetConversation();
    return;
  }

  // A deliberate "release" moment rather than an instant wipe — the words visibly dissolve
  // away, matching the fact that they're never actually stored anywhere once gone.
  bubbles.forEach((el, i) => {
    el.style.animationDelay = `${i * 40}ms`;
    el.classList.add("dissolving");
  });
  setTimeout(resetConversation, bubbles.length * 40 + 700);
});

downloadBtn.addEventListener("click", () => {
  if (!conversation.length) return;
  const lines = conversation.map((m) => `${m.role === "user" ? "เรา" : "ที่ปรึกษาใจ"}: ${m.text}`);
  const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `บทสนทนา-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// Font size — in-memory only, resets on refresh like everything else here.
const FONT_SCALE_MIN = 0.875;
const FONT_SCALE_MAX = 1.375;
const FONT_SCALE_STEP = 0.125;
let fontScale = 1;
function applyFontScale() {
  document.documentElement.style.fontSize = `${16 * fontScale}px`;
}
fontDecBtn.addEventListener("click", () => {
  fontScale = Math.max(FONT_SCALE_MIN, +(fontScale - FONT_SCALE_STEP).toFixed(3));
  applyFontScale();
});
fontIncBtn.addEventListener("click", () => {
  fontScale = Math.min(FONT_SCALE_MAX, +(fontScale + FONT_SCALE_STEP).toFixed(3));
  applyFontScale();
});

// Floating emergency-help panel — reachable any time, not gated behind AI detection.
helpFab.addEventListener("click", () => {
  helpPanel.hidden = !helpPanel.hidden;
});
helpPanelClose.addEventListener("click", () => {
  helpPanel.hidden = true;
});
document.addEventListener("click", (e) => {
  if (!helpPanel.hidden && !helpPanel.contains(e.target) && e.target !== helpFab) {
    helpPanel.hidden = true;
  }
});

// Breathing exercise — circle animation is 8s (4s inhale, 4s exhale) via CSS; the label
// swaps in step with it since both start together the moment the overlay unhides.
let breatheInterval = null;
function openBreathe() {
  breatheOverlay.hidden = false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    breatheLabel.textContent = "หายใจเข้าลึกๆ แล้วค่อยๆ ผ่อนออก ทำซ้ำสัก 4-5 รอบ";
    return;
  }
  let phase = "in";
  breatheLabel.textContent = "หายใจเข้า...";
  breatheInterval = setInterval(() => {
    phase = phase === "in" ? "out" : "in";
    breatheLabel.textContent = phase === "in" ? "หายใจเข้า..." : "หายใจออก...";
  }, 4000);
}
function closeBreathe() {
  breatheOverlay.hidden = true;
  if (breatheInterval) {
    clearInterval(breatheInterval);
    breatheInterval = null;
  }
}
breatheBtn.addEventListener("click", openBreathe);
breatheCloseBtn.addEventListener("click", closeBreathe);
breatheOverlay.addEventListener("click", (e) => {
  if (e.target === breatheOverlay) closeBreathe();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!helpPanel.hidden) helpPanel.hidden = true;
  if (!breatheOverlay.hidden) closeBreathe();
});

// Voice input — feature-detected; the mic button stays hidden entirely on browsers without
// SpeechRecognition (notably Firefox) instead of showing a button that would just fail.
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognitionCtor) {
  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "th-TH";
  recognition.interimResults = true;
  recognition.continuous = false;
  let listening = false;

  recognition.onstart = () => {
    listening = true;
    micBtn.classList.add("recording");
  };
  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove("recording");
  };
  recognition.onerror = () => {
    listening = false;
    micBtn.classList.remove("recording");
  };
  recognition.onresult = (e) => {
    let transcript = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    inputEl.value = transcript;
  };

  micBtn.hidden = false;
  micBtn.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch {
        // already running or mic permission not granted yet — ignore
      }
    }
  });
}

// Voice output — feature-detected; speak() (defined earlier) checks ttsEnabled itself.
if ("speechSynthesis" in window) {
  ttsBtn.hidden = false;
  ttsBtn.addEventListener("click", () => {
    ttsEnabled = !ttsEnabled;
    ttsBtn.classList.toggle("active", ttsEnabled);
    ttsBtn.textContent = ttsEnabled ? "🔊 กำลังอ่านออกเสียง" : "🔊 อ่านออกเสียง";
    if (!ttsEnabled) window.speechSynthesis.cancel();
  });
}

renderMessage("model", "สวัสดีนะ อยากเล่าอะไรให้ฟังบ้างวันนี้?");
