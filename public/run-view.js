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

  var feed = S.createFeedWidget({ listEl: feedListEl, widgetEl: feedWidget, toggleEl: feedToggle, countEl: feedCountEl });

  var route = null; // { waypoints, viewBox: {w,h}, finishKm }
  var routeD = "";
  var pinOffsets = []; // precomputed {ox,oy} per waypoint, shared by every card
  var cardRefs = new Map(); // teamId -> refs
  var lastTeamOrder = "";
  var lastFetchTs = null;

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

  function computePinOffsets() {
    var OFFSET = 38;
    return route.waypoints.map(function (wp, i) {
      var perp = perpAt(i);
      var side = i % 2 === 0 ? 1 : -1;
      return { ox: wp.x + perp.x * OFFSET * side, oy: wp.y + perp.y * OFFSET * side };
    });
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
        '<g fill="#4f8a55" opacity="0.4">' +
          '<circle cx="90" cy="380" r="26" /><circle cx="130" cy="360" r="20" />' +
          '<circle cx="410" cy="420" r="24" /><circle cx="440" cy="450" r="18" /><circle cx="180" cy="470" r="22" />' +
        "</g>" +
        '<path class="route-glow" d="" /><path class="route-path" d="" />' +
        '<g class="pin-leaders" stroke="#7a5230" stroke-width="1" stroke-dasharray="2 2" opacity="0.6"></g>' +
        '<g class="pin-dots"></g>' +
      "</svg>";
  }

  function renderPins(refs) {
    refs.pinsLayer.innerHTML = "";
    refs.pinDotsEl.innerHTML = "";
    refs.pinLeadersEl.innerHTML = "";
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

      var label = document.createElement("span");
      label.className = "way-label";
      label.textContent = wp.name;
      var km = document.createElement("span");
      km.className = "way-km";
      km.textContent = wp.km + " กม.";

      pin.appendChild(label);
      pin.appendChild(km);
      refs.pinsLayer.appendChild(pin);
    });
  }

  function buildTeamMapCard(team) {
    var card = document.createElement("div");
    card.className = "team-map-card";

    var header = document.createElement("div");
    header.className = "team-map-header";
    var nameEl = document.createElement("span");
    nameEl.className = "team-map-name";
    var kmEl = document.createElement("span");
    kmEl.className = "team-map-km";
    header.appendChild(nameEl);
    header.appendChild(kmEl);

    var frame = document.createElement("div");
    frame.className = "map-frame";
    frame.innerHTML = mapSvgMarkup(team.id);
    var pinsLayer = document.createElement("div");
    pinsLayer.className = "pins-layer";
    var runnersLayer = document.createElement("div");
    runnersLayer.className = "runners-layer";
    frame.appendChild(pinsLayer);
    frame.appendChild(runnersLayer);

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
    tag.appendChild(runnerName);
    tag.appendChild(runnerKm);
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

    card.appendChild(header);
    card.appendChild(frame);
    card.appendChild(place);
    card.appendChild(barTrack);

    var refs = {
      card: card, nameEl: nameEl, kmEl: kmEl, placeEl: place, barFill: barFill,
      routePathEl: frame.querySelector(".route-path"), routeGlowEl: frame.querySelector(".route-glow"),
      pinDotsEl: frame.querySelector(".pin-dots"), pinLeadersEl: frame.querySelector(".pin-leaders"),
      pinsLayer: pinsLayer, runnerWrap: runnerWrap, runnerName: runnerName, runnerKm: runnerKm,
      lastPlace: null
    };

    if (route) {
      refs.routePathEl.setAttribute("d", routeD);
      refs.routeGlowEl.setAttribute("d", routeD);
      renderPins(refs);
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

    var p = positionForKm(team.km);
    refs.runnerWrap.style.left = pctX(p.x);
    refs.runnerWrap.style.top = pctY(p.y);
    refs.runnerName.textContent = team.name;
    refs.runnerKm.textContent = team.km + " กม.";

    if (refs.lastPlace !== null && p.place !== refs.lastPlace) {
      var big = p.place.indexOf("เชียงราย") !== -1;
      celebrateRunner(refs, big);
      showToast(refs, big ? "\u{1F3C5} ถึงเชียงรายแล้ว!" : "\u{1F4CD} ถึง" + p.place + "แล้ว!");
    }
    refs.lastPlace = p.place;

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

  function render(state) {
    titleEl.textContent = state.title;
    var order = state.teams.map(function (t) { return t.id; }).join(",");
    if (order !== lastTeamOrder) fullRebuild(state.teams); else state.teams.forEach(updateCard);
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

  fetch("/api/route")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      route = data;
      routeD = smoothPathD(route.waypoints);
      pinOffsets = computePinOffsets();
      poll();
      setInterval(poll, POLL_MS);
    });
})();
