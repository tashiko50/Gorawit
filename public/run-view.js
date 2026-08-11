(function () {
  "use strict";

  var S = window.Scoreboard;
  var POLL_MS = 3000;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var gridEl = document.getElementById("teamMapsGrid");
  var titleEl = document.getElementById("boardTitle");
  var lastUpdatedEl = document.getElementById("lastUpdated");
  var visitCountEl = document.getElementById("visitCount");
  var visitBadgeEl = document.getElementById("visitBadge");
  var lastVisitCount = null;
  var rankSummaryEl = document.getElementById("rankSummary");
  var topRunnersSummaryEl = document.getElementById("topRunnersSummary");
  var kioskToggleBtn = document.getElementById("kioskToggle");
  var kioskBackdrop = document.getElementById("kioskBackdrop");
  var kioskHeader = document.getElementById("kioskHeader");
  var kioskTeamNameEl = document.getElementById("kioskTeamName");
  var kioskExitBtn = document.getElementById("kioskExit");
  var clockTimeEl = document.getElementById("clockTime");
  var clockDateEl = document.getElementById("clockDate");
  var bgmEl = document.getElementById("bgm");
  var bgmToggleBtn = document.getElementById("bgmToggle");
  var top10ToggleBtn = document.getElementById("top10Toggle");
  var rank10Backdrop = document.getElementById("rank10Backdrop");
  var rank10Sheet = document.getElementById("rank10Sheet");
  var rank10Tabs = document.getElementById("rank10Tabs");
  var rank10Body = document.getElementById("rank10Body");
  var rank10Close = document.getElementById("rank10Close");
  var rank10ActiveTeamId = null;

  // Each entry: { id, label, waypoints, viewBox: {w,h}, finishKm, startKm, routeD,
  // routeSegments, pinOffsets, subTicks } — a team resolves to whichever chapter its own
  // km has reached (see chapterForKm), so two cards can legitimately be on different
  // chapters' art at the same time. Everything that used to close over one global `route`
  // now takes the relevant chapter as a parameter instead.
  var chapters = [];
  var overallFinishKm = 0; // last chapter's finishKm, once loaded — used for the whole-race progress bars in the rank summary
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

  function pctX(x, chapter) { return (x / chapter.viewBox.w * 100) + "%"; }
  function pctY(y, chapter) { return (y / chapter.viewBox.h * 100) + "%"; }

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
  function positionOnRouteCurve(t, chapter) {
    var segs = chapter.routeSegments;
    if (!segs.length) return { x: 0, y: 0 };
    var scaled = ((t % 1) + 1) % 1 * segs.length;
    var idx = Math.min(segs.length - 1, Math.floor(scaled));
    return pointOnSegment(segs[idx], scaled - idx);
  }

  /* Perpendicular direction of the road at waypoint i, from the segments either side of
     it — used to push each place's label off the road instead of stacking labels on top
     of the dashed line (and the runner marker, when it's sitting right on a checkpoint). */
  function perpAt(chapter, i) {
    var wps = chapter.waypoints;
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

  function computePinOffsets(chapter) {
    var OFFSET = 38;
    return chapter.waypoints.map(function (wp, i) {
      var perp = perpAt(chapter, i);
      var side = i % 2 === 0 ? 1 : -1;
      var dist = PIN_OFFSET_OVERRIDES[wp.name] || OFFSET;
      return { ox: wp.x + perp.x * dist * side, oy: wp.y + perp.y * dist * side };
    });
  }

  /* Small unlabeled dots every 50km between the named waypoints, purely so the road
     reads with finer progress granularity than just the big province markers. */
  function computeSubTicks(chapter) {
    var wps = chapter.waypoints;
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
  function progressPathD(km, chapter) {
    var wps = chapter.waypoints;
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

  /* Small radial sparkle burst around the visit-count badge, for a round-number crossing
     (100, 200, 300, ...) — same technique as the checkpoint sparkle burst, just its own
     class names so its short travel distance never gets confused with the bigger one. */
  function celebrateVisitMilestone() {
    if (!visitBadgeEl) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var burst = document.createElement("div");
    burst.className = "visit-sparkle-burst";
    var count = 8;
    for (var i = 0; i < count; i++) {
      var s = document.createElement("span");
      s.className = "visit-sparkle";
      s.style.setProperty("--angle", (360 / count) * i + "deg");
      s.textContent = "🎉";
      burst.appendChild(s);
    }
    visitBadgeEl.appendChild(burst);
    setTimeout(function () { burst.remove(); }, 1000);
  }

  /* Which chapter a given absolute km belongs to — the last chapter whose startKm has
     been reached. Chapters are always in ascending startKm order (as sent by the
     server), so a simple forward scan keeping the latest match is enough. */
  function chapterForKm(km) {
    var current = chapters[0];
    for (var i = 0; i < chapters.length; i++) {
      if (chapters[i].startKm <= km) current = chapters[i];
    }
    return current;
  }

  /* Position along a chapter's route for a given km: interpolates linearly between the
     two waypoints straddling it, and reports the place name / distance to the next
     place. Past the chapter's last waypoint, the marker stays pinned there and
     `overshoot` reports how far beyond that the team ran (only meaningful for the last
     chapter — earlier chapters never see overshoot since chapterForKm would already
     have moved the team into the next one by then). */
  function positionForKm(km, chapter) {
    var wps = chapter.waypoints;
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

  /* Thailand terrain + road backdrop (chapter "th") — identical to the original single-map
     art. Gradient/pattern ids are suffixed per card since duplicate ids in one document
     would all resolve to the first one defined. */
  function chapter1SvgMarkup(uid) {
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

  /* Myanmar/Yunnan backdrop for chapter "cn" (แม่สาย → คุนหมิง) — same structural class
     hooks as chapter1SvgMarkup (route-path/route-glow/route-progress/pin-dots/night-overlay) so all
     the existing weather-filter and day/night CSS keeps working unchanged on this frame
     too. The terrain gradient runs misty highland (top, near Kunming) into warmer lowland
     green (bottom, near the แม่สาย handoff) so the two chapters read as a continuous climb
     north rather than an arbitrary palette swap. */
  function chapter2SvgMarkup(uid) {
    return "" +
      '<svg viewBox="0 0 480 760" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
        "<defs>" +
          '<linearGradient id="terrainGrad2-' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#9FC2B8" />' +
            '<stop offset="35%" stop-color="#5F9A6E" />' +
            '<stop offset="70%" stop-color="#3E6E4C" />' +
            '<stop offset="100%" stop-color="#4D7A58" />' +
          "</linearGradient>" +
          '<pattern id="terraceHatch-' + uid + '" width="30" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-4)">' +
            '<rect width="30" height="6" fill="#CDB15E" opacity="0.3" />' +
          "</pattern>" +
        "</defs>" +
        '<rect x="0" y="0" width="480" height="760" fill="url(#terrainGrad2-' + uid + ')" />' +
        '<path d="M0,190 L70,120 L130,175 L210,100 L280,165 L360,110 L480,150 L480,0 L0,0 Z" fill="#AECABF" opacity="0.55" />' +
        '<path d="M0,240 L90,165 L160,220 L250,150 L330,215 L420,170 L480,205 L480,0 L0,0 Z" fill="#3E6E4C" opacity="0.35" />' +
        '<rect x="0" y="520" width="480" height="240" fill="url(#terraceHatch-' + uid + ')" />' +
        '<path d="M-10,760 C60,700 90,620 140,560 C170,525 165,480 210,455 C225,435 190,400 200,340 C205,300 185,240 195,180" fill="none" stroke="#2F7EA8" stroke-width="4" stroke-linecap="round" opacity="0.35" />' +
        '<path d="M-10,760 C60,700 90,620 140,560 C170,525 165,480 210,455 C225,435 190,400 200,340 C205,300 185,240 195,180" fill="none" stroke="#4FA0CE" stroke-width="20" stroke-linecap="round" opacity="0.55" />' +
        '<g opacity="0.8">' +
          '<polygon points="345,592 351,606 339,606" fill="#D99F2E" /><rect x="337" y="606" width="16" height="9" fill="#C0553A" />' +
          '<polygon points="363,598 367,608 359,608" fill="#D99F2E" /><rect x="360" y="608" width="8" height="6" fill="#C0553A" />' +
        "</g>" +
        '<g opacity="0.85">' +
          '<rect x="170" y="454" width="20" height="8" fill="#C0553A" /><polygon points="167,454 193,454 180,442" fill="#D99F2E" />' +
          '<rect x="173" y="434" width="14" height="8" fill="#C0553A" /><polygon points="171,434 189,434 180,424" fill="#D99F2E" />' +
        "</g>" +
        '<rect class="night-overlay" x="0" y="0" width="480" height="760" />' +
        '<g fill="#fff" class="night-stars">' +
          '<circle class="night-star" cx="60" cy="55" r="1.6" /><circle class="night-star" cx="130" cy="25" r="1.2" />' +
          '<circle class="night-star" cx="210" cy="65" r="1.8" /><circle class="night-star" cx="290" cy="20" r="1.3" />' +
          '<circle class="night-star" cx="350" cy="85" r="1.5" /><circle class="night-star" cx="420" cy="35" r="1.2" />' +
          '<circle class="night-star" cx="450" cy="105" r="1.6" /><circle class="night-star" cx="25" cy="120" r="1.3" />' +
        "</g>" +
        '<path class="route-glow" d="" /><path class="route-path" d="" /><path class="route-progress" d="" />' +
        '<g class="pin-leaders" stroke="#7a3320" stroke-width="1" stroke-dasharray="2 2" opacity="0.6"></g>' +
        '<g class="sub-ticks"></g>' +
        '<g class="pin-dots"></g>' +
      "</svg>";
  }

  function mapSvgMarkup(chapterId, uid) {
    return chapterId === "cn" ? chapter2SvgMarkup(uid) : chapter1SvgMarkup(uid);
  }

  function renderSubTicks(refs, chapter) {
    refs.subTicksEl.innerHTML = "";
    chapter.subTicks.forEach(function (tick) {
      refs.subTicksEl.appendChild(svgEl("circle", { cx: tick.x, cy: tick.y, r: 2, fill: "#fff8e6", opacity: 0.6 }));
    });
  }

  function renderPins(refs, chapter) {
    refs.pinsLayer.innerHTML = "";
    refs.pinDotsEl.innerHTML = "";
    refs.pinLeadersEl.innerHTML = "";
    refs.pinWeatherEls = [];
    chapter.waypoints.forEach(function (wp, i) {
      var isFinish = wp.km === chapter.finishKm;
      var off = chapter.pinOffsets[i];

      refs.pinDotsEl.appendChild(svgEl("circle", {
        cx: wp.x, cy: wp.y, r: isFinish ? 6 : 3.5,
        fill: isFinish ? "#ffd873" : "#fff", stroke: isFinish ? "#b3860f" : "#7a5230", "stroke-width": 2
      }));
      refs.pinLeadersEl.appendChild(svgEl("line", { x1: wp.x, y1: wp.y, x2: off.ox, y2: off.oy }));

      var pin = document.createElement("div");
      pin.className = "way-label-pin" + (isFinish ? " finish" : "");
      pin.style.left = pctX(off.ox, chapter);
      pin.style.top = pctY(off.oy, chapter);

      /* This pin is centered on both axes by default, but several waypoints (start/finish
         especially) sit close enough to a frame corner that centering pushes the label past
         the clipped border on both sides at once — anchor toward the inside instead whenever
         the offset point is near an edge. Static per-waypoint offsets, so this only needs
         computing once here, not on every km update. */
      var hFrac = off.ox / chapter.viewBox.w;
      var vFrac = off.oy / chapter.viewBox.h;
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

  /* Real current weather per waypoint (across BOTH chapters — fetched once, keyed by
     name), separate from team km on its own slower interval. Only a single emoji is ever
     shown inline; full condition + temperature stay in the pin's title tooltip. */
  var weatherByPlace = {};

  /* Maps a real Open-Meteo WMO weather code to one of the ambient background categories the
     card frame's CSS already knows how to render (rain/snow — anything else keeps the
     default "sun" look with no filter), so each team's map background reflects the actual
     current weather of whichever place that team is passing through right now. */
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

  /* (Re)builds the numbered stamp-chip row at the bottom of a card for whichever chapter
     it's currently on — called both at initial build and again on a chapter swap, since
     chapter 2 has a different waypoint count than chapter 1. */
  function buildStampChips(refs, chapter) {
    refs.stampsEl.innerHTML = "";
    refs.stampChips = chapter.waypoints.map(function (wp, i) {
      var chip = document.createElement("span");
      chip.className = "stamp-chip";
      chip.title = wp.name + " (" + wp.km + " กม.)";
      chip.textContent = String(i + 1);
      refs.stampsEl.appendChild(chip);
      return chip;
    });
  }

  /* (Re)builds a card's background map — the SVG terrain/route art plus its pins and sub-
     ticks — for whichever chapter applies right now. Used both for the very first build
     (frame starts with an empty placeholder <svg> so this always has something to replace)
     and for a live chapter swap mid-race: only the <svg> child gets swapped out, so the
     overlaid runner/dust/vehicle/cloud layers (siblings of the svg, not inside it) are
     never touched and keep animating straight through the transition. */
  function setupMapFrame(refs, chapter) {
    var temp = document.createElement("div");
    temp.innerHTML = mapSvgMarkup(chapter.id, refs.teamId);
    var newSvg = temp.firstElementChild;
    var oldSvg = refs.frame.querySelector("svg");
    if (oldSvg) refs.frame.replaceChild(newSvg, oldSvg);
    else refs.frame.insertBefore(newSvg, refs.frame.firstChild);

    refs.routePathEl = newSvg.querySelector(".route-path");
    refs.routeGlowEl = newSvg.querySelector(".route-glow");
    refs.routeProgressEl = newSvg.querySelector(".route-progress");
    refs.pinDotsEl = newSvg.querySelector(".pin-dots");
    refs.pinLeadersEl = newSvg.querySelector(".pin-leaders");
    refs.subTicksEl = newSvg.querySelector(".sub-ticks");

    refs.routePathEl.setAttribute("d", chapter.routeD);
    refs.routeGlowEl.setAttribute("d", chapter.routeD);
    renderPins(refs, chapter);
    renderSubTicks(refs, chapter);
    refs.chapter = chapter;
    S.applyWeather(refs.frame);
    refs.frame.dataset.night = S.dayPhase();
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
    // Empty placeholder so setupMapFrame always has an <svg> to replaceChild against,
    // whether this is the very first build or a later mid-race chapter swap.
    frame.appendChild(document.createElementNS(SVG_NS, "svg"));
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

    card.appendChild(header);
    card.appendChild(frame);
    card.appendChild(place);
    card.appendChild(barTrack);
    card.appendChild(stamps);

    var refs = {
      card: card, nameEl: nameEl, kmEl: kmEl, rankEl: rankEl, placeEl: place, barFill: barFill, frame: frame,
      pinsLayer: pinsLayer, runnerWrap: runnerWrap, runnerName: runnerName, runnerKm: runnerKm, tagEl: tag,
      dustEls: dustEls, stampsEl: stamps, stampChips: [], vehicleEl: vehicleEl, vehiclePhase: Math.random() * VEHICLE_LOOP_MS,
      lastPlace: null, teamId: team.id, chapter: null
    };

    if (chapters.length) {
      var initialChapter = chapterForKm(team.km);
      setupMapFrame(refs, initialChapter);
      buildStampChips(refs, initialChapter);
    }
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
    lastRankOrder = ""; // cards just got rebuilt in raw team order, not rank order — force reorderCards to run once more right after, even if the rank order string happens to match its stale cached value
  }

  function updateCard(team) {
    var refs = cardRefs.get(team.id);
    if (!refs || !chapters.length) return;

    var chapter = chapterForKm(team.km);
    var chapterChanged = refs.chapter !== chapter;
    if (chapterChanged) {
      setupMapFrame(refs, chapter);
      buildStampChips(refs, chapter);
    }

    refs.card.style.setProperty("--accent", team.color);
    refs.nameEl.textContent = team.name;
    refs.kmEl.textContent = team.km + " กม.";
    refs.rankEl.textContent = S.rankBadgeText(currentRanks[team.id] || 1);

    var p = positionForKm(team.km, chapter);
    refs.runnerWrap.style.left = pctX(p.x, chapter);
    refs.runnerWrap.style.top = pctY(p.y, chapter);
    refs.runnerName.textContent = team.name;
    refs.runnerKm.textContent = team.km + " กม.";

    /* The name+km tag is centered on the runner by default, but near the map's left/right
       edges (e.g. right at the start point) that centering pushes it past the frame's
       clipped border — flip its anchor near either edge so it always stays fully visible. */
    var edgeFrac = p.x / chapter.viewBox.w;
    refs.tagEl.classList.toggle("runner-tag--edge-start", edgeFrac < 0.2);
    refs.tagEl.classList.toggle("runner-tag--edge-end", edgeFrac > 0.8);

    refs.routeProgressEl.setAttribute("d", progressPathD(team.km, chapter));
    DUST_OFFSETS_KM.forEach(function (behindKm, i) {
      var dp = positionForKm(Math.max(0, team.km - behindKm), chapter);
      refs.dustEls[i].style.left = pctX(dp.x, chapter);
      refs.dustEls[i].style.top = pctY(dp.y, chapter);
    });
    refs.stampChips.forEach(function (chip, i) {
      chip.classList.toggle("reached", team.km >= chapter.waypoints[i].km);
    });

    if (chapterChanged && refs.lastPlace !== null) {
      // Crossing into a later chapter always outranks a same-poll "arrived at place"
      // toast (the new chapter's first waypoint is the same shared place by name, e.g.
      // แม่สาย, so the check below naturally stays quiet right after this fires).
      celebrateRunner(refs, true);
      showToast(refs, "\u{1F30F} ข้ามพรมแดนแล้ว! เริ่ม" + (chapter.label || "บทใหม่"));
    } else if (refs.lastPlace !== null && p.place !== refs.lastPlace) {
      var isChiangRai = p.place.indexOf("เชียงราย") !== -1;
      var isKunming = p.place.indexOf("คุนหมิง") !== -1;
      var big = isChiangRai || isKunming;
      celebrateRunner(refs, big);
      var msg = isKunming ? "\u{1F386} ถึงคุนหมิงแล้ว! จบการเดินทางสุดยิ่งใหญ่!"
        : isChiangRai ? "\u{1F3C5} ถึงเชียงรายแล้ว!"
        : "\u{1F4CD} ถึง" + p.place + "แล้ว!";
      showToast(refs, msg);
    }
    refs.lastPlace = p.place;

    var weatherCat = realWeatherCategoryForPlace(p.place);
    if (weatherCat) S.applyWeather(refs.frame, weatherCat);

    var finalStretch = team.km < chapter.finishKm && (chapter.finishKm - team.km) <= 50;
    refs.runnerWrap.classList.toggle("final-stretch", finalStretch);

    if (p.overshoot > 0) {
      refs.placeEl.textContent = "\u{1F389} ถึงจุดหมายแล้ว! เลย " + p.place + " ไปอีก " + p.overshoot + " กม.";
    } else if (p.nextPlace) {
      refs.placeEl.textContent = "อยู่ที่ " + p.place + " · อีก " + p.kmToNext + " กม. ถึง" + p.nextPlace;
    } else {
      refs.placeEl.textContent = "อยู่ที่ " + p.place;
    }
    var pct = S.clamp((team.km / chapter.finishKm) * 100, 0, 100);
    refs.barFill.style.width = pct + "%";
  }

  /* Re-append the map cards in current-rank order so #1 always sits first (leftmost on
     desktop, topmost once the grid collapses to a single column on phones) — using the
     FLIP technique (record each card's position before moving it, then animate a
     compensating transform back to zero) so a rank swap glides instead of jump-cutting.
     Re-appending the *same* card elements (not rebuilding them) keeps every embedded
     SVG/animation ref in cardRefs valid, so the runner/dust/weather state on each card
     is untouched by the reshuffle. Skipped during kiosk mode since that card is pulled
     out of grid flow onto a fixed overlay anyway. Only actually touches the DOM when the
     rank order itself changed since last time — every poll ticks each team's km by a
     little, and re-measuring/re-appending on every one of those (even when nobody
     actually passed anybody) was causing a small pointless snap-transition each cycle,
     which read as constant jitter rather than the occasional real rank-swap glide. */
  var lastRankOrder = "";
  function reorderCards(teams) {
    if (kioskActive || !teams.length) return;
    var sorted = teams.slice().sort(function (a, b) { return b.km - a.km; });
    var rankOrder = sorted.map(function (t) { return t.id; }).join(",");
    if (rankOrder === lastRankOrder) return;
    lastRankOrder = rankOrder;
    var firstRects = new Map();
    cardRefs.forEach(function (refs, id) {
      firstRects.set(id, refs.card.getBoundingClientRect());
    });
    sorted.forEach(function (team) {
      var refs = cardRefs.get(team.id);
      if (refs) gridEl.appendChild(refs.card);
    });
    cardRefs.forEach(function (refs, id) {
      var first = firstRects.get(id);
      if (!first) return;
      var last = refs.card.getBoundingClientRect();
      var dx = first.left - last.left;
      var dy = first.top - last.top;
      if (!dx && !dy) return;
      refs.card.style.transition = "none";
      refs.card.style.transform = "translate(" + dx + "px, " + dy + "px)";
      refs.card.offsetWidth; // force reflow so the transform above is applied before animating away from it
      refs.card.style.transition = "transform 0.6s cubic-bezier(.3,.8,.4,1)";
      refs.card.style.transform = "";
      setTimeout(function () { refs.card.style.transition = ""; }, 650);
    });
  }

  /* One mini track per team, ranked — the whole race at a glance without opening every
     card. Small enough team count that a full rebuild each poll is simplest and cheap.
     Each row is two lines: name+km on top (full name, never truncated), a thin track
     below with a runner mark riding its filled edge. The track is scaled to the overall
     race finish (last chapter's finishKm) so standing reads consistently across the
     whole journey regardless of which chapter each team is currently on. */
  function renderRankSummary(teams) {
    rankSummaryEl.innerHTML = "";
    if (!teams.length || !overallFinishKm) return;
    var sorted = teams.slice().sort(function (a, b) { return b.km - a.km; });
    sorted.forEach(function (team, i) {
      var row = document.createElement("div");
      row.className = "rank-row";

      var top = document.createElement("div");
      top.className = "rank-row-top";
      var medal = document.createElement("span");
      medal.className = "rank-medal";
      medal.textContent = S.rankBadgeText(i + 1);
      var name = document.createElement("span");
      name.className = "rank-name";
      name.textContent = team.name;
      var km = document.createElement("span");
      km.className = "rank-km";
      km.textContent = team.km + " กม.";
      top.appendChild(medal);
      top.appendChild(name);
      top.appendChild(km);

      var trackWrap = document.createElement("div");
      trackWrap.className = "rank-track-wrap";
      var track = document.createElement("div");
      track.className = "rank-track";
      var pct = S.clamp((team.km / overallFinishKm) * 100, 0, 100);
      var fill = document.createElement("div");
      fill.className = "rank-track-fill";
      fill.style.background = team.color;
      fill.style.width = pct + "%";
      var runner = document.createElement("span");
      runner.className = "rank-runner";
      runner.textContent = "\u{1F3C3}";
      runner.style.left = pct + "%";
      track.appendChild(fill);
      track.appendChild(runner);
      trackWrap.appendChild(track);

      row.appendChild(top);
      row.appendChild(trackWrap);
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

  /* Second summary box, right below the team-rank one — one stacked block per team
     (ranked same as above), each listing that team's top-3 runners. A plain vertical
     list rather than side-by-side columns, so it never needs to fight for width inside
     a narrow flex row the way embedding this in each map card did. */
  function renderTopRunnersSummary(teams) {
    topRunnersSummaryEl.innerHTML = "";
    var sorted = teams.slice().sort(function (a, b) { return b.km - a.km; });
    sorted.forEach(function (team) {
      var top3 = (team.topRunners || []).slice(0, 3);
      if (!top3.length) return;
      var block = document.createElement("div");
      block.className = "top-team-block";
      var title = document.createElement("div");
      title.className = "top-team-block-title";
      title.textContent = team.name;
      block.appendChild(title);
      top3.forEach(function (runner, i) {
        var row = document.createElement("div");
        row.className = "top-team-runner-row";
        var medal = document.createElement("span");
        medal.className = "top-team-runner-medal";
        medal.textContent = S.rankBadgeText(i + 1);
        var name = document.createElement("span");
        name.className = "top-team-runner-name";
        name.textContent = runner.name;
        var km = document.createElement("span");
        km.className = "top-team-runner-km";
        km.textContent = runner.km + " กม.";
        row.appendChild(medal);
        row.appendChild(name);
        row.appendChild(km);
        block.appendChild(row);
      });
      topRunnersSummaryEl.appendChild(block);
    });
  }

  /* Top 10 popup — same team data as the summary above, just the fuller list (up to 10
     per team instead of 3) plus a mini podium for ranks 1-3. Rebuilt from scratch on every
     poll (cheap: 3 teams x <=10 rows) so it's already fresh the moment someone opens it,
     and stays live-updating for as long as they leave it open. */
  function renderTop10Modal(teams) {
    if (!rank10Body) return;
    var sorted = teams.slice().sort(function (a, b) { return b.km - a.km; });
    rank10Body.innerHTML = "";
    rank10Tabs.innerHTML = "";

    if (rank10ActiveTeamId === null || !sorted.some(function (t) { return t.id === rank10ActiveTeamId; })) {
      rank10ActiveTeamId = sorted.length ? sorted[0].id : null;
    }

    sorted.forEach(function (team) {
      var runners = team.topRunners || [];

      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "rank10-tab" + (team.id === rank10ActiveTeamId ? " is-active" : "");
      tab.textContent = team.name;
      tab.style.setProperty("--tint", team.color);
      tab.dataset.teamId = team.id;
      rank10Tabs.appendChild(tab);

      var col = document.createElement("div");
      col.className = "rank10-team-col" + (team.id === rank10ActiveTeamId ? " is-active" : "");
      col.dataset.teamId = team.id;
      col.style.setProperty("--tint", team.color);

      var head = document.createElement("div");
      head.className = "rank10-team-head";
      var swatch = document.createElement("span");
      swatch.className = "swatch";
      head.appendChild(swatch);
      head.appendChild(document.createTextNode(team.name));
      col.appendChild(head);

      if (!runners.length) {
        var empty = document.createElement("div");
        empty.className = "rank10-empty";
        empty.textContent = "ยังไม่มีข้อมูลนักวิ่งรายบุคคลของทีมนี้";
        col.appendChild(empty);
        rank10Body.appendChild(col);
        return;
      }

      var list = document.createElement("div");
      list.className = "rank10-list";
      runners.forEach(function (runner, i) {
        var row = document.createElement("div");
        row.className = "rank10-row";
        var rk = document.createElement("span");
        rk.className = "rk";
        rk.textContent = String(i + 1);
        var rn = document.createElement("span");
        rn.className = "rn";
        rn.textContent = runner.name;
        var rkm = document.createElement("span");
        rkm.className = "rkm";
        rkm.textContent = runner.km + " กม.";
        row.appendChild(rk);
        row.appendChild(rn);
        row.appendChild(rkm);
        list.appendChild(row);
      });
      col.appendChild(list);

      rank10Body.appendChild(col);
    });
  }

  function openRank10Modal() {
    if (!rank10Backdrop) return;
    renderTop10Modal(lastTeamsSnapshot);
    rank10Backdrop.classList.add("active");
    rank10Sheet.classList.add("active");
  }

  function closeRank10Modal() {
    if (!rank10Backdrop) return;
    rank10Backdrop.classList.remove("active");
    rank10Sheet.classList.remove("active");
  }

  if (top10ToggleBtn) {
    top10ToggleBtn.addEventListener("click", openRank10Modal);
    rank10Close.addEventListener("click", closeRank10Modal);
    rank10Backdrop.addEventListener("click", closeRank10Modal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeRank10Modal();
    });
    rank10Tabs.addEventListener("click", function (e) {
      var btn = e.target.closest(".rank10-tab");
      if (!btn) return;
      rank10ActiveTeamId = btn.dataset.teamId;
      renderTop10Modal(lastTeamsSnapshot);
    });
  }

  function render(state) {
    titleEl.textContent = state.title;
    currentRanks = S.computeRanks(state.teams);
    lastTeamsSnapshot = state.teams;
    var order = state.teams.map(function (t) { return t.id; }).join(",");
    if (order !== lastTeamOrder) { fullRebuild(state.teams); applyWeatherToPins(); } else state.teams.forEach(updateCard);
    reorderCards(state.teams);
    renderRankSummary(state.teams);
    renderTopRunnersSummary(state.teams);
    if (rank10Sheet && rank10Sheet.classList.contains("active")) renderTop10Modal(state.teams);
    if (visitCountEl && typeof state.visitCount === "number") {
      visitCountEl.textContent = state.visitCount.toLocaleString("th-TH");
      // Math.floor(.../100) comparison catches crossing a hundred even if the count jumps
      // by more than 1 between polls (several visits landing in the same ~poll window) —
      // a plain "=== 0" check on the new value alone could miss it skipping past exactly 100.
      if (lastVisitCount !== null && state.visitCount > lastVisitCount &&
          Math.floor(state.visitCount / 100) > Math.floor(lastVisitCount / 100)) {
        celebrateVisitMilestone();
      }
      lastVisitCount = state.visitCount;
    }
    lastFetchTs = Date.now();
  }

  function tickVehicles() {
    var now = Date.now();
    cardRefs.forEach(function (refs) {
      if (!refs.chapter) return;
      var t = ((now + refs.vehiclePhase) % VEHICLE_LOOP_MS) / VEHICLE_LOOP_MS;
      var p = positionOnRouteCurve(t, refs.chapter);
      refs.vehicleEl.style.left = pctX(p.x, refs.chapter);
      refs.vehicleEl.style.top = pctY(p.y, refs.chapter);
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
     toggle button once; after that it keeps looping on its own.

     Playlist: pick a random track on load, then pick a new random track (never repeating
     the one that just finished) each time one ends — an endless shuffle that lands on a
     different song per visit instead of always looping the same one. */
  if (bgmEl && bgmToggleBtn) {
    var BGM_TRACKS = ["audio/theme.mp3", "audio/track2.mp3", "audio/track3.mp3", "audio/track4.mp3"];
    var BGM_TARGET_VOLUME = 0.18;
    var BGM_FADE_MS = 4000;
    var bgmUserPaused = false;
    var bgmCurrentTrack = null;
    var bgmReduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var pickNextTrack = function () {
      if (BGM_TRACKS.length === 1) return BGM_TRACKS[0];
      var choice;
      do {
        choice = BGM_TRACKS[Math.floor(Math.random() * BGM_TRACKS.length)];
      } while (choice === bgmCurrentTrack);
      return choice;
    };

    var setToggleLabel = function (playing) {
      bgmToggleBtn.textContent = playing ? "🔈 เพลง" : "🔇 เพลง";
    };

    var fadeIn = function () {
      if (bgmReduceMotion) { bgmEl.volume = BGM_TARGET_VOLUME; return; }
      var start = performance.now();
      function step(now) {
        // Clamped both ends: some browsers (seen in headless/automated runs) can hand the
        // very first rAF callback a timestamp slightly *before* the performance.now() read
        // above, which would otherwise push volume just under 0 and throw IndexSizeError.
        var t = Math.min(1, Math.max(0, (now - start) / BGM_FADE_MS));
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

    bgmEl.addEventListener("ended", function () {
      bgmCurrentTrack = pickNextTrack();
      bgmEl.src = bgmCurrentTrack;
      startPlaying();
    });

    bgmCurrentTrack = pickNextTrack();
    bgmEl.src = bgmCurrentTrack;
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
      chapters = data.chapters.map(function (c) {
        var chapter = {
          id: c.id, label: c.label, startKm: c.startKm,
          waypoints: c.waypoints, viewBox: c.viewBox, finishKm: c.finishKm
        };
        chapter.routeD = smoothPathD(chapter.waypoints);
        chapter.routeSegments = buildRouteSegments(chapter.waypoints);
        chapter.pinOffsets = computePinOffsets(chapter);
        chapter.subTicks = computeSubTicks(chapter);
        return chapter;
      });
      overallFinishKm = chapters.length ? chapters[chapters.length - 1].finishKm : 0;
      poll();
      setInterval(poll, POLL_MS);
      refreshWeatherClient();
      setInterval(refreshWeatherClient, 5 * 60 * 1000);
    });
})();
