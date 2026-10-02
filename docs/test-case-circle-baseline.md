# Test case — circular path vs baseline

**Status:** PENDING fixture (`fixtures/field-circle-baseline/garden.json` not yet attached)  
**Repo path:** `fixtures/field-circle-baseline/`  
**Live app:** https://pjwinstone.github.io/gardenplanting/

## Ground truth (field)

1. **Baseline** established (known length; preferably a house edge you can re-find).
2. **Circular path** walked / measured with a **stake at the centre** (known circle).
3. Circle geometry **passes near one baseline end** (clear visual / residual check).

Capture enough + Point stations on the path that a circle fit is over-determined (≥3, prefer 5+). Keep sticky Item geometry = **circle**.

## Fixture drop-in

When the outdoor session is exported:

1. Export **garden.json** from the app (or OneDrive `/Garden Survey/garden.json`).
2. Place it at **`fixtures/field-circle-baseline/garden.json`** (do not invent a fake file).
3. Optional: note photo IDs / embedded thumbs already in the JSON; extra loose images only if needed.
4. Update this doc’s **Status** to **FIXTURE READY** and record the Build stamp used in the field.

See `fixtures/field-circle-baseline/README.md`.

## Manual pass / fail

| Check | Pass |
|---|---|
| Baseline length / ends | Matches taped/laser value within tape σ |
| Fitted circle | Residual language plausible; ring overlays path points |
| Near baseline end | Circle approaches the stated end (not the far end by mistake) |
| Centre | Plausible vs stake / path midpoint |
| Thumbs | Real photos on points (not only placeholders) |

## Automated check

```bash
npm run test:field-circle
```

**Skips (exit 0)** when `garden.json` is absent — CI stays green until the fixture arrives.  
When present, the script loads JSON and asserts baseline + circle-capable points exist (expand assertions once fixture is real).

The fixture may record `fxShared: false` (each photo keeps its own focal length). That field is allowed and is how the first circle trial is solved. A pass or fail of the circle needs **STN03**. A capture that names STN01 and STN02 only is reported and not graded. Shared `fx` is a later change; the raw tapes and clicks stay re-solvable.

## Related

- [testing-guide.md](../README.md) / Project store testing-guide § Field fixture — circle vs baseline
