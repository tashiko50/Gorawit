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
  var lastFetchTs = null;
  var feed = S.createFeedWidget({ listEl: feedListEl, widgetEl: feedWidget, toggleEl: feedToggle, countEl: feedCountEl });

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

  function render(state) {
    var order = state.teams.map(function (t) { return t.id; }).join(",");
    if (order !== lastTeamOrder) fullRebuild(state); else state.teams.forEach(updateCard);
    titleEl.textContent = state.title;
    feed.render(state.events || []);
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
    feed.tick();
    if (lastFetchTs) lastUpdatedEl.textContent = "อัปเดตล่าสุด: " + S.relativeTime(lastFetchTs);
  }, 1000);

  var sceneEl = document.querySelector(".scene-sky");
  S.applyWeather(sceneEl);
  setInterval(function () { S.applyWeather(sceneEl); }, 30000);

  poll();
  setInterval(poll, POLL_MS);
})();
