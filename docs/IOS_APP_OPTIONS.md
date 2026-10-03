# iOS app options

**Status:** decision note only. No application code, and no change to the survey method. The Photo & Marker Vision Reviewer and the Geometry & Maths Advisor have reviewed this note; their points are applied below.

Garden Survey is a Vite + TypeScript PWA on GitHub Pages (0.7.25), used in iPhone Safari. The garden is one OneDrive JSON file via MSAL and Microsoft Graph ([entra-onedrive-setup.md](entra-onedrive-setup.md)). Paul is reconsidering a native app because the in-app shutter cannot produce a survey still.

This note reads `main` and four open drafts. PR #3 (`cursor/phase1-geometry-solver-8c5c`) is the geometry solver: 3,863 lines in `src/solver/`, 2,253 lines of Node tests, CI via `npm test` on Ubuntu. It cannot yet share one `fx` per phone. PR #2 (`docs/MARKER_VISION_DESIGN.md`) needs one focal length per phone and per **1×** lens. EXIF `FocalLengthIn35mmFilm` only checks that the shot is 1× (an integer, about ±1.9% at 26 mm). On a 4032-wide frame the marker note’s scale is `fx ≈ 3028 px` at 26 mm and `fx ≈ 2798 px` at 24 mm. PR #5’s circle probe fails closed when `FocalLength` or `LensModel` is missing. PR #6 stores original bytes under `/Garden Survey/photos/`. On iOS Safari, `<input capture="environment">` is WebKit’s `UIImageJPEGRepresentation` at quality 0.8, named `image.jpg`, with no Make, Model, LensModel, FocalLength, DateTimeOriginal, GPS, or MakerNote. A Library pick is PHPicker Compatible mode: a converted JPEG. WebKit bug 207088 comments 24–25 say EXIF is kept and location is stripped. That is a user report.

A survey still is the wide (1×) camera, 4032×3024, HEIC or JPEG, with lens and time EXIF, focus locked **for that shot**, zoom held at 1, and gravity at the photo timestamp. The coach, plan, and solver already exist.

Figures below are effort, not a calendar. “Agent days” is implementation work. Paul’s days are time at a Mac or on the phone.

## What any native shutter can use

**Lens, focus, file.** [`builtInWideAngleCamera`](https://developer.apple.com/documentation/avfoundation/avcapturedevice/devicetype-swift.struct/builtinwideanglecamera) is the physical wide camera. A virtual dual or triple camera can switch lenses and zoom below 1×. Inside [`lockForConfiguration()`](https://developer.apple.com/documentation/avfoundation/avcapturedevice/lockforconfiguration()), set `videoZoomFactor` to 1 and lock exposure (`exposureMode = .locked`). The preview is a native view controller with `AVCaptureVideoPreviewLayer`. Do not put that layer under the WKWebView.

One locked focus cannot cover 2–15 m. On the reviewer’s figures for this lens (`f ≈ 6.9 mm`, `f/1.78`, circle of confusion 2 px ≈ 4.9 µm) the hyperfocal distance is about **5.4 m**, so the near limit is about **2.7 m**. At a 1 px limit those become about **10.8 m** and **5.4 m**. `lensPosition` is not a distance, and the same number is not the same distance on every phone. Each shot taps to focus on the stick, then locks with `setFocusModeLocked(lensPosition:completionHandler:)`, and stores that `lensPosition`. The checkerboard is repeated at two or three focus distances so the prior is `fx(lensPosition)`, which is how focus breathing enters the solve. The Geometry & Maths Advisor’s reading of PR #3: sharing one `fx` per phone would cut the circle’s radius σ from about 15 mm to about 6.5 mm and would catch station-tape blunders. The solver cannot do that yet. This per-phone `fx(lensPosition)` table is the input that work needs.

Set [`photoQualityPrioritization`](https://developer.apple.com/documentation/avfoundation/avcapturephotosettings/photoqualityprioritization) to `.balanced` on the output and on the request, and record it, plus the stabilisation state in the resolved settings. On a 48 MP sensor, `maxPhotoDimensions` of **4032×3024** is the binned full field of view. Record HEIC or JPEG. ProRAW stays off. [`fileDataRepresentation()`](https://developer.apple.com/documentation/avfoundation/avcapturephoto/filedatarepresentation()) is the file: pixels plus the metadata from that capture.

On every still, record `isGeometricDistortionCorrectionSupported` and `isGeometricDistortionCorrectionEnabled`. When the device supports geometric distortion correction, the default is on ([property](https://developer.apple.com/documentation/avfoundation/avcapturedevice/isgeometricdistortioncorrectionenabled)). The checkerboard is shot in that same mode.

**The survey shutter has no calibration matrix.** [`isCameraCalibrationDataDeliverySupported`](https://developer.apple.com/documentation/avfoundation/avcapturephotooutput/iscameracalibrationdatadeliverysupported) is true only with virtual-device constituent photo delivery on, content-aware distortion correction off, and `isGeometricDistortionCorrectionEnabled = false`. The photo property still also names `isDualCameraDualPhotoDeliveryEnabled`, and depth captures carry calibration on `AVDepthData` ([property](https://developer.apple.com/documentation/avfoundation/avcapturephoto/cameracalibrationdata)). A locked `builtInWideAngleCamera` still gets **nil**. Depth delivery is a different configuration (dual camera, TrueDepth, or LiDAR) and delays the still.

If a matrix is wanted, it is a **separate** calibration capture: a virtual device, constituent delivery, distortion correction off. Keep `intrinsicMatrix` with its `intrinsicMatrixReferenceDimensions` and the `lensDistortionLookupTable`. Never use that matrix as a prior for a still taken in a different correction mode. Whether `AVCameraCalibrationData` is per-unit or a nominal model is untested.

Video-buffer intrinsics ([`isCameraIntrinsicMatrixDeliverySupported`](https://developer.apple.com/documentation/avfoundation/avcaptureconnection/iscameraintrinsicmatrixdeliverysupported), documented on `AVCaptureVideoDataOutput` in iOS 11) match that video crop, not this 12 MP still.

**Motion.** Sample `CMMotionManager` at 100 Hz in [`.xArbitraryCorrectedZVertical`](https://developer.apple.com/documentation/coremotion/cmattitudereferenceframe/xarbitrarycorrectedzvertical): Z vertical, yaw arbitrary, magnetometer used only to slow yaw drift. Gravity is all the solver needs. Magnetic heading is unreliable near steel fence and shed fixings, so compass heading is not a survey observation and location stays off, as PR #6 already wants.

[`CMLogItem.timestamp`](https://developer.apple.com/documentation/coremotion/cmlogitem/timestamp) is host time (seconds since boot). [`AVCapturePhoto.timestamp`](https://developer.apple.com/documentation/avfoundation/avcapturephoto/timestamp) is the capture session’s clock. Convert it onto the host clock with the session’s synchronization clock, then interpolate the 100 Hz sample **at the photo time**, not at the tap. Zero-shutter-lag can deliver a frame from before the tap. Which instant inside the exposure that timestamp marks is untested.

The 1° check needs an axis map before the numbers are compared. ExifTool’s Apple tag `0x0008` `AccelerationVector` is in units of g and is left-handed: as viewed from the front of the phone, +X is toward the left, +Y toward the bottom, and +Z into the face ([Apple tags](https://exiftool.org/TagNames/Apple.html)). CoreMotion’s device frame is right-handed: +X to the right, +Y to the top, +Z out of the screen ([raw accelerometer events](https://developer.apple.com/documentation/coremotion/getting-raw-accelerometer-events)). Those are opposite directions on every axis, so the MakerNote vector `(x, y, z)` maps to CoreMotion as `(−x, −y, −z)`. Compare that mapped vector with `CMDeviceMotion.gravity` in the phone body, not in the oriented image. The angle between them is the check.

**ARKit, later and a separate mode.** [`ARCamera.intrinsics`](https://developer.apple.com/documentation/arkit/arcamera/intrinsics) on a streaming frame belong to [`capturedImage`](https://developer.apple.com/documentation/arkit/arframe/capturedimage), a YCbCr video buffer. From iOS 16, [`captureHighResolutionFrame`](https://developer.apple.com/documentation/arkit/arsession/capturehighresolutionframe(completion:)) can return a high-resolution still with that frame’s intrinsics and pose. That is a different camera mode from the locked wide-camera shutter, not a switch inside it. LiDAR scene depth is metres on a smaller map, only where `supportsFrameSemantics(.sceneDepth)` is true ([scene depth](https://developer.apple.com/documentation/arkit/arconfiguration/framesemantics-swift.struct/scenedepth)). Apple states no millimetre accuracy. Keep both off the first build.

**Accounts, CI, Graph.** A Mac with current Xcode is required to sign and run. Apple’s account page says a free Apple Account can install from Xcode onto a personal phone (10 App IDs, 3 devices, 3 apps, profiles expire after 7 days, no TestFlight) ([account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/)). Those limits are **not yet tried** on Paul’s Apple ID. The [Developer Program](https://developer.apple.com/programs/whats-included/) is 99 USD/year. [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/) builds last 90 days. A free account is the spike path if the published limits hold and he rebuilds from his Mac. It does not let an agent hand him a build.

The repo is public. Standard runners, including `macos-latest`, are free there; larger runners are billed even then ([billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions), [runners](https://docs.github.com/en/actions/using-jobs/choosing-the-runner-for-a-job)). The macOS image includes Xcode, so [fastlane](https://docs.fastlane.tools/) (`scan`, `gym`, `pilot`, `match`) or `xcodebuild` can build and boot the Simulator. The Simulator has no survey lens. Linux agents cannot run Xcode. Device signing needs a certificate and profile, or match, plus an App Store Connect API key, as Actions secrets, after the paid program. The `.p8` and `.p12` stay out of git.

Graph upload sessions are HTTPS with a delegated `Files.ReadWrite` token ([createUploadSession](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0)). Add an iOS platform to the existing registration: redirect `msauth.<bundle-id>://auth`, URL scheme in Info.plist, and `msauthv2` / `msauthv3` if the broker is used ([mobile setup](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-mobile-app-configuration), [redirect URIs](https://learn.microsoft.com/en-us/entra/msal/objc/redirect-uris-ios)). The Pages SPA redirects stay. No client secret. `@azure/msal-browser` inside WKWebView is the wrong login: SPA redirects are https, and the iOS guide uses the system browser or the broker.

## (a) Native SwiftUI + AVFoundation

**Capture and UX.** The shutter is the section above: wide camera, zoom 1, tap-to-focus lock per shot, `.balanced`, 4032×3024 HEIC or JPEG, gravity interpolated at the photo time. The survey still has no intrinsic matrix. One app, no Camera.app hop.

**Reuse.** `ui.ts` is about 4,100 lines; the web app is about 11,700 lines of TS/CSS/HTML. SwiftUI rewrites that. Keep the solver. It has no DOM, and its only outside import is a type from `model.ts`. Bundle it and run it in [JavaScriptCore](https://developer.apple.com/documentation/javascriptcore). The accuracy bars stay the Node tests. A macOS job can smoke-test that bundle. Porting `adjust.ts` (1,984 lines) would be a second solver the current CI does not grade. Shared `fx` is future work on that TypeScript solver, fed by the `fx(lensPosition)` table, not a reason to port it.

**Effort.** About 40–60 agent days to match today’s survey with the solver and Graph left in TypeScript, and about 5–8 days of Paul’s on the Mac, TestFlight, Entra, and the phone. A Swift solver port adds about 15–25 agent days.

**Toolchain and OneDrive.** The shared section. This option wants the paid program, because the signed binary is the whole product. CI runs logic tests in the Simulator. Paul adds the iOS redirect and takes the proving still.

**Risks.** A second UI if Pages stays for the iPad plan. A long gap before he can survey in the new app. Export-compliance questions on the first TestFlight upload, because the app uses HTTPS.

## (b) Hybrid: Capacitor and a custom camera plugin

**Capture and UX.** [Capacitor](https://capacitorjs.com/docs/ios) hosts the existing pages. The coach, modes, plan, and solver stay. The shutter is a small Swift plugin on the path above, with its own native preview controller.

The official plugin is the wrong shutter. [`@capacitor/camera`](https://capacitorjs.com/docs/apis/camera) `takePhoto` (8.1.0) defaults to JPEG, applies a 0–100 `quality`, and offers front or rear only. No wide-camera lock, no per-shot focus lock, no HEIC file. Older `getPhoto` docs say iOS and Android only support JPEG.

**Where the file lives.** The plugin writes `fileDataRepresentation()` under Application Support and returns that path. JavaScript reads the bytes with [`Capacitor.convertFileSrc`](https://capacitorjs.com/docs/basics/utilities). The queue holds metadata plus the path: device type, `lensPosition`, both geometric-distortion flags, `photoQualityPrioritization`, stabilisation, zoom, pixel size, codec, and the motion sample at the photo time. It does not hold the pixels, and it does not use WKWebView IndexedDB as the copy of the original. Upload uses the existing JavaScript Graph session or a native background `URLSession`. Compute SHA-256 locally and keep it as a local integrity record only. Graph does not reliably return SHA-256. Verify the upload the way PR #6 does: size plus [`quickXorHash`](https://learn.microsoft.com/en-us/onedrive/developer/code-snippets/quickxorhash) (`file.hashes.quickXorHash`). Delete the file only after that check passes. Skip base64 across the bridge.

**Reuse.** Essentially all of the TypeScript. The WKWebView is already JavaScriptCore, so `npm test` stays the accuracy gate. A thin MSAL plugin returns a Graph token; `onedrive.ts` keeps the upload session when that path is the one in use. `msalAuth.ts` stays the website path.

**Effort.** The spike (plugin plus a shell he runs from Xcode) is about 4–6 agent days and one afternoon of his, once it builds. A TestFlight that captures, stores the file and the motion sample, and uploads is about 15–25 agent days and about 2–4 days of his.

**Toolchain and OneDrive.** Same Mac and same account choice. Linux `npm test` is untouched. The macOS job proves the plugin compiles and that a fixture file round-trips. Sign-in is the native redirect. The Pages URI is unchanged.

**Risks.** Capacitor upgrades move the Xcode project. The plugin is only believable on his iPhone. `window.print()` may later need a share sheet. IndexedDB eviction and bridge memory are open questions below, not the design of the file store.

## (c) Stay on the web

**Capture and UX.** The PWA, solver, and OneDrive already run. PR #6’s honest path is Camera.app (12 MP, HEIF Max off, ProRAW off, location off), then Library at Actual Size. That is the hop Paul wants to drop. The in-app control can aim. It is not the survey file.

**Achievable.** Coach, baseline, tapes, plan, tags, the https MSAL redirect, and Graph uploads. If a Library JPEG really keeps LensModel and DateTimeOriginal, the circle probe can accept it. That EXIF claim is only the WebKit user report.

**Not achievable.** Choosing `builtInWideAngleCamera`, locking zoom, tap-to-focus, or exposure. A shutter-time motion sample. An Application Support original. Image Capture `takePhoto` is unsupported in Safari on iOS ([caniuse](https://caniuse.com/imagecapture)). `getUserMedia` on iOS does not expose focus or zoom. There is no survey-still intrinsic matrix on this path either.

**Reuse, effort, accounts.** All current code. No Mac and no Apple account. What remains is Paul’s time at every station, and a field check of Library EXIF. OneDrive is unchanged.

**Risk.** A picker change, or a missing LensModel, fails the circle probe closed.

## Recommendation

Build the hybrid, and start with a custom camera plugin.

The broken part is the shutter (PR #6). The UI and the Node-tested solver stay. Capacitor’s own camera encodes JPEG and only chooses front or rear, so the plugin uses `builtInWideAngleCamera`, zoom 1, tap-to-focus locked per shot, `.balanced`, and 4032×3024 HEIC or JPEG. The file goes to Application Support and into the Graph upload only as a path. The survey shutter has no intrinsic matrix. Focal length is `fx(lensPosition)` from a checkerboard in the same geometric-distortion mode, and that table is what a future shared-`fx` solve in PR #3 would consume. ARKit high-resolution frames stay a later, separate mode. SwiftUI waits until this plugin has been on the phone and the web view is actually in the way.

**Phasing**

1. Paul answers the list below. The website keeps shipping. This note does not block PRs #3, #5, or #6.
2. Spike. The agent writes the plugin and a Capacitor shell. Paul runs it from Xcode. Pass: device type is `builtInWideAngleCamera`; zoom is 1; `lensPosition` and both geometric-distortion flags are stored; LensModel is present and contains “back”, or the spike fails closed, as PR #5 does when LensModel is missing; the 35 mm equivalent is 23–27; DateTimeOriginal is set; after the `(−x, −y, −z)` map above, the MakerNote `AccelerationVector` is within about 1° of `CMDeviceMotion.gravity`; after upload, size and `quickXorHash` match Graph. SHA-256 is recorded locally and is not the upload check. Fail: stop, and look again at Camera.app or a native shell.
3. If it passes: token plugin, the path queue, and a `macos-latest` compile. TestFlight only with the paid program.
4. The circle walk (PR #5) uses that shutter. The checkerboard at two or three focus distances can be the same trip.
5. SwiftUI only if step 2 shows a hard web-view limit. The solver stays TypeScript, in JavaScriptCore if the UI is no longer a web view.

## Decisions for Paul

1. **Next step.** Hybrid (same screens, new shutter), a full Swift rewrite, or keep Camera.app plus Library.
2. **Apple account.** 99 USD/year and TestFlight, or a free account and a reinstall from the Mac on whatever schedule the free profile actually enforces. Free is the spike, once those limits are confirmed.
3. **Mac and phone.** A Mac that runs current Xcode, and the iPhone model. The model decides whether a separate depth or LiDAR capture exists. The survey lens is the 1× wide camera either way.
4. **Entra.** Add `msauth.<bundle-id>://auth` to the existing Garden Survey app, same client id. The Pages redirect stays. Refusing this keeps sign-in on the website only.
5. **Heading.** Gravity only. Compass heading is not an observation: steel in the fences and the shed makes a magnetic heading unreliable, and location stays off.
6. **Focal length.** No matrix on the survey still. Shared `fx` is a checkerboard in the same distortion-correction mode, at two or three focus distances, stored against `lensPosition`. A missing matrix does not block the app.
7. **Website.** Keep GitHub Pages as the iPad plan and the fallback while the spike runs.

## Open questions for the spike

Untested until Paul’s phone says otherwise:

- Whether `fileDataRepresentation()` from this plugin carries LensModel, the MakerNote, and Orientation.
- Whether `AVCameraCalibrationData`, on the separate calibration capture, is per-unit or nominal.
- Whether Camera.app’s 24/28/35 mm choice and its 24 MP setting carry into an AVFoundation session. The spike sets 4032×3024 itself.
- The zero-shutter-lag default, and which moment `photo.timestamp` marks inside the exposure.
- How much Deep Fusion moves pixels.
- The free-account limits on his Apple ID.
- Whether WKWebView IndexedDB eviction still matters once originals are files. Bridge memory if any code path still base64-encodes a still.
