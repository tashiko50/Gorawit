(function () {
  "use strict";

  var S = window.Scoreboard;
  var POLL_MS = 3000;

  var boardEl = document.getElementById("board");
  var titleEl = document.getElementById("boardTitle");
  var feedListEl = document.getElementById("feedList");
  var lastUpdatedEl = document.getElementById("lastUpdated");

  var cardRefs = new Map();
  var lastTeamOrder = "";
  var lastEventIds = "";
  var lastFetchTs = null;

  function relativeTime(ts) {
    var diff = Math.max(0, Date.now() - ts);
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return "เมื่อสักครู่";
    if (mins < 60) return mins + " นาทีที่แล้ว";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + " ชั่วโมงที่แล้ว";
    var days = Math.floor(hours / 24);
    return days + " วันที่แล้ว";
  }

  function buildViewCard(team) {
    var visual = S.buildHousePlot(team);
    var card = document.createElement("div");
    card.className = "team-card";
    card.style.setProperty("--accent", team.color);

    var nameEl = document.createElement("div");
    nameEl.className = "team-name";
    nameEl.textContent = team.name;
    card.appendChild(nameEl);

    var levelEl = document.createElement("div");
    levelEl.className = "level-badge";
    levelEl.textContent = "ระดับบ้าน " + team.level;
    card.appendChild(levelEl);

    card.appendChild(visual.plot);

    var scoreCard = document.createElement("div");
    scoreCard.className = "score-card";

    var scoreWrap = document.createElement("div");
    scoreWrap.className = "view-score";
    var pointsEl = document.createElement("span");
    pointsEl.className = "view-points";
    pointsEl.textContent = team.points;
    var ptsLabel = document.createElement("span");
    ptsLabel.className = "view-pts-label";
    ptsLabel.textContent = "pts";
    scoreWrap.appendChild(pointsEl);
    scoreWrap.appendChild(ptsLabel);
    scoreCard.appendChild(scoreWrap);

    var tokenGroup = document.createElement("div");
    tokenGroup.className = "token-group";
    var tokenIconSpan = document.createElement("span");
    tokenIconSpan.className = "token-icon";
    tokenIconSpan.innerHTML = S.TOKEN_ICONS[team.tokenType] || S.TOKEN_ICONS.star;
    var tokenCountEl = document.createElement("span");
    tokenCountEl.className = "token-count";
    tokenCountEl.textContent = team.tokenCount;
    tokenGroup.appendChild(tokenIconSpan);
    tokenGroup.appendChild(tokenCountEl);
    scoreCard.appendChild(tokenGroup);

    card.appendChild(scoreCard);

    cardRefs.set(team.id, {
      card: card, nameEl: nameEl, levelEl: levelEl, house: visual.house, decorLayer: visual.decorLayer,
      pointsEl: pointsEl, tokenIconSpan: tokenIconSpan, tokenCountEl: tokenCountEl
    });
    return card;
  }

  function fullRebuild(state) {
    boardEl.innerHTML = "";
    cardRefs.clear();
    state.teams.forEach(function (team) { boardEl.appendChild(buildViewCard(team)); });
    lastTeamOrder = state.teams.map(function (t) { return t.id; }).join(",");
  }

  function updateCard(team) {
    var refs = cardRefs.get(team.id);
    if (!refs) return;
    refs.card.style.setProperty("--accent", team.color);
    refs.nameEl.textContent = team.name;
    refs.levelEl.textContent = "ระดับบ้าน " + team.level;
    refs.house.dataset.level = String(team.level);
    refs.house.style.setProperty("--accent", team.color);
    var accessoryEl = refs.house.querySelector(".accessory");
    if (accessoryEl) accessoryEl.innerHTML = S.ACCESSORY_ICONS[team.tokenType] || S.ACCESSORY_ICONS.star;
    S.renderDecorLayer(refs.decorLayer, team.decorations);
    refs.pointsEl.textContent = team.points;
    refs.tokenIconSpan.innerHTML = S.TOKEN_ICONS[team.tokenType] || S.TOKEN_ICONS.star;
    refs.tokenCountEl.textContent = team.tokenCount;
  }

  function renderFeed(events) {
    var ids = events.map(function (e) { return e.id; }).join(",");
    if (ids === lastEventIds) return;
    lastEventIds = ids;
    feedListEl.innerHTML = "";
    if (!events.length) {
      var empty = document.createElement("li");
      empty.className = "feed-empty";
      empty.textContent = "ยังไม่มีความเคลื่อนไหว";
      feedListEl.appendChild(empty);
      return;
    }
    events.forEach(function (event) {
      var li = document.createElement("li");
      li.className = "feed-item";
      var text = document.createElement("span");
      text.textContent = event.text;
      var time = document.createElement("span");
      time.className = "feed-time";
      time.dataset.ts = event.ts;
      time.textContent = relativeTime(event.ts);
      li.appendChild(text);
      li.appendChild(time);
      feedListEl.appendChild(li);
    });
  }

  function render(state) {
    var order = state.teams.map(function (t) { return t.id; }).join(",");
    if (order !== lastTeamOrder) fullRebuild(state); else state.teams.forEach(updateCard);
    titleEl.textContent = state.title;
    renderFeed(state.events || []);
    lastFetchTs = Date.now();
  }

  function poll() {
    fetch("/api/state")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        render(data);
        lastUpdatedEl.textContent = "อัปเดตล่าสุด: เมื่อสักครู่";
      })
      .catch(function () {
        lastUpdatedEl.textContent = "ขาดการเชื่อมต่อ กำลังลองใหม่…";
      });
  }

  setInterval(function () {
    document.querySelectorAll(".feed-time").forEach(function (el) {
      el.textContent = relativeTime(Number(el.dataset.ts));
    });
    if (lastFetchTs) lastUpdatedEl.textContent = "อัปเดตล่าสุด: " + relativeTime(lastFetchTs);
  }, 1000);

  poll();
  setInterval(poll, POLL_MS);
})();
