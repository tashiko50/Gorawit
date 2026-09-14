# Run Mile — Final Celebration · Visual Implementation Specification

> **Status:** Approved specification. Source of truth for visual and implementation work.
> **Scope of this document:** specification and delivered artwork. The nine approved assets
> are committed; the modal is **not** implemented and **not** wired to the dashboard yet.
>
> **Related files**
> - `public/final-results-data.js` — the static, deep-frozen config (`window.RunMileFinalConfig`), already committed and **disabled** (`enabled: false`).
> - `public/img/final-celebration/` — the nine delivered assets (see §6).
> - `docs/wrapup-mockup.html` — **structural reference only** (see §1).

---

## 1. Creative Direction

**Project name:** Run Mile — Final Celebration
**Theme:** Soft Sky Celebration
**Style:** Modern 2.5D Journey

### Design balance

| Share | Intent |
|---|---|
| **70%** | Preserve the existing Run Mile dashboard visual language |
| **30%** | Introduce modern 2.5D depth, lighting, layering, and celebration details |

### The final design must feel

- cheerful
- warm
- modern
- polished
- dimensional
- suitable for an internal company activity
- visually related to the current Run Mile dashboard

### Avoid

- dark dusk-gradient visual as the main direction
- saturated arcade-game styling
- wooden signboards
- realistic human characters
- hyper-detailed fantasy scenery
- heavy shadows
- excessive gradients
- continuous confetti
- visual clutter

### Use of the existing mockup

`docs/wrapup-mockup.html` may be used **only as a structural reference** (section order,
hero → podium → leaders → closing flow).

**Do not** copy its dusk mood, its colors, or its final visual styling. That mockup is a
dark dusk-gradient design, which is explicitly *not* the approved direction here.

---

## 2. Modal Structure

The Final Celebration is a **modal overlay above the existing dashboard**. The dashboard
itself is never replaced or navigated away from.

### Desktop

- centered modal
- maximum width approximately **1180px**
- maximum height must fit within the viewport
- rounded white / pale-blue container
- soft layered shadow
- dimmed and lightly blurred dashboard behind it
- close button at top-right
- replay animation button
- result/podium visual is the primary focus
- podium arrangement: **rank 2 · rank 1 · rank 3** (left → right)

### Mobile

- **no horizontal scrolling**
- modal uses nearly full screen width
- content can scroll vertically inside the modal
- closing button remains easy to reach
- rank 1 receives the strongest visual emphasis
- final result details appear vertically in rank order: **1, 2, 3**
- all buttons must have at least a **44px** touch target
- typography must remain readable without zooming

#### Mobile composition sequence

Mobile is **not** a shrunken desktop layout. It plays out in two stages, top to bottom:

**Stage 1 — podium overview**
- First show the **main podium overview** in **2 · 1 · 3** order (same arrangement as desktop).
- The podium overview uses **pose B for all three teams** (trophies raised).

**Stage 2 — enlarged result cards**
- After the podium overview, show **enlarged result cards vertically in rank order 1, 2, 3**.
- Each result card uses the corresponding **pose A** teammate-pair image.
- Each card includes: **rank**, **HTML team name**, and **HTML final distance**.

**Rules for the sequence**
- **Do not compress the entire experience into one viewport.** The podium overview and the
  result cards are meant to be reached by scrolling, not crushed together to fit one screen.
- **Preserve readable character size through vertical scrolling** — cards stay large enough
  that both runners' faces, colors, gestures and trophy stay clear. Scrolling is the budget;
  shrinking the characters is not.
- **Do not create horizontal scrolling** at any point in either stage.

#### Vertically scrollable results

On mobile the three team results are a **vertically scrollable list**:

- results stack vertically in rank order 1, 2, 3 and scroll vertically
- scrolling the results must never introduce horizontal movement
- the close button stays reachable at all times, regardless of scroll position
- the podium scene may shrink or pin above the list so results remain reachable without
  scrolling past a full-height image
- momentum/inertial scrolling behaves natively; no custom scroll hijacking
- when the list is scrollable, it must be visually evident that more content follows
  (partial next row visible, or an affordance) so a result is never silently cut off

---

## 3. Content Hierarchy

Display order, top to bottom:

| # | Element | Content |
|---|---|---|
| 1 | English eyebrow | `THE FINAL CELEBRATION` |
| 2 | Main Thai title | `บทสรุป RUN MILE` |
| 3 | Closing date label | from `campaign.closingDateLabel` |
| 4 | Company total distance | `ระยะทางรวมทั้งบริษัท` · `[companyTotalKm] กม.` |
| 5 | Main podium scene | — |
| 6 | Three team results | rank · Thai team name · final distance in km |
| 7 | Closing message | — |
| 8 | Replay animation control | — |

### Text rendering rule

**All dynamic text and numbers must be rendered as HTML.**

Do **not** bake Thai text, team names, distances, rankings, or dates into image assets.
This keeps text selectable, translatable, accessible to screen readers, crisp at every
display density, and editable without re-exporting artwork.

---

## 4. Team Visual Identity

| Team | Thai name | Primary color | Asset key |
|---|---|---|---|
| Factory | โรงงาน | `#4F9A5B` | `factory` |
| Warehouse | คลังสินค้า | `#E2934A` | `warehouse` |
| Samyan | ออฟฟิศสามย่าน | `#4A90D9` | `samyan` |

### Rank trophy colors

| Rank | Trophy |
|---|---|
| 1 | warm gold |
| 2 | soft silver |
| 3 | warm bronze |

### Each team duo

Each team is represented by a **duo of two teammates**, not a single mascot. The pair
represents colleagues who ran the campaign together.

### Duo composition

- Each team is represented by **one male and one female runner**.
- **Six runners appear on the podium in total: three male and three female.**
- **Both runners in each duo have equal visual importance** — neither is a background figure,
  a sidekick, or noticeably smaller, dimmer, or further back than the other.
- Each duo **symbolically represents the wider team**. It does not imply that only two people
  contributed; it is a stand-in for everyone on that team.

### Duo scale across ranks

- **Rank 1 remains the largest and most visually prominent duo.**
- **Rank 2 and rank 3 must still be large enough** that faces, team colors, gestures, and
  trophies remain clearly recognizable.
- Prominence is expressed through relative scale and placement, never by degrading rank 2 or
  rank 3 into small, dim, or indistinct silhouettes.

### Character requirements

- soft premium 2.5D runner characters, **two per team**
- friendly, celebratory expressions
- the duo **share a single trophy**, held together between them — one trophy per team, not one each
- **no placards** — the requirement for a blank placard or team-symbol prop is removed.
  Free hands are used for natural celebration gestures (open wave, thumbs-up, raised fist)
- team names, ranks and distances remain **HTML labels**; no text is painted onto any prop
- consistent character proportions and rendering style across all teams
- **two poses per team** for lightweight pose-swap animation

### Body language — non-romantic coworker framing

The duo must unambiguously read as **teammates/colleagues**, never as a couple.

Required:
- standing **side by side**, each character self-supporting
- clear visual separation between the two figures
- celebration directed **outward to the viewer**, not toward each other
- shared trophy is the only point of connection between them

Not allowed:
- embracing, hugging, or arms around shoulders or waist
- hand-holding
- leaning on, or into, each other
- face-to-face or gazing-at-each-other poses
- any romantic or couple-coded framing

### Podium foot grounding

Both characters in each duo must sit **physically on the podium surface**:

- feet flat and fully in contact with the podium top — no floating, hovering, or clipping
- a soft contact shadow anchors each character to the podium
- the **feet baseline must be identical between pose A and pose B**, so the pose swap never
  makes a character bob off its platform
- character scale is consistent across all three duos so the three podium steps read as one scene

---

## 5. Journey Scenery

The scene must contain **both journey phases** as a single unified celebratory landscape.

### Left side — Phase 1

```
กรุงเทพฯ → แม่สาย
890 กม.
```

Visual cues may include:
- Bangkok city silhouette
- northern hills
- route trail
- soft clouds

### Right side — Phase 2

```
ฮานอย → ชิมาเนะ
2999 กม.
```

Visual cues may include:
- Hanoi-inspired city / heritage silhouette
- sea or journey transition
- Shimane-inspired Japanese landscape
- subtle torii or regional architectural cue
- route trail
- soft clouds

> ### ⚠️ Critical
> The right side must be **ฮานอย → ชิมาเนะ (Hanoi → Shimane)**, **not** Bangkok → Shimane.
> Phase 2 begins at Hanoi, because the route warps from แม่สาย to ฮานอย between chapters.

### Composition rule

Scenery must **support** the podium, not compete with it. Keep the mid-frame calm so the
podium and characters stay the focal point.

**No location text may be baked into the image** — all place names are HTML.

---

## 6. Graphic Asset Plan

Assets are stored under:

```
public/img/final-celebration/
```

### Delivered assets

All nine approved assets are **delivered and committed**. Dimensions below are the
as-delivered, verified values.

| File | Type | Delivered size | Purpose |
|---|---|---|---|
| `final-scene-desktop.webp` | WebP | 1672 × 941 | Full background scene, desktop (landscape) |
| `final-scene-mobile.webp` | WebP | 941 × 1672 | Full background scene, mobile (portrait) |
| `final-podium.png` | transparent PNG (RGBA) | 1536 × 1024 | Podium layer — rank 2 · 1 · 3, gold/silver/bronze trim |
| `factory-pose-a.png` | transparent PNG (RGBA) | 640 × 960 | โรงงาน **duo**, pose A |
| `factory-pose-b.png` | transparent PNG (RGBA) | 640 × 960 | โรงงาน **duo**, pose B |
| `warehouse-pose-a.png` | transparent PNG (RGBA) | 640 × 960 | คลังสินค้า **duo**, pose A |
| `warehouse-pose-b.png` | transparent PNG (RGBA) | 640 × 960 | คลังสินค้า **duo**, pose B |
| `samyan-pose-a.png` | transparent PNG (RGBA) | 640 × 960 | ออฟฟิศสามย่าน **duo**, pose A |
| `samyan-pose-b.png` | transparent PNG (RGBA) | 640 × 960 | ออฟฟิศสามย่าน **duo**, pose B |

Each `*-pose-*.png` contains **both teammates of that team's duo** on one canvas, already
positioned relative to each other. Pose A is the lower/neutral celebration; pose B raises
the shared trophy.

Verified at delivery: all three pose pairs share an identical 640 × 960 canvas, carry a real
alpha channel, keep transparent padding on every edge, and hold their feet baseline steady
between A and B (drift ≤ 1px), so the pose swap reads as motion rather than a jump.

### Asset immutability

**The nine committed files are the approved visual source assets.**

Not allowed:
- **do not regenerate, redraw, recolor, or destructively crop them**
- **do not alter their canvas dimensions or alpha channels**
- do not re-encode, re-compress, or overwrite them during implementation

Allowed:
- **CSS may position, scale, and crop them non-destructively at render time**
  (`transform`, `object-fit`, `object-position`, `clip-path`, sizing, masking) — the files on
  disk stay byte-identical
- **all text and data remain HTML** — team names, ranks, distances, dates and the company
  total are never painted into these bitmaps

Any future change to the artwork itself is a new approved asset delivery, not an edit of
these files.

### Requirements

- **WebP** for full-scene backgrounds
- **transparent PNG** for podium and character layers
- optimize for web
- avoid unnecessarily large files
- **do not include text in bitmap assets**
- maintain safe transparent padding around character poses
- **pose A and pose B must share the same canvas size and character alignment**, so the
  swap reads as motion rather than a jump

---

## 7. Depth System

The 2.5D effect comes from **layered composition**, not 3D rendering.

| Layer | Contents |
|---|---|
| **1** | soft sky gradient and atmospheric clouds |
| **2** | distant city, mountains, Hanoi/Shimane landscape silhouettes |
| **3** | route trails and secondary scenery |
| **4** | podium |
| **5** | team characters and trophies |
| **6** | HTML labels, distances, title, buttons, and accessibility controls |

### Depth techniques

- subtle parallax only
- soft contact shadows
- gentle rim lighting
- restrained highlight glow
- foreground and background blur separation
- small scale differences between layers

### Technology constraint

> **Do not use WebGL or Three.js for this popup.**
> Use optimized raster assets, HTML, CSS, and vanilla JavaScript only.

---

## 8. Animation Timeline

Staged animation, measured from modal open:

| Time | Stage |
|---|---|
| **0–300ms** | backdrop fades in · dashboard blur appears |
| **150–600ms** | modal fades and scales into view |
| **450–900ms** | scenery layers softly slide/fade into place |
| **650–1200ms** | podium rises into position |
| **1000–1500ms** | team characters enter using **pose A** |
| **1500–2100ms** | swap or transition toward **pose B** · characters raise trophies |
| **1900–2500ms** | team labels and final distances appear |
| **2200–3500ms** | company total counts up to its fixed final value |
| **2800–4200ms** | **one** controlled confetti burst |
| **after 4200ms** | subtle idle only — gentle character bob, tiny low-frequency trophy shine, **no continuous confetti** |

### Replay

Replay:
- resets **only** the modal animation
- must **not** reload the page
- must **not** call APIs
- must **not** read Google Sheets

---

## 9. Modal Behavior

### When the feature is enabled

- automatically open **once per `storageVersion`**
- user can close with the **X** button
- user can close by clicking the **backdrop**
- user can close with **Escape**
- closing returns to the **unchanged** dashboard
- a **trophy/podium button** in the dashboard header reopens it
- **Replay** runs the celebration again
- opening Final Celebration **closes** Top 10 or Search overlays
- opening Top 10 or Search **closes** Final Celebration
- scrolling behind the modal must be **locked** while open
- focus must be placed **inside** the modal
- focus **returns to the trophy button** after closing

> The mutual-exclusion rule above matches the dashboard's existing behavior, where opening
> one full-screen sheet already closes the other. The Final Celebration must join that same
> arrangement so two overlays can never stack.

### When `enabled` is false

- do **not** auto-open
- do **not** show the trophy button
- do **not** create any side effects

---

## 10. Accessibility and Performance

### Accessibility

- support `prefers-reduced-motion`
- reduced-motion mode shows the **completed scene** without staged movement
- keyboard-accessible close and replay controls
- visible focus states
- meaningful `aria-label`s
- sufficient text contrast
- **avoid relying on trophy color alone to communicate rank** — always pair with the rank
  number and text

### Performance

- lazy-load celebration graphics where practical
- animation should prefer `transform` and `opacity`
- avoid layout-thrashing animations
- **no new animation library or external dependency**
- maintain smooth behavior on mobile devices

---

## 11. Data Safety

Final Celebration reads from:

```js
window.RunMileFinalConfig
```

It **must**:

- use **static final values only**
- **never** calculate final rankings from live dashboard state
- **never** fetch final results from Google Sheets
- **never** write to Google Sheets
- **never** modify `server.js`
- **never** modify any API
- remain **disabled until final approval**

The config object is deep-frozen and exposed as a non-writable, non-configurable global, so
the celebration cannot mutate its own record at runtime.

The following values are `null` in the config today and must be **typed in by hand** after
the campaign closes — never derived, polled, or scraped:

- `campaign.closingDateLabel`
- `campaign.companyTotalKm`
- `teams[].rank` (×3)
- `teams[].distanceKm` (×3)

---

## 12. Acceptance Criteria

### Visual

- [ ] Visually consistent with the existing Run Mile dashboard (70/30 balance respected)
- [ ] Theme reads as "Soft Sky Celebration" — not dusk, not arcade
- [ ] None of the §1 "Avoid" items are present
- [ ] Layered 2.5D depth is visible without WebGL/Three.js
- [ ] Scenery supports rather than competes with the podium

### Journey phases

- [ ] Left side shows Phase 1: กรุงเทพฯ → แม่สาย (890 กม.)
- [ ] Right side shows Phase 2: **ฮานอย → ชิมาเนะ** (2999 กม.)
- [ ] Right side is **not** Bangkok → Shimane
- [ ] No location text baked into any bitmap asset

### Duo composition and scale

- [ ] Each team is represented by **one male and one female runner**
- [ ] **Six runners total on the podium — three male, three female**
- [ ] Both runners in each duo have **equal visual importance** (neither is a sidekick,
      smaller, dimmer, or pushed to the back)
- [ ] The duo reads as **symbolic of the wider team**, not as "only two people contributed"
- [ ] **Rank 1 is the largest and most visually prominent duo**
- [ ] **Rank 2 and rank 3 remain large enough** for faces, team colors, gestures and trophies
      to stay clearly recognizable
- [ ] Prominence comes from scale/placement — rank 2 and 3 are never reduced to small, dim or
      indistinct silhouettes

### Team duos, trophy and grounding

- [ ] Each team is shown as a **duo of two teammates**, not a single mascot
- [ ] Each duo shares **one trophy** held between them — not one trophy each
- [ ] **No placards** or blank signboards anywhere in the scene
- [ ] Body language reads as **colleagues, never a couple** — side by side, no embracing,
      no hand-holding, no leaning, celebration aimed at the viewer
- [ ] Both characters' feet are **flat on the podium** — no floating, hovering or clipping
- [ ] Contact shadows anchor each character to the podium surface
- [ ] Feet baseline is identical between pose A and pose B (no bob off the platform)
- [ ] Character scale is consistent across all three duos
- [ ] Team names/ranks/distances are HTML labels — no text painted on any character or prop

### Desktop behavior

- [ ] Modal centered, max width ≈1180px, fits within viewport height
- [ ] Podium order is rank 2 · rank 1 · rank 3
- [ ] Dashboard behind is dimmed and lightly blurred
- [ ] Close button top-right; replay control present

### Mobile behavior

- [ ] No horizontal scrolling at any supported width
- [ ] Modal uses nearly full screen width; content scrolls vertically inside
- [ ] **Stage 1:** podium overview shown first, in **2 · 1 · 3** order
- [ ] **Stage 1:** podium overview uses **pose B** for all three teams
- [ ] **Stage 2:** enlarged result cards follow, vertically in rank order **1, 2, 3**
- [ ] **Stage 2:** each result card uses the corresponding **pose A** teammate-pair image
- [ ] Each card shows rank + **HTML** team name + **HTML** final distance
- [ ] The whole experience is **not** compressed into a single viewport
- [ ] Character size stays readable while scrolling (scroll more rather than shrink)
- [ ] Results listed vertically in rank order 1, 2, 3
- [ ] Results list is **vertically scrollable**, with no horizontal movement introduced
- [ ] Close button reachable at any scroll position
- [ ] No result row is silently cut off — further content is visually evident
- [ ] Native momentum scrolling; no scroll hijacking
- [ ] Rank 1 has the strongest emphasis
- [ ] All buttons ≥44px touch target
- [ ] Text readable without zooming

### Modal open / close / reopen

- [ ] Auto-opens once per `storageVersion`
- [ ] Closes via X, backdrop click, and Escape
- [ ] Trophy button reopens it
- [ ] Opening Final Celebration closes Top 10 / Search
- [ ] Opening Top 10 / Search closes Final Celebration
- [ ] Background scroll locked while open
- [ ] Dashboard is unchanged after closing

### Animation replay

- [ ] Replay restarts the staged animation
- [ ] Replay does not reload the page
- [ ] Replay makes no API calls and reads no Google Sheets
- [ ] Only one confetti burst; no continuous confetti
- [ ] Idle state after 4200ms is subtle only

### Reduced motion

- [ ] `prefers-reduced-motion` shows the completed scene with no staged movement
- [ ] No count-up, parallax, or confetti under reduced motion

### Keyboard and focus

- [ ] Focus moves into the modal on open
- [ ] Close and replay reachable and operable by keyboard
- [ ] Visible focus states throughout
- [ ] Focus returns to the trophy button on close
- [ ] Meaningful `aria-label`s present
- [ ] Rank is communicated by text/number, not trophy color alone

### Asset integrity

- [ ] The nine committed files are used **as-is** as the approved visual source assets
- [ ] No asset was regenerated, redrawn, recolored, or destructively cropped
- [ ] No canvas dimension or alpha channel was altered
- [ ] Any positioning, scaling or cropping is done **non-destructively in CSS** at render time
- [ ] All text and data remain HTML — nothing baked into the bitmaps

### Data safety

- [ ] No Google Sheets read or write
- [ ] No `/api/*` request from the celebration code
- [ ] No dependency on live dashboard state or ranking logic
- [ ] All displayed results come from `window.RunMileFinalConfig`
- [ ] `server.js` and all APIs unmodified

### Regression and release safety

- [ ] No dashboard regression — map, Top 10, Search, music, and visit counter all behave as before
- [ ] No new dependency or animation library added
- [ ] Feature **disabled by default** (`enabled: false`)
- [ ] With `enabled: false`: no auto-open, no trophy button, no side effects
- [ ] **No Production deployment** performed as part of this work
