# Photos viewer, archive and photo check

Paul's decisions, October 2026.

## Photos viewer (replaces the always-on Retake)

- The roller row no longer has a separate Retake next to the pill.
- The step's **Photos (n)** button opens a viewer of that step's current photos. Each photo shows a thumbnail, its file name, and its state (on the phone and OneDrive / uploading / upload failed).
- The button shows when the step has photos, or when its action is *done* or *error*. So error recovery is reachable from the viewer too: the reason is shown at the top, failed uploads get **Retry upload**, and every photo gets **Retake**.
- **Retake** opens the camera for that step straight away. It has the same semantics as `retake_done` (workflow/action.net.yaml): `retakeAfter` is set, so the old photos stop counting, and steps resting on them go to re-check. For the calibration step that means camera-1…4 and circle-result.
- Retake replaces **all** of the step's current photos, as `retakeAfter` does. The viewer says so.
- The red error pill (Retake when refused / Retry upload when failed) is unchanged.

## Where photos live

- **Live photos** stay on the phone (the original in the photo queue, kept after a verified upload) and in OneDrive `Garden Survey/photos/`. Finished runs keep their live photos.
- A photo **superseded by a Retake**:
  1. is moved in OneDrive to `photos/archive/run-<run start>/` with a Graph move (PATCH parentReference, conflictBehavior `rename`), never deleted;
  2. gets `archivedAt` and `archivePath` on its manifest row;
  3. has its phone copy deleted (only after the move worked);
  4. gets an `archived` record in the run's `photoArchive.log`.
- Pending moves are kept in `photoArchive.pending` on the run. They are drained after a Retake, on app start, when the phone comes back online, and every 30 s.
- A failed move goes to the error log. The log updates in place, with no full redraw. It is retried with backoff (30 s, 1 min, 2 min, …, at most 30 min). The backoff is kept in memory, so a failure does not change the document.

## Set-up: photo housekeeping

- **Archive age before clean-out (days):** default 90 (`workflow/tolerances.json` → `photoArchiveMaxAgeDays`), editable in Set-up, stored in the run's config. Changing it is logged (`config.changed`) but sends no step to re-check.
- **Check photos:** runs the photo check (below). It also runs on Start/Resume of a run, and before every clean-out.
- **Clean out archive:** lists the files in `photos/archive/**` older than the archive age, with their total size. It deletes them only after you confirm. It never touches anything outside `photos/archive/`.
- **Archive N unreferenced photos:** moves the OneDrive orphans to `photos/archive/unreferenced/`. Nothing is deleted.

## Photo check

Every photo the survey uses (not superseded, not archived) must be on the phone and/or in OneDrive.

| Found | Result |
|---|---|
| on both | fine |
| on neither | **ERROR** on the error log, by step and photo: "…missing on the phone and in OneDrive. Retake it: open the step's Photos and tap Retake." |
| only on the phone | warning; the upload is retried automatically |
| only in OneDrive | warning |
| a file in `photos/` that the survey does not use | orphan in OneDrive; offered for *Archive N unreferenced photos* |
| a phone original that the survey does not use | listed only; left on the phone |

When offline or signed out, only the phone side is checked, so no false errors are raised.
