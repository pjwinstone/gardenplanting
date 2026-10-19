# Garden Planting — GUI design guidelines

*Planned home: `docs/design-guidelines.md`. Words come from `glossary.yaml`; if a word is not there, add it there first.*

## 1. Principles
- **One action per place.** Every action has exactly one control. Don't repeat a state that is already
  visible somewhere else: no chips that copy icons, no Back button next to a roller.
- **Show state, don't explain it.** An icon and a colour on the item, and the reason in one short line.
- **Plain words, no codes.** "Camera position Left", not "STN01"; "tape measurement", not "tape reading".
- **Outdoors first.** Used in sun, one-handed, often wearing gloves.

## 2. Liquid Glass materials
| Layer | Fill | Blur | Border / highlight | Radius |
|---|---|---|---|---|
| Sheet / dialog | white 28% | 24 px, saturate 1.8 | 1 px white 55%, inset top 1 px white 70% | 26 |
| Capsule (the selected row) | white 55% | inherits | 1 px white 90% | 22 (44 pt tall) |
| Button, secondary | white 50% | none (it sits on glass) | 1 px white 80% | height/2 |
| Button, primary | solid accent #1f6feb | none | none | height/2 |
Use at most **two** layers of `backdrop-filter` on screen at once (it is expensive in WKWebView). Never put glass on top of glass.
Shadow: `0 20px 50px rgb(0 0 0 / .35)`, on sheets only.

**Spacing scale (pt):** 4 · 8 · 12 · 16 · 24 · 32. Sheets have 8 pt of inner padding and sit 8 pt from the
screen edges and above the safe area.

**Compactness rule.** Overlays cover the plan, so keep them as small as possible.
- Panels stacked inside one sheet (header, roller, button row) abut each other, with a **gap of 4 pt or
  less**. Never put a blank band between panels; the roller's fade is the only separator.
- Make every row exactly the touch target (**44 pt**) with no extra padding around it. Fold supporting text
  into the space beside a control, such as the reason line next to the button, rather than giving it its own row.
- Keep the header to two lines at most (title and position, then counts), with line-height 1.2.
- Show 5 rows on a roller (the current row ±2), not 7.
- Shrink the overlay before you shrink any target. Target height: about 330 pt for header + roller + buttons.
**Type scale (system font, SF Pro):**
| Use | Size / weight |
|---|---|
| Sheet title | 16 semibold |
| Row / body | 15 regular; the current row is 15 semibold |
| Buttons | 15 semibold |
| Secondary / counts | 13–14 regular |
| Reason line, captions | 12 regular |
Numbers use `font-variant-numeric: tabular-nums`. Lengths are given in metres to 3 decimals, and tolerances in mm.

## 3. Colour semantics (these match the glossary)
| Colour | Meaning | Use |
|---|---|---|
| **Green** #2e7d32 | Checked and agreeing (\|w\| ≤ 1.96, r ≥ 0.3). You can move on. | ticks, green measurement strength |
| **Amber** #d18b00 | Weak check or moderately off. Don't ignore it; it can be an accepted amber. | warnings, ticked by hand with a reason, skipped with a note |
| **Red** #c62828 | Strong disagreement (\|w\| > 3.29), or the step's evidence failed. Stop and fix it. | errors, the Retake pill |
| **Grey** #6b7c74 | Unchecked (r < 0.01). Never treat it as green. | unchecked measurements, waiting |
| **Blue** #1f6feb | The app's own action, or the primary button. It never means a quality level. | primary button, "ticked by the app" |
Colour is never the only signal: always pair it with an icon shape and a word.

## 4. Patterns
**Roller (checklist / step picker).** It works like an iOS date-picker wheel. The current item is centred
in a glass capsule; rows above and below tilt (`rotateX`), shrink and fade.
- Scrolling moves the current item. That *is* Back, so there is no Back button.
- Each row shows its number, a state icon and the title.
- **Action labels start with a verb** (Take photo 2 of 2, Mark photo 2 of 2, Retake, Retry upload, Save baseline).
  A bare count such as "Photo 2 of 2" reads as finished. Status text on a disabled pill (Uploading…, ✓ Photos in) is a state, not an action.
- Only the current row carries actions: one contextual pill (Retake, Take photos, Save) and a small **?** that
  opens Details.
- The header counts (`7 of 12 ticked · 2 warnings · 1 error · 3 open`) are the jump control: tap a count to
  scroll to the next item of that kind.
- Build it with CSS scroll-snap, transforms set from `requestAnimationFrame`, and a mask to fade the ends.

**Button row.** **One** compact row, 44 pt high, at most two buttons, with the primary button on the right.
- The left side may hold the reason line (information, not a button).
- Less common actions (Skip with a note, Tick by hand, Untick, Pause) go in the Details sheet or a
  "⋯" overflow, never in a second row.
- Next never skips silently: while an item isn't settled, the button reads **Later**. Done shows how many
  are open and goes to the first open one.

**Configuration lives in Step 0 and the cog, never on a separate screen.** A run's assumptions (lengths,
camera position distances, and tolerances from `tolerances.json`) are Step 0 **Set-up** at the top of the
roller.
- A small cog in the header scrolls the roller there.
- They are edited in a compact form that replaces the button row; long lists open in Details.
- Every change is written to the run log with its old and new values.
- Changing a value marks the steps that depend on it as **Needs a re-check** (amber ↻). The app re-checks
  its own evidence; you tick again for your own steps.
- Don't add a Settings screen or a modal settings page.

**Details sheet.** Opened with **?**. It holds the full title, the instructions, the diagram, the note or
reason field, and the less common actions as text buttons. Close it with the grabber or by tapping outside.

**Photo tap screen.** After a guided photo, the photo fills the screen and pinch-zooms. One 44 pt bar at the
bottom names the next point to tap ("Tap the top edge of the sleeve (1 of 2)") with at most two buttons
(Not in view, Save). Close and Undo are 44 pt round buttons in the top corner. The labels come from the step,
never a shared A / B / Target default. No header block, no extra rows over the photo.

**Rough tap, the app refines.** The user never has to hit an exact edge with a finger. On the calibration
photo they tap once anywhere on the sleeve ("Tap once on the sleeve. The app finds its top and bottom
edge."). The bar says "Finding the sleeve edges…" while the full-size photo is read, then two short green
lines mark the paper ends with a dashed axis between them: "Sleeve found. Check the two lines sit on the
paper ends, then Save. Undo to tap again." Only when the app is unsure does the bar say why and ask for the
top edge, then the bottom edge, by hand. New target types follow the same pattern.

**Log (observation log / error log).** Entries are listed in the order they happened. **Tap an entry to mark
it seen**, and tap again to mark it unseen. Seen entries are dimmed. There is no "Mark all seen" or "Clear"
button. An unseen *error* keeps the menu badge red; info entries never do. Enter or Space toggles the
focused row. (This is the behaviour in `errorLog.ts` since PR #39.)

## 5. Touch and input
- The minimum touch target is **44 × 44 pt**. A visual element can be smaller, such as a 30 pt **?**, as
  long as its hit area is padded to 44.
- Keep at least 8 pt between targets. Put primary actions in the bottom third, within thumb reach.
- Use haptics: a selection tick on each step the roller clicks past, and a success notification when the app
  ticks something.

## 6. Modes
- **Sunlight** (the in-app toggle) and `prefers-contrast: more` / `prefers-reduced-transparency`: opaque white
  sheets, black ink, no blur, borders 2 px, state colours at full strength, and text at least 15 pt.
- **Reduced motion** (`prefers-reduced-motion`): no 3D tilt and no animated tick. Snap scrolling stays.
- **Dark**: glass changes to black 35%, the ink inverts, and the state colours stay the same hue.

## 7. Icons
SF Symbols-like line icons, 2 pt stroke, with a 26 pt circular badge for states:

| Meaning | Icon |
|---|---|
| open | `circle` |
| waiting | `hourglass` |
| ticked | `checkmark` |
| ticked by the app | `checkmark` + small `iphone` badge |
| warning | `exclamationmark` |
| skipped | `arrow.uturn.forward` |
| error | `xmark` |
| needs a re-check | `arrow.clockwise` (amber ring) |
| Set-up | `gearshape` |
| details | `questionmark` |
| camera position | `camera` |
| tape measurement | `ruler` |
| baseline | `line.diagonal` |
| save | `icloud.and.arrow.up` |
Don't use emoji in the shipped UI.

## 8. Wording
- Use glossary terms: camera position, tape measurement, photo click, baseline point, closure, measurement
  strength, accepted amber, unavailable / deleted point.
- Never use codes or legacy names on screen (STN01, CAL, CHK-BASE, station, cross-tie, repeat tape). Point
  *names* such as BAS01 are fine.
- Buttons are verbs, kept short: Tick, Next, Later, Done, Retake, Save. Reasons are one plain sentence that
  says what to do: "Photo not usable for focal length. Retake at 1×."
- Counts are real counts, worked out from state ("7 of 12 ticked"). Never show a position next to "ticked".