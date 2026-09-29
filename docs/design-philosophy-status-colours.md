# Design philosophy — concertina status colours

Hamburger **concertina** rows show state at a glance via a **small status icon to the left of the section label** (green / orange / red). Titles stay short and neutral; optional **inline** text after the title (e.g. point ids, “garden loaded”) carries compact detail. Fuller copy lives in the expanded body.

## Status colours (default)
| Colour | Meaning |
|---|---|
| **Orange / amber** | Not ready — e.g. not signed in, baseline not set |
| **Red** | Problem — error, failed save/load, config missing |
| **Green** | Ready — e.g. signed in **and** garden loaded; baseline established |
| Neutral / default | Idle / N/A for that section |

## Apply to
- **Sign in** row: collapsed label **Sign in**; inline **garden loaded** + green when signed in and garden present; orange when not signed in / no garden; red only for real errors
- **Baseline** row: collapsed **Baseline** + point ids (`A — B`) + green/orange icon (never red for “not set”)
- Align with red **☰** badge for unseen errors (global attention); per-row colour is section-local status
- **Error log**: error lines in red; tap a red line to acknowledge and clear the ☰ warning (entries stay). Info lines use default text colour and do not keep ☰ red.

## Don’t
- Put long OneDrive / Microsoft wording in the collapsed title
- Use red for “not set” / “not signed in” (those are orange)
- Flash green until both login **and** loaded garden are true for the Sign in row

Dated: 2026-09-29 (Project design philosophy)
