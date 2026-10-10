# Print the marker sleeves

Print these the day before the circle test. One A4 page is one sleeve. The code is Bank 1 from [MARKER_VISION_DESIGN.md](MARKER_VISION_DESIGN.md): sync `11110`, one of the 61 issued words, stop `01`. Black is 1, white is 0. The word is printed with its high bit directly under the sync. Bank 2 (five black bars of sync) is not printed.

The sheets are [docs/markers/](markers/). [all-sleeves.pdf](markers/all-sleeves.pdf) is the same eight pages in one file. Rebuild with `npm run build:marker-sleeves`.

## Which sleeve goes on which stick

The design note does not assign these garden names. This test uses eight issued words spread through the list. Neighbours are at least distance 6 apart, and no pair differs only inside four adjacent bands. The first eight words (222 through 2B4) are not used: they share a top nibble, and a leaf across the bottom four bands could swap 222 with 22D, or 244 with 24B.

| Point | Code | File | What it is |
|---|---|---|---|
| BAS01 | 315 | [BAS01.pdf](markers/BAS01.pdf) | Far baseline end |
| BAS02 | 36E | [BAS02.pdf](markers/BAS02.pdf) | Near baseline end, about 0.30 m past CRC01 |
| CRC01 | 459 | [CRC01.pdf](markers/CRC01.pdf) | Circle stick nearest the baseline |
| CRC02 | 6BA | [CRC02.pdf](markers/CRC02.pdf) | Next circle stick |
| CRC03 | 8A3 | [CRC03.pdf](markers/CRC03.pdf) | Next circle stick |
| CRC04 | 952 | [CRC04.pdf](markers/CRC04.pdf) | Opposite CRC01 |
| CRC05 | DAC | [CRC05.pdf](markers/CRC05.pdf) | Next circle stick |
| CRC06 | EC5 | [CRC06.pdf](markers/CRC06.pdf) | Last circle stick, closing back to CRC01 |
| STN01 | — | — | Where you stand. No sleeve |
| STN02 | — | — | Where you stand. No sleeve |
| STN03 | — | — | Where you stand. No sleeve |

Write the code on the dowel in pencil as well, next to the top of the sleeve, so a soaked label is not the only copy.

**Calibration.** The circle sheet’s calibration is a photo of one plumbed cane, tape from the front of the phone to the paper, about 4 m. Reuse CRC01, or a spare cane. A spare does not get a ninth code in this set. This test does not use a checkerboard. The checkerboard of known square size is the later shared-focal-length prior in the marker note (§6.3), after this trial. Do not print one for this visit.

## Print settings

- A4 portrait, **210 × 297 mm**.
- **Actual size / 100%.** No “fit to page”, no shrink to printable area, no scaling.
- **No borderless.** Borderless often scales the page. The 5 mm top and bottom trims are part of the template. A side margin that clips the blank tab is acceptable; one that clips the bands is not. If the dashes or band ink are clipped by your printer, cut at the edge of the ink.
- Highest quality. Black only. Colour management off if the driver has a switch for it.
- One sheet per page. Do not print two-up.

Before you cut, check the **100 mm** bar with a steel ruler. It must be 100 mm within **±0.5 mm**. The **50 mm** bar on the blank tab is the other axis. The sheet also carries the design’s own rulers: **250 mm** down the tab, and **180 mm** along the bottom legend. Letter paper with fit-to-page lands near 94% and turns those into about 235 mm and 169 mm. A miss means the driver scaled the page. Reprint. Do not use that sheet.

The four black bars at the **TOP** are the sync. Together they are **52 mm**.

## Paper, laminate, weather

Matte. A gloss stripe down the sleeve blinds the reader.

The marker note’s stock is laser or pigment ink on **matte polypropylene or polyester**. Plain copy paper cockles when it is damp, and dye ink runs.

If you print on paper: matte, **120–160 gsm**, laser or pigment, not dye.

Preferred weatherproofing is **matte film over laser toner**. A matte pouch or a clear matte tape is the same idea, and only if it does not add glare. Gloss film and glossy toner cause specular highlights. After any film, measure the 100 mm bar again. If the film stretched the sheet, reprint. Then measure R on the finished sleeve. The outside after the film is the R that counts. Film adds thickness, so the design’s 30.2 mm is not the number you write down.

Outdoors: keep the sheets dry until the glue has set. Do not leave dye ink in the rain.

## Widths

Each sleeve is **one A4 sheet**. Nothing is split across pages, so there is only one join.

| Part | Width | Where it sits |
|---|---|---|
| Cutting tolerance | **0.75 mm** | The same bands, from about 4.50 mm to 5.25 mm. Extra bleed on the visible edge. Not part of the 189.8 mm. |
| Coded bands, to the fold | **189.8 mm** | x = 5.25 mm to 195.0 mm. This is 2π × 30.2 mm, the expected outer circumference. |
| Underlap bleed | **3.0 mm** | x = 195.0 mm to 198.0 mm. The same bands, continued. |
| Blank tab | **12.0 mm** | x = 198.0 mm to the sheet edge at 210 mm. No band ink. |
| Coded + tab | **204.8 mm** | Wider than a typical printable width. |
| Page | **210 mm** | A4 portrait. |

A home printer’s printable width on A4 is about **200–202 mm**, with **4–5 mm** margins. 204.8 mm does not fit in that. The tab is on the **right**, where a clipped edge eats blank paper and not the code. The dash is centred at **4.26 mm**, just left of the band ink, so its stroke does not sit in the bands. The legend reads **cut just inside this line**. The bands themselves start at about **4.50 mm** (0.75 mm left of the coded edge at **5.25 mm**). Cut just inside the dash, between it and the start of the bands (about 4.4–5.0 mm), so the band ink runs right to the cut edge. A cut down the dash leaves a sliver of dash and white paper at the seam. A 5 mm left margin can clip that dash and a sliver of the cutting tolerance. It does not eat the coded edge. The right dashed cut is 0.4 mm inside the sheet edge (x = 209.6 mm). A 4–5 mm right margin will not put toner on that line, or on the outer few millimetres of the tab. The paper is still there. If the dashes or band ink are clipped by your printer, cut at the edge of the ink. The fold line at **195 mm** is only a mark in the legends. Do not crease it.

Expected outside size is unchanged: **D ≈ 60.4 mm**, **R ≈ 30.2 mm** for a 0.2 mm sheet. The coded width to the fold is that outer circumference, not a new radius. One turn of the paper, through the middle of a 0.2 mm sheet, is about `2π(R − t/2) ≈ 189.1 mm`. The printed outer length is 189.8 mm, so the overlap is about 0.6 mm longer than that turn. Harmless. Each extra 0.1 mm of thickness adds about **0.3 mm** to one turn of the paper.

## Cut and join

The page is 210 × 297 mm. Finished height is still **H = 287 mm**. Laminate or film the flat sheet first, if you use film. Then cut. A film put on after the cut changes the size you just cut to.

Bands stay **horizontal**. They become rings. The **TOP** arrow points to the top of the stick. The four black sync bars are at that end. **BOTTOM** is the black stop. Dowel **60 mm**. A 63 mm pipe is larger than this code: its outside would be about 199 mm around, and the 3 mm bleed cannot cover that gap.

1. Laminate or film first, if you use it. Then cut both edges. Cut just inside the dash, between it and the start of the bands (about 4.4–5.0 mm), so the band ink runs right to the cut edge. Do not cut down the dash: its ink ends near 4.35 mm and the bands start near 4.50 mm, so the line itself leaves a white sliver. If you leave the margin on, a white stripe about 5 mm wide hides the bleed. If the dashes or band ink are clipped by your printer, cut at the edge of the ink. Cut the **right** edge on its dashed line (x = 209.6 mm). If those dashes did not print, cut the right-hand edge of the sheet. That edge is the outer edge of the **15 mm** tab. Cut **5 mm** off the top and the bottom, on the horizontal lines.
2. Measure R after the sheet is on the dowel (step 4), not on the flat sheet. The outside after the film is the R that counts. The method is in the next section.
3. Fasten the blank tab to the dowel before you wrap. A stapler cannot close once the sheet is around the stick, and the tab will be hidden under the bands. On a wooden dowel, use a staple-gun or a drawing-pin. On a tube, use glue or thin double-sided tape. Use flush staples or flush pins: no raised heads under the overlap, or the ridge splits the silhouette. Staples go in the blank part only, at least **4 mm** from the fold (past the 3 mm bleed). Never through the bands. The words on the tab read **staple/glue here — overlap under the other edge**.
4. Wrap snug, printed face outward. Do **not** crease the fold line. A crease under the overlap makes a ridge, and a ridge splits the silhouette. Stick the cut left edge down over the tab with glue or thin double-sided tape, so the bands meet the bleed. No staples through the bands. The left edge is the visible seam. Up to 3 mm of oversize then shows band ink, not white. A **1°** spiral misaligns the bands by about **3.3 mm**. Use the crosses on the **195 mm** fold to keep the wrap square.
5. Turn that seam **away from the stations and away from the camera**.

Do not crease the fold. The fold mark in the legends is only there to show where the coded width ends. Two crosses sit on that fold, at **195 mm**, one in the top legend and one in the bottom. Use those fold crosses to keep the wrap square: the TOP arrow and the two crosses should stay in line along the dowel. Two smaller crosses sit on the right-hand cut, at **209.6 mm**, in the same margin as those dashes, so they may not print. The name and the code are in the legends, outside the black-and-white code.

Once the left edge has been cut just inside the dash, a white gap opens at the seam only if the finished outside circumference is longer than about **192.8 mm** (the 189.8 mm fold plus the 3.0 mm bleed). That is an outside diameter of about **61.4 mm** (192.8 / π), a dowel of about **61.0 mm** with 0.2 mm stock. The design size, D = 60.4 mm and R = 30.2 mm, sits inside that limit. The step at the tab moves the centreline by only **0.1–0.2 mm**. A loose sleeve is not a bearing: the silhouette would follow the paper, not the dowel.

The circle stations stand on both sides of the baseline. The seam still cannot face away from all of them at once. Keep it off the middle of the calibration photo.

Expected outside size for a **0.2 mm** sheet, before you measure: **D ≈ 60.4 mm**, **R ≈ 30.2 mm**. Stock, glue, and film move it. The laser offset is the **measured** R, added after the tape has been made level. It is not 30.2 mm unless that is what you measured.

## Measure R, height, and plumb

Do this after the sheet is stuck down. Laminate before you cut, if you laminate. The outside after the film is the R that counts.

**Radius.** At three heights — about 40 mm below the top, the middle, and about 40 mm above the bottom — wrap a **paper strip** or a **cloth tape** around the sleeve and pull it snug. Do not use a steel tape: it stands off the curve and reads long. The length is the outside circumference C. After lamination, this outside R is the one that counts. The step at the tab moves the centreline by only **0.1–0.2 mm**.

`R = C / (2π)`

Use `2π ≈ 6.2832`, so a circumference of 190.2 mm is R = 30.3 mm. Round each sleeve’s R to **0.1 mm**. If the three heights disagree by more than a few tenths of a millimetre, the wrap is not even: reseat it and measure again. Write the mean on that cane’s **Sleeve R mm** cell on [FIELD_CHECKLIST_CIRCLE.md](FIELD_CHECKLIST_CIRCLE.md). One R per sleeve. Do not copy 30 mm onto every row.

**Height.** For this circle test the target is **0.5 m** from the ground to the **middle of the paper**. That is the circle sheet’s figure. Aim for it, then write the height you actually measure on the cane row. Do not copy 0.5 m in place of the tape.

**Plumb.** Bubble in two directions. Middle of the bubble, about **1°**. A 2° lean at 0.5 m moves the ground point about 17 mm, and a photo cannot see a lean toward the camera. Tick plumb only when the bubble passed.

The app’s offset boxes stay at **0**. R is applied later, on the tape, after the tape is level.
