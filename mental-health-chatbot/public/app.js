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

async function sendText(text) {
  if (!text.trim()) return;

  conversation.push({ role: "user", text });
  renderMessage("user", text);
  sendBtn.disabled = true;
  topicChipsEl.querySelectorAll(".chip").forEach((c) => (c.disabled = true));
  showTyping();

  let bubble = null;
  let accumulated = "";
  let doneData = null;

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
          if (!bubble) {
            hideTyping();
            bubble = createStreamingBubble();
          }
          accumulated += event.text;
          bubble.textSpan.textContent = accumulated;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } else if (event.type === "done") {
          doneData = event;
        } else if (event.type === "error") {
          hideTyping();
          renderMessage("model", "ขอโทษด้วย เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะ");
        }
      }
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
    }

    if (doneData) {
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

clearBtn.addEventListener("click", () => {
  conversation = [];
  shownTopics.clear();
  messagesEl.innerHTML = "";
  topicChipsEl.style.display = "flex";
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

renderMessage("model", "สวัสดีนะ อยากเล่าอะไรให้ฟังบ้างวันนี้?");
