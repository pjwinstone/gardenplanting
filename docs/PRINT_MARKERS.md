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
- **No borderless.** Borderless often scales the page. The 5 mm margin is part of the template.
- Highest quality. Black only. Colour management off if the driver has a switch for it.
- One sheet per page. Do not print two-up.

Before you cut, check the **100 mm** bar with a steel ruler. It must be 100 mm within **±0.5 mm**. The **50 mm** bar on the glue flap is the other axis. The sheet also carries the design’s own rulers: **250 mm** down the glue flap, and **180 mm** along the bottom legend. Letter paper with fit-to-page lands near 94% and turns those into about 235 mm and 169 mm. A miss means the driver scaled the page. Reprint. Do not use that sheet.

The four black bars at the **TOP** are the sync. Together they are **52 mm**.

## Paper, laminate, weather

Matte. A gloss stripe down the sleeve blinds the reader.

The marker note’s stock is laser or pigment ink on **matte polypropylene or polyester**. Plain copy paper cockles when it is damp, and dye ink runs.

If you print on paper: matte, **120–160 gsm**, laser or pigment, not dye.

Preferred weatherproofing is **matte film over laser toner**. A matte pouch or a clear matte tape is the same idea, and only if it does not add glare. Gloss film and glossy toner cause specular highlights. After any film, measure the 100 mm bar again. If the film stretched the sheet, reprint. Then measure R on the finished sleeve. The outside after the film is the R that counts. Film adds thickness, so the design’s 30.2 mm is not the number you write down.

Outdoors: keep the sheets dry until the glue has set. Do not leave dye ink in the rain.

## Cut

The page is 210 × 297 mm. The finished sleeve is **205 × 287 mm**.

- Cut the **right** edge on the line marked **TRIM 205 mm**. That removes 5 mm.
- Cut **5 mm** off the top and **5 mm** off the bottom, on the horizontal lines. Finished height **H = 287 mm**.
- Do **not** cut the left edge. The left **16.5 mm** is the glue flap. The outer 5 mm of that flap is the unprinted border. It hides under the glue. About 11 mm of the flap is printed.

The alignment crosses sit on the flap’s inner edge and on the cut edge. They are the seam marks. The name and the code are in the legends and in the flap, outside the black-and-white code.

## Wrap

Dowel **60 mm**. Not a 63 mm pipe: after the trim only about 7 mm would be left to glue, and that does not snug.

Bands stay **horizontal**. They become rings. The **TOP** arrow points to the top of the stick. The four black sync bars are at that end. **BOTTOM** is the black stop.

1. Printed face outward.
2. Lay the glue flap on the dowel first. The words **GLUE UNDER** go against the overlap, then under it.
3. Roll the sheet tight. Put **both** seam alignment crosses on the cut edge — the top one and the bottom one — onto the matching crosses at the inner edge of the flap. A **1°** spiral misaligns the bands by about **3.3 mm**, so keep the TOP arrow square to the dowel. The overlap on a 60 mm dowel is **205 − π × 60 ≈ 16.5 mm** (circumference 188.5 mm). A white gap opens at the seam if the outside circumference goes over about **192.8 mm**, which is a dowel over about **61.2 mm** once film is on it. The bands do not cover that extra paper.
4. Glue the flap to the wood, and glue or tape the overlap down. A loose sleeve is not a bearing: the silhouette would follow the paper, not the dowel.
5. Press the seam flat. It is a vertical join, not a ridge. A ridge splits the silhouette.

The design does not give the seam a compass bearing. The circle stations stand on both sides of the baseline, so the seam cannot face away from all of them. Press it flat. When you can, keep that ridge off the middle of the calibration photo.

Expected outside size for a **0.2 mm** sheet, before you measure: **D ≈ 60.4 mm**, **R ≈ 30.2 mm**. Stock, glue, and film move it. The laser offset is the **measured** R, added after the tape has been made level. It is not 30.2 mm unless that is what you measured.

## Measure R, height, and plumb

Do this after the glue is dry, and after any matte film.

**Radius.** At three heights — about 40 mm below the top, the middle, and about 40 mm above the bottom — wrap a **paper strip** or a **cloth tape** around the sleeve and pull it snug. Do not use a steel tape: it stands off the curve and reads long. The length is the outside circumference C. After lamination, this outside R is the one that counts. The step at the glue flap moves the centreline by only **0.1–0.2 mm**.

`R = C / (2π)`

Use `2π ≈ 6.2832`, so a circumference of 190.2 mm is R = 30.3 mm. Round each sleeve’s R to **0.1 mm**. If the three heights disagree by more than a few tenths of a millimetre, the wrap is not even: reseat it and measure again. Write the mean on that cane’s **Sleeve R mm** cell on [FIELD_CHECKLIST_CIRCLE.md](FIELD_CHECKLIST_CIRCLE.md). One R per sleeve. Do not copy 30 mm onto every row.

**Height.** For this circle test the target is **0.5 m** from the ground to the **middle of the paper**. That is the circle sheet’s figure. Aim for it, then write the height you actually measure on the cane row. Do not copy 0.5 m in place of the tape.

**Plumb.** Bubble in two directions. Middle of the bubble, about **1°**. A 2° lean at 0.5 m moves the ground point about 17 mm, and a photo cannot see a lean toward the camera. Tick plumb only when the bubble passed.

The app’s offset boxes stay at **0**. R is applied later, on the tape, after the tape is level.
