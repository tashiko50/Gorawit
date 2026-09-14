# Run Mile — Final Celebration · Visual Implementation Specification

> **Status:** Approved specification. Source of truth for visual and implementation work.
> **Scope of this document:** specification only. No modal, no graphics, and no dashboard
> wiring exist yet.
>
> **Related files**
> - `public/final-results-data.js` — the static, deep-frozen config (`window.RunMileFinalConfig`), already committed and **disabled** (`enabled: false`).
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

### Each team character

- soft premium 2.5D runner mascot
- friendly, celebratory expression
- **right hand** holds a trophy
- **left hand** holds a simple blank placard or team-symbol prop
- the team name must remain **HTML**, not painted into the placard image
- consistent character proportions and rendering style across all teams
- **two poses per team** for lightweight pose-swap animation

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

Assets will later be stored under:

```
public/img/final-celebration/
```

### Planned assets

| File | Type | Purpose |
|---|---|---|
| `final-scene-desktop.webp` | WebP | Full background scene, desktop |
| `final-scene-mobile.webp` | WebP | Full background scene, mobile |
| `final-podium.png` | transparent PNG | Podium layer |
| `factory-pose-a.png` | transparent PNG | โรงงาน character, pose A |
| `factory-pose-b.png` | transparent PNG | โรงงาน character, pose B |
| `warehouse-pose-a.png` | transparent PNG | คลังสินค้า character, pose A |
| `warehouse-pose-b.png` | transparent PNG | คลังสินค้า character, pose B |
| `samyan-pose-a.png` | transparent PNG | ออฟฟิศสามย่าน character, pose A |
| `samyan-pose-b.png` | transparent PNG | ออฟฟิศสามย่าน character, pose B |

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

### Desktop behavior

- [ ] Modal centered, max width ≈1180px, fits within viewport height
- [ ] Podium order is rank 2 · rank 1 · rank 3
- [ ] Dashboard behind is dimmed and lightly blurred
- [ ] Close button top-right; replay control present

### Mobile behavior

- [ ] No horizontal scrolling at any supported width
- [ ] Modal uses nearly full screen width; content scrolls vertically inside
- [ ] Results listed vertically in rank order 1, 2, 3
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
