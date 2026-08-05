(function () {
  "use strict";

  var S = window.Scoreboard;
  var POLL_MS = 3000;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var gridEl = document.getElementById("teamMapsGrid");
  var titleEl = document.getElementById("boardTitle");
  var lastUpdatedEl = document.getElementById("lastUpdated");
  var feedListEl = document.getElementById("feedList");
  var feedWidget = document.getElementById("feedWidget");
  var feedToggle = document.getElementById("feedToggle");
  var feedCountEl = document.getElementById("feedCount");
  var rankSummaryEl = document.getElementById("rankSummary");
  var kioskToggleBtn = document.getElementById("kioskToggle");
  var kioskBackdrop = document.getElementById("kioskBackdrop");
  var kioskHeader = document.getElementById("kioskHeader");
  var kioskTeamNameEl = document.getElementById("kioskTeamName");
  var kioskExitBtn = document.getElementById("kioskExit");
  var clockTimeEl = document.getElementById("clockTime");
  var clockDateEl = document.getElementById("clockDate");
  var bgmEl = document.getElementById("bgm");
  var bgmToggleBtn = document.getElementById("bgmToggle");

  var feed = S.createFeedWidget({ listEl: feedListEl, widgetEl: feedWidget, toggleEl: feedToggle, countEl: feedCountEl });

  var route = null; // { waypoints, viewBox: {w,h}, finishKm }
  var routeD = "";
  var routeSegments = [];
  var pinOffsets = []; // precomputed {ox,oy} per waypoint, shared by every card
  var subTicks = []; // small unlabeled dots every 50km between named waypoints
  var cardRefs = new Map(); // teamId -> refs
  var lastTeamOrder = "";
  var lastFetchTs = null;
  var currentRanks = {}; // teamId -> 1-based rank by km, recomputed every render
  var lastTeamsSnapshot = []; // latest team array, used by kiosk mode to cycle through
  var VEHICLE_LOOP_MS = 26000;
  var DUST_OFFSETS_KM = [12, 24, 36];

  var kioskActive = false;
  var kioskIndex = 0;
  var kioskTimer = null;
  var kioskCurrentTeamId = null;
  var KIOSK_INTERVAL_MS = 8000;

  function pctX(x) { return (x / route.viewBox.w * 100) + "%"; }
  function pctY(y) { return (y / route.viewBox.h * 100) + "%"; }

  /* Smooth the polyline through the real waypoints by curving through their midpoints
     (a common cheap Bezier trick) — the road reads as a curve, not a jagged zig-zag. */
  function smoothPathD(points) {
    if (!points.length) return "";
    var d = "M " + points[0].x + " " + points[0].y;
    for (var i = 1; i < points.length - 1; i++) {
      var mx = (points[i].x + points[i + 1].x) / 2;
      var my = (points[i].y + points[i + 1].y) / 2;
      d += " Q " + points[i].x + " " + points[i].y + " " + mx + " " + my;
    }
    var last = points[points.length - 1];
    d += " L " + last.x + " " + last.y;
    return d;
  }

  /* Same curve as smoothPathD, but as a list of evaluable segments instead of a path
     string — used to walk the ambient decorative vehicle exactly along the visible road
     (it used to reuse positionForKm's straight waypoint-to-waypoint lines, which cut
     corners badly wherever the smoothed curve bends away from that, e.g. around ตาก). */
  function buildRouteSegments(points) {
    var segs = [];
    if (!points.length) return segs;
    var prevEnd = { x: points[0].x, y: points[0].y };
    for (var i = 1; i < points.length - 1; i++) {
      var mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
      segs.push({ type: "Q", p0: prevEnd, c: points[i], p1: mid });
      prevEnd = mid;
    }
    var lastPt = points[points.length - 1];
    segs.push({ type: "L", p0: prevEnd, p1: { x: lastPt.x, y: lastPt.y } });
    return segs;
  }

  function pointOnSegment(seg, t) {
    if (seg.type === "L") {
      return { x: seg.p0.x + (seg.p1.x - seg.p0.x) * t, y: seg.p0.y + (seg.p1.y - seg.p0.y) * t };
    }
    var mt = 1 - t;
    return {
      x: mt * mt * seg.p0.x + 2 * mt * t * seg.c.x + t * t * seg.p1.x,
      y: mt * mt * seg.p0.y + 2 * mt * t * seg.c.y + t * t * seg.p1.y
    };
  }

  /* Position for a loop fraction (0-1) spread evenly across every segment of the visible
     curve — purely decorative, so equal time per segment (rather than true arc-length or
     km-accurate pacing) is plenty smooth and always exactly on the road. */
  function positionOnRouteCurve(t) {
    if (!routeSegments.length) return { x: 0, y: 0 };
    var scaled = ((t % 1) + 1) % 1 * routeSegments.length;
    var idx = Math.min(routeSegments.length - 1, Math.floor(scaled));
    return pointOnSegment(routeSegments[idx], scaled - idx);
  }

  /* Perpendicular direction of the road at waypoint i, from the segments either side of
     it — used to push each place's label off the road instead of stacking labels on top
     of the dashed line (and the runner marker, when it's sitting right on a checkpoint). */
  function perpAt(i) {
    var wps = route.waypoints;
    var prev = wps[i - 1] || wps[i];
    var next = wps[i + 1] || wps[i];
    var dx = next.x - prev.x, dy = next.y - prev.y;
    var len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  }

  // กรุงเทพฯ sits only ~40km (and visually just ~85 canvas units) from ปทุมธานี — the
  // standard offset isn't enough to keep the two place-name pins apart, so it gets pushed
  // further out specifically.
  var PIN_OFFSET_OVERRIDES = { "กรุงเทพฯ (TDFB HQ)": 78 };

  function computePinOffsets() {
    var OFFSET = 38;
    return route.waypoints.map(function (wp, i) {
      var perp = perpAt(i);
      var side = i % 2 === 0 ? 1 : -1;
      var dist = PIN_OFFSET_OVERRIDES[wp.name] || OFFSET;
      return { ox: wp.x + perp.x * dist * side, oy: wp.y + perp.y * dist * side };
    });
  }

  /* Small unlabeled dots every 50km between the named waypoints, purely so the road
     reads with finer progress granularity than just the big province markers. */
  function computeSubTicks() {
    var wps = route.waypoints;
    var ticks = [];
    for (var i = 0; i < wps.length - 1; i++) {
      var a = wps[i], b = wps[i + 1];
      for (var k = Math.ceil(a.km / 50) * 50; k < b.km; k += 50) {
        if (k <= a.km) continue;
        var t = (k - a.km) / ((b.km - a.km) || 1);
        ticks.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return ticks;
  }

  /* Traveled-so-far path, built with the exact same per-segment interpolation as
     positionForKm — guarantees the solid line always ends precisely at the runner. */
  function progressPathD(km) {
    var wps = route.waypoints;
    var k = Math.max(0, Number(km) || 0);
    var d = "M " + wps[0].x + " " + wps[0].y;
    for (var i = 0; i < wps.length - 1; i++) {
      var a = wps[i], b = wps[i + 1];
      if (k >= b.km) {
        d += " L " + b.x + " " + b.y;
      } else {
        var t = (k - a.km) / ((b.km - a.km) || 1);
        d += " L " + (a.x + (b.x - a.x) * t) + " " + (a.y + (b.y - a.y) * t);
        break;
      }
    }
    return d;
  }

  function confettiBurst(frame) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var colors = ["#ffd873", "#e6536b", "#4a90d9", "#4f9a5b", "#8B6FD1", "#3FA9A0"];
    for (var i = 0; i < 24; i++) {
      var piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.left = (Math.random() * 100) + "%";
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = (Math.random() * 0.4).toFixed(2) + "s";
      piece.style.animationDuration = (1.6 + Math.random() * 0.8).toFixed(2) + "s";
      frame.appendChild(piece);
      (function (p) { setTimeout(function () { p.remove(); }, 2800); })(piece);
    }
  }

  /* Position along the route for a given km: interpolates linearly between the two
     waypoints straddling it, and reports the place name / distance to the next place.
     Past the last waypoint, the marker stays pinned there and `overshoot` reports how
     far beyond that the team ran. */
  function positionForKm(km) {
    var wps = route.waypoints;
    var k = Math.max(0, Number(km) || 0);
    var first = wps[0], last = wps[wps.length - 1];
    if (k <= first.km) {
      var seg0 = wps[1] || first;
      return { x: first.x, y: first.y, place: first.name, nextPlace: seg0.name, kmToNext: Math.max(0, seg0.km - k), overshoot: 0 };
    }
    for (var i = 0; i < wps.length - 1; i++) {
      var a = wps[i], b = wps[i + 1];
      if (k <= b.km) {
        var t = (k - a.km) / ((b.km - a.km) || 1);
        return {
          x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
          place: a.name, nextPlace: b.name, kmToNext: Math.max(0, Math.round(b.km - k)), overshoot: 0
        };
      }
    }
    return { x: last.x, y: last.y, place: last.name, nextPlace: null, kmToNext: 0, overshoot: Math.round(k - last.km) };
  }

  function svgEl(name, attrs) {
    var e = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  /* Static terrain + road backdrop, identical for every card. Gradient/pattern ids are
     suffixed per card since duplicate ids in one document would all resolve to the first
     one defined. */
  function mapSvgMarkup(uid) {
    return "" +
      '<svg viewBox="0 0 520 860" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
        "<defs>" +
          '<linearGradient id="terrainGrad-' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#8CA3B8" />' +
            '<stop offset="28%" stop-color="#7FAE6F" />' +
            '<stop offset="60%" stop-color="#A8C96A" />' +
            '<stop offset="100%" stop-color="#DCDC93" />' +
          "</linearGradient>" +
          '<pattern id="paddyHatch-' + uid + '" width="26" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">' +
            '<line x1="0" y1="14" x2="26" y2="0" stroke="#8fae55" stroke-width="2" opacity="0.35" />' +
          "</pattern>" +
        "</defs>" +
        '<rect x="0" y="0" width="520" height="860" fill="url(#terrainGrad-' + uid + ')" />' +
        '<rect x="0" y="600" width="520" height="260" fill="url(#paddyHatch-' + uid + ')" />' +
        '<path d="M0,230 L60,140 L110,210 L170,110 L230,200 L300,130 L360,215 L520,150 L520,0 L0,0 Z" fill="#5c7a72" opacity="0.55" />' +
        '<path d="M0,280 L80,190 L150,260 L230,170 L320,250 L400,180 L520,240 L520,0 L0,0 Z" fill="#496359" opacity="0.35" />' +
        '<path d="M40,780 C120,760 100,700 180,680 C260,660 235,600 320,585" fill="none" stroke="#6fb8d9" stroke-width="4" stroke-linecap="round" opacity="0.35" />' +
        '<g fill="#4f8a55" opacity="0.4">' +
          '<circle cx="90" cy="380" r="26" /><circle cx="130" cy="360" r="20" />' +
          '<circle cx="410" cy="420" r="24" /><circle cx="440" cy="450" r="18" /><circle cx="180" cy="470" r="22" />' +
          '<circle cx="220" cy="530" r="18" /><circle cx="480" cy="610" r="20" /><circle cx="60" cy="600" r="16" /><circle cx="300" cy="700" r="18" />' +
        "</g>" +
        '<g transform="translate(478,695)" opacity="0.5">' +
          '<polygon points="0,-34 8,-10 -8,-10" fill="#c9a24a" />' +
          '<polygon points="-14,-10 14,-10 10,4 -10,4" fill="#b98f3d" />' +
          '<rect x="-16" y="4" width="32" height="14" fill="#a97f36" />' +
        "</g>" +
        '<rect class="night-overlay" x="0" y="0" width="520" height="860" />' +
        '<g fill="#fff" class="night-stars">' +
          '<circle class="night-star" cx="70" cy="60" r="1.6" /><circle class="night-star" cx="140" cy="30" r="1.2" />' +
          '<circle class="night-star" cx="230" cy="70" r="1.8" /><circle class="night-star" cx="310" cy="25" r="1.3" />' +
          '<circle class="night-star" cx="380" cy="90" r="1.5" /><circle class="night-star" cx="450" cy="40" r="1.2" />' +
          '<circle class="night-star" cx="490" cy="110" r="1.6" /><circle class="night-star" cx="30" cy="130" r="1.3" />' +
        "</g>" +
        '<path class="route-glow" d="" /><path class="route-path" d="" /><path class="route-progress" d="" />' +
        '<g class="pin-leaders" stroke="#7a5230" stroke-width="1" stroke-dasharray="2 2" opacity="0.6"></g>' +
        '<g class="sub-ticks"></g>' +
        '<g class="pin-dots"></g>' +
      "</svg>";
  }

  function renderSubTicks(refs) {
    refs.subTicksEl.innerHTML = "";
    subTicks.forEach(function (tick) {
      refs.subTicksEl.appendChild(svgEl("circle", { cx: tick.x, cy: tick.y, r: 2, fill: "#fff8e6", opacity: 0.6 }));
    });
  }

  function renderPins(refs) {
    refs.pinsLayer.innerHTML = "";
    refs.pinDotsEl.innerHTML = "";
    refs.pinLeadersEl.innerHTML = "";
    refs.pinWeatherEls = [];
    route.waypoints.forEach(function (wp, i) {
      var isFinish = wp.km === route.finishKm;
      var off = pinOffsets[i];

      refs.pinDotsEl.appendChild(svgEl("circle", {
        cx: wp.x, cy: wp.y, r: isFinish ? 6 : 3.5,
        fill: isFinish ? "#ffd873" : "#fff", stroke: isFinish ? "#b3860f" : "#7a5230", "stroke-width": 2
      }));
      refs.pinLeadersEl.appendChild(svgEl("line", { x1: wp.x, y1: wp.y, x2: off.ox, y2: off.oy }));

      var pin = document.createElement("div");
      pin.className = "way-label-pin" + (isFinish ? " finish" : "");
      pin.style.left = pctX(off.ox);
      pin.style.top = pctY(off.oy);

      /* This pin is centered on both axes by default, but several waypoints (start/finish
         especially) sit close enough to a frame corner that centering pushes the label past
         the clipped border on both sides at once — anchor toward the inside instead whenever
         the offset point is near an edge. Static per-waypoint offsets, so this only needs
         computing once here, not on every km update. */
      var hFrac = off.ox / route.viewBox.w;
      var vFrac = off.oy / route.viewBox.h;
      var tx = hFrac < 0.1 ? "-8%" : hFrac > 0.85 ? "-92%" : "-50%";
      var ty = vFrac < 0.12 ? "-8%" : vFrac > 0.85 ? "-92%" : "-50%";
      pin.style.transform = "translate(" + tx + ", " + ty + ")";

      var label = document.createElement("span");
      label.className = "way-label";
      // A few names carry a parenthetical ("กรุงเทพฯ (TDFB HQ)", "แม่สาย (ชายแดน)") long
      // enough to make the pill unusually wide — break onto a second line at that point
      // instead of forcing every other (mostly short) label to allow wrapping too.
      var parenIdx = wp.name.indexOf(" (");
      if (parenIdx !== -1) {
        label.appendChild(document.createTextNode(wp.name.slice(0, parenIdx)));
        label.appendChild(document.createElement("br"));
        label.appendChild(document.createTextNode(wp.name.slice(parenIdx + 1)));
      } else {
        label.appendChild(document.createTextNode(wp.name));
      }
      label.appendChild(document.createTextNode(" "));
      var weatherEl = document.createElement("span");
      weatherEl.className = "way-weather";
      label.appendChild(weatherEl);
      var km = document.createElement("span");
      km.className = "way-km";
      km.textContent = wp.km + " กม.";

      pin.title = wp.name;
      pin.appendChild(label);
      pin.appendChild(km);
      refs.pinsLayer.appendChild(pin);
      refs.pinWeatherEls.push({ name: wp.name, emojiEl: weatherEl, pinEl: pin });
    });
  }

  /* Real current weather per waypoint (same for every card — the route is shared), fetched
     separately from team km on its own slower interval. Only a single emoji is ever shown
     inline; full condition + temperature stay in the pin's title tooltip (hover/tap), same
     low-clutter pattern the stamp chips already use, so 12 waypoints x 3 cards never gets
     visually noisy. */
  var weatherByPlace = {};

  /* Maps a real Open-Meteo WMO weather code to one of the ambient background categories the
     card frame's CSS already knows how to render (rain/snow — anything else keeps the
     default "sun" look with no filter), so each team's map background reflects the actual
     current weather of whichever province that team is passing through right now. */
  function weatherCategoryFromCode(code) {
    if (code == null) return null;
    if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return "snow";
    if ((code >= 51 && code <= 67) || code === 80 || code === 81 || code === 82 || (code >= 95 && code <= 99)) return "rain";
    return "sun";
  }

  function realWeatherCategoryForPlace(place) {
    var w = weatherByPlace[place];
    return w && w.code != null ? weatherCategoryFromCode(w.code) : null;
  }

  function applyWeatherToPins() {
    cardRefs.forEach(function (refs) {
      if (!refs.pinWeatherEls) return;
      refs.pinWeatherEls.forEach(function (entry) {
        var w = weatherByPlace[entry.name];
        entry.emojiEl.textContent = w ? w.emoji : "";
        entry.emojiEl.style.background = w ? w.color : "transparent";
        entry.pinEl.title = w ? (entry.name + " · " + w.label + " · " + w.temp + "°C") : entry.name;
      });
    });
  }

  function refreshWeatherClient() {
    fetch("/api/weather")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        weatherByPlace = data || {};
        applyWeatherToPins();
      })
      .catch(function () {});
  }

  function buildTeamMapCard(team) {
    var card = document.createElement("div");
    card.className = "team-map-card";

    var header = document.createElement("div");
    header.className = "team-map-header";
    var title = document.createElement("div");
    title.className = "team-map-title";
    var rankEl = document.createElement("span");
    rankEl.className = "team-map-rank";
    var nameEl = document.createElement("span");
    nameEl.className = "team-map-name";
    title.appendChild(rankEl);
    title.appendChild(nameEl);
    var kmEl = document.createElement("span");
    kmEl.className = "team-map-km";
    header.appendChild(title);
    header.appendChild(kmEl);

    var frame = document.createElement("div");
    frame.className = "map-frame";
    frame.innerHTML = mapSvgMarkup(team.id);
    var cloudA = document.createElement("div");
    cloudA.className = "map-cloud";
    var cloudB = document.createElement("div");
    cloudB.className = "map-cloud map-cloud--b";
    var vehicleEl = document.createElement("div");
    vehicleEl.className = "ambient-vehicle";
    vehicleEl.setAttribute("aria-hidden", "true");
    vehicleEl.textContent = "\u{1F6F5}";
    var pinsLayer = document.createElement("div");
    pinsLayer.className = "pins-layer";
    var runnersLayer = document.createElement("div");
    runnersLayer.className = "runners-layer";
    frame.appendChild(cloudA);
    frame.appendChild(cloudB);
    frame.appendChild(pinsLayer);
    frame.appendChild(runnersLayer);
    frame.appendChild(vehicleEl);

    var dustEls = [1, 2, 3].map(function (n) {
      var d = document.createElement("div");
      d.className = "runner-dust runner-dust--" + n;
      runnersLayer.appendChild(d);
      return d;
    });

    var runnerWrap = document.createElement("div");
    runnerWrap.className = "runner";
    var shadow = document.createElement("div");
    shadow.className = "runner-shadow";
    var badge = document.createElement("div");
    badge.className = "runner-badge";
    var emoji = document.createElement("span");
    emoji.className = "runner-emoji";
    emoji.setAttribute("aria-hidden", "true");
    emoji.textContent = "\u{1F3C3}";
    badge.appendChild(emoji);
    var tag = document.createElement("div");
    tag.className = "runner-tag";
    var runnerName = document.createElement("div");
    runnerName.className = "runner-name";
    var runnerKm = document.createElement("div");
    runnerKm.className = "runner-km";
    var finalStretchTag = document.createElement("div");
    finalStretchTag.className = "final-stretch-tag";
    finalStretchTag.textContent = "\u{1F3C1} โค้งสุดท้าย!";
    tag.appendChild(runnerName);
    tag.appendChild(runnerKm);
    tag.appendChild(finalStretchTag);
    runnerWrap.appendChild(shadow);
    runnerWrap.appendChild(badge);
    runnerWrap.appendChild(tag);
    runnersLayer.appendChild(runnerWrap);

    var place = document.createElement("div");
    place.className = "team-map-place";

    var barTrack = document.createElement("div");
    barTrack.className = "roster-bar-track";
    var barFill = document.createElement("div");
    barFill.className = "roster-bar-fill";
    barTrack.appendChild(barFill);

    var stamps = document.createElement("div");
    stamps.className = "team-map-stamps";
    var stampChips = route ? route.waypoints.map(function (wp, i) {
      var chip = document.createElement("span");
      chip.className = "stamp-chip";
      chip.title = wp.name + " (" + wp.km + " กม.)";
      chip.textContent = String(i + 1);
      stamps.appendChild(chip);
      return chip;
    }) : [];

    card.appendChild(header);
    card.appendChild(frame);
    card.appendChild(place);
    card.appendChild(barTrack);
    card.appendChild(stamps);

    var refs = {
      card: card, nameEl: nameEl, kmEl: kmEl, rankEl: rankEl, placeEl: place, barFill: barFill, frame: frame,
      routePathEl: frame.querySelector(".route-path"), routeGlowEl: frame.querySelector(".route-glow"),
      routeProgressEl: frame.querySelector(".route-progress"),
      pinDotsEl: frame.querySelector(".pin-dots"), pinLeadersEl: frame.querySelector(".pin-leaders"),
      subTicksEl: frame.querySelector(".sub-ticks"),
      pinsLayer: pinsLayer, runnerWrap: runnerWrap, runnerName: runnerName, runnerKm: runnerKm, tagEl: tag,
      dustEls: dustEls, stampChips: stampChips, vehicleEl: vehicleEl, vehiclePhase: Math.random() * VEHICLE_LOOP_MS,
      lastPlace: null
    };

    if (route) {
      refs.routePathEl.setAttribute("d", routeD);
      refs.routeGlowEl.setAttribute("d", routeD);
      renderPins(refs);
      renderSubTicks(refs);
    }
    S.applyWeather(frame);
    frame.dataset.night = S.dayPhase();
    return refs;
  }

  function celebrateRunner(refs, big) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    refs.runnerWrap.classList.remove("celebrate");
    void refs.runnerWrap.offsetWidth;
    refs.runnerWrap.classList.add("celebrate");

    var burst = document.createElement("div");
    burst.className = "runner-sparkle-burst";
    var count = big ? 10 : 6;
    for (var i = 0; i < count; i++) {
      var s = document.createElement("span");
      s.className = "runner-sparkle";
      s.style.setProperty("--angle", (360 / count) * i + "deg");
      s.textContent = big ? "🎉" : "✨";
      burst.appendChild(s);
    }
    refs.runnerWrap.appendChild(burst);
    setTimeout(function () { burst.remove(); }, 800);
    setTimeout(function () { refs.runnerWrap.classList.remove("celebrate"); }, 700);

    if (big) confettiBurst(refs.frame);
  }

  function showToast(refs, text) {
    var toast = document.createElement("div");
    toast.className = "runner-toast";
    toast.textContent = text;
    refs.runnerWrap.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 2200);
  }

  function fullRebuild(teams) {
    gridEl.innerHTML = "";
    cardRefs.clear();
    if (!teams.length) {
      var empty = document.createElement("div");
      empty.className = "team-maps-empty";
      empty.textContent = "ยังไม่มีทีม";
      gridEl.appendChild(empty);
    } else {
      teams.forEach(function (team) {
        var refs = buildTeamMapCard(team);
        gridEl.appendChild(refs.card);
        cardRefs.set(team.id, refs);
      });
      teams.forEach(updateCard);
    }
    lastTeamOrder = teams.map(function (t) { return t.id; }).join(",");
  }

  function updateCard(team) {
    var refs = cardRefs.get(team.id);
    if (!refs) return;
    refs.card.style.setProperty("--accent", team.color);
    refs.nameEl.textContent = team.name;
    refs.kmEl.textContent = team.km + " กม.";
    refs.rankEl.textContent = S.rankBadgeText(currentRanks[team.id] || 1);

    var p = positionForKm(team.km);
    refs.runnerWrap.style.left = pctX(p.x);
    refs.runnerWrap.style.top = pctY(p.y);
    refs.runnerName.textContent = team.name;
    refs.runnerKm.textContent = team.km + " กม.";

    /* The name+km tag is centered on the runner by default, but near the map's left/right
       edges (e.g. right at the start point) that centering pushes it past the frame's
       clipped border — flip its anchor near either edge so it always stays fully visible. */
    var edgeFrac = p.x / route.viewBox.w;
    refs.tagEl.classList.toggle("runner-tag--edge-start", edgeFrac < 0.2);
    refs.tagEl.classList.toggle("runner-tag--edge-end", edgeFrac > 0.8);

    refs.routeProgressEl.setAttribute("d", progressPathD(team.km));
    DUST_OFFSETS_KM.forEach(function (behindKm, i) {
      var dp = positionForKm(Math.max(0, team.km - behindKm));
      refs.dustEls[i].style.left = pctX(dp.x);
      refs.dustEls[i].style.top = pctY(dp.y);
    });
    refs.stampChips.forEach(function (chip, i) {
      chip.classList.toggle("reached", team.km >= route.waypoints[i].km);
    });

    if (refs.lastPlace !== null && p.place !== refs.lastPlace) {
      var big = p.place.indexOf("เชียงราย") !== -1;
      celebrateRunner(refs, big);
      showToast(refs, big ? "\u{1F3C5} ถึงเชียงรายแล้ว!" : "\u{1F4CD} ถึง" + p.place + "แล้ว!");
    }
    refs.lastPlace = p.place;

    var weatherCat = realWeatherCategoryForPlace(p.place);
    if (weatherCat) S.applyWeather(refs.frame, weatherCat);

    var finalStretch = team.km < route.finishKm && (route.finishKm - team.km) <= 50;
    refs.runnerWrap.classList.toggle("final-stretch", finalStretch);

    if (p.overshoot > 0) {
      refs.placeEl.textContent = "\u{1F389} ถึงจุดหมายแล้ว! เลย " + p.place + " ไปอีก " + p.overshoot + " กม.";
    } else if (p.nextPlace) {
      refs.placeEl.textContent = "อยู่ที่ " + p.place + " · อีก " + p.kmToNext + " กม. ถึง" + p.nextPlace;
    } else {
      refs.placeEl.textContent = "อยู่ที่ " + p.place;
    }
    var pct = S.clamp((team.km / route.finishKm) * 100, 0, 100);
    refs.barFill.style.width = pct + "%";
  }

  /* One mini track per team, ranked — the whole race at a glance without opening every
     card. Small enough team count that a full rebuild each poll is simplest and cheap. */
  function renderRankSummary(teams) {
    rankSummaryEl.innerHTML = "";
    if (!teams.length) return;
    var sorted = teams.slice().sort(function (a, b) { return b.km - a.km; });
    sorted.forEach(function (team, i) {
      var row = document.createElement("div");
      row.className = "rank-row";
      var medal = document.createElement("span");
      medal.className = "rank-medal";
      medal.textContent = S.rankBadgeText(i + 1);
      var name = document.createElement("span");
      name.className = "rank-name";
      name.textContent = team.name;
      var track = document.createElement("div");
      track.className = "rank-track";
      var fill = document.createElement("div");
      fill.className = "rank-track-fill";
      fill.style.background = team.color;
      fill.style.width = S.clamp((team.km / route.finishKm) * 100, 0, 100) + "%";
      track.appendChild(fill);
      var km = document.createElement("span");
      km.className = "rank-km";
      km.textContent = team.km + " กม.";
      row.appendChild(medal);
      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(km);
      rankSummaryEl.appendChild(row);
    });

    var banner = document.createElement("div");
    banner.className = "close-race-banner";
    if (sorted.length >= 2) {
      var gap = Math.round((sorted[0].km - sorted[1].km) * 100) / 100;
      if (gap <= 20) {
        banner.classList.add("show");
        banner.textContent = "\u{1F525} " + sorted[0].name + " กับ " + sorted[1].name + " สูสีกันมาก! ห่างกันแค่ " + gap + " กม.";
      }
    }
    rankSummaryEl.appendChild(banner);
  }

  function render(state) {
    titleEl.textContent = state.title;
    currentRanks = S.computeRanks(state.teams);
    lastTeamsSnapshot = state.teams;
    var order = state.teams.map(function (t) { return t.id; }).join(",");
    if (order !== lastTeamOrder) { fullRebuild(state.teams); applyWeatherToPins(); } else state.teams.forEach(updateCard);
    renderRankSummary(state.teams);
    feed.render(state.events || []);
    lastFetchTs = Date.now();
  }

  function tickVehicles() {
    var now = Date.now();
    cardRefs.forEach(function (refs) {
      var t = ((now + refs.vehiclePhase) % VEHICLE_LOOP_MS) / VEHICLE_LOOP_MS;
      var p = positionOnRouteCurve(t);
      refs.vehicleEl.style.left = pctX(p.x);
      refs.vehicleEl.style.top = pctY(p.y);
    });
  }

  function tickDayNight() {
    var phase = S.dayPhase();
    cardRefs.forEach(function (refs) { refs.frame.dataset.night = phase; });
  }

  /* Kiosk/TV mode blows up one team's actual card in place (a class toggle, not a
     reparent) and cycles to the next team on a timer — meant for an office TV display. */
  function showKioskTeam(i) {
    var team = lastTeamsSnapshot[i];
    if (!team) return;
    if (kioskCurrentTeamId) {
      var prevRefs = cardRefs.get(kioskCurrentTeamId);
      if (prevRefs) prevRefs.card.classList.remove("kiosk-active");
    }
    var refs = cardRefs.get(team.id);
    if (refs) refs.card.classList.add("kiosk-active");
    kioskCurrentTeamId = team.id;
    kioskTeamNameEl.textContent = team.name;
  }

  function startKiosk() {
    if (!lastTeamsSnapshot.length) return;
    kioskActive = true;
    kioskBackdrop.classList.add("active");
    kioskHeader.classList.add("active");
    kioskIndex = 0;
    showKioskTeam(kioskIndex);
    kioskTimer = setInterval(function () {
      kioskIndex = (kioskIndex + 1) % lastTeamsSnapshot.length;
      showKioskTeam(kioskIndex);
    }, KIOSK_INTERVAL_MS);
  }

  function stopKiosk() {
    kioskActive = false;
    clearInterval(kioskTimer);
    kioskBackdrop.classList.remove("active");
    kioskHeader.classList.remove("active");
    if (kioskCurrentTeamId) {
      var refs = cardRefs.get(kioskCurrentTeamId);
      if (refs) refs.card.classList.remove("kiosk-active");
    }
    kioskCurrentTeamId = null;
  }

  kioskToggleBtn.addEventListener("click", function () {
    if (kioskActive) stopKiosk(); else startKiosk();
  });
  kioskExitBtn.addEventListener("click", stopKiosk);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && kioskActive) stopKiosk();
  });

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
  setInterval(function () {
    S.applyWeather(sceneEl);
  }, 30000);

  setInterval(tickVehicles, 150);
  setInterval(tickDayNight, 60000);

  function updateClock() {
    if (!clockTimeEl || !clockDateEl) return;
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour12: false
    }).formatToParts(new Date());
    var v = {};
    parts.forEach(function (p) { v[p.type] = p.value; });
    var hour = v.hour === "24" ? "00" : v.hour;
    clockTimeEl.textContent = hour + ":" + v.minute + ":" + v.second + " น.";
    clockDateEl.textContent = v.day + "/" + v.month + "/" + (parseInt(v.year, 10) + 543);
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* Background music: browsers block autoplay-with-sound entirely, so we start muted
     (always allowed) and unmute + fade the volume in on the very first click/tap/keypress
     anywhere on the page — in practice that's within a second of load for most visitors.
     Kiosk/TV screens with nobody touching them will stay silent until someone taps the
     toggle button once; after that it keeps looping on its own. */
  if (bgmEl && bgmToggleBtn) {
    var BGM_TARGET_VOLUME = 0.18;
    var BGM_FADE_MS = 4000;
    var bgmUserPaused = false;
    var bgmReduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var setToggleLabel = function (playing) {
      bgmToggleBtn.textContent = playing ? "🔈 เพลง" : "🔇 เพลง";
    };

    var fadeIn = function () {
      if (bgmReduceMotion) { bgmEl.volume = BGM_TARGET_VOLUME; return; }
      var start = performance.now();
      function step(now) {
        var t = Math.min(1, (now - start) / BGM_FADE_MS);
        bgmEl.volume = BGM_TARGET_VOLUME * t;
        if (t < 1 && !bgmEl.paused) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    };

    var startPlaying = function () {
      if (bgmUserPaused) return;
      bgmEl.muted = false;
      bgmEl.play().then(fadeIn).catch(function () {});
      setToggleLabel(true);
    };

    bgmEl.volume = 0;
    bgmEl.muted = true;
    bgmEl.play().catch(function () {});

    ["click", "touchstart", "keydown"].forEach(function (evt) {
      document.addEventListener(evt, function firstInteraction() {
        startPlaying();
        ["click", "touchstart", "keydown"].forEach(function (e2) {
          document.removeEventListener(e2, firstInteraction);
        });
      }, { once: true });
    });

    bgmToggleBtn.addEventListener("click", function () {
      if (bgmEl.paused || bgmEl.muted) {
        bgmUserPaused = false;
        startPlaying();
      } else {
        bgmUserPaused = true;
        bgmEl.pause();
        setToggleLabel(false);
      }
    });
  }

  fetch("/api/route")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      route = data;
      routeD = smoothPathD(route.waypoints);
      routeSegments = buildRouteSegments(route.waypoints);
      pinOffsets = computePinOffsets();
      subTicks = computeSubTicks();
      poll();
      setInterval(poll, POLL_MS);
      refreshWeatherClient();
      setInterval(refreshWeatherClient, 5 * 60 * 1000);
    });
})();
