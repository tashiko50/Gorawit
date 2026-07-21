(function (global) {
  "use strict";

  var PALETTE = ["#4A90D9", "#E2934A", "#4F9A5B", "#D1587A", "#8B6FD1", "#3FA9A0"];
  var DECORATION_TYPES = ["trees", "flowers", "people", "animals", "teaField"];

  var KM_PER_LEVEL = 20;
  var STRUCTURAL_STAGES = 4;
  var LEVELS_PER_STAGE = 5;
  var STAGE_NAMES = ["แคมป์เล็กๆ", "กระท่อมน่าอยู่", "บ้านไร่ชา", "คฤหาสน์หมู่บ้าน"];

  var RUN_ICON_A = '<svg viewBox="0 0 24 24"><circle cx="13" cy="4.3" r="2.3" fill="#8a5a3b"/><path d="M11 7 8 12l3 2-1 6h2.4l1-5.6L16 16l1.6 5h2.3l-2-7.4-2.6-2.3 1.2-4.6 3 2.4 1.3-1.7-4.4-3.6-3-.4-2.4 3.6z" fill="var(--accent, #4a90d9)"/></svg>';
  var RUN_ICON_B = '<svg viewBox="0 0 24 24"><circle cx="11" cy="4.3" r="2.3" fill="#8a5a3b"/><path d="M13 7 17 10.8l-1.2 4.6L19 18l-1.4 1.7-3.8-3.6-1.1-4.3-2 2 .6 6.2H9l-.7-7.4 2.4-3.4-3-1.6-2 3.4-2-1.2 3-5.2 3-1.4z" fill="var(--accent, #4a90d9)"/></svg>';

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function levelForKm(km) {
    return Math.max(0, Math.floor((Number(km) || 0) / KM_PER_LEVEL));
  }

  function stageForLevel(level) {
    return Math.min(STRUCTURAL_STAGES - 1, Math.floor(level / LEVELS_PER_STAGE));
  }

  function kmToNextLevel(km) {
    var level = levelForKm(km);
    return (level + 1) * KM_PER_LEVEL - Number(km || 0);
  }

  function stageNameForLevel(level) {
    return STAGE_NAMES[stageForLevel(level)];
  }

  function decorationsForLevel(level) {
    var stage = stageForLevel(level);
    return {
      trees: level,
      flowers: Math.floor(level * 1.5),
      people: level * 2 + (stage >= 1 ? 2 : 0),
      animals: Math.floor(level / 2),
      teaField: stage >= 2 ? Math.min(4, stage + 1) : 0
    };
  }

  var DECOR_ICONS = {
    trees: '<svg viewBox="0 0 24 24"><path d="M12 2 6.5 10h2.7L4.5 17h6V22h3v-5h6l-4.7-7h2.7L12 2z" fill="#3f7d4c" stroke="#2b5636" stroke-width="0.6" stroke-linejoin="round"/></svg>',
    flowers: '<svg viewBox="0 0 24 24"><path d="M12 12v9" stroke="#4f9a5b" stroke-width="2" stroke-linecap="round"/><g fill="#f177a6"><circle cx="12" cy="7" r="2.6"/><circle cx="8.2" cy="9" r="2.2"/><circle cx="15.8" cy="9" r="2.2"/><circle cx="9.5" cy="12" r="2.2"/><circle cx="14.5" cy="12" r="2.2"/></g><circle cx="12" cy="10" r="2" fill="#ffd873"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="12" cy="6.2" r="3" fill="#8a5a3b"/><path d="M6 21c0-5 3-8 6-8s6 3 6 8" fill="var(--accent, #4a90d9)"/></svg>',
    animals: '<svg viewBox="0 0 24 24"><path d="M5 13c-1.2 0-2-.9-2-2s.8-2 2-2" fill="none" stroke="#c98a4b" stroke-width="1.3" stroke-linecap="round"/><ellipse cx="11" cy="14.5" rx="6.4" ry="4.6" fill="#e9c095" stroke="#c98a4b" stroke-width="1"/><path d="M5.5 10.5 4 6.5l3 2.2z" fill="#e9c095" stroke="#c98a4b" stroke-width="1" stroke-linejoin="round"/><path d="M8 9.5 6.8 5.2l3 2.6z" fill="#e9c095" stroke="#c98a4b" stroke-width="1" stroke-linejoin="round"/><circle cx="6.6" cy="11.6" r="0.7" fill="#5c3d22"/><rect x="7" y="18" width="2" height="3.4" rx="1" fill="#c98a4b"/><rect x="13.5" y="18" width="2" height="3.4" rx="1" fill="#c98a4b"/><path d="M17.2 12.5c1.4.3 2 1.6 1.4 2.8" fill="none" stroke="#c98a4b" stroke-width="1.3" stroke-linecap="round"/></svg>'
  };

  /* All slots (and their overflow badges) stay outside the house footprint:
     trees/flowers hug the side margins, people/animals stay in the yard strip
     below the house's fixed bottom edge (see shared.css .house { bottom: 54px }). */
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
  var SWAY_DELAYS = ["0s", "-0.6s", "-1.2s", "-0.3s"];

  function buildHousePlot(team) {
    var level = levelForKm(team.km);
    var stage = stageForLevel(level);

    var plot = document.createElement("div");
    plot.className = "house-plot";
    plot.dataset.fence = String(stage >= 3);

    var groundShadow = document.createElement("div");
    groundShadow.className = "ground-shadow";
    plot.appendChild(groundShadow);

    var grassTufts = document.createElement("div");
    grassTufts.className = "grass-tufts";
    plot.appendChild(grassTufts);

    var house = document.createElement("div");
    house.className = "house";
    house.dataset.stage = String(stage);
    house.style.setProperty("--accent", team.color);
    house.innerHTML =
      '<div class="roof"><div class="roof-shine"></div></div>' +
      '<div class="roof-side"></div>' +
      '<div class="chimney"><div class="smoke smoke--a"></div><div class="smoke smoke--b"></div></div>' +
      '<div class="wall">' +
      '<div class="window"></div>' +
      '<div class="window--upper"></div>' +
      '<div class="pillar pillar--left"></div>' +
      '<div class="pillar pillar--right"></div>' +
      '<div class="door"></div>' +
      "</div>" +
      '<div class="wall-side"></div>';
    plot.appendChild(house);

    var fence = document.createElement("div");
    fence.className = "fence";
    plot.appendChild(fence);

    var decorLayer = document.createElement("div");
    decorLayer.className = "decor-layer";
    renderDecorLayer(decorLayer, decorationsForLevel(level));
    plot.appendChild(decorLayer);

    return { plot: plot, house: house, decorLayer: decorLayer };
  }

  function updateHouseVisual(refs, team) {
    var level = levelForKm(team.km);
    var stage = stageForLevel(level);
    refs.house.dataset.stage = String(stage);
    refs.house.style.setProperty("--accent", team.color);
    refs.plot.dataset.fence = String(stage >= 3);
    renderDecorLayer(refs.decorLayer, decorationsForLevel(level));
    return stage;
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
        el.style.setProperty("--sway-delay", SWAY_DELAYS[i % SWAY_DELAYS.length]);
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
      field.style.setProperty("--rows", teaField);
      layer.appendChild(field);
    }
  }

  function buildRunIcon() {
    var wrap = document.createElement("span");
    wrap.className = "run-icon";
    wrap.setAttribute("aria-hidden", "true");
    var a = document.createElement("span");
    a.className = "run-frame run-frame--a";
    a.innerHTML = RUN_ICON_A;
    var b = document.createElement("span");
    b.className = "run-frame run-frame--b";
    b.innerHTML = RUN_ICON_B;
    wrap.appendChild(a);
    wrap.appendChild(b);
    return wrap;
  }

  /* Sparkle burst + scale pop so an upgrade reads as an obvious event, not a silent
     CSS attribute swap. `big` (structural stage change) gets a stronger burst + toast. */
  function celebrateUpgrade(plotEl, big, toastText) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    plotEl.classList.remove("pulse-up", "celebrate-up");
    void plotEl.offsetWidth;
    plotEl.classList.add(big ? "celebrate-up" : "pulse-up");

    if (big) {
      var burst = document.createElement("div");
      burst.className = "sparkle-burst";
      var count = 8;
      for (var i = 0; i < count; i++) {
        var s = document.createElement("span");
        s.className = "sparkle";
        var angle = (360 / count) * i;
        s.style.setProperty("--angle", angle + "deg");
        s.textContent = "✨";
        burst.appendChild(s);
      }
      plotEl.appendChild(burst);
      setTimeout(function () { burst.remove(); }, 900);

      if (toastText) {
        var toast = document.createElement("div");
        toast.className = "upgrade-toast";
        toast.textContent = toastText;
        plotEl.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 2000);
      }
    }

    setTimeout(function () { plotEl.classList.remove("pulse-up", "celebrate-up"); }, big ? 900 : 500);
  }

  global.Scoreboard = {
    PALETTE: PALETTE,
    DECORATION_TYPES: DECORATION_TYPES,
    KM_PER_LEVEL: KM_PER_LEVEL,
    STRUCTURAL_STAGES: STRUCTURAL_STAGES,
    LEVELS_PER_STAGE: LEVELS_PER_STAGE,
    levelForKm: levelForKm,
    stageForLevel: stageForLevel,
    kmToNextLevel: kmToNextLevel,
    stageNameForLevel: stageNameForLevel,
    decorationsForLevel: decorationsForLevel,
    buildHousePlot: buildHousePlot,
    updateHouseVisual: updateHouseVisual,
    renderDecorLayer: renderDecorLayer,
    buildRunIcon: buildRunIcon,
    celebrateUpgrade: celebrateUpgrade,
    clamp: clamp
  };
})(window);
