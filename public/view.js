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
  var currentRanks = {};
  var feed = S.createFeedWidget({ listEl: feedListEl, widgetEl: feedWidget, toggleEl: feedToggle, countEl: feedCountEl });

  function buildViewCard(team) {
    var visual = S.buildHousePlot(team);
    var card = document.createElement("div");
    card.className = "team-card";
    card.style.setProperty("--accent", team.color);

    var nameEl = document.createElement("div");
    nameEl.className = "team-name";
    var rankEl = document.createElement("span");
    rankEl.className = "house-rank";
    rankEl.textContent = S.rankBadgeText(currentRanks[team.id] || 1);
    var nameTextEl = document.createElement("span");
    nameTextEl.textContent = team.name;
    nameEl.appendChild(rankEl);
    nameEl.appendChild(nameTextEl);
    card.appendChild(nameEl);

    var levelBadge = document.createElement("div");
    levelBadge.className = "level-badge";
    card.appendChild(levelBadge);
    var levelProgress = document.createElement("div");
    levelProgress.className = "level-progress";
    card.appendChild(levelProgress);
    setLevelText(levelBadge, levelProgress, team);

    var milestoneShelf = document.createElement("div");
    milestoneShelf.className = "milestone-shelf";
    card.appendChild(milestoneShelf);

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
      card: card, nameEl: nameEl, rankEl: rankEl, nameTextEl: nameTextEl,
      levelBadge: levelBadge, levelProgress: levelProgress, milestoneShelf: milestoneShelf,
      house: visual.house, plot: visual.plot, decorLayer: visual.decorLayer, kmEl: kmEl,
      lastLevel: S.levelForKm(team.km), lastMilestoneName: S.milestoneNameForLevel(S.levelForKm(team.km))
    });
    renderMilestoneShelf(milestoneShelf, S.levelForKm(team.km));
    return card;
  }

  function setLevelText(levelBadge, levelProgress, team) {
    var level = S.levelForKm(team.km);
    levelBadge.textContent = "ระดับ " + level + " · " + S.milestoneNameForLevel(level);
    var toNext = S.kmToNextLevel(team.km);
    levelProgress.textContent = "อีก " + toNext + " กม. ถึงระดับถัดไป";
  }

  function renderMilestoneShelf(shelfEl, level) {
    shelfEl.innerHTML = "";
    S.milestonesReached(level).forEach(function (m) {
      var chip = document.createElement("span");
      chip.className = "milestone-chip";
      chip.textContent = "\u{1F3C6} " + m.name;
      shelfEl.appendChild(chip);
    });
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
    refs.nameTextEl.textContent = team.name;
    refs.rankEl.textContent = S.rankBadgeText(currentRanks[team.id] || 1);
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
      renderMilestoneShelf(refs.milestoneShelf, newLevel);
      if (refs.lastLevel < 50 && newLevel >= 50) grandFinale(team.name);
    }
    refs.lastLevel = newLevel;
  }

  function render(state) {
    currentRanks = S.computeRanks(state.teams);
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

  /* A bigger, page-wide moment on top of the usual per-card celebration, the first time
     any team crosses the original 1000km target. */
  function grandFinale(teamName) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var overlay = document.createElement("div");
    overlay.className = "grand-finale-overlay";
    var banner = document.createElement("div");
    banner.className = "grand-finale-banner";
    banner.textContent = "\u{1F3C6} " + teamName + " วิ่งครบ 1,000 กม. แล้ว!!";
    overlay.appendChild(banner);
    document.body.appendChild(overlay);
    setTimeout(function () { overlay.remove(); }, 4000);

    var colors = ["#ffd873", "#e6536b", "#4a90d9", "#4f9a5b", "#8B6FD1", "#3FA9A0"];
    for (var i = 0; i < 70; i++) {
      var piece = document.createElement("div");
      piece.className = "grand-finale-confetti";
      piece.style.left = (Math.random() * 100) + "%";
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = (Math.random() * 0.6).toFixed(2) + "s";
      piece.style.animationDuration = (2.2 + Math.random() * 1.2).toFixed(2) + "s";
      document.body.appendChild(piece);
      (function (p) { setTimeout(function () { p.remove(); }, 4200); })(piece);
    }
  }

  setInterval(function () {
    feed.tick();
    if (lastFetchTs) lastUpdatedEl.textContent = "อัปเดตล่าสุด: " + S.relativeTime(lastFetchTs);
  }, 1000);

  var sceneEl = document.querySelector(".scene-sky");
  var prevWeather = S.applyWeather(sceneEl);
  S.applyDayNight(sceneEl);
  setInterval(function () {
    var w = S.applyWeather(sceneEl);
    if (prevWeather === "rain" && w !== "rain") S.showRainbow(sceneEl);
    prevWeather = w;
    S.applyDayNight(sceneEl);
  }, 30000);
  setInterval(function () { S.maybeSpawnShootingStar(sceneEl); }, 6000);

  poll();
  setInterval(poll, POLL_MS);
})();
