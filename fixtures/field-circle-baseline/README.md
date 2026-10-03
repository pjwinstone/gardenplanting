# Fixture — field circle vs baseline

**Status:** waiting for real export — **do not invent `garden.json`.**

## Drop-in

When the user provides a field export, save it here as:

```
fixtures/field-circle-baseline/garden.json
```

Source is typically the app Export or OneDrive `/Garden Survey/garden.json` after the circular-path session described in `docs/test-case-circle-baseline.md`.

## Optional extras

- `NOTES.md` — Build stamp, weather, which baseline end the circle nears, stake notes.
- Loose photos only if not already embedded as `thumbnailDataUrl` on `photos[]`.

## Verify

```bash
npm run test:field-circle
```

Skips cleanly until `garden.json` exists.

The first trial is graded only when `fxShared` is false and STN03 is in the capture. `fxShared: true` is not graded. Two stations are reported and not graded. Branch index 0 is +Y of BAS01→BAS02; the peg side is index 1.
