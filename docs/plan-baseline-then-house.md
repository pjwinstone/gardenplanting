# Plan — Baseline first, then measure house

**Status:** **implemented** in AGENTS.md + app (Build 0.5.0). Defaults: Close house warns if gap &gt; 50 mm; v1 photo-tie requires both baseline ends + target in one frame.

Live app today still assumes **house rectangle first**. This plan replaces that with **any known-length baseline → house as irregular polygon → leapfrog for the far side**.

## What you described
1. A **baseline** is two points with a known distance — conceptually not “the whole house.”
2. **Default practice:** the first baseline is **one edge of the house** (two corners / marks on that wall). Easy to re-find later.
3. House ≈ **10 corners**, irregular polygon; diagonal tape often impossible.
4. Round posts (or rolls on corners): the mark is not the true brick arris — store an **offset / radius parameter** per mark (mm) so the geometry can correct toward the real corner.
5. After the first baseline: **add further baselines, taped edges, and corners** incrementally (not all 10 at once).
6. Far side / front via **leapfrog** and additional baselines.
7. Photo problem: shared-frame tie vs Add point from a known station (see below).

## Recommended field pattern

### Workflow A — Establish baseline (default = house edge)
1. Pick **one house edge** that you can re-establish (clear corners or durable marks).
2. Mark ends **B1, B2** (toilet-roll / disc on or next to the corner). Enter optional **mark offset** (e.g. post radius / roll standoff in mm) so the solved point can be the brick corner, not the roll centre.
3. Tape or laser **B1–B2** along that edge (σ: tape 20 mm / laser 2 mm).
4. App creates: a **Baseline** observation + two **house corner** candidates (or links B1/B2 into the house polygon as vertices 1 and 2).
5. Coach: “This edge is your baseline. Measure it. Offsets are OK — tell me the roll/post radius if the mark is not the true corner.”

Later baselines may be free pegs in the lawn or further house edges — same toolbox call, different workflow prompt.

### Workflow B — Attach house corners to that baseline
House corners **H1…Hn** are **marks you cannot stand on**. Treat them like today’s fence tags: disc/roll on the brick, or a clearly clickable corner in the image.

**Preferred photo geometry (solve your “can’t see baseline and house” worry):**

Do **not** stand with your back to the baseline looking only at the house — that hides the only known scale/control.

Instead:

1. **Offset the baseline into the garden** so both ends can “see” the façade you care about (often 3–8 m off the wall, parallel-ish).
2. Stand where **one photo contains: B1, B2, and the house mark(s) you are fixing** (at least one corner; two is stronger).
3. Plumb the ~1 m pole; tap those image points.
4. Solver: distances primary (B1–B2); photo resection secondary — same spirit as AGENTS Layer B, but control is baseline, not a closed house rectangle.

If a single frame cannot hold B1+B2+corner:

| Fallback | When to use |
|---|---|
| **Add point at a known station** | Stand on B1 or B2 (or a previously added point), photo house marks only; need a second known mark in frame, or a yaw-only second photo sharing that station, or a second station |
| **Short helper rod** | Plant rod A in view of house; photo **baseline + rod** first, then **rod + house marks** (leapfrog control toward the wall) |
| **Two-station resection** | Photo from station S1 (baseline in view), move to S2 (house + one live rod); share constraints across photos — later module if v1 underdetermined |

**Rule (keep):** if pose is underdetermined, say so; do not invent coordinates.

### Workflow C — Grow the ~10-corner house
1. Start from house-edge baseline (2 corners fixed in relative scale).
2. Add the next corner or edge when convenient:
   - tape the next wall segment if reachable, and/or
   - photo-tie new corner(s) to the live baseline / rods, and/or
   - add another baseline (second house edge or free pegs).
3. Far side / front: **LEAPFROG** + new baseline where the first edge cannot see.
4. Polygon stays open until enough corners exist; “good enough” for v1 ≈ all intended corners entered **or** close residual reported when user taps Close house (target: discuss — e.g. warn if gap &gt; 50 mm).
5. House = **polygon** on `structure` / `buildings` layer (~10 vertices), not a rectangle.

### Workflow D — Optional “points on the house are the baseline”
If B1/B2 *are* two house corners with a taped edge between them:
- Same as A+B, but the baseline edge is also a house edge.
- Still no requirement to tape the diagonal.
- Remaining corners still come from photos + leapfrog.

## How this maps to toolbox vs workflow (architecture)
- **Toolbox:** `setBaseline(B1,B2,length)`, `addDistanceObs`, `resectMarksInPhoto`, `leapfrogRods`, `closePolygon(houseId)`, `adjustLayerA/B`
- **Workflows / prompts:** `workflowEstablishBaseline` → `workflowTieHouseToBaseline` → `workflowLeapfrogAroundHouse`
- **Coach copy** stays in `coach.ts` only
- Survey **rules** change → update AGENTS.md when you approve this plan

## App mode sketch (replace house-first chain)

1. `START`
2. `BASELINE` — place marks + enter length  
3. `PHOTO_TIE_BASELINE` — B1, B2, + target marks in frame (house corners, posts, …)  
4. `HOUSE_EDGES` (optional) — tapewalk edges you can reach  
5. `ADD_POINT` / `ADD_POINT_EXTRA_YAW` — Add point workflow (rover on plumbed pole); button **+ Point**  
6. `LEAPFROG` / `RODS_MOVED` — unchanged idea; used heavily around the house  
7. `ADJUST` / `REVIEW`

Remove assumption: “house rectangle must close before anything else.”

## Answering your photo puzzle directly
**Best default:** move the baseline **away from** the wall so you can stand where **baseline ends and house corners share the frame**. The corner stays a **clicked mark** (disc on brick), not a place you stand.

**Standing at a known point** (B1/B2/Add point) and shooting only the house works when that station is already fixed and the photo has enough other control (second mark, second rod, or yaw set). Alone with zero control in frame → underdetermined.

**Back to the baseline, facing the house only** → usually *hides* control; avoid as the primary method.

## Implementation phases (after approval)
1. **Docs:** rewrite AGENTS modes + field checklist for baseline-first  
2. **Model:** `Baseline` entity; house as irregular polygon; drop forced rectangle close  
3. **Workflows:** baseline → photo-tie → optional edges → leapfrog second baseline  
4. **Adjust:** Layer A on baselines + taped edges; Layer B resection to marks; polygon close residual  
5. **UI:** task-strip workflows “Establish baseline” / “Measure house” on plan backdrop  
6. **Migration:** synthetic demo uses a short baseline + irregular 5–6 corner shed, not a perfect rectangle  

## Decisions locked from you
1. **House ≈ 10 corners** (irregular polygon).
2. **First baseline = one house edge** — easy to re-establish; then add more baselines / edges / corners.
3. **Mark offset / post radius** is a first-class parameter (mm) on baseline ends and similar marks.

## Still open
1. When Close house is allowed / warning threshold (e.g. gap &gt; 50 mm)?  
2. v1 photos: require **both baseline ends + target in one frame**, multi-image BA later?

## Recommendation
Default path: **house-edge baseline + mark offsets + shared-frame photo-tie for the next corners**; leapfrog/second baseline for the far side. Free lawn baselines remain available as the same toolbox tool.

Approve this plan (and the two open items if you care) before we change AGENTS.md and the app.
