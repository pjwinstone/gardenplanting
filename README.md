# Garden Survey

Static PWA (Vite + TypeScript) for surveying a ~20×20 m UK garden. No backend. Session modes, a chatty coach, Layer A/B adjust, SVG plan, and A4 printable rod belts.

**Live (GitHub Pages):** https://pjwinstone.github.io/gardenplanting/

**Stage 2 — accurate measurements (field):** phone checklist → **[docs/stage-2-field-checklist.md](docs/stage-2-field-checklist.md)**. In the app: **Start Stage 2 field loop** / **Show Stage 2 checklist**.

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

Exactly one mode at a time. The banner + coach always say where you are and what is legal next. For the live garden, follow **[Stage 2 field checklist](docs/stage-2-field-checklist.md)** (also available in-app).

1. **START** — New garden or load JSON (`Import garden.json` / `Load synthetic demo` / OneDrive load when signed in).
2. **HOUSE_BASELINE** — Measure the back wall and one diagonal. Do not move on until the house rectangle closes. → *Start house*
3. **PLACE_ROD_A** — Put rod A where the house can see it. Both ends need toilet-roll belts. → *Rod A ready*
4. **PHOTO_TIE_HOUSE_ROD** — Frame two house corners **and** both ends of rod A; tap those four marks. → *Take tie photo*
5. **OCCUPY** — Spike, bubble the pole, photograph live rod(s), name the point. → *Occupy*
6. **OCCUPY_EXTRA_YAW** — Do not step; only yaw the phone. Photos share this occupy point. → *Another photo here (yaw)*
7. **LEAPFROG** — Plant rod B; photograph A and B together before picking A up. → *Start leapfrog*
8. **RODS_MOVED** — Confirm move; old setup closes, new setup opens. Rod A is no longer the old coordinates. → *Rods moved* (refused until A+B photographed together)
9. **FENCE_TAG** — Stick a roll on the post; photograph with a live rod. → *Fence mark*
10. **ADJUST** — Layer A (house tapes/straights + rod lengths) then Layer B (per-photo pose; yaw sets share x,y). Residuals in plain language. → *Adjust*
11. **REVIEW** — Plan + thumbnails. → *Done with this setup*

Illegal transitions are refused with a clear sentence (buttons stay disabled when illegal).

## Demo path (milestone 1)

1. Open the app (`npm run dev` or the Pages URL).
2. Click **Load synthetic demo** or **Run milestone demo (synthetic → Adjust)** — house 8×6 m, rod A 4.000 m, tie photo + two occupy photos; Adjust draws the SVG plan.
3. If walking manually: after Load synthetic, click **Adjust**.
4. Click **Print tags** — A4 sheet with rod belts (A1 A2 A0 B1 B2 B0) and FNC01–04.

Illegal mode buttons stay clickable and show a refusal sentence (they are not a silent grey void). House baseline, tie marks, and leapfrog each have a step panel so you can always proceed.

## Data

- Document: `points`, `lines`, `polygons`, `observations`, `photos` (thumbnails + clicks), `setups`.
- **localStorage** offline cache; **Export / Import** `garden.json`.
- **OneDrive** source of truth when signed in: `/Garden Survey/garden.json` (coach panel shows signed-in state, last save, and plain-language errors).
- Coach copy lives only in `src/coach.ts`.

## Modules

`model.ts` · `modes.ts` · `adjustLayerA.ts` · `adjustLayerB.ts` · `photoGeometry.ts` · `storage.ts` · `planSvg.ts` · `tagsPrint.ts` · `coach.ts` · `stage2Checklist.ts` · `ui.ts` · `msalAuth.ts` · `onedrive.ts` · `cloudStatus.ts` · `cloudConfig.ts`

See `AGENTS.md` for the survey method (do not change without asking).
