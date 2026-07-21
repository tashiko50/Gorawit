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
    flash("บันทึก PIN แล้ว ลองแก้ไขระยะทางได้เลย");
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

    var levelBadge = document.createElement("div");
    levelBadge.className = "level-badge";
    card.appendChild(levelBadge);

    var levelProgress = document.createElement("div");
    levelProgress.className = "level-progress";
    card.appendChild(levelProgress);

    var scoreCard = document.createElement("div");
    scoreCard.className = "score-card";

    var pointsGroup = document.createElement("div");
    pointsGroup.className = "points-group";
    var minusBtn = document.createElement("button");
    minusBtn.type = "button"; minusBtn.className = "step-btn"; minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", "ลดระยะทาง");
    minusBtn.addEventListener("click", function () { postAction("adjustKm", team.id, { delta: -1 }); });

    var kmInput = document.createElement("input");
    kmInput.type = "number"; kmInput.className = "points-input"; kmInput.value = team.km; kmInput.inputMode = "numeric";
    kmInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); kmInput.blur(); } });
    kmInput.addEventListener("blur", function () {
      var n = parseInt(kmInput.value, 10);
      if (isNaN(n)) n = 0;
      if (n !== team.km) postAction("setKm", team.id, { km: n });
      else kmInput.value = team.km;
    });

    var plusBtn = document.createElement("button");
    plusBtn.type = "button"; plusBtn.className = "step-btn"; plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "เพิ่มระยะทาง");
    plusBtn.addEventListener("click", function () { postAction("adjustKm", team.id, { delta: 1 }); });

    var ptsCol = document.createElement("div");
    ptsCol.className = "pts-col";
    ptsCol.appendChild(kmInput);
    var ptsLabel = document.createElement("div");
    ptsLabel.className = "pts-label"; ptsLabel.textContent = "กม.";
    ptsCol.appendChild(ptsLabel);

    pointsGroup.appendChild(minusBtn);
    pointsGroup.appendChild(ptsCol);
    pointsGroup.appendChild(plusBtn);
    scoreCard.appendChild(pointsGroup);
    scoreCard.appendChild(S.buildRunIcon());

    card.appendChild(scoreCard);

    cardRefs.set(team.id, {
      card: card, nameEl: nameEl, palette: palette, house: visual.house, plot: visual.plot, decorLayer: visual.decorLayer,
      levelBadge: levelBadge, levelProgress: levelProgress, kmInput: kmInput,
      lastLevel: S.levelForKm(team.km), lastMilestoneName: S.milestoneNameForLevel(S.levelForKm(team.km))
    });

    updateLevelText(levelBadge, levelProgress, team);
    return card;
  }

  function updateLevelText(levelBadge, levelProgress, team) {
    var level = S.levelForKm(team.km);
    levelBadge.textContent = "ระดับ " + level + " · " + S.milestoneNameForLevel(level);
    var toNext = S.kmToNextLevel(team.km);
    levelProgress.textContent = "อีก " + toNext + " กม. ถึงระดับถัดไป";
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

    var newLevel = S.levelForKm(team.km);
    S.updateHouseVisual(refs, team);
    updateLevelText(refs.levelBadge, refs.levelProgress, team);
    if (document.activeElement !== refs.kmInput) refs.kmInput.value = team.km;

    if (newLevel > refs.lastLevel) {
      var newMilestoneName = S.milestoneNameForLevel(newLevel);
      var milestoneChanged = newMilestoneName !== refs.lastMilestoneName;
      var big = milestoneChanged || S.isNotableLevel(newLevel);
      S.celebrateUpgrade(refs.plot, big, big ? S.celebrationTextForLevel(newLevel, milestoneChanged) : null);
      refs.lastMilestoneName = newMilestoneName;
    }
    refs.lastLevel = newLevel;
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

  var sceneEl = document.querySelector(".scene-sky");
  S.applyWeather(sceneEl);
  setInterval(function () { S.applyWeather(sceneEl); }, 30000);

  poll();
  setInterval(poll, POLL_MS);
  if (!getPin()) showPinModal("");
})();
