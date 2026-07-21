(function () {
  "use strict";

  var S = window.Scoreboard;
  var POLL_MS = 3000;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var routePathEl = document.getElementById("routePath");
  var routeGlowEl = document.getElementById("routeGlow");
  var pinDotsEl = document.getElementById("pinDots");
  var pinLeadersEl = document.getElementById("pinLeaders");
  var pinsLayer = document.getElementById("pinsLayer");
  var runnersLayer = document.getElementById("runnersLayer");
  var rosterEl = document.getElementById("roster");
  var titleEl = document.getElementById("boardTitle");
  var lastUpdatedEl = document.getElementById("lastUpdated");
  var feedListEl = document.getElementById("feedList");
  var feedWidget = document.getElementById("feedWidget");
  var feedToggle = document.getElementById("feedToggle");
  var feedCountEl = document.getElementById("feedCount");

  var feed = S.createFeedWidget({ listEl: feedListEl, widgetEl: feedWidget, toggleEl: feedToggle, countEl: feedCountEl });

  var route = null; // { waypoints, viewBox: {w,h}, finishKm }
  var runnerRefs = new Map();
  var rosterRefs = new Map();
  var lastRosterOrder = "";
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

  function svgEl(name, attrs) {
    var e = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  /* Perpendicular direction of the road at waypoint i, from the segments either side of
     it — used to push each place's label off the road instead of stacking labels on top
     of the dashed line (and any runner standing right on the checkpoint). */
  function perpAt(i) {
    var wps = route.waypoints;
    var prev = wps[i - 1] || wps[i];
    var next = wps[i + 1] || wps[i];
    var dx = next.x - prev.x, dy = next.y - prev.y;
    var len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  }

  function renderPins() {
    pinsLayer.innerHTML = "";
    pinDotsEl.innerHTML = "";
    pinLeadersEl.innerHTML = "";
    var OFFSET = 38;
    route.waypoints.forEach(function (wp, i) {
      var isFinish = wp.km === route.finishKm;
      var perp = perpAt(i);
      var side = i % 2 === 0 ? 1 : -1;
      var ox = wp.x + perp.x * OFFSET * side;
      var oy = wp.y + perp.y * OFFSET * side;

      pinDotsEl.appendChild(svgEl("circle", {
        cx: wp.x, cy: wp.y, r: isFinish ? 6 : 3.5,
        fill: isFinish ? "#ffd873" : "#fff", stroke: isFinish ? "#b3860f" : "#7a5230", "stroke-width": 2
      }));
      pinLeadersEl.appendChild(svgEl("line", { x1: wp.x, y1: wp.y, x2: ox, y2: oy }));

      var pin = document.createElement("div");
      pin.className = "way-label-pin" + (isFinish ? " finish" : "");
      pin.style.left = pctX(ox);
      pin.style.top = pctY(oy);

      var label = document.createElement("span");
      label.className = "way-label";
      label.textContent = wp.name;
      var km = document.createElement("span");
      km.className = "way-km";
      km.textContent = wp.km + " กม.";

      pin.appendChild(label);
      pin.appendChild(km);
      pinsLayer.appendChild(pin);
    });
  }

  /* Position along the route for a given km: interpolates linearly between the two
     waypoints straddling it, and reports the segment direction (for collision offsets)
     plus the place name / distance to the next place. Past the last waypoint, the
     marker stays pinned there and `overshoot` reports how far beyond that the team ran. */
  function positionForKm(km) {
    var wps = route.waypoints;
    var k = Math.max(0, Number(km) || 0);
    var first = wps[0], last = wps[wps.length - 1];
    if (k <= first.km) {
      var seg0 = wps[1] || first;
      return { x: first.x, y: first.y, dirX: seg0.x - first.x, dirY: seg0.y - first.y, place: first.name, nextPlace: seg0.name, kmToNext: Math.max(0, seg0.km - k), overshoot: 0 };
    }
    for (var i = 0; i < wps.length - 1; i++) {
      var a = wps[i], b = wps[i + 1];
      if (k <= b.km) {
        var t = (k - a.km) / ((b.km - a.km) || 1);
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          dirX: b.x - a.x, dirY: b.y - a.y,
          place: a.name, nextPlace: b.name, kmToNext: Math.max(0, Math.round(b.km - k)), overshoot: 0
        };
      }
    }
    return { x: last.x, y: last.y, dirX: 0, dirY: -1, place: last.name, nextPlace: null, kmToNext: 0, overshoot: Math.round(k - last.km) };
  }

  /* Multiple teams can land on (nearly) the same spot on a shared route — nudge later
     arrivals sideways, perpendicular to the road, alternating left/right in growing steps. */
  function layoutPositions(teams) {
    var placed = [];
    return teams.map(function (team) {
      var p = positionForKm(team.km);
      var len = Math.hypot(p.dirX, p.dirY) || 1;
      var nx = -p.dirY / len, ny = p.dirX / len;
      var nearby = placed.filter(function (q) { return Math.hypot(q.x - p.x, q.y - p.y) < 22; });
      if (nearby.length) {
        var side = nearby.length % 2 === 1 ? 1 : -1;
        var mag = Math.ceil(nearby.length / 2) * 16;
        p.x += nx * mag * side;
        p.y += ny * mag * side;
      }
      placed.push({ x: p.x, y: p.y });
      return { team: team, p: p };
    });
  }

  function ensureRunner(team) {
    var refs = runnerRefs.get(team.id);
    if (refs) return refs;
    var wrap = document.createElement("div");
    wrap.className = "runner";
    var shadow = document.createElement("div");
    shadow.className = "runner-shadow";
    var badge = document.createElement("div");
    badge.className = "runner-badge";
    badge.appendChild(S.buildRunIcon());
    var tag = document.createElement("div");
    tag.className = "runner-tag";
    var name = document.createElement("div");
    name.className = "runner-name";
    var km = document.createElement("div");
    km.className = "runner-km";
    tag.appendChild(name);
    tag.appendChild(km);
    wrap.appendChild(shadow);
    wrap.appendChild(badge);
    wrap.appendChild(tag);
    runnersLayer.appendChild(wrap);
    refs = { wrap: wrap, name: name, kmEl: km, lastPlace: null };
    runnerRefs.set(team.id, refs);
    return refs;
  }

  function celebrateRunner(refs, big) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    refs.wrap.classList.remove("celebrate");
    void refs.wrap.offsetWidth;
    refs.wrap.classList.add("celebrate");

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
    refs.wrap.appendChild(burst);
    setTimeout(function () { burst.remove(); }, 800);
    setTimeout(function () { refs.wrap.classList.remove("celebrate"); }, 700);
  }

  function showToast(refs, text) {
    var toast = document.createElement("div");
    toast.className = "runner-toast";
    toast.textContent = text;
    refs.wrap.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 2200);
  }

  function renderRunners(teams) {
    var laidOut = layoutPositions(teams);
    var seenIds = {};
    laidOut.forEach(function (item) {
      var team = item.team, p = item.p;
      seenIds[team.id] = true;
      var refs = ensureRunner(team);
      refs.wrap.style.setProperty("--accent", team.color);
      refs.wrap.style.left = pctX(p.x);
      refs.wrap.style.top = pctY(p.y);
      refs.name.textContent = team.name;
      refs.kmEl.textContent = team.km + " กม.";

      if (refs.lastPlace !== null && p.place !== refs.lastPlace) {
        var big = p.place.indexOf("เชียงราย") !== -1;
        celebrateRunner(refs, big);
        showToast(refs, big ? "\u{1F3C5} " + team.name + " ถึงเชียงรายแล้ว!" : "\u{1F4CD} ถึง" + p.place + "แล้ว!");
      }
      refs.lastPlace = p.place;
    });
    runnerRefs.forEach(function (refs, id) {
      if (!seenIds[id]) {
        refs.wrap.remove();
        runnerRefs.delete(id);
      }
    });
  }

  function renderRoster(teams) {
    var order = teams.map(function (t) { return t.id; }).join(",");
    if (order !== lastRosterOrder) {
      rosterEl.innerHTML = "";
      rosterRefs.clear();
      if (!teams.length) {
        var empty = document.createElement("div");
        empty.className = "roster-empty";
        empty.textContent = "ยังไม่มีทีม";
        rosterEl.appendChild(empty);
      } else {
        teams.forEach(function (team) {
          var card = document.createElement("div");
          card.className = "roster-card";

          var top = document.createElement("div");
          top.className = "roster-top";
          var name = document.createElement("span");
          name.className = "roster-name";
          var km = document.createElement("span");
          km.className = "roster-km";
          top.appendChild(name);
          top.appendChild(km);

          var place = document.createElement("div");
          place.className = "roster-place";

          var barTrack = document.createElement("div");
          barTrack.className = "roster-bar-track";
          var barFill = document.createElement("div");
          barFill.className = "roster-bar-fill";
          barTrack.appendChild(barFill);

          card.appendChild(top);
          card.appendChild(place);
          card.appendChild(barTrack);
          rosterEl.appendChild(card);

          rosterRefs.set(team.id, { card: card, name: name, km: km, place: place, barFill: barFill });
        });
      }
      lastRosterOrder = order;
    }

    teams.forEach(function (team) {
      var refs = rosterRefs.get(team.id);
      if (!refs) return;
      refs.card.style.setProperty("--accent", team.color);
      refs.name.textContent = team.name;
      refs.km.textContent = team.km + " กม.";
      var p = positionForKm(team.km);
      if (p.overshoot > 0) {
        refs.place.textContent = "\u{1F389} ถึงจุดหมายแล้ว! เลย " + p.place + " ไปอีก " + p.overshoot + " กม.";
      } else if (p.nextPlace) {
        refs.place.textContent = "อยู่ที่ " + p.place + " · อีก " + p.kmToNext + " กม. ถึง" + p.nextPlace;
      } else {
        refs.place.textContent = "อยู่ที่ " + p.place;
      }
      var pct = S.clamp((team.km / route.finishKm) * 100, 0, 100);
      refs.barFill.style.width = pct + "%";
    });
  }

  function render(state) {
    titleEl.textContent = state.title;
    renderRunners(state.teams);
    renderRoster(state.teams);
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
      var d = smoothPathD(route.waypoints);
      routePathEl.setAttribute("d", d);
      routeGlowEl.setAttribute("d", d);
      renderPins();
      poll();
      setInterval(poll, POLL_MS);
    });
})();
