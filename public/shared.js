(function (global) {
  "use strict";

  var PALETTE = ["#4A90D9", "#E2934A", "#4F9A5B", "#D1587A", "#8B6FD1", "#3FA9A0"];
  var TOKEN_TYPES = ["star", "coin", "coins", "chest"];
  var DECORATION_TYPES = ["trees", "flowers", "people", "animals", "teaField"];
  var DECORATION_LABELS = { trees: "ต้นไม้", flowers: "ดอกไม้", people: "ผู้คน", animals: "สัตว์เลี้ยง", teaField: "แปลงชา" };
  var DECORATION_MAX = { trees: 20, flowers: 20, people: 30, animals: 20, teaField: 10 };

  var KM_PER_LEVEL = 10;
  var MAX_LEVEL = 3;

  var TOKEN_ICONS = {
    star: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2.5l2.7 6.35 6.9.6-5.2 4.6 1.6 6.8L12 17.6l-6 3.25 1.6-6.8-5.2-4.6 6.9-.6L12 2.5z" fill="#F4C542" stroke="#B8862A" stroke-width="1" stroke-linejoin="round"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="#F6D25C" stroke="#B8862A" stroke-width="1.4"/><circle cx="12" cy="12" r="5.4" fill="none" stroke="#B8862A" stroke-width="1"/></svg>',
    coins: '<svg viewBox="0 0 24 24" fill="none"><ellipse cx="9" cy="16" rx="7" ry="3" fill="#F6D25C" stroke="#B8862A" stroke-width="1.1"/><ellipse cx="9" cy="13" rx="7" ry="3" fill="#F8DA72" stroke="#B8862A" stroke-width="1.1"/><ellipse cx="12" cy="9.5" rx="7" ry="3" fill="#F6D25C" stroke="#B8862A" stroke-width="1.1"/></svg>',
    chest: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="10" width="18" height="10" rx="1.5" fill="#B8752E" stroke="#7A4A18" stroke-width="1.2"/><path d="M3 10.5c0-3 4-5.5 9-5.5s9 2.5 9 5.5" fill="#D68F3F" stroke="#7A4A18" stroke-width="1.2"/><rect x="10" y="10.5" width="4" height="4" rx="0.8" fill="#F4C542" stroke="#7A4A18" stroke-width="1"/></svg>'
  };

  var ACCESSORY_ICONS = {
    star: '<svg viewBox="0 0 30 30" fill="none"><path d="M15 3v13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 3l9 5-9 3z" fill="currentColor"/></svg>',
    coin: '<svg viewBox="0 0 30 30" fill="none"><text x="6" y="14" font-size="13" font-weight="900" fill="currentColor">?</text><text x="17" y="24" font-size="10" font-weight="900" fill="currentColor">?</text></svg>',
    coins: '<svg viewBox="0 0 30 30" fill="none"><path d="M6 24C4 16 8 6 15 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="10" cy="12" rx="4" ry="2.4" fill="currentColor"/><ellipse cx="6" cy="20" rx="3.4" ry="2" fill="currentColor"/></svg>',
    chest: '<svg viewBox="0 0 30 30" fill="none"><path d="M15 6l2.6 5.3 5.9.8-4.3 4.1 1 5.8L15 19l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L15 6z" fill="currentColor"/></svg>'
  };

  var DECOR_ICONS = {
    trees: '<svg viewBox="0 0 24 24"><path d="M12 2 6.5 10h2.7L4.5 17h6V22h3v-5h6l-4.7-7h2.7L12 2z" fill="#3f7d4c" stroke="#2b5636" stroke-width="0.6" stroke-linejoin="round"/></svg>',
    flowers: '<svg viewBox="0 0 24 24"><path d="M12 12v9" stroke="#4f9a5b" stroke-width="2" stroke-linecap="round"/><g fill="#f177a6"><circle cx="12" cy="7" r="2.6"/><circle cx="8.2" cy="9" r="2.2"/><circle cx="15.8" cy="9" r="2.2"/><circle cx="9.5" cy="12" r="2.2"/><circle cx="14.5" cy="12" r="2.2"/></g><circle cx="12" cy="10" r="2" fill="#ffd873"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="12" cy="6.2" r="3" fill="#8a5a3b"/><path d="M6 21c0-5 3-8 6-8s6 3 6 8" fill="var(--accent, #4a90d9)"/></svg>',
    animals: '<svg viewBox="0 0 24 24"><path d="M5 13c-1.2 0-2-.9-2-2s.8-2 2-2" fill="none" stroke="#c98a4b" stroke-width="1.3" stroke-linecap="round"/><ellipse cx="11" cy="14.5" rx="6.4" ry="4.6" fill="#e9c095" stroke="#c98a4b" stroke-width="1"/><path d="M5.5 10.5 4 6.5l3 2.2z" fill="#e9c095" stroke="#c98a4b" stroke-width="1" stroke-linejoin="round"/><path d="M8 9.5 6.8 5.2l3 2.6z" fill="#e9c095" stroke="#c98a4b" stroke-width="1" stroke-linejoin="round"/><circle cx="6.6" cy="11.6" r="0.7" fill="#5c3d22"/><rect x="7" y="18" width="2" height="3.4" rx="1" fill="#c98a4b"/><rect x="13.5" y="18" width="2" height="3.4" rx="1" fill="#c98a4b"/><path d="M17.2 12.5c1.4.3 2 1.6 1.4 2.8" fill="none" stroke="#c98a4b" stroke-width="1.3" stroke-linecap="round"/></svg>'
  };

  /* All slots (and their overflow badges) stay outside the house footprint:
     trees/flowers hug the side margins (x well outside the widest house+2.5D-panel span),
     people/animals stay in the yard strip below the house's fixed bottom edge. */
  var DECOR_SLOTS = {
    trees: [[4, 38], [2, 53], [9, 66]],
    flowers: [[94, 40], [98, 55], [92, 68]],
    people: [[22, 86], [72, 94], [48, 90]],
    animals: [[12, 89], [86, 95]]
  };
  var DECOR_BADGE_POS = {
    trees: [6, 78],
    flowers: [95, 78],
    people: [50, 97],
    animals: [70, 97]
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function levelForKm(km) {
    return clamp(Math.floor((Number(km) || 0) / KM_PER_LEVEL), 0, MAX_LEVEL);
  }

  function kmToNextLevel(km) {
    var level = levelForKm(km);
    if (level >= MAX_LEVEL) return 0;
    return (level + 1) * KM_PER_LEVEL - Number(km || 0);
  }

  function buildHousePlot(team) {
    var level = levelForKm(team.km);

    var plot = document.createElement("div");
    plot.className = "house-plot";
    plot.dataset.fence = String(level >= 3);

    var house = document.createElement("div");
    house.className = "house";
    house.dataset.level = String(level);
    house.style.setProperty("--accent", team.color);
    house.innerHTML =
      '<div class="roof"></div>' +
      '<div class="roof-side"></div>' +
      '<div class="chimney"></div>' +
      '<div class="wall">' +
      '<div class="window"></div>' +
      '<div class="window--upper"></div>' +
      '<div class="pillar pillar--left"></div>' +
      '<div class="pillar pillar--right"></div>' +
      '<div class="door"></div>' +
      "</div>" +
      '<div class="wall-side"></div>' +
      '<div class="accessory">' + (ACCESSORY_ICONS[team.tokenType] || ACCESSORY_ICONS.star) + "</div>";
    plot.appendChild(house);

    var fence = document.createElement("div");
    fence.className = "fence";
    plot.appendChild(fence);

    var decorLayer = document.createElement("div");
    decorLayer.className = "decor-layer";
    renderDecorLayer(decorLayer, team.decorations || {});
    plot.appendChild(decorLayer);

    return { plot: plot, house: house, decorLayer: decorLayer };
  }

  function updateHouseLevel(refs, team) {
    var level = levelForKm(team.km);
    refs.house.dataset.level = String(level);
    refs.house.style.setProperty("--accent", team.color);
    refs.plot.dataset.fence = String(level >= 3);
    return level;
  }

  function renderDecorLayer(layer, decorations) {
    layer.innerHTML = "";
    ["trees", "flowers", "people", "animals"].forEach(function (type) {
      var count = decorations[type] || 0;
      var slots = DECOR_SLOTS[type];
      var shown = Math.min(count, slots.length);
      for (var i = 0; i < shown; i++) {
        var el = document.createElement("div");
        el.className = "decor decor--" + type;
        el.style.left = slots[i][0] + "%";
        el.style.top = slots[i][1] + "%";
        el.innerHTML = DECOR_ICONS[type];
        layer.appendChild(el);
      }
      if (count > slots.length) {
        var badge = document.createElement("div");
        badge.className = "decor-badge";
        var pos = DECOR_BADGE_POS[type];
        badge.style.left = pos[0] + "%";
        badge.style.top = pos[1] + "%";
        badge.textContent = "+" + (count - slots.length);
        layer.appendChild(badge);
      }
    });
    var teaField = decorations.teaField || 0;
    if (teaField > 0) {
      var field = document.createElement("div");
      field.className = "tea-field";
      field.style.setProperty("--rows", Math.min(teaField, 4));
      layer.appendChild(field);
    }
  }

  global.Scoreboard = {
    PALETTE: PALETTE,
    TOKEN_TYPES: TOKEN_TYPES,
    DECORATION_TYPES: DECORATION_TYPES,
    DECORATION_LABELS: DECORATION_LABELS,
    DECORATION_MAX: DECORATION_MAX,
    TOKEN_ICONS: TOKEN_ICONS,
    ACCESSORY_ICONS: ACCESSORY_ICONS,
    DECOR_ICONS: DECOR_ICONS,
    MAX_LEVEL: MAX_LEVEL,
    KM_PER_LEVEL: KM_PER_LEVEL,
    levelForKm: levelForKm,
    kmToNextLevel: kmToNextLevel,
    buildHousePlot: buildHousePlot,
    updateHouseLevel: updateHouseLevel,
    renderDecorLayer: renderDecorLayer,
    clamp: clamp
  };
})(window);
