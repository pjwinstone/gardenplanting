# iOS app options

**Status:** decision note only. No application code, and no change to the survey method.

Garden Survey is a Vite + TypeScript PWA on GitHub Pages (0.7.25), used in iPhone Safari. The garden is one OneDrive JSON file via MSAL and Microsoft Graph ([entra-onedrive-setup.md](entra-onedrive-setup.md)). Paul is reconsidering a native app because the in-app shutter cannot produce a survey still.

This note reads `main` and four open drafts. PR #3 (`cursor/phase1-geometry-solver-8c5c`) is the geometry solver: 3,863 lines in `src/solver/`, 2,253 lines of Node tests, CI via `npm test` on Ubuntu. PR #2 (`docs/MARKER_VISION_DESIGN.md`) needs one focal length per phone and per **1×** lens, solved in the adjustment. EXIF `FocalLengthIn35mmFilm` only checks that the shot is 1× (an integer, about ±1.9% at 26 mm). PR #5’s circle probe fails closed when `FocalLength` or `LensModel` is missing. PR #6 (`cursor/original-photo-onedrive-e4bf`) stores original bytes under `/Garden Survey/photos/`. On iOS Safari, `<input capture="environment">` is WebKit’s `UIImageJPEGRepresentation` at quality 0.8, named `image.jpg`, with no Make, Model, LensModel, FocalLength, DateTimeOriginal, GPS, or MakerNote. A Library pick is PHPicker Compatible mode: a converted JPEG, not HEIC. WebKit bug 207088 comments 24–25 say EXIF is kept and location is stripped. That is a user report.

A survey still has to be the wide (1×) camera, about 12 MP (the marker note’s working frame is 4032×3024, `fx ≈ 3028 px`), with lens and time EXIF, focus and zoom held still, and gravity at the shutter. The coach, plan, and solver already exist. The missing piece is that still.

Figures below are effort, not a calendar. “Agent days” is implementation work. Paul’s days are time at a Mac or on the phone.

## What any native shutter can use

**Lens and file.** [`builtInWideAngleCamera`](https://developer.apple.com/documentation/avfoundation/avcapturedevice/devicetype-swift.struct/builtinwideanglecamera) is the physical wide camera. A virtual dual or triple camera can switch lenses and zoom below 1×. Inside [`lockForConfiguration()`](https://developer.apple.com/documentation/avfoundation/avcapturedevice/lockforconfiguration()), set `videoZoomFactor` to 1, lock focus with `setFocusModeLocked(lensPosition:completionHandler:)`, and set `exposureMode` to `.locked`. The marker note budgets about 0.3% of focus breathing at 2 m. Cap `maxPhotoDimensions` at the device’s ~12 MP 4:3 size (`supportedMaxPhotoDimensions` varies by phone; a 24 MP default on iPhone 15 and later is still unverified). [`fileDataRepresentation()`](https://developer.apple.com/documentation/avfoundation/avcapturephoto/filedatarepresentation()) is the file to store: pixels plus the metadata from the capture, HEIF or JFIF. ProRAW stays off.

**Intrinsics, honestly.** [`intrinsicMatrix`](https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata/intrinsicmatrix) is valid only with `intrinsicMatrixReferenceDimensions`. Current docs say delivery requires constituent-photo delivery on, content-aware distortion correction off, and geometric distortion correction off ([flag](https://developer.apple.com/documentation/avfoundation/avcapturephotooutput/iscameracalibrationdatadeliverysupported)). The photo property itself still says both `isCameraCalibrationDataDeliveryEnabled` and `isDualCameraDualPhotoDeliveryEnabled`, and points depth captures at `AVDepthData.cameraCalibrationData` ([property](https://developer.apple.com/documentation/avfoundation/avcapturephoto/cameracalibrationdata)). The two texts name different switches. **Uncertain** which one a given phone and iOS version still requires. Read the Boolean at runtime and store nil when it is false.

Depth is a second route and is not every iPhone. It needs a dual camera, TrueDepth, or LiDAR, and it delays the still ([depth flag](https://developer.apple.com/documentation/avfoundation/avcapturephotosettings/isdepthdatadeliveryenabled)). An Apple reply on [forums thread 826469](https://developer.apple.com/forums/thread/826469) (full thread not re-read; treat as uncertain) says calibration is supported for depth and for constituent delivery, and not for back-camera RAW. [Thread 746564](https://developer.apple.com/forums/thread/746564) reports that an ordinary single-camera still gets nothing. Working assumption: a normal 1× still has no matrix.

Video buffers are the wider API. [`isCameraIntrinsicMatrixDeliverySupported`](https://developer.apple.com/documentation/avfoundation/avcaptureconnection/iscameraintrinsicmatrixdeliverysupported) is documented, for iOS 11, on `AVCaptureVideoDataOutput` only. Whether later iOS added the photo output is **uncertain**. That matrix matches the video crop, not automatically a 12 MP still. Leave geometric distortion correction at the default: turning it off is a condition of receiving calibration, and it changes the pixels. The checkerboard prior must use the same setting.

**Motion.** `CMMotionManager` with `xArbitraryZVertical` gives gravity and attitude without a compass. `xTrueNorthZVertical` and `CLLocationManager` heading need When-In-Use location. Photo and motion timestamps are both host times; aligning them is standard and the residual is **unmeasured**. Gravity is what the rays use. PR #6 wants location off, so the default sample is gravity only.

**ARKit, later.** [`ARCamera.intrinsics`](https://developer.apple.com/documentation/arkit/arcamera/intrinsics) exists on every world-tracking frame. [`capturedImage`](https://developer.apple.com/documentation/arkit/arframe/capturedimage) is a YCbCr video buffer, not a 12 MP HEIC, and ARKit owns the session. LiDAR scene depth is metres on a smaller map, only where `supportsFrameSemantics(.sceneDepth)` is true ([scene depth](https://developer.apple.com/documentation/arkit/arconfiguration/framesemantics-swift.struct/scenedepth)). Apple states no millimetre accuracy. Tracking drift does not replace the tape. Keep ARKit off the first build.

**Accounts, CI, Graph.** A Mac with current Xcode is required to sign and run. A free Apple Account installs from Xcode onto a personal phone: 10 App IDs, 3 devices, 3 apps, profiles expire after 7 days, no TestFlight ([account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/)). The [Developer Program](https://developer.apple.com/programs/whats-included/) is 99 USD/year. [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/) builds last 90 days. The free account covers the spike if Paul rebuilds weekly. It does not let an agent hand him a build.

The repo is public. Standard runners, including `macos-latest`, are free there; larger runners are billed even then ([billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions), [runners](https://docs.github.com/en/actions/using-jobs/choosing-the-runner-for-a-job)). The macOS image includes Xcode, so [fastlane](https://docs.fastlane.tools/) (`scan`, `gym`, `pilot`, `match`) or `xcodebuild` can build and boot the Simulator. The Simulator has no survey lens. Linux agents cannot run Xcode. Device signing needs a certificate and profile, or match, plus an App Store Connect API key, as Actions secrets, after the paid program. The `.p8` and `.p12` stay out of git. Camera truth still needs Paul’s phone.

Graph upload sessions are HTTPS with a delegated `Files.ReadWrite` token ([createUploadSession](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0)). Add an iOS platform to the existing registration: redirect `msauth.<bundle-id>://auth`, URL scheme in Info.plist, and `msauthv2` / `msauthv3` if the broker is used ([mobile setup](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-mobile-app-configuration), [redirect URIs](https://learn.microsoft.com/en-us/entra/msal/objc/redirect-uris-ios)). The Pages SPA redirects stay. No client secret. `@azure/msal-browser` inside WKWebView is the wrong login: SPA redirects are https, and the iOS guide uses the system browser or the broker.

## (a) Native SwiftUI + AVFoundation

**Capture and UX.** The shutter can be the wide camera, zoom 1, focus and exposure locked, writing `fileDataRepresentation()` and a gravity sample. One app, no Camera.app hop. A matrix on that still is a bonus, under the limits above.

**Reuse.** `ui.ts` is about 4,100 lines; the web app is about 11,700 lines of TS/CSS/HTML. SwiftUI rewrites that. Keep the solver. It has no DOM, and its only outside import is a type from `model.ts`. Bundle it and run it in [JavaScriptCore](https://developer.apple.com/documentation/javascriptcore). The accuracy bars stay the Node tests (millimetres and chi-square, not bit-exact V8). A macOS job can smoke-test that bundle. Porting `adjust.ts` (1,984 lines) would be a second solver the current CI does not grade. Graph upload can stay in the same bundle.

**Effort.** About 40–60 agent days to match today’s survey with the solver and Graph left in TypeScript, and about 5–8 days of Paul’s on the Mac, TestFlight, Entra, and the phone. A Swift solver port adds about 15–25 agent days.

**Toolchain and OneDrive.** The shared section. This option is the one that wants the paid program, because the signed binary is the whole product. CI runs logic tests in the Simulator. Paul adds the iOS redirect and takes the proving still.

**Risks.** A second UI if Pages stays for the iPad plan. A long gap before he can survey in the new app. Calibration flags that differ by iOS version. Export-compliance questions on the first TestFlight upload, because the app uses HTTPS.

## (b) Hybrid: Capacitor and a custom camera plugin

**Capture and UX.** [Capacitor](https://capacitorjs.com/docs/ios) hosts the existing pages. The coach, modes, plan, and solver stay. The shutter is a small Swift plugin on the AVFoundation path above.

The official plugin is the wrong shutter. [`@capacitor/camera`](https://capacitorjs.com/docs/apis/camera) `takePhoto` (8.1.0) defaults to JPEG, applies a 0–100 `quality`, and offers front or rear only. No wide-camera lock, no zoom or focus lock, no HEIC file. Older `getPhoto` docs say iOS and Android only support JPEG. That repeats the Safari re-encode. A gallery plugin that returns original bytes still does not lock the lens or sample the shutter.

The plugin writes `fileDataRepresentation()` to the cache and returns a `webPath`. JavaScript `fetch`es a `File` into the PR #6 queue, plus a side object: codec, pixel size, LensModel, both focal lengths, DateTimeOriginal, device type, zoom, lens position, motion, and intrinsics or an explicit null. Skip base64 across the bridge. Peak memory of a 12 MP HEIC is **unmeasured**.

**Reuse.** Essentially all of the TypeScript. The WKWebView is already JavaScriptCore, so the solver runs as in Safari, and `npm test` stays the accuracy gate. A thin MSAL plugin returns a Graph token; `onedrive.ts` keeps the upload session. `msalAuth.ts` stays the website path.

**Effort.** The spike (plugin plus a shell he runs from Xcode) is about 4–6 agent days and one afternoon of his, once it builds. A TestFlight that captures, stores the motion sample, and uploads is about 15–25 agent days and about 2–4 days of his (Xcode once, the Entra redirect, photo checks).

**Toolchain and OneDrive.** Same Mac and same account choice. Linux `npm test` is untouched. The macOS job proves the plugin compiles and that a fixture file round-trips. Sign-in is the native redirect. The Pages URI is unchanged.

**Risks.** WKWebView can evict IndexedDB, which is where the photo queue lives. Uploads pause when the view is suspended; a background `URLSession` can wait. Capacitor upgrades move the Xcode project. The plugin is only believable on his iPhone. `window.print()` may later need a share sheet.

## (c) Stay on the web

**Capture and UX.** The PWA, solver, and OneDrive already run. PR #6’s honest path is Camera.app (12 MP, HEIF Max off, ProRAW off, location off), then Library at Actual Size. That is the hop Paul wants to drop. The in-app control can aim. It is not the survey file.

**Achievable.** Coach, baseline, tapes, plan, tags, the https MSAL redirect, and Graph uploads. If a Library JPEG really keeps LensModel and DateTimeOriginal, the circle probe can accept it. That EXIF claim is only the WebKit user report.

**Not achievable.** Locking the wide camera, zoom, focus, or exposure. Reading `intrinsicMatrix` or a shutter-time motion sample. A HEIC original from the capture attribute or from PHPicker Compatible mode. Image Capture `takePhoto` is unsupported in Safari on iOS ([caniuse](https://caniuse.com/imagecapture)). `getUserMedia` on iOS does not expose focus or zoom.

**Reuse, effort, accounts.** All current code. No Mac and no Apple account. What remains is Paul’s time at every station, and a field check of Library EXIF. OneDrive is unchanged.

**Risk.** A picker change, or a missing LensModel, fails the circle probe closed. There is no route from this option to a per-frame matrix.

## Recommendation

Build the hybrid, and start with a custom camera plugin.

The broken part is the shutter (PR #6). The UI and the Node-tested solver stay. Capacitor’s own camera encodes JPEG and only chooses front or rear, so the plugin uses the wide camera, zoom 1, locked focus and exposure, and `fileDataRepresentation()`, then the existing upload queue. Sign-in is native MSAL, one new redirect on the same registration, token passed into the existing Graph code. A still-photo intrinsic matrix is a bonus prior for the checkerboard `fx`, not a gate: the documented cases are constituent delivery or depth, with distortion correction off. ARKit and LiDAR stay off that first plugin. SwiftUI waits until the plugin has been on the phone and the web view is actually in the way; until then it rewrites about 4,100 lines of UI to reach the same shutter.

**Phasing**

1. Paul answers the list below. The website keeps shipping. This note does not block PRs #3, #5, or #6.
2. Spike. The agent writes the plugin and a Capacitor shell. Paul runs it from Xcode. Pass: capture bytes unchanged; LensModel contains “back”; 35 mm equivalent 23–27; DateTimeOriginal set; device type wide; zoom 1. Fail: stop, and look again at Camera.app or a native shell.
3. If it passes: motion sample, token plugin, PR #6 queue, and a `macos-latest` compile. TestFlight only with the paid program.
4. The circle walk (PR #5) uses that shutter.
5. SwiftUI only if step 2 shows a hard web-view limit. The solver stays TypeScript, in JavaScriptCore if the UI is no longer a web view.

## Decisions for Paul

1. **Next step.** Hybrid (same screens, new shutter), a full Swift rewrite, or keep Camera.app plus Library.
2. **Apple account.** 99 USD/year and TestFlight, or a free account and a reinstall from the Mac every 7 days. Free is enough for the spike.
3. **Mac and phone.** A Mac that runs current Xcode, and the iPhone model. The model decides whether depth or LiDAR exists. The lens is the 1× wide camera either way.
4. **Entra.** Add `msauth.<bundle-id>://auth` to the existing Garden Survey app, same client id. The Pages redirect stays. Refusing this keeps sign-in on the website only.
5. **Location.** Gravity only, with location left off, or compass heading as well, which asks for location permission.
6. **Focal length.** The intrinsic matrix is a bonus prior. Shared `fx` still comes from a checkerboard. A missing matrix does not block the app.
7. **Website.** Keep GitHub Pages as the iPad plan and the fallback while the spike runs.
