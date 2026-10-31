# Circle test nets

_Generated from the nets YAML. Do not edit by hand._

## Home (`home`, rev be67d5be)

The app's start screen. Only the circle test is on the engine so far.

| Place | Screen | What it is |
|---|---|---|
| hub (entry) | panel | Pick an activity. |
| circle → circle_test |  | The circle test is open. |

| Move | Button | From → To | Guard | What it does |
|---|---|---|---|---|
| open_circle_test (user) | Circle test | hub → circle |  | Start or resume the circle test. |
| circle_closed (user) |  | circle → hub (child exit closed) |  |  |

### Circle test (`circle_test`, rev d6f02832)

The steps of the circle field test. Step buttons show the current and next step, plus All steps.

| Place | Screen | What it is |
|---|---|---|
| steps (entry) | panel | One step at a time; pick a step with the step buttons. |
| edge → edge_points |  | The edge point list (steps Edge photos and Circle result). |
| closed (exit) |  | The circle test is put away (Later); its data is kept. |

| Move | Button | From → To | Guard | What it does |
|---|---|---|---|---|
| open_edge_points (user) | Edge points | steps → edge |  | Open the list of edge points. |
| back_step (user) | ‹ Back | steps → steps | hasPrevStep | Go back to the previous step. |
| pick_step (user) | Go to step | steps → steps |  | Move to another step. |
| pause (user) | Later | steps → closed |  | Put the test away and come back later. |
| edge_closed (user) |  | edge → steps (child exit back) |  |  |

#### Edge points (`edge_points`, rev 1cd1bae8)

The hub of the circle test. Add edge point is always at the top.

| Place | Screen | What it is |
|---|---|---|
| list (entry) | list | Every edge point with its residual and colour. |
| adding → edge_add |  | Adding one edge point. |
| point → edge_edit |  | One point's pop-up is open. |
| fit → edge_fit |  | The circle fit is shown. |
| back (exit) |  | Left the list for another step. |

| Move | Button | From → To | Guard | What it does |
|---|---|---|---|---|
| add_point (user) | + Add edge point | list → adding |  | Take the next edge point's photo. |
| show_fit (user) | Circle fit | list → fit | canFit | The circle from the points in the fit. |
| back_to_steps (user) | Back to the step you came from | list → back | cameFromStep | Return to the step you were on. |
| back_step (user) | ‹ Back | list → back | hasPrevStep | Go back to the previous step. |
| pick_step (user) | Go to step | list → back |  | Move to another step. |
| open_point (user) | Open point | list → point | hasPoints | Open one point's pop-up. |
| delete_point (user) | Delete | list → list | hasLivePoint | Swipe left on a row to delete it (Restore undoes). |
| restore_point (user) | Restore | list → list | hasDeletedPoint | Put a deleted point back. |
| refit (app) |  | list → list |  | The fit recomputes by itself when points change; you stay where you are. |
| add_done (user) |  | adding → list (child exit done) |  |  |
| point_done (user) |  | point → list (child exit closed) |  |  |
| fit_done (user) |  | fit → list (child exit closed) |  |  |

##### Add edge point (`edge_add`, rev 4e318843)

The camera, then the tap screen for the new photo. Save or Cancel goes back to the list.

| Place | Screen | What it is |
|---|---|---|
| camera (entry) | camera | The camera is open (landscape). |
| tapscreen | form | Tap the base points you can see in the new photo. |
| done (exit) |  | Back to the list |

| Move | Button | From → To | Guard | What it does |
|---|---|---|---|---|
| photo_in (user) | Take photo | camera → tapscreen |  | The photo comes back from the camera. |
| camera_cancel (user) | Cancel | camera → done |  | Close the camera; nothing is added. |
| taps_saved (user) | Save | tapscreen → done |  | Save the taps and go back to the list. |
| taps_later (user) | Later | tapscreen → done |  | Keep the photo |

##### Edge point pop-up (`edge_edit`, rev 1e160b66)

One edge point full screen, with its photo, residual and note.

| Place | Screen | What it is |
|---|---|---|
| open (entry) | popup | The point's photo |
| retake → edge_photo |  | The retake screen (previous vs current). |
| taps | form | Re-tap the base points in this photo. |
| closed (exit) |  | Back to the list on this point. |

| Move | Button | From → To | Guard | What it does |
|---|---|---|---|---|
| retake (user) | ⟳ Retake | open → retake |  | Take this point's photo again. |
| edit_taps (user) | Tap base points | open → taps |  | Fix the taps on this photo. |
| save (user) | Save | open → closed |  | Keep the note and go back. |
| cancel (user) | Cancel | open → closed |  | Go back without saving the note. |
| delete (user) | Delete | open → open | pointLive | Leave it out of the fit (Restore undoes). |
| restore (user) | Restore | open → open | pointDeleted | Put it back in the fit. |
| taps_back (user) | Save | taps → closed |  | Save the taps and go back to the list. |
| retake_back (user) |  | retake → open (child exit back) |  |  |
| retake_saved (user) |  | retake → closed (child exit done) |  |  |

###### Retake screen (`edge_photo`, rev 156b84d6)

The previous and current photo side by side.

| Place | Screen | What it is |
|---|---|---|
| viewer (entry) | popup | Previous vs current photo. |
| camera → edge_add |  | The new photo is being taken. |
| back (exit) |  | Closed |
| done (exit) |  | New photo in |

| Move | Button | From → To | Guard | What it does |
|---|---|---|---|---|
| retake_photo (user) | Retake | viewer → camera |  | Open the camera for a new photo. |
| close (user) | Close | viewer → back |  | Back to the pop-up. |
| photo_done (user) |  | camera → done (child exit done) |  |  |

##### Circle fit (`edge_fit`, rev 7ba8e56b)

The circle from the points in the fit, with its verdict.

| Place | Screen | What it is |
|---|---|---|
| shown (entry) | panel | Centre |
| closed (exit) |  | Back to the list. |

| Move | Button | From → To | Guard | What it does |
|---|---|---|---|---|
| close (user) | Close | shown → closed |  | Back to the edge point list. |
| refit (app) |  | shown → shown |  | Refit runs by itself; you stay here. |
