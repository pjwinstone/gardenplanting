# Print the marker sleeves

Print these the day before the circle test. One A4 page is one sleeve. The code is Bank 1 from [MARKER_VISION_DESIGN.md](MARKER_VISION_DESIGN.md): sync `11110`, one of the 61 issued words, stop `01`. Black is 1, white is 0. The word is printed with its high bit directly under the sync. Bank 2 (five black bars of sync) is not printed.

The sheets are [docs/markers/](markers/). [all-sleeves.pdf](markers/all-sleeves.pdf) is the same eight pages in one file. Rebuild with `npm run build:marker-sleeves`.

## Which sleeve goes on which stick

The design note does not assign these garden names. This test uses the first eight issued words, in numeric order.

| Point | Code | File | What it is |
|---|---|---|---|
| BAS01 | 222 | [BAS01.pdf](markers/BAS01.pdf) | Far baseline end |
| BAS02 | 22D | [BAS02.pdf](markers/BAS02.pdf) | Near baseline end, about 0.30 m past CRC01 |
| CRC01 | 244 | [CRC01.pdf](markers/CRC01.pdf) | Circle stick nearest the baseline |
| CRC02 | 24B | [CRC02.pdf](markers/CRC02.pdf) | Next circle stick |
| CRC03 | 271 | [CRC03.pdf](markers/CRC03.pdf) | Next circle stick |
| CRC04 | 28E | [CRC04.pdf](markers/CRC04.pdf) | Opposite CRC01 |
| CRC05 | 293 | [CRC05.pdf](markers/CRC05.pdf) | Next circle stick |
| CRC06 | 2B4 | [CRC06.pdf](markers/CRC06.pdf) | Last circle stick, closing back to CRC01 |
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

Laminate only for the weather, and only with a **matte** pouch or a clear **matte** tape, and only if it does not add glare. Gloss laminate causes specular highlights. After any film, measure the 100 mm bar again. If the film stretched the sheet, reprint. Then measure R on the finished sleeve. Film adds thickness, so the design’s 30.2 mm is not the number you write down.

Outdoors: keep the sheets dry until the glue has set. Matte synthetic stock, or matte paper plus a matte film, is the weatherproofing. Do not leave dye ink in the rain.

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
3. Roll the sheet tight. The cut edge lands on the seam cross. The overlap is whatever is left of the 205 mm sheet: **205 − π × 60 ≈ 16.5 mm** (the dowel’s circumference is 188.5 mm).
4. Glue the flap to the wood, and glue or tape the overlap down. A loose sleeve is not a bearing: the silhouette would follow the paper, not the dowel.
5. Press the seam flat. It is a vertical join, not a ridge. A ridge splits the silhouette.

The design does not give the seam a compass bearing. The circle stations stand on both sides of the baseline, so the seam cannot face away from all of them. Press it flat. When you can, keep that ridge off the middle of the calibration photo.

Expected outside size for a **0.2 mm** sheet, before you measure: **D ≈ 60.4 mm**, **R ≈ 30.2 mm**. Stock, glue, and film move it. The laser offset is the **measured** R, added after the tape has been made level. It is not 30.2 mm unless that is what you measured.

## Measure R, height, and plumb

Do this after the glue is dry, and after any matte film.

**Radius.** At three heights — about 40 mm below the top, the middle, and about 40 mm above the bottom — wrap a paper strip or a tape around the sleeve and read the circumference C. That is the outside.

`R = C / (2π)`

Use `2π ≈ 6.2832`, so a circumference of 190.2 mm is R = 30.3 mm. Round each sleeve’s R to **0.1 mm**. If the three heights disagree by more than a few tenths of a millimetre, the wrap is not even: reseat it and measure again. Write the mean on that cane’s **Sleeve R mm** cell on [FIELD_CHECKLIST_CIRCLE.md](FIELD_CHECKLIST_CIRCLE.md). One R per sleeve. Do not copy 30 mm onto every row.

**Height.** Measure from the ground to the **middle of the paper**. Write it on the cane row. The circle sheet’s target is **0.5 m**. The marker note’s worked example ties that middle at **0.45 m**. Those two notes do not agree. Write the height you actually measure. Do not substitute either figure for the tape.

**Plumb.** Bubble in two directions. Middle of the bubble, about **1°**. A 2° lean at 0.5 m moves the ground point about 17 mm, and a photo cannot see a lean toward the camera. Tick plumb only when the bubble passed.

The app’s offset boxes stay at **0**. R is applied later, on the tape, after the tape is level.
