(function () {
  "use strict";

  var S = window.Scoreboard;
  var POLL_MS = 3000;

  var boardEl = document.getElementById("board");
  var titleEl = document.getElementById("boardTitle");
  var feedListEl = document.getElementById("feedList");
  var feedWidget = document.getElementById("feedWidget");
  var feedToggle = document.getElementById("feedToggle");
  var feedCountEl = document.getElementById("feedCount");
  var lastUpdatedEl = document.getElementById("lastUpdated");

  var cardRefs = new Map();
  var lastTeamOrder = "";
  var lastEventIds = "";
  var lastFetchTs = null;
  var seenEventId = null;
  var feedOpen = false;
  var feedInitialized = false;

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

    var levelBadge = document.createElement("div");
    levelBadge.className = "level-badge";
    card.appendChild(levelBadge);
    var levelProgress = document.createElement("div");
    levelProgress.className = "level-progress";
    card.appendChild(levelProgress);
    setLevelText(levelBadge, levelProgress, team);

    card.appendChild(visual.plot);

    var scoreCard = document.createElement("div");
    scoreCard.className = "score-card";

    var scoreWrap = document.createElement("div");
    scoreWrap.className = "view-score";
    var kmEl = document.createElement("span");
    kmEl.className = "view-points";
    kmEl.textContent = team.km;
    var kmLabel = document.createElement("span");
    kmLabel.className = "view-pts-label";
    kmLabel.textContent = "กม.";
    scoreWrap.appendChild(kmEl);
    scoreWrap.appendChild(kmLabel);
    scoreCard.appendChild(scoreWrap);
    scoreCard.appendChild(S.buildRunIcon());

    card.appendChild(scoreCard);

    cardRefs.set(team.id, {
      card: card, nameEl: nameEl, levelBadge: levelBadge, levelProgress: levelProgress,
      house: visual.house, plot: visual.plot, decorLayer: visual.decorLayer, kmEl: kmEl,
      lastLevel: S.levelForKm(team.km), lastMilestoneName: S.milestoneNameForLevel(S.levelForKm(team.km))
    });
    return card;
  }

  function setLevelText(levelBadge, levelProgress, team) {
    var level = S.levelForKm(team.km);
    levelBadge.textContent = "ระดับ " + level + " · " + S.milestoneNameForLevel(level);
    var toNext = S.kmToNextLevel(team.km);
    levelProgress.textContent = "อีก " + toNext + " กม. ถึงระดับถัดไป";
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
    setLevelText(refs.levelBadge, refs.levelProgress, team);

    var newLevel = S.levelForKm(team.km);
    S.updateHouseVisual(refs, team);
    refs.kmEl.textContent = team.km;

    if (newLevel > refs.lastLevel) {
      var newMilestoneName = S.milestoneNameForLevel(newLevel);
      var milestoneChanged = newMilestoneName !== refs.lastMilestoneName;
      var big = milestoneChanged || S.isNotableLevel(newLevel);
      S.celebrateUpgrade(refs.plot, big, big ? S.celebrationTextForLevel(newLevel, milestoneChanged) : null);
      refs.lastMilestoneName = newMilestoneName;
    }
    refs.lastLevel = newLevel;
  }

  function renderFeed(events) {
    var ids = events.map(function (e) { return e.id; }).join(",");
    if (ids !== lastEventIds) {
      lastEventIds = ids;
      feedListEl.innerHTML = "";
      if (!events.length) {
        var empty = document.createElement("li");
        empty.className = "feed-empty";
        empty.textContent = "ยังไม่มีความเคลื่อนไหว";
        feedListEl.appendChild(empty);
      } else {
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
    }

    if (!feedInitialized) {
      feedInitialized = true;
      if (events.length) seenEventId = events[0].id;
    }

    var unseenCount = 0;
    if (events.length) {
      if (seenEventId === null) {
        unseenCount = events.length;
      } else {
        var idx = events.findIndex(function (e) { return e.id === seenEventId; });
        unseenCount = idx === -1 ? events.length : idx;
      }
    }
    if (feedOpen && events.length) seenEventId = events[0].id;
    feedCountEl.hidden = unseenCount <= 0;
    feedCountEl.textContent = unseenCount > 9 ? "9+" : String(unseenCount);
  }

  feedToggle.addEventListener("click", function () {
    feedOpen = !feedOpen;
    feedWidget.classList.toggle("open", feedOpen);
    if (feedOpen && lastEventIds) {
      var ids = lastEventIds.split(",");
      seenEventId = ids[0] || null;
      feedCountEl.hidden = true;
    }
  });

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

  var sceneEl = document.querySelector(".scene-sky");
  S.applyWeather(sceneEl);
  setInterval(function () { S.applyWeather(sceneEl); }, 30000);

  poll();
  setInterval(poll, POLL_MS);
})();
