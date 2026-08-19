(function () {
  "use strict";

  var S = window.Scoreboard;
  var POLL_MS = 12000; // the sheet itself only refreshes every 20s server-side, so polling faster than that just re-fetches the same data
  var SVG_NS = "http://www.w3.org/2000/svg";

  // Sheet-sourced km values can carry long floating-point tails (e.g. item-bonus
  // multipliers landing on 38.918...) — always display at most 2 decimal places,
  // trimming trailing zeros so whole/1-decimal numbers stay clean (30, 30.16).
  function fmtKm(km) {
    return (Math.round(Number(km) * 100) / 100).toString();
  }

  var gridEl = document.getElementById("teamMapsGrid");
  var titleEl = document.getElementById("boardTitle");
  var lastUpdatedEl = document.getElementById("lastUpdated");
  var visitCountEl = document.getElementById("visitCount");
  var visitBadgeEl = document.getElementById("visitBadge");
  var lastVisitCount = null;
  var rankSummaryEl = document.getElementById("rankSummary");
  var topRunnersSummaryEl = document.getElementById("topRunnersSummary");
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
  var searchToggleBtn = document.getElementById("searchToggle");
  var searchBackdrop = document.getElementById("searchBackdrop");
  var searchSheet = document.getElementById("searchSheet");
  var searchClose = document.getElementById("searchClose");
  var searchInput = document.getElementById("searchInput");
  var searchSuggest = document.getElementById("searchSuggest");
  var searchHint = document.getElementById("searchHint");
  var searchView = document.getElementById("searchView");
  var searchResultView = document.getElementById("searchResultView");
  var searchCompareView = document.getElementById("searchCompareView");
  var searchShareBtn = document.getElementById("searchShareBtn");
  var searchShareView = document.getElementById("searchShareView");
  var shareCardGender = "male"; // "male" | "female"
  var shareCardBg = "dark"; // "dark" | "light"
  var companyTotalBadge = document.getElementById("companyTotalBadge");
  var companyTotalNum = document.getElementById("companyTotalNum");
  var lastCompanyTotalKm = null;
  var lastRoster = []; // latest roster array from /api/state, refreshed every poll
  var lastSearchedPerson = null; // whoever's solo result is currently shown — the "me" side of a comparison

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
  var lastTeamsSnapshot = []; // latest team array, reused by the Top 10 modal on re-render
  var VEHICLE_LOOP_MS = 26000;
  var DUST_OFFSETS_KM = [12, 24, 36];

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
  // further out specifically. The Japan-chapter entries below are the same idea: sharp
  // turns in the route (ground → flight → ground) mean the standard perpendicular offset
  // isn't enough to clear both the incoming and outgoing curve at once — tuned by actually
  // running the server locally and looking at the rendered map, not computed analytically.
  var PIN_OFFSET_OVERRIDES = {
    "กรุงเทพฯ (TDFB HQ)": 78,
    // pushed further out so its label pill doesn't sit on top of the new warp-portal icon
    // drawn at the same point (see chapter1SvgMarkup) — the two used to overlap.
    "แม่สาย (ชายแดน)": 60,
    "ไทเป": 60,
    "โอซาก้า": 90,
    "HIKAWA CO., LTD. 🏁🏭": 70
  };

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
     reads with finer progress granularity than just the big province markers. Skipped
     entirely across a waypoint marked `flight: true` (the leg FROM it is flown, not run —
     e.g. ไทเป → โอกินาว่า in the Japan chapter) since evenly-spaced roadside ticks would
     read as "you ran this" exactly where the map is saying the opposite. */
  function computeSubTicks(chapter) {
    var wps = chapter.waypoints;
    var ticks = [];
    for (var i = 0; i < wps.length - 1; i++) {
      var a = wps[i], b = wps[i + 1];
      if (a.flight) continue;
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
      return { x: first.x, y: first.y, place: first.name, nextPlace: seg0.name, kmToNext: Math.max(0, seg0.km - k), overshoot: 0, inFlight: false };
    }
    for (var i = 0; i < wps.length - 1; i++) {
      var a = wps[i], b = wps[i + 1];
      if (k <= b.km) {
        var t = (k - a.km) / ((b.km - a.km) || 1);
        return {
          x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
          place: a.name, nextPlace: b.name, kmToNext: Math.max(0, Math.round(b.km - k)), overshoot: 0,
          inFlight: !!a.flight
        };
      }
    }
    return { x: last.x, y: last.y, place: last.name, nextPlace: null, kmToNext: 0, overshoot: Math.round(k - last.km), inFlight: false };
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
          '<radialGradient id="warpGlow-' + uid + '">' +
            '<stop offset="0%" stop-color="#5fd0e8" stop-opacity="0.9" />' +
            '<stop offset="100%" stop-color="#5fd0e8" stop-opacity="0" />' +
          "</radialGradient>" +
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
        /* Warp portal at แม่สาย (255,21) — drawn LAST (after route-glow/pin-dots) so its
           rings actually show on top; drawing it earlier put the fat, soft .route-glow
           stroke (width 10, since the road ends right at this point) over the rings and
           washed them out to invisible. The chapter 2 handoff no longer walks across the
           border, it warps straight to ฮานอย instead (see chapter2SvgMarkup below, which
           draws the matching warp-in ring at its own ฮานอย waypoint). Purely decorative. */
        '<g transform="translate(255,21)">' +
          '<circle r="15" fill="url(#warpGlow-' + uid + ')" />' +
          '<circle class="warp-ring" r="10" fill="none" stroke="#fff" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.95" />' +
          '<circle class="warp-ring warp-ring-b" r="6.5" fill="none" stroke="#eafcff" stroke-width="1.6" stroke-dasharray="2 2" opacity="0.9" />' +
          '<text y="3" text-anchor="middle" font-size="10">\u{1F300}</text>' +
        "</g>" +
      "</svg>";
  }

  /* One circular city-scene badge for the jp chapter map: a dotted leader from the real
     waypoint (wpx,wpy) out to a small themed circle at (bx,by), with a hand-drawn icon
     inside and an outlined text label underneath. Text uses paint-order stroke instead of
     a background pill so it stays legible over whatever backdrop art it lands on without
     needing a per-label measured rect. */
  function cityBadgeMarkup(bx, by, wpx, wpy, bgColor, iconColor, label, iconMarkup) {
    // Thumb-leader deliberately quieter/muted than the pin-leaders above (thinner dash,
    // grey ink) so it's never mistaken for the real route or a place-name leader.
    return "" +
      '<line x1="' + wpx + '" y1="' + wpy + '" x2="' + bx + '" y2="' + by + '" stroke="#5b7086" stroke-width="1.1" stroke-dasharray="1 3.5" opacity="0.6" />' +
      '<g transform="translate(' + bx + ',' + by + ')">' +
        '<circle r="31" fill="' + bgColor + '" stroke="#fff" stroke-width="2.5" />' +
        '<g fill="' + iconColor + '">' + iconMarkup + "</g>" +
        '<text y="45" text-anchor="middle" font-size="11" font-weight="600" fill="#1b2d3a" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke">' + label + "</text>" +
      "</g>";
  }

  /* Japan-warp backdrop for chapter "jp" (ฮานอย → HIKAWA CO., LTD. ที่ชิมาเนะ) — same
     structural class hooks as chapter1SvgMarkup (route-path/route-glow/route-progress/
     pin-dots/pin-leaders/sub-ticks/night-overlay) so all the existing weather-filter,
     day/night CSS, and pin-rendering logic keep working unchanged on this frame too.
     Sky gradient runs a full day→dusk→night band top-to-bottom purely as scenery (the
     real day/night state is still driven by .night-overlay/.night-stars like every other
     chapter — this gradient is just backdrop color, same idea as chapter1/2's terrain tint).
     Known limitation: .route-path/.route-progress are still drawn as ONE continuous line
     through every waypoint (see smoothPathD/progressPathD) — there's no per-segment dash
     style, so the ไทเป→โอกินาว่า flight leg doesn't visually look different on the route
     line itself. The plane note + skipped sub-ticks (see computeSubTicks) + turquoise sea
     art carry that signal instead. Properly splitting the line style would need a deeper
     change to how routeD/routeProgress are built — left as a follow-up, not attempted here. */
  function chapter2SvgMarkup(uid) {
    return "" +
      '<svg viewBox="0 0 480 760" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
        "<defs>" +
          '<linearGradient id="skyJp-' + uid + '" x1="0" y1="1" x2="0" y2="0">' +
            '<stop offset="0%" stop-color="#7FAE6F" />' +
            '<stop offset="20%" stop-color="#dcebe0" />' +
            '<stop offset="42%" stop-color="#bfe0e6" />' +
            '<stop offset="62%" stop-color="#e6c199" />' +
            '<stop offset="78%" stop-color="#3d5468" />' +
            '<stop offset="92%" stop-color="#16233a" />' +
            '<stop offset="100%" stop-color="#e85c7a" />' +
          "</linearGradient>" +
          '<pattern id="paddyHatchJp-' + uid + '" width="26" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">' +
            '<line x1="0" y1="14" x2="26" y2="0" stroke="#274d3a" stroke-width="2" opacity="0.3" />' +
          "</pattern>" +
          '<radialGradient id="warpGlowJp-' + uid + '">' +
            '<stop offset="0%" stop-color="#5fd0e8" stop-opacity="0.9" />' +
            '<stop offset="100%" stop-color="#5fd0e8" stop-opacity="0" />' +
          "</radialGradient>" +
        "</defs>" +
        '<rect x="0" y="0" width="480" height="760" fill="url(#skyJp-' + uid + ')" />' +
        // zone: ฮานอย — Red River delta + rice paddy, full-width river band (not a small
        // patch) so it actually reads as "the river ฮานอย sits on"
        '<path d="M0,660 L80,615 L170,650 L250,605 L360,635 L480,615 L480,760 L0,760 Z" fill="#274d3a" opacity="0.5" />' +
        '<path d="M0,700 L90,660 L180,690 L260,650 L370,675 L480,660 L480,760 L0,760 Z" fill="#274d3a" opacity="0.8" />' +
        '<rect x="0" y="700" width="480" height="60" fill="url(#paddyHatchJp-' + uid + ')" />' +
        '<path d="M0,708 C60,695 100,722 160,710 C220,698 260,722 320,708 C380,694 420,720 480,706 L480,760 L0,760 Z" fill="#4FA0CE" opacity="0.55" />' +
        '<g transform="translate(96,676) scale(0.5)" opacity="0.9" fill="#1b2d3a">' +
          '<ellipse cx="0" cy="10" rx="28" ry="6" opacity="0.35" />' +
          '<rect x="-3" y="-70" width="6" height="70" />' +
          '<path d="M-8,-52 L8,-52 L14,-44 L-14,-44 Z" /><rect x="-6" y="-44" width="12" height="10" />' +
          '<path d="M-14,-34 L14,-34 L22,-24 L-22,-24 Z" /><rect x="-10" y="-24" width="20" height="10" />' +
          '<path d="M-22,-14 L22,-14 L30,-2 L-30,-2 Z" /><rect x="-14" y="-2" width="28" height="14" />' +
        "</g>" +
        // zone: ฮ่องกง/ไทเป — faint coastal shimmer only, full skyline detail lives in the
        // filmstrip-equivalent (there's no filmstrip on the real site, so these stay simple)
        '<path d="M60,530 C110,518 140,538 195,524 L195,565 L60,565 Z" fill="#3a5f78" opacity="0.3" />' +
        '<path d="M140,415 C185,403 210,420 260,408 L260,448 L140,448 Z" fill="#2f5570" opacity="0.28" />' +
        // zone: โอกินาว่า — turquoise sea + red torii, first landfall in Japan after the flight
        '<path d="M280,320 C320,308 350,325 400,312 L400,350 L280,350 Z" fill="#2ec4c6" opacity="0.35" />' +
        '<g transform="translate(300,320)" opacity="0.9">' +
          '<rect x="-3" y="-2" width="6" height="26" fill="#c0392b" />' +
          '<rect x="-14" y="-8" width="28" height="6" fill="#c0392b" />' +
          '<rect x="-11" y="-16" width="22" height="6" fill="#c0392b" />' +
        "</g>" +
        // zone: โอซาก้า — castle silhouette, pushed left of the route's sharp turn there so
        // it doesn't sit on top of the road or the finish's torii (both close by up here)
        '<g transform="translate(250,148) scale(0.8)" opacity="0.92" fill="#1b2d3a">' +
          '<rect x="-16" y="-6" width="32" height="16" />' +
          '<polygon points="-20,-6 20,-6 0,-20" />' +
          '<rect x="-10" y="-30" width="20" height="14" />' +
          '<polygon points="-13,-30 13,-30 0,-42" />' +
          '<rect x="-2" y="-50" width="4" height="10" />' +
        "</g>" +
        '<g fill="#ff6fae" opacity="0.85">' +
          '<circle cx="260" cy="200" r="1.6" /><circle cx="345" cy="195" r="1.6" /><circle cx="330" cy="215" r="1.4" />' +
        "</g>" +
        // zone: เส้นชัยจริง — HIKAWA CO., LTD. ที่ชิมาเนะ (ไม่ใช่เมืองท่องเที่ยว) — torii
        // gate + shrine roofline (Izumo Taisha, the area's real famous landmark, sits near
        // Hikawa-cho/Izumo), pushed right of the finish dot/route so the icon doesn't sit
        // directly on top of either
        '<g transform="translate(422,116) scale(0.85)">' +
          '<path d="M-26,12 L26,12 L15,-10 L-15,-10 Z" fill="#e8edf2" opacity="0.85" />' +
          '<rect x="-11" y="12" width="22" height="16" fill="#e8edf2" opacity="0.85" />' +
          '<g fill="#c0392b">' +
            '<rect x="-17" y="-8" width="4.5" height="42" /><rect x="12.5" y="-8" width="4.5" height="42" />' +
            '<rect x="-23" y="-17" width="46" height="7" /><rect x="-19" y="-4" width="38" height="4.5" />' +
          "</g>" +
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
        // Circular city-scene badges — one per waypoint, confirmed for this chapter only
        // (not chapter 1). Positions/size match the approved mockup exactly (each badge
        // tucked into open terrain next to its own waypoint via a thumb-leader, not a
        // side column — see run-mile-japan-warp-mockup.html's .map-inset-badge-wrap /
        // .thumb-leader for the source values this was ported from). Icons drawn directly
        // rather than via <symbol>/<use> since there's no filmstrip gallery on the real
        // site to share the art with. Drawn after pin-dots so the badges never sit under
        // the route-glow's paint order.
        '<g class="city-badges" font-family="inherit">' +
          cityBadgeMarkup(270, 640, 130, 700, "#f0a84e", "#7a3320", "ฮานอย",
            '<g transform="translate(0,-3) scale(0.35)"><rect x="-3" y="-70" width="6" height="70" />' +
            '<path d="M-8,-52 L8,-52 L14,-44 L-14,-44 Z" /><rect x="-6" y="-44" width="12" height="10" />' +
            '<path d="M-14,-34 L14,-34 L22,-24 L-22,-24 Z" /><rect x="-10" y="-24" width="20" height="10" />' +
            '<path d="M-22,-14 L22,-14 L30,-2 L-30,-2 Z" /><rect x="-14" y="-2" width="28" height="14" /></g>') +
          cityBadgeMarkup(90, 460, 230, 560, "#3a6ea5", "#12263a", "ฮ่องกง",
            '<g transform="translate(0,6) scale(1.4)"><rect x="-16" y="-8" width="6" height="8" /><rect x="-9" y="-14" width="6" height="14" />' +
            '<rect x="-2" y="-6" width="5" height="6" /><rect x="4" y="-18" width="6" height="18" />' +
            '<polygon points="9,-18 5,-18 7,-23" /><rect x="11" y="-10" width="5" height="10" /></g>') +
          cityBadgeMarkup(170, 440, 300, 430, "#e0925a", "#3a2418", "ไทเป",
            '<g transform="translate(0,6) scale(1.4)"><rect x="-1.5" y="-30" width="3" height="4" /><rect x="-4" y="-26" width="8" height="4" />' +
            '<rect x="-3" y="-22" width="6" height="3" /><rect x="-5" y="-19" width="10" height="3" />' +
            '<rect x="-4" y="-16" width="8" height="3" /><rect x="-6" y="-13" width="12" height="3" />' +
            '<rect x="-5" y="-10" width="10" height="3" /><rect x="-7" y="-7" width="14" height="7" /></g>') +
          cityBadgeMarkup(100, 300, 340, 300, "#2ec4c6", "#c0392b", "โอกินาว่า",
            '<g transform="translate(0,3) scale(0.85)"><rect x="-3" y="-2" width="6" height="26" />' +
            '<rect x="-14" y="-8" width="28" height="6" /><rect x="-11" y="-16" width="22" height="6" /></g>') +
          cityBadgeMarkup(150, 190, 310, 170, "#5c6b7a", "#0d1a26", "โอซาก้า",
            '<g transform="translate(0,3) scale(0.8)"><rect x="-16" y="-6" width="32" height="16" /><polygon points="-20,-6 20,-6 0,-20" />' +
            '<rect x="-10" y="-30" width="20" height="14" /><polygon points="-13,-30 13,-30 0,-42" />' +
            '<rect x="-2" y="-50" width="4" height="10" /></g>') +
          cityBadgeMarkup(180, 65, 370, 80, "#f4c95d", "#e8edf2", "HIKAWA",
            '<g transform="translate(0,5) scale(0.65)" fill="#e8edf2"><path d="M-26,12 L26,12 L15,-10 L-15,-10 Z" opacity="0.9" />' +
            '<rect x="-11" y="12" width="22" height="16" opacity="0.9" /></g>' +
            '<g transform="translate(0,5) scale(0.65)" fill="#c0392b"><rect x="-17" y="-8" width="4.5" height="42" /><rect x="12.5" y="-8" width="4.5" height="42" />' +
            '<rect x="-23" y="-17" width="46" height="7" /><rect x="-19" y="-4" width="38" height="4.5" /></g>') +
        "</g>" +
        // warp-in ring at ฮานอย (130,700) — matching pair to the warp-out ring at แม่สาย in
        // chapter1SvgMarkup, so the two maps visually read as one continuous "jump". Drawn
        // last (after route-glow/pin-dots) for the same reason as the แม่สาย ring — earlier
        // in the paint order, the road's own glow washed the thin rings out to invisible.
        '<g transform="translate(130,700)">' +
          '<circle r="15" fill="url(#warpGlowJp-' + uid + ')" />' +
          '<circle class="warp-ring" r="10" fill="none" stroke="#fff" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.95" />' +
          '<circle class="warp-ring warp-ring-b" r="6.5" fill="none" stroke="#eafcff" stroke-width="1.6" stroke-dasharray="2 2" opacity="0.9" />' +
          '<text y="3" text-anchor="middle" font-size="10">\u{1F300}</text>' +
        "</g>" +
      "</svg>";
  }

  function mapSvgMarkup(chapterId, uid) {
    return chapterId === "jp" ? chapter2SvgMarkup(uid) : chapter1SvgMarkup(uid);
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

    // The Japan chapter's ไทเป → โอกินาว่า leg is flown, not run (see the `flight: true`
    // waypoint flag) — this static note is the plain-HTML twin of chapter2SvgMarkup's other
    // decorations. It's HTML rather than SVG <text> specifically because ✈️ silently fails
    // to render as an SVG glyph on some renderers (no color-emoji font for SVG text there)
    // while the exact same glyph renders fine in ordinary HTML everywhere.
    if (refs.flightNoteEl) {
      var isJp = chapter.id === "jp";
      refs.flightNoteEl.style.display = isJp ? "flex" : "none";
      if (isJp) {
        refs.flightNoteEl.style.left = pctX(220, chapter);
        refs.flightNoteEl.style.top = pctY(380, chapter);
      }
    }
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
    var flightNoteEl = document.createElement("div");
    flightNoteEl.className = "flight-note";
    flightNoteEl.setAttribute("aria-hidden", "true");
    flightNoteEl.style.display = "none";
    var flightNoteIcon = document.createElement("span");
    flightNoteIcon.textContent = "✈️";
    flightNoteEl.appendChild(flightNoteIcon);
    // No specific km figure here — the ~630km real flight distance doesn't match the
    // 200km gap the rescaled ไทเป->โอกินาว่า km values (see server.js) actually assign to
    // this leg, and stating a number that disagrees with the km shown everywhere else on
    // the card would read as a bug rather than flavor text.
    flightNoteEl.appendChild(document.createTextNode(" บินข้ามทะเล"));
    var pinsLayer = document.createElement("div");
    pinsLayer.className = "pins-layer";
    var runnersLayer = document.createElement("div");
    runnersLayer.className = "runners-layer";
    frame.appendChild(cloudA);
    frame.appendChild(cloudB);
    frame.appendChild(pinsLayer);
    frame.appendChild(runnersLayer);
    frame.appendChild(vehicleEl);
    frame.appendChild(flightNoteEl);

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
      pinsLayer: pinsLayer, runnerWrap: runnerWrap, runnerEmojiEl: emoji, runnerName: runnerName, runnerKm: runnerKm, tagEl: tag,
      dustEls: dustEls, stampsEl: stamps, stampChips: [], vehicleEl: vehicleEl, flightNoteEl: flightNoteEl, vehiclePhase: Math.random() * VEHICLE_LOOP_MS,
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
    refs.kmEl.textContent = fmtKm(team.km) + " กม.";
    refs.rankEl.textContent = S.rankBadgeText(currentRanks[team.id] || 1);

    var p = positionForKm(team.km, chapter);
    refs.runnerWrap.style.left = pctX(p.x, chapter);
    refs.runnerWrap.style.top = pctY(p.y, chapter);
    refs.runnerName.textContent = team.name;
    refs.runnerKm.textContent = fmtKm(team.km) + " กม.";
    // On the flown leg (ไทเป -> โอกินาว่า in the Japan chapter, see the `flight` waypoint
    // flag), the team marker itself was still a running-person emoji gliding along the
    // route line — thematically backwards, since the whole point of that leg is "you flew
    // here, you didn't run it". Swap to a plane for exactly that stretch.
    if (refs.runnerEmojiEl) refs.runnerEmojiEl.textContent = p.inFlight ? "✈️" : "\u{1F3C3}";

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
      // Was hardcoded to specific city names ("เชียงราย"/"คุนหมิง") — that silently stopped
      // matching the moment chapter 2's finish became a different place (HIKAWA CO., LTD.)
      // instead of คุนหมิง. Generalized to "is this waypoint the chapter's actual finishKm"
      // so it stays correct for any future chapter/finish-place change too.
      var arrivedWp = null;
      for (var wi = 0; wi < chapter.waypoints.length; wi++) {
        if (chapter.waypoints[wi].name === p.place) { arrivedWp = chapter.waypoints[wi]; break; }
      }
      var isChapterFinish = !!arrivedWp && arrivedWp.km === chapter.finishKm;
      var isOverallFinish = isChapterFinish && chapter === chapters[chapters.length - 1];
      celebrateRunner(refs, isChapterFinish);
      var msg = isOverallFinish ? "\u{1F386} ถึง" + p.place + "แล้ว! จบการเดินทางสุดยิ่งใหญ่!"
        : isChapterFinish ? "\u{1F3C5} ถึง" + p.place + "แล้ว!"
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
     is untouched by the reshuffle. Only actually touches the DOM when the rank order
     itself changed since last time — every poll ticks each team's km by a little, and
     re-measuring/re-appending on every one of those (even when nobody actually passed
     anybody) was causing a small pointless snap-transition each cycle, which read as
     constant jitter rather than the occasional real rank-swap glide. */
  var lastRankOrder = "";
  function reorderCards(teams) {
    if (!teams.length) return;
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

  /* Sum of every team's km — kept hidden until the first real poll lands (avoids
     flashing "0" while /api/state is still loading), then just updates the number in
     place on every poll after that. No count-up animation on every refresh — that was
     nice for a one-time page-load reveal in the mockup, but replaying it every ~12s
     poll would be distracting rather than lively. */
  function renderCompanyTotal(teams) {
    if (!companyTotalBadge) return;
    var total = Math.round(teams.reduce(function (sum, t) { return sum + (Number(t.km) || 0); }, 0) * 100) / 100;
    if (total === lastCompanyTotalKm) return;
    lastCompanyTotalKm = total;
    companyTotalNum.textContent = total.toLocaleString("th-TH", { maximumFractionDigits: 2 });
    companyTotalBadge.hidden = false;
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
      km.textContent = fmtKm(team.km) + " กม.";
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
      var teamPos = positionForKm(team.km, chapterForKm(team.km));
      runner.textContent = teamPos.inFlight ? "✈️" : "\u{1F3C3}";
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
        km.textContent = fmtKm(runner.km) + " กม.";
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
        rkm.textContent = fmtKm(runner.km) + " กม.";
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
    closeSearchModal(); // the two full-screen sheets shared no mutual-exclusion before —
    // opening one while the other was already open left both stacked on screen at once.
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

  /* ===== "ค้นหาอันดับของฉัน" — search a person's own stats within their team =====
     Data comes from lastRoster (see render(), cached from /api/state on every poll), which
     the server fills from the private "ตรวจสอบภายใน" sheet via the same Apps Script Web App
     the visit counter already uses (?action=roster) — see server.js and Code.gs. Rank/gap
     are computed here client-side rather than server-side so results update instantly as
     the user types, same as the validated mockup. */

  // Names/teams below come straight from the roster sheet (real people can type anything
  // into their own nickname field) and get concatenated into innerHTML — escape every one
  // instead of trusting the source, so a stray "<"/"&"/quote in someone's name can't inject
  // markup that runs for everyone else who searches for or sees that name.
  var HTML_ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return HTML_ESCAPE_MAP[c]; });
  }

  function searchTeamStats(person) {
    var mates = lastRoster.filter(function (p) { return p.team === person.team; })
      .sort(function (a, b) { return b.km - a.km; });
    var rank = mates.findIndex(function (p) { return p.name === person.name; }) + 1;
    var above = rank > 1 ? mates[rank - 2] : null;
    var gap = above ? Math.round((above.km - person.km) * 10) / 10 : 0;
    var leaderKm = mates.length ? mates[0].km : 0;
    var pct = leaderKm > 0 ? Math.max(6, Math.min(100, Math.round((person.km / leaderKm) * 100))) : 6;
    return { rank: rank, teamSize: mates.length, above: above, gap: gap, pct: pct };
  }

  function searchMedalFor(rank) {
    return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  }

  // Same color each team already wears everywhere else on the board (map cards, Top 10
  // swatches) — falls back to the generic tint if the roster ever names a team that
  // doesn't match state.teams (e.g. right after a team rename before the next poll).
  function searchTeamColor(teamName) {
    var team = lastTeamsSnapshot.find(function (t) { return t.name === teamName; });
    return (team && team.color) || "#4a90d9";
  }

  function searchFirstName(fullName) { return String(fullName || "").split(" ")[0]; }

  // Tinted with the person's own team color (light background wash + matching border/number)
  // instead of flat neutral grey — ties the 3 stat tiles visually to the progress bar below,
  // and the icon gives each tile something to look at besides a bare number.
  function searchStatTile(icon, value, label, teamColor) {
    var tintBg = "color-mix(in srgb, " + teamColor + " 12%, var(--card-bg))";
    var tintBorder = "color-mix(in srgb, " + teamColor + " 30%, var(--card-border))";
    return (
      '<div class="search-stat" style="background:' + tintBg + ";border-color:" + tintBorder + '">' +
        '<div class="search-stat-icon">' + icon + "</div>" +
        '<div class="search-stat-num" style="color:' + teamColor + '">' + value + "</div>" +
        '<div class="search-stat-label">' + label + "</div>" +
      "</div>"
    );
  }

  // People who exist in the company roster but have never actually submitted evidence get
  // a distinct friendly empty-state instead of a stat card — showing "#last of team, 0 km"
  // would read as a real (discouraging) ranking, when really there's just nothing to rank yet.
  function searchNeverRanHtml(person) {
    var teamColor = searchTeamColor(person.team);
    return (
      '<div class="search-result-person">' +
        '<div class="search-result-avatar">🚶</div>' +
        "<div><div class=\"search-result-name\">" + escapeHtml(person.name) + '</div><div class="search-result-team">ทีม' + escapeHtml(person.team) + "</div></div>" +
      "</div>" +
      '<div class="search-never-ran" style="border-color:color-mix(in srgb, ' + teamColor + ' 30%, var(--card-border))">' +
        "👟 ยังไม่เคยส่งหลักฐานวิ่ง/เดินเลย — ลองเริ่มวันนี้ดูนะ!" +
      "</div>" +
      '<button type="button" class="search-again-btn">🔍 ค้นหาคนอื่น</button>'
    );
  }

  function searchResultHtml(person) {
    if (!person.submissions) return searchNeverRanHtml(person);
    var s = searchTeamStats(person);
    var medal = searchMedalFor(s.rank);
    var teamColor = searchTeamColor(person.team);
    var badgeHtml = medal ? '<span class="search-avatar-medal">' + medal + "</span>" : "";
    var teamLine = "ทีม" + escapeHtml(person.team) +
      (!medal && s.rank >= 4 && s.rank <= 10 ? ' <span class="search-top10-pill">🏆 Top 10 ทีม</span>' : "");
    var progressLabel = s.rank <= 1
      ? "🎉 เป็นอันดับ 1 ของทีมตอนนี้!"
      : "อีก " + s.gap + " กม. จะแซงอันดับที่ " + (s.rank - 1) + " ของทีม" + (s.above ? " (" + escapeHtml(searchFirstName(s.above.name)) + ")" : "");
    var streakHtml = person.streak > 0
      ? '<div class="search-streak">🔥 ส่งหลักฐานติดต่อกัน ' + person.streak + " วัน</div>"
      : '<div class="search-streak is-inactive">📭 ยังไม่มี streak ติดต่อกัน — ส่งวันนี้เพื่อเริ่มนับ!</div>';

    return (
      '<div class="search-result-person">' +
        '<div class="search-result-avatar">🏃' + badgeHtml + "</div>" +
        "<div><div class=\"search-result-name\">" + escapeHtml(person.name) + '</div><div class="search-result-team">' + teamLine + "</div></div>" +
      "</div>" +
      '<div class="search-stat-grid">' +
        searchStatTile("📏", fmtKm(person.km), "กม. สะสมรวม", teamColor) +
        searchStatTile("🎯", "#" + (s.rank || "-"), "อันดับของทีม" + escapeHtml(person.team), teamColor) +
        searchStatTile("📸", String(person.submissions || 0), "ครั้งที่ส่งหลักฐานมาแล้ว", teamColor) +
      "</div>" +
      '<div class="search-progress">' +
        '<div class="search-prog-track"><div class="search-prog-fill" style="width:' + s.pct + '%;background:' + teamColor + '"></div>' +
        '<div class="search-prog-runner" style="left:' + s.pct + '%">🏃</div></div>' +
        '<div class="search-progress-label">' + progressLabel + "</div>" +
      "</div>" +
      streakHtml +
      '<button type="button" class="search-cta-btn">⚔️ เทียบกับเพื่อน</button>' +
      '<button type="button" class="search-again-btn">🔍 ค้นหาคนอื่น</button>'
    );
  }

  // Small avatar+current-medal reused for each side of a "เทียบกับเพื่อน" comparison —
  // same markup/classes as the solo result view so both features share one visual identity.
  function compareAvatarHtml(person) {
    var medal = searchMedalFor(searchTeamStats(person).rank);
    var badgeHtml = medal ? '<span class="search-avatar-medal">' + medal + "</span>" : "";
    return '<div class="search-result-avatar">🏃' + badgeHtml + "</div>";
  }

  // Renders the win/lose/tie comparison between whoever was originally searched
  // (lastSearchedPerson) and a chosen opponent, across the same 3 stats shown in the solo view.
  function compareResultHtml(me, opp) {
    var meColor = searchTeamColor(me.team);
    var oppColor = searchTeamColor(opp.team);
    var rows = [
      { icon: "📏", label: "กม. สะสม", a: me.km, b: opp.km, fmt: fmtKm },
      { icon: "📸", label: "ครั้งที่ส่ง", a: me.submissions || 0, b: opp.submissions || 0, fmt: String },
      { icon: "🔥", label: "วันติดต่อกัน", a: me.streak || 0, b: opp.streak || 0, fmt: String }
    ];

    var aWins = 0, bWins = 0;
    var rowsHtml = rows.map(function (r) {
      var aWin = r.a > r.b, bWin = r.b > r.a;
      if (aWin) aWins++; if (bWin) bWins++;
      return (
        '<div class="cmp-row">' +
          '<div class="cmp-val' + (aWin ? " win" : "") + '" style="color:' + (aWin ? meColor : "var(--ink-soft)") + '"><span class="cmp-crown">👑</span>' + r.fmt(r.a) + "</div>" +
          '<div class="cmp-mid">' + r.icon + "<br>" + r.label + "</div>" +
          '<div class="cmp-val' + (bWin ? " win" : "") + '" style="color:' + (bWin ? oppColor : "var(--ink-soft)") + '"><span class="cmp-crown">👑</span>' + r.fmt(r.b) + "</div>" +
        "</div>"
      );
    }).join("");

    var verdictHtml;
    if (aWins === bWins) {
      verdictHtml = '<div class="cmp-verdict" style="background:var(--toolbar-bg);color:var(--ink)">🤝 สูสีมาก! เสมอกันไปคนละ ' + aWins + " หมวด</div>";
    } else {
      var winner = aWins > bWins ? me : opp;
      var winnerColor = aWins > bWins ? meColor : oppColor;
      verdictHtml = '<div class="cmp-verdict" style="background:color-mix(in srgb, ' + winnerColor + ' 16%, var(--card-bg));color:' + winnerColor + '">🏆 ' +
        escapeHtml(winner.name) + " ชนะไป " + Math.max(aWins, bWins) + " ใน " + rows.length + " หมวด!</div>";
    }

    return (
      '<div class="cmp-heads">' +
        '<div class="cmp-side">' + compareAvatarHtml(me) + '<div class="cmp-side-name">' + escapeHtml(me.name) + '</div><div class="cmp-side-team">' + escapeHtml(me.team) + "</div></div>" +
        '<div class="cmp-vs">VS</div>' +
        '<div class="cmp-side">' + compareAvatarHtml(opp) + '<div class="cmp-side-name">' + escapeHtml(opp.name) + '</div><div class="cmp-side-team">' + escapeHtml(opp.team) + "</div></div>" +
      "</div>" +
      '<div class="cmp-rows">' + rowsHtml + "</div>" +
      verdictHtml +
      '<div class="cmp-actions">' +
        '<button type="button" class="search-cta-btn" id="cmpAgainBtn">⚔️ เทียบกับคนอื่นอีก</button>' +
        '<button type="button" class="search-again-btn" id="cmpBackBtn">← กลับไปดูของฉัน</button>' +
      "</div>"
    );
  }

  function searchSuggestRowHtml(person, q) {
    var idx = person.name.indexOf(q);
    var before = person.name.slice(0, idx), match = person.name.slice(idx, idx + q.length), after = person.name.slice(idx + q.length);
    return (
      '<div class="search-suggest-row" data-name="' + escapeHtml(person.name) + '" data-team="' + escapeHtml(person.team) + '">' +
        '<div class="search-suggest-avatar">🏃</div>' +
        '<div class="search-suggest-name">' + escapeHtml(before) + "<mark>" + escapeHtml(match) + "</mark>" + escapeHtml(after) + "</div>" +
        '<div class="search-suggest-team">' + escapeHtml(person.team) + "</div>" +
      "</div>"
    );
  }

  function renderSearchSuggestions() {
    var q = searchInput.value.trim();
    if (!q) {
      searchSuggest.innerHTML = "";
      searchHint.hidden = false;
      searchHint.textContent = lastRoster.length ? "พิมพ์ชื่อเล่นด้านบนเพื่อเริ่มค้นหา" : "ยังโหลดรายชื่อไม่สำเร็จ ลองใหม่อีกครั้งภายหลัง";
      return;
    }
    var matches = lastRoster.filter(function (p) { return p.name.indexOf(q) !== -1; }).slice(0, 6);
    if (!matches.length) {
      searchSuggest.innerHTML = "";
      searchHint.hidden = false;
      searchHint.textContent = "ไม่พบชื่อนี้ ลองพิมพ์คำอื่นหรือสะกดแบบอื่น";
      return;
    }
    searchHint.hidden = true;
    searchSuggest.innerHTML = matches.map(function (p) { return searchSuggestRowHtml(p, q); }).join("");
    Array.prototype.forEach.call(searchSuggest.querySelectorAll(".search-suggest-row"), function (row) {
      row.addEventListener("click", function () { selectSearchPerson(row.getAttribute("data-name"), row.getAttribute("data-team")); });
    });
  }

  // Matched on name+team together, not name alone — two people sharing a common nickname
  // on different teams used to silently resolve to whichever of them happened to sit first
  // in lastRoster, regardless of which suggestion row (labeled with the correct team) was
  // actually clicked.
  function selectSearchPerson(name, team) {
    var person = lastRoster.find(function (p) { return p.name === name && p.team === team; });
    if (!person) return;
    lastSearchedPerson = person;
    searchResultView.innerHTML = searchResultHtml(person);
    var againBtn = searchResultView.querySelector(".search-again-btn");
    if (againBtn) againBtn.addEventListener("click", backToSearchView);
    var compareBtn = searchResultView.querySelector(".search-cta-btn");
    if (compareBtn) compareBtn.addEventListener("click", openComparePicker);
    searchCompareView.hidden = true;
    searchShareView.hidden = true;
    shareCardOnAssetLoad = null;
    searchView.hidden = true;
    searchResultView.hidden = false;
    if (searchShareBtn) searchShareBtn.hidden = false;
  }

  // Returns to the name-entry view without closing the whole modal — lets someone look up
  // a teammate right after checking their own stats instead of reopening from scratch.
  function backToSearchView() {
    searchResultView.hidden = true;
    searchCompareView.hidden = true;
    searchShareView.hidden = true;
    shareCardOnAssetLoad = null;
    searchView.hidden = false;
    if (searchShareBtn) searchShareBtn.hidden = true;
    searchInput.value = "";
    renderSearchSuggestions();
    searchInput.focus();
  }

  // "เทียบกับเพื่อน" — reuses the same input+suggestion-row markup/classes as the main name
  // search (search-input-wrap/search-input/search-suggest-list/search-suggest-row) so the
  // picker looks and behaves identically, just inside searchCompareView instead of searchView.
  function openComparePicker() {
    if (!lastSearchedPerson) return;
    searchResultView.hidden = true;
    if (searchShareBtn) searchShareBtn.hidden = true;
    searchCompareView.hidden = false;
    searchCompareView.innerHTML =
      '<h3 class="cmp-title">พิมพ์ชื่อเพื่อนที่จะเทียบกับ ' + escapeHtml(searchFirstName(lastSearchedPerson.name)) + "</h3>" +
      '<p class="cmp-sub">เลือกใครก็ได้ในบริษัท จะเทียบ กม. สะสม / จำนวนครั้งที่ส่ง / streak ให้ทันที</p>' +
      '<div class="search-input-wrap" style="margin:0 18px"><span class="search-icon">🔍</span>' +
        '<input class="search-input" id="cmpOpponentInput" placeholder="พิมพ์ชื่อเล่น เช่น ไก่น้อย" autocomplete="off"></div>' +
      '<div class="search-suggest-list" id="cmpOpponentSuggest" style="margin:8px 18px 20px"></div>';

    var input = document.getElementById("cmpOpponentInput");
    var suggest = document.getElementById("cmpOpponentSuggest");
    function renderOpponentSuggestions(q) {
      // Excludes only the literal same person (name+team), not everyone who happens to
      // share their nickname on a different team — those are legitimate opponents. Matched
      // by value (not object reference) since lastRoster can be replaced wholesale by a
      // roster poll between picking a person and opening this picker, which would make a
      // reference comparison against the stale lastSearchedPerson object match nobody.
      var candidates = lastRoster.filter(function (p) {
        return !(p.name === lastSearchedPerson.name && p.team === lastSearchedPerson.team);
      });
      var matches = (q ? candidates.filter(function (p) { return p.name.indexOf(q) !== -1; }) : candidates).slice(0, 6);
      suggest.innerHTML = matches.map(function (p) { return searchSuggestRowHtml(p, q); }).join("");
      Array.prototype.forEach.call(suggest.querySelectorAll(".search-suggest-row"), function (row) {
        row.addEventListener("click", function () { renderComparisonResult(row.getAttribute("data-name"), row.getAttribute("data-team")); });
      });
    }
    renderOpponentSuggestions("");
    input.addEventListener("input", function () { renderOpponentSuggestions(input.value.trim()); });
    input.focus();
  }

  function renderComparisonResult(opponentName, opponentTeam) {
    var opponent = lastRoster.find(function (p) { return p.name === opponentName && p.team === opponentTeam; });
    if (!opponent) return;
    searchCompareView.innerHTML = compareResultHtml(lastSearchedPerson, opponent);
    document.getElementById("cmpAgainBtn").addEventListener("click", openComparePicker);
    document.getElementById("cmpBackBtn").addEventListener("click", function () {
      searchCompareView.hidden = true;
      selectSearchPerson(lastSearchedPerson.name, lastSearchedPerson.team);
    });
  }

  function openSearchModal() {
    if (!searchBackdrop) return;
    closeRank10Modal();
    searchBackdrop.classList.add("active");
    searchSheet.classList.add("active");
    searchInput.value = "";
    searchView.hidden = false;
    searchResultView.hidden = true;
    searchResultView.innerHTML = "";
    searchCompareView.hidden = true;
    searchCompareView.innerHTML = "";
    searchShareView.hidden = true;
    searchShareView.innerHTML = "";
    shareCardOnAssetLoad = null;
    if (searchShareBtn) searchShareBtn.hidden = true;
    renderSearchSuggestions();
    searchInput.focus();
  }

  function closeSearchModal() {
    if (!searchBackdrop) return;
    searchBackdrop.classList.remove("active");
    searchSheet.classList.remove("active");
  }

  /* ===== downloadable share-card (📸 button in the search header) =====
     Rendered on a plain rectangular <canvas> (no rounded corners/border baked into the
     exported PNG — a "card" frame only makes sense as a UI element, not as a standalone
     photo someone posts to a story). Monochrome-only per the agreed design: no team-color
     theming, so it always looks the same regardless of which team is viewing/sharing it. */
  var SHARE_CANVAS_W = 1080;
  var SHARE_CANVAS_H = 1350;

  // "dark" (black bg/white ink, no border needed — already stands out against IG's white
  // chrome) and "light" (white bg/black ink, needs the dashed frame below for the same
  // reason) — the only two backgrounds offered, per the agreed design.
  var SHARE_BG_PRESETS = {
    dark: { bg: "#141414", ink: "#fafafa", logoSrc: "/img/logo-mono-white.png" },
    light: { bg: "#fafafa", ink: "#1a1a1a", logoSrc: "/img/logo-mono-black.png" }
  };

  // Preloaded once at page load rather than per-render — these are tiny local assets, so by
  // the time anyone reaches the share panel (search → pick a result → open share view) they're
  // essentially always ready, but onload still re-fires the current redraw just in case a very
  // fast/automated interaction beats the network.
  var shareLogoImgs = { white: new Image(), black: new Image() };
  var shareCardOnAssetLoad = null;
  shareLogoImgs.white.src = "/img/logo-mono-white.png";
  shareLogoImgs.black.src = "/img/logo-mono-black.png";
  shareLogoImgs.white.onload = shareLogoImgs.black.onload = function () {
    if (shareCardOnAssetLoad) shareCardOnAssetLoad();
  };

  function roundRectPath(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawShareCardTexture(ctx, preset) {
    var w = SHARE_CANVAS_W, h = SHARE_CANVAS_H;
    ctx.save();
    ctx.fillStyle = preset.bg;
    ctx.fillRect(0, 0, w, h);

    // sparse dot-grid texture, very faint
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = preset.ink;
    for (var gy = 20; gy < h; gy += 90) {
      for (var gx = 20; gx < w; gx += 90) {
        ctx.beginPath();
        ctx.arc(gx, gy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // checkered "finish flag" corner motif, top-right
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.translate(w - 50, 50);
    ctx.rotate((20 * Math.PI) / 180);
    var checkSize = 26;
    for (var cy = -260; cy < 160; cy += checkSize) {
      for (var cx = -160; cx < 260; cx += checkSize) {
        var odd = (Math.round(cx / checkSize) + Math.round(cy / checkSize)) % 2 === 0;
        if (odd) { ctx.fillStyle = preset.ink; ctx.fillRect(cx, cy, checkSize, checkSize); }
      }
    }
    ctx.restore();

    // winding dashed "route" line, faint — same visual idea as the real route map
    ctx.strokeStyle = preset.ink;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 6;
    ctx.setLineDash([5, 24]);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-50, 1300);
    ctx.bezierCurveTo(175, 1200, 125, 1050, 300, 1000);
    ctx.bezierCurveTo(400, 970, 475, 800, 425, 700);
    ctx.bezierCurveTo(375, 600, 625, 550, 575, 425);
    ctx.bezierCurveTo(525, 300, 775, 250, 1150, 200);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();

    // dashed border frame — only the light (white) background needs it to read as a distinct
    // photo against IG's own white chrome; the dark background already stands out on its own.
    if (preset.bg !== "#141414") {
      ctx.save();
      ctx.strokeStyle = preset.ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 6;
      ctx.setLineDash([12, 16]);
      ctx.strokeRect(40, 40, w - 80, h - 80);
      ctx.restore();
    }
  }

  // Shrinks the font until `text` fits within maxWidth (down to a floor so it never becomes
  // illegibly tiny) — team names and especially people's own names have no fixed length, so
  // a fixed font size overflows the canvas edge for anyone with a longer-than-average name.
  // Leaves ctx.font set to the chosen size/family on return; caller still does the fillText.
  function shareFitFont(ctx, text, maxWidth, weight, startSize, minSize) {
    var size = startSize;
    while (size > minSize) {
      ctx.font = weight + " " + size + "px ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif";
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    }
    return size;
  }

  function shareRunnerEmoji(gender) {
    return gender === "female" ? "\u{1F3C3}‍♀️" : "\u{1F3C3}‍♂️";
  }

  function drawShareCard(canvas, person, gender, bg) {
    canvas.width = SHARE_CANVAS_W;
    canvas.height = SHARE_CANVAS_H;
    var ctx = canvas.getContext("2d");
    var w = SHARE_CANVAS_W;
    var emoji = shareRunnerEmoji(gender);
    var preset = SHARE_BG_PRESETS[bg] || SHARE_BG_PRESETS.dark;
    var ink = preset.ink;
    // grayscale+brightness(0) turns any emoji into a solid black silhouette regardless of its
    // real colors; invert(1) flips that to white for the dark background. Applying only
    // grayscale/brightness without the invert (or only invert without grayscale) both let the
    // emoji's real colors bleed through faintly — this exact combination is required.
    var emojiFilter = bg === "light" ? "grayscale(1) brightness(0)" : "grayscale(1) brightness(0) invert(1)";
    var logoImg = bg === "light" ? shareLogoImgs.black : shareLogoImgs.white;

    drawShareCardTexture(ctx, preset);
    ctx.fillStyle = ink;
    ctx.textBaseline = "alphabetic";

    // top row: event logo (replaces the old "RUN MILE" text — the logo already reads
    // "Run Mile") + team pill. Logo drawn at its real aspect ratio, fixed height.
    if (logoImg.complete && logoImg.naturalWidth) {
      var logoH = 72, logoW = logoH * (logoImg.naturalWidth / logoImg.naturalHeight);
      ctx.drawImage(logoImg, 68, 60, logoW, logoH);
    }

    ctx.textAlign = "left";
    var teamText = person.team;
    var teamPadX = 28, teamH = 56, teamMaxTextWidth = 420;
    shareFitFont(ctx, teamText, teamMaxTextWidth, "800", 30, 16);
    var teamW = Math.min(teamMaxTextWidth, ctx.measureText(teamText).width) + teamPadX * 2;
    var teamX = w - 68 - teamW, teamY = 68;
    roundRectPath(ctx, teamX, teamY, teamW, teamH, teamH / 2);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.fillText(teamText, teamX + teamW / 2, teamY + 39);
    ctx.textAlign = "left";

    // name — shrinks to fit so it never runs past the canvas edge regardless of length
    ctx.fillStyle = ink;
    shareFitFont(ctx, person.name, w - 136, "900", 58, 28);
    ctx.fillText(person.name, 68, 236);

    ctx.save();
    ctx.font = "300px sans-serif";
    ctx.textAlign = "center";
    ctx.filter = emojiFilter;
    ctx.fillText(emoji, w / 2, 540);
    ctx.restore();
    var numY = 760, unitY = 822, dividerY = 900, bottomY = 940;

    ctx.textAlign = "center";
    ctx.fillStyle = ink;
    ctx.font = "900 200px ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(fmtKm(person.km), w / 2, numY);
    ctx.font = "800 34px ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif";
    ctx.globalAlpha = 0.6;
    ctx.fillText("กิโลเมตรสะสม", w / 2, unitY);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(68, dividerY);
    ctx.lineTo(w - 68, dividerY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    var rank = searchTeamStats(person).rank;
    ctx.textAlign = "left";
    ctx.font = "900 52px ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(rank ? "#" + rank : "-", 68, bottomY);
    ctx.font = "700 26px ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif";
    ctx.globalAlpha = 0.6;
    ctx.fillText("อันดับในทีม", 68, bottomY + 40);
    ctx.globalAlpha = 1;

    ctx.textAlign = "right";
    ctx.fillStyle = ink;
    ctx.font = "900 52px ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(person.streak + "\u{1F525}", w - 68, bottomY);
    ctx.font = "700 26px ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif";
    ctx.globalAlpha = 0.6;
    ctx.fillText("วันติดต่อกัน", w - 68, bottomY + 40);
    ctx.globalAlpha = 1;
  }

  function openShareCardView() {
    if (!lastSearchedPerson) return;
    searchResultView.hidden = true;
    searchShareView.hidden = false;
    searchShareView.innerHTML =
      '<h3 class="share-card-title">\u{1F4F8} บันทึกการ์ดของฉัน</h3>' +
      '<p class="share-card-sub">เลือกแบบที่ชอบแล้วกดดาวน์โหลดเป็นรูปได้เลย</p>' +
      '<div class="share-picker-label">เลือกพื้นหลัง</div>' +
      '<div class="share-picker-row" id="shareBgPicker">' +
        '<button type="button" class="share-picker-btn" data-bg="dark">⬛ พื้นดำ</button>' +
        '<button type="button" class="share-picker-btn" data-bg="light">⬜ พื้นขาว</button>' +
      "</div>" +
      '<div class="share-picker-label">เลือกเพศนักวิ่ง</div>' +
      '<div class="share-picker-row" id="shareGenderPicker">' +
        '<button type="button" class="share-picker-btn" data-gender="male">\u{1F3C3}‍♂️ ชาย</button>' +
        '<button type="button" class="share-picker-btn" data-gender="female">\u{1F3C3}‍♀️ หญิง</button>' +
      "</div>" +
      '<div class="share-canvas-wrap"><canvas id="shareCardCanvas"></canvas></div>' +
      '<button type="button" class="share-download-btn" id="shareDownloadBtn">⬇️ ดาวน์โหลดรูป</button>' +
      '<button type="button" class="search-again-btn" id="shareBackBtn">← กลับไปดูของฉัน</button>';

    var canvas = document.getElementById("shareCardCanvas");
    var bgBtns = searchShareView.querySelectorAll("#shareBgPicker .share-picker-btn");
    var genderBtns = searchShareView.querySelectorAll("#shareGenderPicker .share-picker-btn");

    function syncPickers() {
      Array.prototype.forEach.call(bgBtns, function (b) { b.classList.toggle("is-selected", b.getAttribute("data-bg") === shareCardBg); });
      Array.prototype.forEach.call(genderBtns, function (b) { b.classList.toggle("is-selected", b.getAttribute("data-gender") === shareCardGender); });
    }
    function redraw() {
      syncPickers();
      drawShareCard(canvas, lastSearchedPerson, shareCardGender, shareCardBg);
    }
    // Re-fires the current redraw if the logo image was still loading the first time this
    // view opened — clearing this reference is handled below (back button) and on modal reset.
    shareCardOnAssetLoad = redraw;

    Array.prototype.forEach.call(bgBtns, function (b) {
      b.addEventListener("click", function () { shareCardBg = b.getAttribute("data-bg"); redraw(); });
    });
    Array.prototype.forEach.call(genderBtns, function (b) {
      b.addEventListener("click", function () { shareCardGender = b.getAttribute("data-gender"); redraw(); });
    });

    var downloadBtn = document.getElementById("shareDownloadBtn");
    downloadBtn.addEventListener("click", function () {
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "run-mile-" + lastSearchedPerson.name.replace(/\s+/g, "-") + ".png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        downloadBtn.textContent = "✅ บันทึกรูปแล้ว!";
        downloadBtn.classList.add("is-saved");
        setTimeout(function () {
          downloadBtn.textContent = "⬇️ ดาวน์โหลดรูป";
          downloadBtn.classList.remove("is-saved");
        }, 1800);
      }, "image/png");
    });

    document.getElementById("shareBackBtn").addEventListener("click", function () {
      searchShareView.hidden = true;
      shareCardOnAssetLoad = null;
      selectSearchPerson(lastSearchedPerson.name, lastSearchedPerson.team);
    });

    redraw();
  }

  if (searchShareBtn) searchShareBtn.addEventListener("click", openShareCardView);

  if (searchToggleBtn) {
    searchToggleBtn.addEventListener("click", openSearchModal);
    searchClose.addEventListener("click", closeSearchModal);
    searchBackdrop.addEventListener("click", closeSearchModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeSearchModal();
    });
    searchInput.addEventListener("input", renderSearchSuggestions);
    searchInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var q = searchInput.value.trim();
      var matches = lastRoster.filter(function (p) { return p.name.indexOf(q) !== -1; });
      if (matches.length === 1) selectSearchPerson(matches[0].name, matches[0].team);
    });
  }

  function render(state) {
    titleEl.textContent = state.title;
    currentRanks = S.computeRanks(state.teams);
    lastTeamsSnapshot = state.teams;
    var order = state.teams.map(function (t) { return t.id; }).join(",");
    if (order !== lastTeamOrder) { fullRebuild(state.teams); applyWeatherToPins(); } else state.teams.forEach(updateCard);
    reorderCards(state.teams);
    renderCompanyTotal(state.teams);
    renderRankSummary(state.teams);
    renderTopRunnersSummary(state.teams);
    if (rank10Sheet && rank10Sheet.classList.contains("active")) renderTop10Modal(state.teams);
    if (Array.isArray(state.roster)) lastRoster = state.roster;
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

  /* Background music: off by default, only starts when the visitor presses the 🔈 เพลง
     button themselves — no autoplay attempt at all, muted or otherwise.

     Playlist: pick a random track on load (queued up, not played), then pick a new random
     track (never repeating the one that just finished) each time one ends — an endless
     shuffle that lands on a different song per visit instead of always looping the same one. */
  if (bgmEl && bgmToggleBtn) {
    var BGM_TRACKS = ["audio/theme.mp3", "audio/track2.mp3", "audio/track3.mp3", "audio/track4.mp3"];
    var BGM_TARGET_VOLUME = 0.18;
    var BGM_FADE_MS = 4000;
    var bgmUserPaused = true; // starts true: nothing plays until the user presses the button
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
      // Label only flips to "on" once play() actually resolves — setting it eagerly here
      // meant a rejected play() (blocked autoplay policy, a corrupt/missing track, etc.)
      // left the button forever claiming music was on while nothing was actually playing.
      bgmEl.play().then(function () {
        setToggleLabel(true);
        fadeIn();
      }).catch(function () {
        setToggleLabel(false);
      });
    };

    bgmEl.addEventListener("ended", function () {
      bgmCurrentTrack = pickNextTrack();
      bgmEl.src = bgmCurrentTrack;
      startPlaying();
    });

    bgmCurrentTrack = pickNextTrack();
    bgmEl.src = bgmCurrentTrack;
    bgmEl.volume = 0;
    setToggleLabel(false);

    bgmToggleBtn.addEventListener("click", function () {
      if (bgmEl.paused) {
        bgmUserPaused = false;
        startPlaying();
      } else {
        bgmUserPaused = true;
        bgmEl.pause();
        setToggleLabel(false);
      }
    });

    // pagehide fires on any real navigation-away/close, everywhere — always safe to pause on.
    var bgmWasPlayingBeforeHide = false;
    var handleBgmHide = function () {
      bgmWasPlayingBeforeHide = !bgmEl.paused;
      bgmEl.pause();
    };
    window.addEventListener("pagehide", handleBgmHide);

    // In-app browsers (e.g. LINE's webview) don't always fire pagehide when the user
    // "leaves" — the page can sit paused-but-alive in the background instead, so the music
    // keeps playing after the user thinks they've closed the site. visibilitychange catches
    // that case too, but it also fires on an ordinary desktop tab-switch — which should NOT
    // silence the music — so only wire it up when we're actually inside a known in-app
    // webview, detected by its user-agent token, rather than for every browser.
    var isInAppWebview = /\bLine\//i.test(navigator.userAgent);
    if (isInAppWebview) {
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          handleBgmHide();
        } else if (bgmWasPlayingBeforeHide && !bgmUserPaused) {
          startPlaying();
        }
      });
    }
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
