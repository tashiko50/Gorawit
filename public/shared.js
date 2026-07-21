(function (global) {
  "use strict";

  var PALETTE = ["#4A90D9", "#E2934A", "#4F9A5B", "#D1587A", "#8B6FD1", "#3FA9A0"];
  var DECORATION_TYPES = ["trees", "flowers", "people", "animals"];

  var KM_PER_LEVEL = 20;

  var MILESTONE_NAMES = {
    0: "แคมป์เริ่มต้น",
    10: "รังนกน้อย",
    20: "ไร่ชายามเช้า",
    30: "คฤหาสน์ใบชา",
    40: "ปราสาทสายลม",
    50: "อาณาจักรนักวิ่ง",
    60: "นักวิ่งไร้พรมแดน",
    70: "ตำนานที่ยังไม่จบ",
    80: "เหนือจินตนาการ",
    90: "ประตูสู่จักรวาล",
    100: "ทูตจากดวงดาว"
  };
  var MILESTONE_LEVELS = Object.keys(MILESTONE_NAMES).map(Number).sort(function (a, b) { return a - b; });
  var LAST_MILESTONE_LEVEL = MILESTONE_LEVELS[MILESTONE_LEVELS.length - 1];

  /* Levels where something structurally new appears (or a milestone name is revealed) —
     these get the big celebrate-up treatment; every other level-up gets a light pulse. */
  var FEATURE_LABELS = {
    1: "\u{1F528} เริ่มตอกเสาเข็มหลังแรก!",
    2: "\u{1F528} โครงหลังคากันแดดขึ้นแล้ว!",
    3: "\u{1F9F1} ผนังเริ่มเป็นรูปเป็นร่าง!",
    4: "\u{1F3E0} กระท่อมหลังแรกเสร็จสมบูรณ์!",
    5: "\u{1FA9F} ติดหน้าต่างแล้ว!",
    6: "\u{1F6AA} ต่อเติมระเบียงหน้าบ้าน!",
    12: "\u{1F697} ปลดล็อกโรงรถ + รถคันใหม่!",
    25: "⛲\u{1F6F8} ปลดล็อกน้ำพุกลางสวน + UFO ลึกลับมาเยือน!",
    35: "\u{1F3CA} ปลดล็อกสระว่ายน้ำ!",
    45: "\u{1F3D7}️ เริ่มสร้างอาคารหลังที่ 2!"
  };
  var NOTABLE_LEVELS = Object.keys(FEATURE_LABELS).map(Number).concat([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

  var RUN_ICON_A = '<svg viewBox="0 0 24 24"><circle cx="13" cy="4.3" r="2.3" fill="#8a5a3b"/><path d="M11 7 8 12l3 2-1 6h2.4l1-5.6L16 16l1.6 5h2.3l-2-7.4-2.6-2.3 1.2-4.6 3 2.4 1.3-1.7-4.4-3.6-3-.4-2.4 3.6z" fill="var(--accent, #4a90d9)"/></svg>';
  var RUN_ICON_B = '<svg viewBox="0 0 24 24"><circle cx="11" cy="4.3" r="2.3" fill="#8a5a3b"/><path d="M13 7 17 10.8l-1.2 4.6L19 18l-1.4 1.7-3.8-3.6-1.1-4.3-2 2 .6 6.2H9l-.7-7.4 2.4-3.4-3-1.6-2 3.4-2-1.2 3-5.2 3-1.4z" fill="var(--accent, #4a90d9)"/></svg>';

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function levelForKm(km) {
    return Math.max(0, Math.floor((Number(km) || 0) / KM_PER_LEVEL));
  }

  function kmToNextLevel(km) {
    var level = levelForKm(km);
    return (level + 1) * KM_PER_LEVEL - Number(km || 0);
  }

  function milestoneNameForLevel(level) {
    var name = MILESTONE_NAMES[0];
    for (var i = 0; i < MILESTONE_LEVELS.length; i++) {
      if (MILESTONE_LEVELS[i] <= level) name = MILESTONE_NAMES[MILESTONE_LEVELS[i]];
      else break;
    }
    return name;
  }

  function isNotableLevel(level) {
    return NOTABLE_LEVELS.indexOf(level) !== -1 || (level > LAST_MILESTONE_LEVEL && level % 25 === 0);
  }

  function celebrationTextForLevel(level, milestoneChanged) {
    if (milestoneChanged) return "🎉 อัปเกรดเป็น " + milestoneNameForLevel(level) + " แล้ว!";
    return FEATURE_LABELS[level] || null;
  }

  /* One continuous build-out, from bare pillars to a full estate compound with a UFO overhead.
     Every threshold here is a deliberate design choice — see README for the full level table. */
  function featuresForLevel(level) {
    return {
      pillar1: level >= 1,
      pillar2: level >= 2,
      leanto: level >= 2 && level < 4,
      wallframing: level === 3,
      wallsolid: level >= 4,
      roof: level >= 4,
      door: level >= 4,
      window: level >= 5,
      porchrail: level >= 6,
      secondfloor: level >= 15,
      chimney: level >= 20,
      thirdfloor: level >= 30,
      castledetail: level >= 40,
      outbuilding: level >= 45,
      ufo: level >= 25,
      garageCar: level >= 12,
      fountain: level >= 25,
      pool: level >= 35,
      statue: level >= 40
    };
  }

  function sizeClassForLevel(level) {
    if (level < 15) return "small";
    if (level < 30) return "medium";
    return "large";
  }

  var WEATHER_CYCLE_MS = 12 * 60 * 1000;
  var WEATHER_SEQUENCE = ["sun", "sun", "rain", "sun", "sun", "rain", "sun", "snow", "sun", "rain"];
  function weatherForNow() {
    var bucket = Math.floor(Date.now() / WEATHER_CYCLE_MS);
    return WEATHER_SEQUENCE[bucket % WEATHER_SEQUENCE.length];
  }

  var DECOR_ICONS = {
    trees: '<svg viewBox="0 0 24 24"><path d="M12 2 6.5 10h2.7L4.5 17h6V22h3v-5h6l-4.7-7h2.7L12 2z" fill="#3f7d4c" stroke="#2b5636" stroke-width="0.6" stroke-linejoin="round"/></svg>',
    flowers: '<svg viewBox="0 0 24 24"><path d="M12 12v9" stroke="#4f9a5b" stroke-width="2" stroke-linecap="round"/><g fill="#f177a6"><circle cx="12" cy="7" r="2.6"/><circle cx="8.2" cy="9" r="2.2"/><circle cx="15.8" cy="9" r="2.2"/><circle cx="9.5" cy="12" r="2.2"/><circle cx="14.5" cy="12" r="2.2"/></g><circle cx="12" cy="10" r="2" fill="#ffd873"/></svg>',
    people: '<svg viewBox="0 0 24 24"><circle cx="12" cy="6.2" r="3" fill="#8a5a3b"/><path d="M6 21c0-5 3-8 6-8s6 3 6 8" fill="var(--accent, #4a90d9)"/></svg>',
    animals: '<svg viewBox="0 0 24 24"><path d="M5 13c-1.2 0-2-.9-2-2s.8-2 2-2" fill="none" stroke="#c98a4b" stroke-width="1.3" stroke-linecap="round"/><ellipse cx="11" cy="14.5" rx="6.4" ry="4.6" fill="#e9c095" stroke="#c98a4b" stroke-width="1"/><path d="M5.5 10.5 4 6.5l3 2.2z" fill="#e9c095" stroke="#c98a4b" stroke-width="1" stroke-linejoin="round"/><path d="M8 9.5 6.8 5.2l3 2.6z" fill="#e9c095" stroke="#c98a4b" stroke-width="1" stroke-linejoin="round"/><circle cx="6.6" cy="11.6" r="0.7" fill="#5c3d22"/><rect x="7" y="18" width="2" height="3.4" rx="1" fill="#c98a4b"/><rect x="13.5" y="18" width="2" height="3.4" rx="1" fill="#c98a4b"/><path d="M17.2 12.5c1.4.3 2 1.6 1.4 2.8" fill="none" stroke="#c98a4b" stroke-width="1.3" stroke-linecap="round"/></svg>'
  };

  /* Trees/flowers hug the side margins (well outside the widest house span, including
     the outbuilding on the right); people/animals + the yard features (garage, statue,
     fountain, pool) each get a fixed non-overlapping x-band across the front yard strip. */
  var DECOR_SLOTS = {
    trees: [[3, 40], [2, 58], [6, 74]],
    flowers: [[97, 38], [99, 54], [99, 70]],
    people: [[31, 92], [69, 92]],
    animals: [[4, 88], [96, 88]]
  };
  var DECOR_BADGE_POS = {
    trees: [5, 84],
    flowers: [97, 84],
    people: [50, 97],
    animals: [50, 90]
  };
  var SWAY_DELAYS = ["0s", "-0.6s", "-1.2s", "-0.3s"];

  function buildHousePlot(team) {
    var level = levelForKm(team.km);
    var f = featuresForLevel(level);
    var size = sizeClassForLevel(level);

    var plot = document.createElement("div");
    plot.className = "house-plot";

    var groundShadow = document.createElement("div");
    groundShadow.className = "ground-shadow";
    plot.appendChild(groundShadow);

    var grassTufts = document.createElement("div");
    grassTufts.className = "grass-tufts";
    plot.appendChild(grassTufts);

    var house = document.createElement("div");
    house.className = "house";
    house.dataset.size = size;
    house.style.setProperty("--accent", team.color);
    house.innerHTML =
      '<div class="turret"><div class="turret-roof"></div></div>' +
      '<div class="crenellation"></div>' +
      '<div class="roof"><div class="roof-shine"></div></div>' +
      '<div class="roof-side"></div>' +
      '<div class="chimney"><div class="smoke smoke--a"></div><div class="smoke smoke--b"></div></div>' +
      '<div class="lean-to"></div>' +
      '<div class="wall">' +
      '<div class="window--top"></div>' +
      '<div class="window--upper"></div>' +
      '<div class="window"></div>' +
      '<div class="door"></div>' +
      "</div>" +
      '<div class="wall-side"></div>' +
      '<div class="porch-rail"></div>' +
      '<div class="pillar pillar--left"></div>' +
      '<div class="pillar pillar--right"></div>' +
      '<div class="start-flag"></div>';
    plot.appendChild(house);

    var outbuilding = document.createElement("div");
    outbuilding.className = "outbuilding";
    outbuilding.innerHTML = '<div class="outbuilding-roof"></div><div class="outbuilding-wall"><div class="outbuilding-door"></div></div>';
    plot.appendChild(outbuilding);

    var ufo = document.createElement("div");
    ufo.className = "ufo-wrap";
    ufo.innerHTML =
      '<div class="ufo-beam"></div>' +
      '<div class="ufo">' +
      '<svg viewBox="0 0 60 30"><ellipse cx="30" cy="12" rx="26" ry="8" fill="#9fb8c8" stroke="#5c7080" stroke-width="1.5"/>' +
      '<ellipse cx="30" cy="7" rx="13" ry="7" fill="#cfe8ee" stroke="#5c7080" stroke-width="1.3"/>' +
      '<circle cx="12" cy="14" r="2.2" fill="#ffe37a"/><circle cx="24" cy="17" r="2.2" fill="#ff8fa3"/>' +
      '<circle cx="36" cy="17" r="2.2" fill="#8fe3ff"/><circle cx="48" cy="14" r="2.2" fill="#c6ff8f"/></svg>' +
      "</div>";
    plot.appendChild(ufo);

    var yardLayer = document.createElement("div");
    yardLayer.className = "yard-layer";
    yardLayer.innerHTML =
      '<div class="garage"><div class="garage-roof"></div><div class="garage-body"><div class="car"></div></div></div>' +
      '<div class="fountain"><div class="fountain-basin"></div><div class="fountain-spray"></div></div>' +
      '<div class="pool"><div class="pool-shimmer"></div></div>' +
      '<div class="statue"><div class="statue-figure"></div><div class="statue-base"></div></div>';
    plot.appendChild(yardLayer);

    var decorLayer = document.createElement("div");
    decorLayer.className = "decor-layer";
    renderDecorLayer(decorLayer, decorationsForLevel(level));
    plot.appendChild(decorLayer);

    applyFeatureAttributes(plot, f);
    return { plot: plot, house: house, decorLayer: decorLayer };
  }

  function applyFeatureAttributes(plot, f) {
    var house = plot.querySelector(".house");
    Object.keys(f).forEach(function (key) {
      house.dataset[key] = String(f[key]);
    });
    plot.dataset.outbuilding = String(f.outbuilding);
    plot.dataset.ufo = String(f.ufo);
    plot.dataset.garageCar = String(f.garageCar);
    plot.dataset.fountain = String(f.fountain);
    plot.dataset.pool = String(f.pool);
    plot.dataset.statue = String(f.statue);
  }

  function decorationsForLevel(level) {
    return {
      trees: level,
      flowers: Math.floor(level * 1.5),
      people: level * 2 + (level >= 4 ? 2 : 0),
      animals: Math.floor(level / 2)
    };
  }

  function updateHouseVisual(refs, team) {
    var level = levelForKm(team.km);
    var f = featuresForLevel(level);
    refs.house.dataset.size = sizeClassForLevel(level);
    refs.house.style.setProperty("--accent", team.color);
    applyFeatureAttributes(refs.plot, f);
    renderDecorLayer(refs.decorLayer, decorationsForLevel(level));
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
     CSS attribute swap. `big` (notable level) gets a stronger burst + toast. */
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
        setTimeout(function () { toast.remove(); }, 2200);
      }
    }

    setTimeout(function () { plotEl.classList.remove("pulse-up", "celebrate-up"); }, big ? 900 : 500);
  }

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

  /* Shared activity-feed widget used by view.js and run-view.js — both poll the same
     /api/state events array and render it the same floating panel + unseen-count badge. */
  function createFeedWidget(els) {
    var lastEventIds = "";
    var seenEventId = null;
    var feedOpen = false;
    var feedInitialized = false;

    function render(events) {
      var ids = events.map(function (e) { return e.id; }).join(",");
      if (ids !== lastEventIds) {
        lastEventIds = ids;
        els.listEl.innerHTML = "";
        if (!events.length) {
          var empty = document.createElement("li");
          empty.className = "feed-empty";
          empty.textContent = "ยังไม่มีความเคลื่อนไหว";
          els.listEl.appendChild(empty);
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
            els.listEl.appendChild(li);
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
      els.countEl.hidden = unseenCount <= 0;
      els.countEl.textContent = unseenCount > 9 ? "9+" : String(unseenCount);
    }

    els.toggleEl.addEventListener("click", function () {
      feedOpen = !feedOpen;
      els.widgetEl.classList.toggle("open", feedOpen);
      if (feedOpen && lastEventIds) {
        var ids = lastEventIds.split(",");
        seenEventId = ids[0] || null;
        els.countEl.hidden = true;
      }
    });

    function tick() {
      els.listEl.querySelectorAll(".feed-time").forEach(function (el) {
        el.textContent = relativeTime(Number(el.dataset.ts));
      });
    }

    return { render: render, tick: tick };
  }

  function applyWeather(sceneEl) {
    var w = weatherForNow();
    if (sceneEl.dataset.weather === w) return w;
    sceneEl.dataset.weather = w;
    sceneEl.querySelectorAll(".raindrop, .snowflake").forEach(function (el) { el.remove(); });
    if (w === "rain") {
      for (var i = 0; i < 40; i++) {
        var drop = document.createElement("div");
        drop.className = "raindrop";
        drop.style.left = Math.random() * 100 + "%";
        drop.style.animationDelay = (Math.random() * 1.2).toFixed(2) + "s";
        drop.style.animationDuration = (0.5 + Math.random() * 0.4).toFixed(2) + "s";
        sceneEl.appendChild(drop);
      }
    } else if (w === "snow") {
      for (var j = 0; j < 34; j++) {
        var flake = document.createElement("div");
        flake.className = "snowflake";
        flake.textContent = "❄";
        flake.style.left = Math.random() * 100 + "%";
        flake.style.animationDelay = (Math.random() * 6).toFixed(2) + "s";
        flake.style.animationDuration = (5 + Math.random() * 4).toFixed(2) + "s";
        flake.style.fontSize = (8 + Math.random() * 8).toFixed(0) + "px";
        sceneEl.appendChild(flake);
      }
    }
    return w;
  }

  global.Scoreboard = {
    PALETTE: PALETTE,
    DECORATION_TYPES: DECORATION_TYPES,
    KM_PER_LEVEL: KM_PER_LEVEL,
    levelForKm: levelForKm,
    kmToNextLevel: kmToNextLevel,
    milestoneNameForLevel: milestoneNameForLevel,
    isNotableLevel: isNotableLevel,
    celebrationTextForLevel: celebrationTextForLevel,
    featuresForLevel: featuresForLevel,
    decorationsForLevel: decorationsForLevel,
    buildHousePlot: buildHousePlot,
    updateHouseVisual: updateHouseVisual,
    renderDecorLayer: renderDecorLayer,
    buildRunIcon: buildRunIcon,
    celebrateUpgrade: celebrateUpgrade,
    applyWeather: applyWeather,
    clamp: clamp,
    relativeTime: relativeTime,
    createFeedWidget: createFeedWidget
  };
})(window);
