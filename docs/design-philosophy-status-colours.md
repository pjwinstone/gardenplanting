# Design philosophy — concertina status colours

Hamburger **concertina** rows should show state at a glance via a **small status icon** immediately after the section label (green / orange / red). The section title stays neutral; the icon carries the primary signal. Optional subtitle text can repeat the detail.

## Status colours (default)
| Colour | Meaning |
|---|---|
| **Orange / amber** | Not ready — e.g. Microsoft not signed in |
| **Red** | Problem — error, failed save/load, config missing |
| **Green** | Ready — e.g. signed in **and** a garden document loaded (local or OneDrive) |
| Neutral / default | Idle / N/A for that section |

## Apply to
- **Sign in / OneDrive** row first (highest priority signal)
- **Baseline** row: label always **Baseline**; orange icon when not set, green when established (never red for “not set”)
- Other sections when they have clear state (e.g. OneDrive not signed in = orange; save/load failure = red)
- Align with red **☰** badge for unseen errors (global attention); per-row colour is section-local status

## Don’t
- Rely on colour alone — keep a short text status under the row when space allows
- Flash green until both login **and** loaded garden are true for the OneDrive row

Dated: 2026-09-28 (Project design philosophy)
