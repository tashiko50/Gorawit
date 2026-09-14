/* Final Celebration — static configuration ONLY.
 *
 * This file is a frozen data sheet for the end-of-campaign "บทสรุป RUN MILE" screen.
 * It deliberately contains no rendering, no DOM access, no timers and no network calls,
 * so loading it can never affect the live dashboard. Nothing here reads run-view.js
 * state (teams/roster/ranks) or any /api/* endpoint.
 *
 * WHY STATIC: the celebration is a frozen commemorative record of how the campaign
 * ended, not a second live scoreboard. The live board already renders current standings
 * from the Google Sheet; this screen must keep showing the same closing numbers forever,
 * even after the sheet is edited, archived, or the Apps Script is turned off.
 *
 * ===========================================================================
 * MUST BE FILLED IN BY HAND AFTER THE CAMPAIGN CLOSES (currently null):
 *   - campaign.closingDateLabel   วันที่ปิดกิจกรรม
 *   - campaign.companyTotalKm     ระยะรวมทั้งบริษัท
 *   - teams[].rank                อันดับสุดท้ายของแต่ละทีม
 *   - teams[].distanceKm          ระยะสะสมสุดท้ายของแต่ละทีม
 *
 * These values must be typed in manually from the approved final numbers.
 * NEVER compute, poll, scrape or fetch them from Google Sheets, the Apps Script
 * web app, or any API — that is the whole point of this file being static.
 *
 * `enabled` MUST REMAIN false until the final results are approved.
 * ===========================================================================
 */
(function (global) {
  "use strict";

  var CONFIG = {
    // Master switch. Stays false until the campaign is over AND the final numbers
    // below have been filled in and approved. While false, nothing should render.
    enabled: false,

    campaign: {
      titleTh: "บทสรุป RUN MILE",
      eyebrowEn: "THE FINAL CELEBRATION",

      // TODO(after-campaign): closing date label, e.g. "30 กันยายน 2569".
      closingDateLabel: null,

      // TODO(after-campaign): final company-wide total in km, as a plain number
      // (e.g. 4210.55). Type in the approved figure — do not derive it from the sheet.
      companyTotalKm: null,

      // Declares intent for any future consumer: this screen is fed by literals in
      // this file only. There is no Google Sheets dependency, by design.
      dataMode: "static-final"
    },

    /* Team order here is the fixed data order, NOT the finishing order — the podium
       arranges itself from each team's `rank` once those are filled in.
       colorHex mirrors the live board's palette (see PALETTE in server.js / shared.js)
       so the celebration screen stays visually consistent with the dashboard. */
    teams: [
      {
        id: "factory",
        nameTh: "โรงงาน",
        color: "green",
        colorHex: "#4F9A5B",
        rank: null,        // TODO(after-campaign): final rank (1, 2 or 3)
        distanceKm: null,  // TODO(after-campaign): final accumulated km
        assetKey: "factory"
      },
      {
        id: "warehouse",
        nameTh: "คลังสินค้า",
        color: "orange",
        colorHex: "#E2934A",
        rank: null,        // TODO(after-campaign): final rank (1, 2 or 3)
        distanceKm: null,  // TODO(after-campaign): final accumulated km
        assetKey: "warehouse"
      },
      {
        id: "samyan",
        nameTh: "ออฟฟิศสามย่าน",
        color: "blue",
        colorHex: "#4A90D9",
        rank: null,        // TODO(after-campaign): final rank (1, 2 or 3)
        distanceKm: null,  // TODO(after-campaign): final accumulated km
        assetKey: "samyan"
      }
    ],

    /* The two chapters of the route, for the recap scenery. These distances are the
       campaign's own fixed milestones (not live progress), so they are known now and
       are safe to hard-code. They match the route the dashboard already draws. */
    journey: {
      phase1: {
        start: "กรุงเทพฯ",
        destination: "แม่สาย",
        distanceKm: 890
      },
      phase2: {
        start: "ฮานอย",
        destination: "ชิมาเนะ",
        distanceKm: 2999
      }
    },

    modal: {
      // Show once per browser on first visit after launch; the trophy button reopens it
      // afterwards, so a viewer is never trapped and never nagged twice.
      autoOpenOnce: true,
      closeButton: true,
      backdropClose: true,
      escapeClose: true,
      trophyButtonReopen: true,
      replayAnimation: true,

      // Bump this string to re-trigger the one-time auto-open for everyone (it is the
      // storage key's version tag, so a new value simply looks "unseen" to every browser).
      storageVersion: "run-mile-final-2026-v1"
    },

    visual: {
      theme: "Soft Sky Celebration",
      style: "Modern 2.5D Journey",

      // Left-to-right podium placement: runner-up, winner (center, tallest), third.
      podiumOrder: [2, 1, 3],

      // Keep the existing dashboard's look and feel; the celebration is a finale for the
      // same board, not a separate product with its own visual language.
      preserveExistingDashboardMood: true,
      reducedMotionSupport: true
    }
  };

  /* Recursively freeze so a stray assignment anywhere (including into a nested team
     object or the podiumOrder array) fails silently in sloppy mode and throws in strict
     mode, instead of quietly corrupting the commemorative record at runtime.
     The isFrozen check doubles as a cycle guard. */
  function deepFreeze(node) {
    if (node === null || typeof node !== "object" || Object.isFrozen(node)) return node;
    Object.freeze(node);
    Object.keys(node).forEach(function (key) {
      deepFreeze(node[key]);
    });
    return node;
  }

  deepFreeze(CONFIG);

  /* Defined rather than plain-assigned so the global itself is read-only too: freezing
     CONFIG alone would still allow `window.RunMileFinalConfig = somethingElse`. */
  Object.defineProperty(global, "RunMileFinalConfig", {
    value: CONFIG,
    writable: false,
    enumerable: true,
    configurable: false
  });
})(window);
