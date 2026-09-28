# Garden Survey

Static PWA (Vite + TypeScript) for surveying a ~20×20 m UK garden. No backend. Session modes, a chatty coach, Layer A/B adjust, SVG plan, and A4 printable rod belts.

**Live (GitHub Pages):** https://pjwinstone.github.io/gardenplanting/

**Architecture (toolbox / workflows / plan-first UI):** **[docs/architecture-toolbox-workflows.md](docs/architecture-toolbox-workflows.md)**.

**Survey method (baseline first, then house polygon):** **[docs/plan-baseline-then-house.md](docs/plan-baseline-then-house.md)**.

**Stage 2 — accurate measurements (field):** phone checklist → **[docs/stage-2-field-checklist.md](docs/stage-2-field-checklist.md)**. In the app: **Establish baseline** / **Show Stage 2 checklist**.

**Microsoft sign-in + OneDrive:** saves `garden.json` to personal OneDrive at `/Garden Survey/garden.json`. Setup: **[docs/entra-onedrive-setup.md](docs/entra-onedrive-setup.md)**.

## Run

```bash
npm install
cp .env.example .env.local   # optional until you have Entra IDs
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

Production build uses Vite `base` `/gardenplanting/` for project Pages. Deploy is automatic on push to `main` via `.github/workflows/deploy-pages.yml` (set Actions secrets listed in the Entra doc).

## Field loop (session modes)

Exactly one mode at a time. The task strip + coach always say where you are and what is legal next. For the live garden, follow **[Stage 2 field checklist](docs/stage-2-field-checklist.md)**.

1. **START** — New garden or load JSON / OneDrive / synthetic demo.
2. **BASELINE** — Default: one **house edge**. Mark ends, enter length + optional offset mm. → *Establish baseline*
3. **PHOTO_TIE_BASELINE** — Both baseline ends **and** the target mark in one frame. → *Take baseline tie*
4. **HOUSE_EDGES** — Grow the irregular ~10-corner house; Close house warns if gap &gt; 50 mm. → *Measure house edges*
5. **OCCUPY** — Spike, bubble, photograph live control, name the point. → *Occupy*
6. **OCCUPY_EXTRA_YAW** — Do not step; only yaw. → *Another photo here (yaw)*
7. **LEAPFROG** — Far side / second baseline; photo A+B together. → *Start leapfrog*
8. **RODS_MOVED** — Old setup closes. → *Rods moved*
9. **FENCE_TAG** — Roll on post + live control. → *Fence mark*
10. **ADJUST** — Layer A (baselines + edges + rods + close gap) then Layer B. → *Adjust*
11. **REVIEW** — Plan + thumbnails. → *Done with this setup*

Illegal transitions are refused with a clear sentence.

## Demo path

1. Open the app.
2. **Run milestone demo** — house-edge baseline + irregular shed + rod A + occupies → Adjust draws the SVG plan.
3. **Print tags** — A4 rod belts + FNC01–04.

## Data

- Document: `points` (optional `offsetMm`), `lines`, `polygons`, **`baselines`**, `observations`, `photos`, `setups`.
- **localStorage** offline cache; **Export / Import** `garden.json`.
- **OneDrive** source of truth when signed in.
- Coach copy lives only in `src/coach.ts`.

## Modules

`model.ts` · `modes.ts` · `toolbox/` · `workflows/` · `adjustLayerA.ts` · `adjustLayerB.ts` · `photoGeometry.ts` · `storage.ts` · `planSvg.ts` · `tagsPrint.ts` · `coach.ts` · `stage2Checklist.ts` · `ui.ts` · `msalAuth.ts` · `onedrive.ts` · `cloudStatus.ts` · `cloudConfig.ts`

See `AGENTS.md` for the survey method.
