// Conversation lives only in this variable, in this tab, for this page load.
// It is never written to localStorage/sessionStorage/cookies/any backend store —
// a refresh or navigating away wipes it completely, by design.
let conversation = [];

const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");

function renderMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderCrisisNotice(text) {
  const div = document.createElement("div");
  div.className = "msg crisis";
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  conversation.push({ role: "user", text });
  renderMessage("user", text);
  inputEl.value = "";
  sendBtn.disabled = true;

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
      renderCrisisNotice(data.crisisNotice);
    }
  } catch (err) {
    renderMessage("model", "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้งนะ");
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
});

clearBtn.addEventListener("click", () => {
  conversation = [];
  messagesEl.innerHTML = "";
});

renderMessage("model", "สวัสดีค่ะ/ครับ อยากเล่าอะไรให้ฟังบ้างวันนี้?");
