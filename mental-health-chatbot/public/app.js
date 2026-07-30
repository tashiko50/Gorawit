// Conversation lives only in this variable, in this tab, for this page load.
// It is never written to localStorage/sessionStorage/cookies/any backend store —
// a refresh or navigating away wipes it completely, by design.
let conversation = [];

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

async function sendText(text) {
  if (!text.trim()) return;

  conversation.push({ role: "user", text });
  renderMessage("user", text);
  sendBtn.disabled = true;
  topicChipsEl.querySelectorAll(".chip").forEach((c) => (c.disabled = true));

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation })
    });
    const data = await res.json();

    if (!res.ok) {
      renderMessage("model", "ขอโทษด้วย เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะ");
      return;
    }

    conversation.push({ role: "model", text: data.reply });
    renderMessage("model", data.reply);

    if (data.crisis && data.crisisNotice) {
      renderNotice("crisis", data.crisisNotice);
    }
    if (Array.isArray(data.topicNotices)) {
      data.topicNotices.forEach((notice) => renderNotice("resource", notice));
    }
  } catch (err) {
    renderMessage("model", "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้งนะ");
  } finally {
    sendBtn.disabled = false;
    topicChipsEl.querySelectorAll(".chip").forEach((c) => (c.disabled = false));
    topicChipsEl.style.display = "none"; // one-time starters, hide once the chat has begun
  }
}

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
