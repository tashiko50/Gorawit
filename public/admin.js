(function () {
  "use strict";

  var S = window.Scoreboard;
  var PIN_KEY = "scoreboardAdminPin";
  var POLL_MS = 3000;

  var boardEl = document.getElementById("board");
  var titleEl = document.getElementById("boardTitle");
  var saveFlash = document.getElementById("saveFlash");
  var pinOverlay = document.getElementById("pinOverlay");
  var pinInput = document.getElementById("pinInput");
  var pinError = document.getElementById("pinError");

  var cardRefs = new Map();
  var lastTeamOrder = "";
  var flashTimer = null;

  function flash(message, isError) {
    saveFlash.textContent = message;
    saveFlash.className = "save-flash show" + (isError ? " error" : "");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      saveFlash.className = "save-flash";
    }, 1800);
  }

  function getPin() {
    return localStorage.getItem(PIN_KEY) || "";
  }

  function showPinModal(message) {
    pinError.textContent = message || "";
    pinOverlay.hidden = false;
    pinInput.value = "";
    pinInput.focus();
  }

  function hidePinModal() {
    pinOverlay.hidden = true;
  }

  document.getElementById("pinBtn").addEventListener("click", function () {
    showPinModal("");
  });

  function submitPin() {
    var value = pinInput.value.trim();
    if (!value) return;
    localStorage.setItem(PIN_KEY, value);
    hidePinModal();
    flash("บันทึก PIN แล้ว ลองแก้ไขคะแนนได้เลย");
  }
  document.getElementById("pinSubmit").addEventListener("click", submitPin);
  pinInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submitPin(); }
  });

  function postAction(type, teamId, payload) {
    return fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-pin": getPin() },
      body: JSON.stringify({ type: type, teamId: teamId, payload: payload || {} })
    }).then(function (res) {
      if (res.status === 401) {
        localStorage.removeItem(PIN_KEY);
        showPinModal("PIN ไม่ถูกต้อง กรุณากรอกใหม่");
        throw new Error("invalid_pin");
      }
      if (!res.ok) {
        flash("เกิดข้อผิดพลาด ลองใหม่อีกครั้ง", true);
        throw new Error("action_failed");
      }
      return res.json();
    }).then(function (data) {
      render(data);
      return data;
    }).catch(function (err) {
      if (err.message !== "invalid_pin") console.error(err);
      return null;
    });
  }

  function buildAdminCard(team) {
    var visual = S.buildHousePlot(team);
    var card = document.createElement("div");
    card.className = "team-card";
    card.style.setProperty("--accent", team.color);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-btn";
    removeBtn.setAttribute("aria-label", "ลบทีมนี้");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", function () {
      if (window.confirm("ลบทีม \"" + team.name + "\" ใช่ไหม?")) {
        postAction("removeTeam", team.id);
      }
    });
    card.appendChild(removeBtn);

    var nameEl = document.createElement("div");
    nameEl.className = "team-name";
    nameEl.contentEditable = "true";
    nameEl.spellcheck = false;
    nameEl.textContent = team.name;
    nameEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); nameEl.blur(); }
    });
    nameEl.addEventListener("blur", function () {
      var value = nameEl.textContent.trim();
      if (value && value !== team.name) postAction("renameTeam", team.id, { name: value });
      else nameEl.textContent = team.name;
    });
    card.appendChild(nameEl);

    var palette = document.createElement("div");
    palette.className = "palette";
    S.PALETTE.forEach(function (hex) {
      var dot = document.createElement("button");
      dot.type = "button";
      dot.style.background = hex;
      dot.dataset.hex = hex.toLowerCase();
      dot.setAttribute("aria-label", "สี " + hex);
      dot.setAttribute("aria-pressed", String(hex.toLowerCase() === team.color.toLowerCase()));
      dot.addEventListener("click", function () { postAction("setColor", team.id, { color: hex }); });
      palette.appendChild(dot);
    });
    card.appendChild(palette);

    card.appendChild(visual.plot);

    var levelRow = document.createElement("div");
    levelRow.className = "level-row";
    var levelMinus = document.createElement("button");
    levelMinus.type = "button"; levelMinus.className = "step-btn"; levelMinus.textContent = "−";
    levelMinus.setAttribute("aria-label", "ลดระดับบ้าน");
    levelMinus.addEventListener("click", function () { postAction("adjustLevel", team.id, { delta: -1 }); });
    var levelLabel = document.createElement("div");
    levelLabel.className = "level-badge";
    levelLabel.textContent = "ระดับบ้าน " + team.level;
    var levelPlus = document.createElement("button");
    levelPlus.type = "button"; levelPlus.className = "step-btn"; levelPlus.textContent = "+";
    levelPlus.setAttribute("aria-label", "อัปเกรดบ้าน");
    levelPlus.addEventListener("click", function () { postAction("adjustLevel", team.id, { delta: 1 }); });
    levelRow.appendChild(levelMinus);
    levelRow.appendChild(levelLabel);
    levelRow.appendChild(levelPlus);
    card.appendChild(levelRow);

    var scoreCard = document.createElement("div");
    scoreCard.className = "score-card";

    var pointsGroup = document.createElement("div");
    pointsGroup.className = "points-group";
    var minusBtn = document.createElement("button");
    minusBtn.type = "button"; minusBtn.className = "step-btn"; minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", "ลดคะแนน");
    minusBtn.addEventListener("click", function () { postAction("adjustPoints", team.id, { delta: -1 }); });

    var pointsInput = document.createElement("input");
    pointsInput.type = "number"; pointsInput.className = "points-input"; pointsInput.value = team.points; pointsInput.inputMode = "numeric";
    pointsInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); pointsInput.blur(); } });
    pointsInput.addEventListener("blur", function () {
      var n = parseInt(pointsInput.value, 10);
      if (isNaN(n)) n = 0;
      if (n !== team.points) postAction("setPoints", team.id, { points: n });
      else pointsInput.value = team.points;
    });

    var plusBtn = document.createElement("button");
    plusBtn.type = "button"; plusBtn.className = "step-btn"; plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "เพิ่มคะแนน");
    plusBtn.addEventListener("click", function () { postAction("adjustPoints", team.id, { delta: 1 }); });

    var ptsCol = document.createElement("div");
    ptsCol.className = "pts-col";
    ptsCol.appendChild(pointsInput);
    var ptsLabel = document.createElement("div");
    ptsLabel.className = "pts-label"; ptsLabel.textContent = "pts";
    ptsCol.appendChild(ptsLabel);

    pointsGroup.appendChild(minusBtn);
    pointsGroup.appendChild(ptsCol);
    pointsGroup.appendChild(plusBtn);
    scoreCard.appendChild(pointsGroup);

    var tokenGroup = document.createElement("div");
    tokenGroup.className = "token-group";
    var tokenCycle = document.createElement("button");
    tokenCycle.type = "button"; tokenCycle.className = "token-cycle";
    tokenCycle.setAttribute("aria-label", "เปลี่ยนไอคอนรางวัล");
    var tokenIconSpan = document.createElement("span");
    tokenIconSpan.className = "token-icon";
    tokenIconSpan.innerHTML = S.TOKEN_ICONS[team.tokenType] || S.TOKEN_ICONS.star;
    tokenCycle.appendChild(tokenIconSpan);
    tokenCycle.addEventListener("click", function () {
      var idx = S.TOKEN_TYPES.indexOf(team.tokenType);
      var next = S.TOKEN_TYPES[(idx + 1) % S.TOKEN_TYPES.length];
      postAction("setTokenType", team.id, { tokenType: next });
    });
    var tokenMinus = document.createElement("button");
    tokenMinus.type = "button"; tokenMinus.className = "step-btn"; tokenMinus.style.width = "18px"; tokenMinus.style.height = "18px"; tokenMinus.textContent = "−";
    tokenMinus.setAttribute("aria-label", "ลดจำนวนรางวัล");
    tokenMinus.addEventListener("click", function (e) { e.stopPropagation(); postAction("adjustTokenCount", team.id, { delta: -1 }); });
    var tokenCountInput = document.createElement("input");
    tokenCountInput.type = "number"; tokenCountInput.className = "token-count-input"; tokenCountInput.value = team.tokenCount; tokenCountInput.inputMode = "numeric";
    tokenCountInput.addEventListener("click", function (e) { e.stopPropagation(); });
    tokenCountInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); tokenCountInput.blur(); } });
    tokenCountInput.addEventListener("blur", function () {
      var n = parseInt(tokenCountInput.value, 10);
      if (isNaN(n) || n < 0) n = 0;
      if (n !== team.tokenCount) postAction("adjustTokenCount", team.id, { delta: n - team.tokenCount });
      else tokenCountInput.value = team.tokenCount;
    });
    var tokenPlus = document.createElement("button");
    tokenPlus.type = "button"; tokenPlus.className = "step-btn"; tokenPlus.style.width = "18px"; tokenPlus.style.height = "18px"; tokenPlus.textContent = "+";
    tokenPlus.setAttribute("aria-label", "เพิ่มจำนวนรางวัล");
    tokenPlus.addEventListener("click", function (e) { e.stopPropagation(); postAction("adjustTokenCount", team.id, { delta: 1 }); });

    tokenGroup.appendChild(tokenCycle);
    tokenGroup.appendChild(tokenMinus);
    tokenGroup.appendChild(tokenCountInput);
    tokenGroup.appendChild(tokenPlus);
    scoreCard.appendChild(tokenGroup);

    card.appendChild(scoreCard);

    var decorToggle = document.createElement("button");
    decorToggle.type = "button";
    decorToggle.className = "decor-toggle";
    decorToggle.textContent = "🌿 ตกแต่งหมู่บ้าน ▾";
    var decorPanel = document.createElement("div");
    decorPanel.className = "decor-panel";
    decorToggle.addEventListener("click", function () {
      var open = decorPanel.classList.toggle("open");
      decorToggle.textContent = "🌿 ตกแต่งหมู่บ้าน " + (open ? "▴" : "▾");
    });

    var decorRefs = {};
    S.DECORATION_TYPES.forEach(function (type) {
      var row = document.createElement("div");
      row.className = "decor-row";
      var labelWrap = document.createElement("div");
      labelWrap.className = "decor-label";
      var iconSpan = document.createElement("span");
      iconSpan.className = "decor-icon";
      iconSpan.innerHTML = S.DECOR_ICONS[type] || "";
      labelWrap.appendChild(iconSpan);
      var labelText = document.createElement("span");
      labelText.textContent = S.DECORATION_LABELS[type];
      labelWrap.appendChild(labelText);
      row.appendChild(labelWrap);

      var controls = document.createElement("div");
      controls.className = "decor-controls";
      var minus = document.createElement("button");
      minus.type = "button"; minus.className = "step-btn"; minus.style.width = "18px"; minus.style.height = "18px"; minus.textContent = "−";
      minus.addEventListener("click", function () { postAction("adjustDecoration", team.id, { decoType: type, delta: -1 }); });
      var countSpan = document.createElement("span");
      countSpan.className = "decor-count";
      countSpan.textContent = team.decorations[type] || 0;
      var plus = document.createElement("button");
      plus.type = "button"; plus.className = "step-btn"; plus.style.width = "18px"; plus.style.height = "18px"; plus.textContent = "+";
      plus.addEventListener("click", function () { postAction("adjustDecoration", team.id, { decoType: type, delta: 1 }); });
      controls.appendChild(minus);
      controls.appendChild(countSpan);
      controls.appendChild(plus);
      row.appendChild(controls);

      decorPanel.appendChild(row);
      decorRefs[type] = { countSpan: countSpan };
    });

    card.appendChild(decorToggle);
    card.appendChild(decorPanel);

    cardRefs.set(team.id, {
      card: card, nameEl: nameEl, palette: palette, house: visual.house, decorLayer: visual.decorLayer,
      levelLabel: levelLabel, levelMinus: levelMinus, levelPlus: levelPlus,
      pointsInput: pointsInput, tokenIconSpan: tokenIconSpan, tokenCountInput: tokenCountInput,
      decorRefs: decorRefs
    });

    return card;
  }

  function buildAddCard() {
    var addCard = document.createElement("button");
    addCard.type = "button";
    addCard.className = "add-card";
    addCard.innerHTML = '<span class="plus-circle">+</span><span>เพิ่มทีมใหม่</span>';
    addCard.addEventListener("click", function () {
      postAction("addTeam", null).then(function (data) {
        if (data && data.createdTeamId) {
          var refs = cardRefs.get(data.createdTeamId);
          if (refs) {
            var range = document.createRange();
            range.selectNodeContents(refs.nameEl);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            refs.nameEl.focus();
          }
        }
      });
    });
    return addCard;
  }

  function fullRebuild(state) {
    boardEl.innerHTML = "";
    cardRefs.clear();
    state.teams.forEach(function (team) { boardEl.appendChild(buildAdminCard(team)); });
    boardEl.appendChild(buildAddCard());
    lastTeamOrder = state.teams.map(function (t) { return t.id; }).join(",");
  }

  function updateCard(team) {
    var refs = cardRefs.get(team.id);
    if (!refs) return;

    refs.card.style.setProperty("--accent", team.color);
    if (document.activeElement !== refs.nameEl) refs.nameEl.textContent = team.name;
    Array.prototype.forEach.call(refs.palette.children, function (dot) {
      dot.setAttribute("aria-pressed", String(dot.dataset.hex === team.color.toLowerCase()));
    });

    refs.house.dataset.level = String(team.level);
    refs.house.style.setProperty("--accent", team.color);
    refs.levelLabel.textContent = "ระดับบ้าน " + team.level;
    refs.levelMinus.disabled = team.level <= 1;
    refs.levelPlus.disabled = team.level >= 3;

    var accessoryEl = refs.house.querySelector(".accessory");
    if (accessoryEl) accessoryEl.innerHTML = S.ACCESSORY_ICONS[team.tokenType] || S.ACCESSORY_ICONS.star;
    S.renderDecorLayer(refs.decorLayer, team.decorations);

    if (document.activeElement !== refs.pointsInput) refs.pointsInput.value = team.points;
    refs.tokenIconSpan.innerHTML = S.TOKEN_ICONS[team.tokenType] || S.TOKEN_ICONS.star;
    if (document.activeElement !== refs.tokenCountInput) refs.tokenCountInput.value = team.tokenCount;

    S.DECORATION_TYPES.forEach(function (type) {
      var r = refs.decorRefs[type];
      if (r) r.countSpan.textContent = team.decorations[type] || 0;
    });
  }

  function render(state) {
    var order = state.teams.map(function (t) { return t.id; }).join(",");
    if (order !== lastTeamOrder) {
      fullRebuild(state);
    } else {
      state.teams.forEach(updateCard);
    }
    if (document.activeElement !== titleEl) titleEl.textContent = state.title;
  }

  titleEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); } });
  titleEl.addEventListener("blur", function () {
    var value = titleEl.textContent.trim();
    if (value) postAction("renameBoard", null, { title: value });
  });

  document.getElementById("addTeamBtn").addEventListener("click", function () {
    document.querySelector(".add-card").click();
  });

  document.getElementById("resetBtn").addEventListener("click", function () {
    if (window.confirm("รีเซ็ตสกอร์บอร์ดทั้งหมดกลับเป็นค่าเริ่มต้นใช่ไหม? การกระทำนี้ย้อนกลับไม่ได้")) {
      postAction("resetAll", null);
    }
  });

  function poll() {
    fetch("/api/state").then(function (res) { return res.json(); }).then(render).catch(function () {});
  }

  poll();
  setInterval(poll, POLL_MS);
  if (!getPin()) showPinModal("");
})();
