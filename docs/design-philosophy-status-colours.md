# Design philosophy — concertina status colours

Hamburger **concertina** rows should show state at a glance via colour (dot, chevron, or section header accent).

## Status colours (default)
| Colour | Meaning |
|---|---|
| **Orange / amber** | Not ready — e.g. Microsoft not signed in |
| **Red** | Problem — error, failed save/load, config missing |
| **Green** | Ready — e.g. signed in **and** a garden document loaded (local or OneDrive) |
| Neutral / default | Idle / N/A for that section |

## Apply to
- **Sign in / OneDrive** row first (highest priority signal)
- Other sections when they have clear state (e.g. baseline missing = orange; Adjust failed = red; baseline OK = green)
- Align with red **☰** badge for unseen errors (global attention); per-row colour is section-local status

## Don’t
- Rely on colour alone — keep a short text status under the row when space allows
- Flash green until both login **and** loaded garden are true for the OneDrive row

Dated: 2026-09-28 (Project design philosophy)
