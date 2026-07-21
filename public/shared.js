(function (global) {
  "use strict";

  var PALETTE = ["#4A90D9", "#E2934A", "#4F9A5B", "#D1587A", "#8B6FD1", "#3FA9A0"];
  var TOKEN_TYPES = ["star", "coin", "coins", "chest"];
  var DECORATION_TYPES = ["trees", "flowers", "people", "animals", "teaField"];
  var DECORATION_LABELS = { trees: "ต้นไม้", flowers: "ดอกไม้", people: "ผู้คน", animals: "สัตว์เลี้ยง", teaField: "แปลงชา" };

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
    animals: '<svg viewBox="0 0 24 24"><circle cx="18" cy="10" r="3" fill="#f3ede3" stroke="#c9bfae" stroke-width="1"/><ellipse cx="11" cy="14" rx="7.2" ry="5" fill="#f3ede3" stroke="#c9bfae" stroke-width="1"/><rect x="7" y="18" width="2.2" height="4" rx="1" fill="#c9bfae"/><rect x="13" y="18" width="2.2" height="4" rx="1" fill="#c9bfae"/></svg>'
  };

  var DECOR_SLOTS = {
    trees: [[3, 82], [-4, 60], [10, 96]],
    flowers: [[88, 90], [98, 70], [80, 99]],
    people: [[42, 98], [58, 92]],
    animals: [[26, 96], [70, 84]]
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function buildHousePlot(team) {
    var plot = document.createElement("div");
    plot.className = "house-plot";

    var house = document.createElement("div");
    house.className = "house";
    house.dataset.level = String(team.level || 1);
    house.style.setProperty("--accent", team.color);
    house.innerHTML =
      '<div class="roof"></div>' +
      '<div class="chimney"></div>' +
      '<div class="chimney2"></div>' +
      '<div class="wall">' +
      '<div class="window"></div>' +
      '<div class="window window--side"></div>' +
      '<div class="attic-window"></div>' +
      '<div class="door"></div>' +
      "</div>" +
      '<div class="accessory">' + (ACCESSORY_ICONS[team.tokenType] || ACCESSORY_ICONS.star) + "</div>";
    plot.appendChild(house);

    var decorLayer = document.createElement("div");
    decorLayer.className = "decor-layer";
    renderDecorLayer(decorLayer, team.decorations || {});
    plot.appendChild(decorLayer);

    return { plot: plot, house: house, decorLayer: decorLayer };
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
        var last = slots[slots.length - 1];
        badge.style.left = clamp(last[0] + 14, 0, 100) + "%";
        badge.style.top = last[1] + "%";
        badge.textContent = "+" + (count - slots.length);
        layer.appendChild(badge);
      }
    });
    var teaField = decorations.teaField || 0;
    if (teaField > 0) {
      var field = document.createElement("div");
      field.className = "tea-field";
      field.style.setProperty("--rows", Math.min(teaField, 5));
      layer.appendChild(field);
    }
  }

  global.Scoreboard = {
    PALETTE: PALETTE,
    TOKEN_TYPES: TOKEN_TYPES,
    DECORATION_TYPES: DECORATION_TYPES,
    DECORATION_LABELS: DECORATION_LABELS,
    TOKEN_ICONS: TOKEN_ICONS,
    ACCESSORY_ICONS: ACCESSORY_ICONS,
    DECOR_ICONS: DECOR_ICONS,
    buildHousePlot: buildHousePlot,
    renderDecorLayer: renderDecorLayer,
    clamp: clamp
  };
})(window);
