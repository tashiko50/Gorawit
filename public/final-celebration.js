/* Final Celebration — modal system.
 *
 * Reads ONLY window.RunMileFinalConfig (a deep-frozen static record). It never touches the
 * live dashboard's state, never computes a ranking, and makes no network request of any
 * kind — no fetch, no XHR, no Google Sheets. The only things it loads are the nine
 * committed images under /img/final-celebration/.
 *
 * Disabled by default: with `enabled: false` (or any incomplete/malformed config) this file
 * returns before creating any DOM, any listener, any image request, or any localStorage
 * access, so the page is byte-identical to the dashboard without it.
 *
 * run-view.js is not modified and not depended on. Mutual exclusion with the Top 10 and
 * Search sheets is done from the outside, by toggling their `.active` classes and by
 * listening to their trigger buttons in the capture phase.
 */
(function (global) {
  "use strict";

  var doc = global.document;
  var CFG = global.RunMileFinalConfig;

  /* ===== gate 1: enabled must be exactly true =====
     Checked before anything else happens — no DOM, no listeners, no storage, no images. */
  if (!CFG || CFG.enabled !== true) return;

  /* ===== gate 2: strict validity =====
     All nine final values must be present and sane. A half-filled commemorative record is
     never shown; we warn once and stop rather than rendering placeholders, and we never
     fall back to live dashboard data. */
  var ASSET_KEYS = ["factory", "warehouse", "samyan"];

  function isFilledString(v) {
    return typeof v === "string" && v.trim() !== "";
  }
  function isNonNegativeNumber(v) {
    return typeof v === "number" && isFinite(v) && v >= 0;
  }

  function validate(cfg) {
    if (!cfg.campaign || !cfg.modal || !cfg.journey) return "missing campaign/modal/journey";
    if (!isFilledString(cfg.campaign.closingDateLabel)) return "campaign.closingDateLabel";
    if (!isNonNegativeNumber(cfg.campaign.companyTotalKm)) return "campaign.companyTotalKm";
    if (!isFilledString(cfg.campaign.closingMessageTh)) return "campaign.closingMessageTh";
    if (!isFilledString(cfg.modal.storageVersion)) return "modal.storageVersion";

    var teams = cfg.teams;
    if (!Array.isArray(teams) || teams.length !== 3) return "teams must be exactly 3";

    var ranks = [];
    for (var i = 0; i < teams.length; i++) {
      var t = teams[i];
      if (!t || typeof t !== "object") return "teams[" + i + "] malformed";
      if (!isFilledString(t.nameTh)) return "teams[" + i + "].nameTh";
      if (ASSET_KEYS.indexOf(t.assetKey) === -1) return "teams[" + i + "].assetKey";
      if (!isNonNegativeNumber(t.distanceKm)) return "teams[" + i + "].distanceKm";
      if (t.rank !== 1 && t.rank !== 2 && t.rank !== 3) return "teams[" + i + "].rank";
      if (ranks.indexOf(t.rank) !== -1) return "duplicate rank " + t.rank;
      ranks.push(t.rank);
    }
    return null;
  }

  var invalidReason = validate(CFG);
  if (invalidReason) {
    // exactly one concise warning, and nothing else happens
    global.console && console.warn(
      "Run Mile Final Celebration: disabled — final config incomplete/invalid (" + invalidReason + ")."
    );
    return;
  }

  /* ===== from here on the config is known-good ===== */

  var ASSET_BASE = "/img/final-celebration/";
  var STORAGE_KEY = "run-mile-final-seen:" + CFG.modal.storageVersion;
  var MOBILE_QUERY = "(max-width: 720px)";

  var teamsByRank = CFG.teams.slice().sort(function (a, b) { return a.rank - b.rank; });

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function isMobile() {
    return !!(global.matchMedia && global.matchMedia(MOBILE_QUERY).matches);
  }
  function fmtKm(km) {
    return (Math.round(Number(km) * 100) / 100).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  }

  /* ---------- tiny DOM helpers (textContent only — no dynamic innerHTML) ---------- */
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function img(src, cls) {
    var n = doc.createElement("img");
    n.className = cls;
    n.src = src;
    n.alt = "";                    // decorative: the facts live in HTML siblings
    n.setAttribute("aria-hidden", "true");
    n.decoding = "async";
    return n;
  }

  /* ===== state ===== */
  var backdropEl = null, dialogEl = null, confettiEl = null, bodyEl = null, stageEl = null;
  var closeBtn = null, replayBtn = null, totalNumEl = null, trophyBtn = null;
  var opened = false, built = false, assetsRequested = false;
  var timers = [], rafId = null;
  var lastFocused = null;
  var scrollX = 0, scrollY = 0, savedBodyStyle = null;
  /* Guards for scroll restoration: a pending rAF must never land on a newer modal session,
     so every lock bumps lockSession and any in-flight restore is cancelled. */
  var scrollRestoreRaf = null, lockSession = 0;

  /* ===== timers / animation bookkeeping ===== */
  function later(fn, ms) { timers.push(global.setTimeout(fn, ms)); }
  function clearTimers() {
    timers.forEach(global.clearTimeout);
    timers = [];
    if (rafId !== null) { global.cancelAnimationFrame(rafId); rafId = null; }
  }

  /* ===== image preloading =====
     Decode before the timeline starts so the podium never rises into empty frames.
     A rejected decode (broken/blocked file) resolves anyway — a missing picture must not
     throw or stall the modal. */
  function preload(src) {
    return new Promise(function (resolve) {
      var i = new global.Image();
      i.decoding = "async";
      i.onload = function () {
        if (i.decode) { i.decode().then(resolve, function () { resolve(); }); } else { resolve(); }
      };
      i.onerror = function () { resolve(); };
      i.src = src;
    });
  }
  function preloadFor(mobile) {
    assetsRequested = true;
    var first = [ASSET_BASE + (mobile ? "final-scene-mobile.webp" : "final-scene-desktop.webp"),
                 ASSET_BASE + "final-podium.png"];
    teamsByRank.forEach(function (t) { first.push(ASSET_BASE + t.assetKey + "-pose-b.png"); });

    var poseA = teamsByRank.map(function (t) { return ASSET_BASE + t.assetKey + "-pose-a.png"; });

    if (mobile) {
      // Stage 1 needs scene + podium + pose B. Pose A starts loading right after, so the
      // stage-2 result cards are ready by the time the reader scrolls to them.
      return Promise.all(first.map(preload)).then(function () {
        poseA.forEach(preload);
      });
    }
    // Desktop/tablet: everything before the timeline, since A and B crossfade on screen.
    return Promise.all(first.concat(poseA).map(preload));
  }

  /* ===== build (once) ===== */
  function build() {
    if (built) return;
    built = true;

    backdropEl = el("div", "fc-backdrop");
    backdropEl.id = "finalCelebrationBackdrop";

    dialogEl = el("div", "fc-dialog");
    dialogEl.id = "finalCelebrationDialog";
    dialogEl.setAttribute("role", "dialog");
    dialogEl.setAttribute("aria-modal", "true");
    dialogEl.setAttribute("aria-labelledby", "finalCelebrationTitle");
    dialogEl.setAttribute("aria-describedby", "finalCelebrationDesc");
    dialogEl.tabIndex = -1;

    /* ---- sticky header ---- */
    var header = el("div", "fc-header");
    var headText = el("div", "fc-header-text");
    var eyebrow = el("p", "fc-eyebrow", CFG.campaign.eyebrowEn);
    eyebrow.id = "finalCelebrationEyebrow";
    var title = el("h2", "fc-title", CFG.campaign.titleTh);
    title.id = "finalCelebrationTitle";
    headText.appendChild(eyebrow);
    headText.appendChild(title);

    closeBtn = el("button", "fc-close", "✕");
    closeBtn.id = "finalCelebrationClose";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "ปิดบทสรุป RUN MILE");

    header.appendChild(headText);
    header.appendChild(closeBtn);

    /* ---- scrollable body ---- */
    bodyEl = el("div", "fc-body");
    bodyEl.id = "finalCelebrationBody";

    var meta = el("div", "fc-meta");
    meta.id = "finalCelebrationDesc";
    meta.appendChild(el("div", "fc-date", CFG.campaign.closingDateLabel));
    var total = el("div", "fc-total");
    total.appendChild(el("div", "fc-total-label", "ระยะทางรวมทั้งบริษัท"));
    var totalRow = el("div", "fc-total-row");
    totalNumEl = el("span", "fc-total-num", fmtKm(CFG.campaign.companyTotalKm));
    totalRow.appendChild(totalNumEl);
    totalRow.appendChild(el("span", "fc-total-unit", "กม."));
    total.appendChild(totalRow);
    meta.appendChild(total);
    bodyEl.appendChild(meta);

    /* ---- journey labels (HTML, never baked into the art) ---- */
    var journey = el("div", "fc-journey");
    [CFG.journey.phase1, CFG.journey.phase2].forEach(function (p) {
      var box = el("div", "fc-phase");
      box.appendChild(el("div", "fc-phase-name", p.start + " → " + p.destination));
      box.appendChild(el("div", "fc-phase-km", fmtKm(p.distanceKm) + " กม."));
      journey.appendChild(box);
    });
    bodyEl.appendChild(journey);

    /* ---- layered stage: scene + podium + duos ---- */
    stageEl = el("div", "fc-stage");
    stageEl.id = "finalCelebrationStage";

    var picture = doc.createElement("picture");
    picture.className = "fc-scene-layer";
    var srcMobile = doc.createElement("source");
    srcMobile.media = MOBILE_QUERY;
    srcMobile.srcset = ASSET_BASE + "final-scene-mobile.webp";
    picture.appendChild(srcMobile);
    picture.appendChild(img(ASSET_BASE + "final-scene-desktop.webp", "fc-scene"));
    stageEl.appendChild(picture);

    var podiumWrap = el("div", "fc-podium-wrap");
    podiumWrap.appendChild(img(ASSET_BASE + "final-podium.png", "fc-podium"));

    teamsByRank.forEach(function (t) {
      var duo = el("div", "fc-duo");
      duo.setAttribute("data-rank", String(t.rank));
      duo.setAttribute("data-team", t.assetKey);
      duo.appendChild(img(ASSET_BASE + t.assetKey + "-pose-a.png", "fc-pose fc-pose-a"));
      duo.appendChild(img(ASSET_BASE + t.assetKey + "-pose-b.png", "fc-pose fc-pose-b"));
      duo.appendChild(el("span", "fc-shine"));
      podiumWrap.appendChild(duo);
    });
    /* ---- desktop/tablet result labels, pinned to each podium step's front face ----
       They live INSIDE .fc-podium-wrap, not in the body flow, so their positions are
       percentages of the podium artwork and stay glued to the steps at every width.
       DOM order stays rank 1,2,3 (reading order); CSS places them visually 2 · 1 · 3.
       Hidden with display:none at <=720px, where the stage-2 cards take over — so only
       one result presentation is ever in the accessibility tree. */
    var results = el("div", "fc-results");
    teamsByRank.forEach(function (t) {
      var r = el("div", "fc-result");
      r.setAttribute("data-rank", String(t.rank));
      r.setAttribute("data-team", t.assetKey);
      r.style.setProperty("--fc-team-color", t.colorHex || "#8fb6d6");
      r.appendChild(el("div", "fc-result-rank", "อันดับ " + t.rank));
      r.appendChild(el("div", "fc-result-team", t.nameTh));
      r.appendChild(el("div", "fc-result-km", fmtKm(t.distanceKm) + " กม."));
      results.appendChild(r);
    });
    podiumWrap.appendChild(results);

    stageEl.appendChild(podiumWrap);
    bodyEl.appendChild(stageEl);

    /* ---- mobile stage 2: enlarged cards, rank order 1,2,3, pose A ---- */
    var cards = el("div", "fc-cards");
    teamsByRank.forEach(function (t) {
      var card = el("div", "fc-card");
      card.style.setProperty("--fc-team-color", t.colorHex || "#8fb6d6");
      card.appendChild(img(ASSET_BASE + t.assetKey + "-pose-a.png", "fc-card-img"));
      var txt = el("div", "fc-card-text");
      txt.appendChild(el("div", "fc-card-rank", "อันดับ " + t.rank));
      txt.appendChild(el("div", "fc-card-team", t.nameTh));
      txt.appendChild(el("div", "fc-card-km", fmtKm(t.distanceKm) + " กม."));
      card.appendChild(txt);
      cards.appendChild(card);
    });
    bodyEl.appendChild(cards);

    bodyEl.appendChild(el("p", "fc-closing", CFG.campaign.closingMessageTh));

    if (CFG.modal.replayAnimation) {
      var actions = el("div", "fc-actions");
      replayBtn = el("button", "fc-replay", "▶ เล่นอนิเมชันอีกครั้ง");
      replayBtn.id = "finalCelebrationReplay";
      replayBtn.type = "button";
      replayBtn.setAttribute("aria-label", "เล่นอนิเมชันบทสรุปอีกครั้ง");
      actions.appendChild(replayBtn);
      bodyEl.appendChild(actions);
    }

    dialogEl.appendChild(header);
    dialogEl.appendChild(bodyEl);

    confettiEl = el("div", "fc-confetti");
    confettiEl.id = "finalCelebrationConfetti";
    confettiEl.setAttribute("aria-hidden", "true");

    /* Appended to <body>, deliberately NOT inside .page — .page is made inert while the
       modal is open, and an inert ancestor would disable the dialog itself. */
    doc.body.appendChild(backdropEl);
    doc.body.appendChild(dialogEl);
    doc.body.appendChild(confettiEl);

    wireModal();
  }

  /* ===== staged timeline (spec section 8) ===== */
  function resetAnimation() {
    clearTimers();
    clearConfetti();
    stageEl.classList.remove("fc-scene-in", "fc-podium-in", "fc-duos-in", "fc-idle");
    bodyEl.classList.remove("fc-results-in");
    var duos = stageEl.querySelectorAll(".fc-duo");
    for (var i = 0; i < duos.length; i++) duos[i].classList.remove("fc-pose-swapped");
    totalNumEl.textContent = fmtKm(CFG.campaign.companyTotalKm);
  }

  function showCompleted() {
    // reduced motion: the finished scene, immediately, with pose B and the final total
    stageEl.classList.add("fc-scene-in", "fc-podium-in", "fc-duos-in");
    bodyEl.classList.add("fc-results-in");
    var duos = stageEl.querySelectorAll(".fc-duo");
    for (var i = 0; i < duos.length; i++) duos[i].classList.add("fc-pose-swapped");
    totalNumEl.textContent = fmtKm(CFG.campaign.companyTotalKm);
  }

  function runTimeline() {
    resetAnimation();

    if (prefersReducedMotion()) { showCompleted(); return; }

    // 450-900 scenery · 650-1200 podium · 1000-1500 pose A in · 1500-2100 swap to pose B
    later(function () { stageEl.classList.add("fc-scene-in"); }, 450);
    later(function () { stageEl.classList.add("fc-podium-in"); }, 650);
    later(function () { stageEl.classList.add("fc-duos-in"); }, 1000);
    later(function () {
      var duos = stageEl.querySelectorAll(".fc-duo");
      for (var i = 0; i < duos.length; i++) duos[i].classList.add("fc-pose-swapped");
    }, 1500);
    // 1900-2500 labels · 2200-3500 count-up · 2800-4200 one confetti burst
    later(function () { bodyEl.classList.add("fc-results-in"); }, 1900);
    later(function () { countUp(2200, 1300); }, 2200);
    later(burstConfetti, 2800);
    later(function () { stageEl.classList.add("fc-idle"); }, 4200);
  }

  /* count-up on rAF (never setInterval), landing exactly on the fixed config value */
  function countUp(_startAt, durationMs) {
    var target = CFG.campaign.companyTotalKm;
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / durationMs);
      var eased = 1 - Math.pow(1 - p, 3);
      totalNumEl.textContent = fmtKm(target * eased);
      if (p < 1) { rafId = global.requestAnimationFrame(step); }
      else { rafId = null; totalNumEl.textContent = fmtKm(target); }
    }
    rafId = global.requestAnimationFrame(step);
  }

  /* ===== confetti: exactly one burst, all nodes removed afterwards =====
     Spec section 8 gives the burst the window 2800–4200ms and requires "subtle idle only"
     afterwards, so the whole burst must fit in CONFETTI_WINDOW_MS. Slowest piece =
     max delay + max duration, and the nodes are removed at the end of the window, not
     one window AFTER it — otherwise confetti would still be falling during the idle. */
  var CONFETTI_WINDOW_MS = 1400;
  var CONFETTI_COLORS = ["#f0a848", "#4F9A5B", "#E2934A", "#4A90D9", "#f6d365", "#8fd3f4"];
  function clearConfetti() { if (confettiEl) confettiEl.textContent = ""; }
  function burstConfetti() {
    if (prefersReducedMotion() || !confettiEl) return;
    var frag = doc.createDocumentFragment();
    for (var i = 0; i < 42; i++) {
      var p = el("span", "fc-confetti-piece");
      p.style.left = (Math.random() * 100) + "%";
      p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      // 0.15 + 1.05 + 0.2 jitter = 1.4s worst case, exactly the window
      p.style.animationDuration = (1.05 + Math.random() * 0.2) + "s";
      p.style.animationDelay = (Math.random() * 0.15) + "s";
      frag.appendChild(p);
    }
    confettiEl.appendChild(frag);
    later(clearConfetti, CONFETTI_WINDOW_MS);
  }

  /* ===== scroll lock =====
     overscroll-behavior alone does not stop the page behind from scrolling on iOS, so the
     body is pinned with position:fixed and the exact previous inline styles are restored on
     every close path. */
  function cancelScrollRestore() {
    if (scrollRestoreRaf !== null) {
      global.cancelAnimationFrame(scrollRestoreRaf);
      scrollRestoreRaf = null;
    }
  }
  function lockScroll() {
    // A restore still queued from a previous session must not fire against this one.
    cancelScrollRestore();
    lockSession++;
    scrollX = global.scrollX || global.pageXOffset || doc.documentElement.scrollLeft || 0;
    scrollY = global.scrollY || global.pageYOffset || doc.documentElement.scrollTop || 0;
    var s = doc.body.style;
    savedBodyStyle = { position: s.position, top: s.top, left: s.left, right: s.right,
                       width: s.width, overflow: s.overflow };
    s.position = "fixed";
    s.top = -scrollY + "px";
    s.left = "0";
    s.right = "0";
    s.width = "100%";
    s.overflow = "hidden";
    doc.body.classList.add("fc-modal-open");
  }
  function unlockScroll() {
    if (!savedBodyStyle) return;
    var s = doc.body.style;
    s.position = savedBodyStyle.position;
    s.top = savedBodyStyle.top;
    s.left = savedBodyStyle.left;
    s.right = savedBodyStyle.right;
    s.width = savedBodyStyle.width;
    s.overflow = savedBodyStyle.overflow;
    savedBodyStyle = null;
    doc.body.classList.remove("fc-modal-open");

    /* While the modal is open body is position:fixed, so the document's scroll extent has
       collapsed to the viewport and scrollTo() would clamp to 0. Resetting the styles above
       restores the extent, but only once layout has run: read offsetHeight to force that
       synchronously, then scroll. Both happen in this same frame, so there is no visible jump.

       (The offset was previously lost for a different reason too — close() focuses the trophy
       button right after this, and focus() scrolls its target into view unless asked not to.
       That call now passes preventScroll.) */
    var x = scrollX, y = scrollY, session = lockSession;
    void doc.documentElement.offsetHeight;
    global.scrollTo(x, y);

    /* Safety net for engines that ignore preventScroll (older Safari) or defer the extent
       recalculation: re-check on the next frame. Cancelled by a reopen, and the session check
       means a stale restore can never override a newer one. */
    cancelScrollRestore();
    scrollRestoreRaf = global.requestAnimationFrame(function () {
      scrollRestoreRaf = null;
      if (session !== lockSession) return;              // newer modal session — stand down
      if (Math.abs((global.scrollY || 0) - y) > 1 || Math.abs((global.scrollX || 0) - x) > 1) {
        global.scrollTo(x, y);
      }
    });
  }

  /* background inert, with aria-hidden fallback where inert is unsupported */
  function setBackgroundInert(on) {
    var page = doc.querySelector(".page");
    if (!page) return;
    var supportsInert = "inert" in global.HTMLElement.prototype;
    if (on) {
      if (supportsInert) page.inert = true; else page.setAttribute("aria-hidden", "true");
    } else {
      if (supportsInert) page.inert = false;
      page.removeAttribute("aria-hidden");
    }
  }

  /* ===== focus trap ===== */
  function focusables() {
    return Array.prototype.filter.call(
      dialogEl.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
      function (n) { return !n.disabled && n.offsetParent !== null; }
    );
  }
  function onKeydown(e) {
    if (!opened) return;                       // guarded: no-op while closed
    if (e.key === "Escape" && CFG.modal.escapeClose !== false) { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    var list = focusables();
    if (!list.length) { e.preventDefault(); dialogEl.focus(); return; }
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && (doc.activeElement === first || doc.activeElement === dialogEl)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && doc.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  /* ===== mutual exclusion with the dashboard's own sheets ===== */
  var OTHER_IDS = ["rank10Backdrop", "rank10Sheet", "searchBackdrop", "searchSheet"];
  function closeOtherOverlays() {
    OTHER_IDS.forEach(function (id) {
      var n = doc.getElementById(id);
      if (n) n.classList.remove("active");
    });
  }

  /* ===== public actions ===== */
  function open(viaAuto) {
    build();
    if (opened) return;
    closeOtherOverlays();

    lastFocused = doc.activeElement;
    opened = true;

    backdropEl.style.display = "block";
    dialogEl.style.display = "flex";
    confettiEl.style.display = "block";

    lockScroll();
    setBackgroundInert(true);

    // let display take effect before the transition classes land
    global.requestAnimationFrame(function () {
      backdropEl.classList.add("fc-in");
      dialogEl.classList.add("fc-in");
    });

    closeBtn.focus();

    var startTimeline = function () { runTimeline(); };
    if (assetsRequested) { startTimeline(); }
    else { preloadFor(isMobile()).then(startTimeline, startTimeline); }

    if (viaAuto) markSeen();
  }

  function close() {
    if (!opened) return;
    opened = false;
    clearTimers();
    clearConfetti();

    backdropEl.classList.remove("fc-in");
    dialogEl.classList.remove("fc-in");
    stageEl.classList.remove("fc-idle");

    var hide = function () {
      if (opened) return;                       // reopened during the fade — leave it visible
      backdropEl.style.display = "none";
      dialogEl.style.display = "none";
      confettiEl.style.display = "none";
    };
    if (prefersReducedMotion()) hide(); else global.setTimeout(hide, 320);

    setBackgroundInert(false);
    unlockScroll();

    /* preventScroll matters: focus() scrolls its target into view by default, and the trophy
       button sits near the top of the page — so focusing it here would immediately undo the
       scroll position unlockScroll() has just restored. Browsers that ignore the option fall
       back to the rAF retry in unlockScroll(). */
    if (trophyBtn) focusWithoutScrolling(trophyBtn);
    else if (lastFocused && lastFocused.focus) focusWithoutScrolling(lastFocused);
  }

  function focusWithoutScrolling(node) {
    try { node.focus({ preventScroll: true }); }
    catch (e) { node.focus(); }                   // very old engines: options bag unsupported
  }

  function replay() {
    if (!opened) return;
    runTimeline();                              // timers/rAF/confetti/classes all reset inside
  }

  function isOpen() { return opened; }

  /* ===== wiring ===== */
  function wireModal() {
    closeBtn.addEventListener("click", function () { close(); });
    if (replayBtn) replayBtn.addEventListener("click", function () { replay(); });
    if (CFG.modal.backdropClose !== false) {
      backdropEl.addEventListener("click", function () { close(); });
    }
    doc.addEventListener("keydown", onKeydown);
  }

  function wireMutualExclusion() {
    // capture phase: close the celebration before run-view.js's own handler opens its sheet
    ["top10Toggle", "searchToggle"].forEach(function (id) {
      var btn = doc.getElementById(id);
      if (btn) btn.addEventListener("click", function () { if (opened) close(); }, true);
    });

    // fallback: if either sheet gains .active by any other path, stand down
    if (!global.MutationObserver) return;
    var obs = new global.MutationObserver(function (records) {
      if (!opened) return;
      for (var i = 0; i < records.length; i++) {
        if (records[i].target.classList.contains("active")) { close(); return; }
      }
    });
    ["rank10Sheet", "searchSheet"].forEach(function (id) {
      var n = doc.getElementById(id);
      if (n) obs.observe(n, { attributes: true, attributeFilter: ["class"] });
    });
  }

  /* ===== trophy button (created only after the gates pass) ===== */
  function addTrophyButton() {
    var row = doc.querySelector(".page-links");
    if (!row) return;
    trophyBtn = el("button", "page-links-btn", "🏆 บทสรุป");
    trophyBtn.id = "finalCelebrationToggle";
    trophyBtn.type = "button";
    trophyBtn.setAttribute("aria-label", "เปิดบทสรุป RUN MILE");
    trophyBtn.addEventListener("click", function () { open(false); });
    row.appendChild(trophyBtn);
  }

  /* ===== auto-open once per storageVersion ===== */
  function hasSeen() {
    try { return global.localStorage.getItem(STORAGE_KEY) === "1"; }
    catch (e) { return false; }                 // storage blocked → treat as unseen, never throw
  }
  function markSeen() {
    try { global.localStorage.setItem(STORAGE_KEY, "1"); } catch (e) { /* non-fatal */ }
  }

  /* ===== init ===== */
  addTrophyButton();
  wireMutualExclusion();

  if (CFG.modal.autoOpenOnce && !hasSeen()) {
    open(true);
  }

  global.RunMileFinalCelebration = {
    open: function () { open(false); },
    close: close,
    replay: replay,
    isOpen: isOpen
  };
})(window);
