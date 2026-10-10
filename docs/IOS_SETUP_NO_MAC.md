# Set up the iOS app without a Mac

Browser and iPhone only. The Capacitor shell, the survey camera, and the GitHub workflows are already in this repo. You do not install Xcode. GitHub’s `macos-latest` runner builds the app. You install it from TestFlight.

The website at <https://pjwinstone.github.io/gardenplanting/> is unchanged. The OneDrive folder stays `/Garden Survey/`. Leave the Entra app registration’s existing name as it appears in the portal.

Membership in the Apple Developer Program ($99/year) is already active. A free Apple Account cannot upload to TestFlight. Copy the **Team ID** (ten characters) from [Account](https://developer.apple.com/account). That value is `APPLE_TEAM_ID` in step 4.

Do these steps in order. Each one becomes necessary at a different moment. The unsigned build on every pull request needs none of them.

| Value | Exact text |
|---|---|
| Bundle ID | `com.pjwinstone.gardenplanting` |
| App name | `Garden Planting` |
| SKU | `garden-planting-ios` |
| API key name | `Garden Planting CI` |
| Entra redirect | `msauth.com.pjwinstone.gardenplanting://auth` |
| URL scheme | `msauth.com.pjwinstone.gardenplanting` |

## 1. Register the bundle ID

**Needed before** the App Store Connect app record, and before a signed archive can be tied to an app. The unsigned simulator job does not check this.

Browser: [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) → Identifiers → **+** → App IDs → App → Continue.

- Description: `Garden Planting`
- Bundle ID: **Explicit**, `com.pjwinstone.gardenplanting`
- Capabilities: leave them **off**

Camera, motion, and the `msauth.` URL scheme are Info.plist entries in the project (`NSCameraUsageDescription`, `NSMotionUsageDescription`, `CFBundleURLTypes`). They are not checkboxes here. Sign in with Apple, Push Notifications, and Associated Domains stay off.

Register. This page does not need a Mac. The bundle ID cannot be changed later.

## 2. Create the app record in App Store Connect

**Needed before** the TestFlight workflow’s upload will be accepted. Archive can be signed without it; the upload needs a record to land in.

Browser: [My Apps](https://appstoreconnect.apple.com/apps) → **+** → New App. Apple’s steps: [Add a new app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app).

- Platforms: iOS
- Name: `Garden Planting` (if that store name is taken, add a suffix; the name must be unique)
- Primary language: English (U.K.)
- Bundle ID: `com.pjwinstone.gardenplanting`
- SKU: `garden-planting-ios`
- User access: Full access

You do not submit the app for review. The record only has to exist so TestFlight has somewhere to put a build.

## 3. Create the App Store Connect API key

**Needed before** the signing workflow can create a profile or upload. You need the key’s contents for step 4.

Browser: [App Store Connect](https://appstoreconnect.apple.com) → Users and Access → Integrations → App Store Connect API. Apple’s guide is [Creating API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api). If “Integrations” is missing, look for “Keys” under Users and Access.

1. Copy the **Issuer ID** at the top.
2. Generate a key. Name: `Garden Planting CI`. Access: **Admin**.
3. Download the `.p8` file. Apple shows it **once**. If you close the page without downloading, revoke that key and make another.
4. Copy the **Key ID**.

Admin is the role to use because cloud signing creates profiles and may create a certificate. Whether App Manager is enough is not clearly stated. Do not pick Developer, Marketing, or a key limited to notarisation.

Keep the `.p8` only until the next step. Then delete the download. GitHub holds the copy.

## 4. Create the `testflight` environment, then add the four secrets there

**Needed before** you dispatch the TestFlight workflow and expect an upload. Until the secrets exist, that workflow still runs and exits successfully with: “Skipping TestFlight upload. One or more signing secrets are absent.”

Do this in order. Create the environment and set its branch rule **before** you add secrets, and **before** you dispatch the workflow. If a dispatch runs while the environment does not exist, GitHub creates `testflight` for you with no deployment-branch rule.

1. Repo → **Settings** → **Environments** → **New environment**. Name it `testflight`. [GitHub environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment).
2. On that environment, set deployment branches to **Selected branches** and allow **`main` only**. Save that rule before the next step.
3. Add the four values as **environment secrets** on `testflight`, not as repository secrets. Names must match exactly:

These are **environment** secrets. Do not add them under Settings → Secrets and variables → Actions → Repository secrets. If those four names are already repository secrets, delete them there after the environment copies exist. A pull request inside this repo can still read repository secrets.

| Secret name | Value |
|---|---|
| `APP_STORE_CONNECT_KEY_ID` | The Key ID from step 3 |
| `APP_STORE_CONNECT_ISSUER_ID` | The Issuer ID from step 3 |
| `APP_STORE_CONNECT_KEY_P8` | The whole `.p8` file, including the `BEGIN PRIVATE KEY` and `END PRIVATE KEY` lines |
| `APPLE_TEAM_ID` | The ten-character Team ID from the Membership page |

Paste the `.p8` as the secret value. A multi-line secret is allowed. Do not base64 it. Do not commit the file.

The TestFlight workflow (`.github/workflows/testflight.yml`) uses `environment: testflight`. It runs only when you choose **Run workflow**, and only if that run is on `main` (`github.ref == 'refs/heads/main'`). The environment’s branch rule is the same limit. A push to `main` does not upload. It does not run on pull requests. GitHub withholds secrets from a pull request that comes from a fork, but a pull request inside this repo would still receive repository secrets, which is why the signing secrets are not repository secrets and the workflow stays off `pull_request`.

The marketing version (`CFBundleShortVersionString` / `VITE_APP_VERSION`) is the `version` field in `package.json`. The build number (`CFBundleVersion`) is `github.run_number`. Neither is hard-coded in the workflow. The `.p8` is written only for the archive step and deleted in a later step that runs even when the archive fails (`if: always()`).

Signing uses `xcodebuild -allowProvisioningUpdates` with `-authenticationKeyPath`, `-authenticationKeyID`, and `-authenticationKeyIssuerID`. That is cloud signing ([WWDC21 session 10204](https://developer.apple.com/videos/play/wwdc2021/10204/)). It is not `fastlane match`. Apple holds the distribution key. The export uses method `app-store-connect` and destination `upload`, so the same key sends the build to TestFlight. `altool` is not used.

This public repo can use the standard `macos-latest` runner without a minutes bill. Larger runners are billed even on public repos ([billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)).

After the four secrets are saved: Actions → **TestFlight** → Run workflow. The first upload can sit in “Processing” for several minutes. The first archive on an empty runner may also create an Apple Development certificate. If later runs keep minting a new one, stop and switch to `fastlane match` with a private repo. Do not set up `MATCH_PASSWORD` or `MATCH_GIT_URL` now.

The Pages build secrets `VITE_MSAL_CLIENT_ID` and `VITE_MSAL_TENANT_ID` are separate. The TestFlight job passes them into the iOS web build when they are already set. They are not the four signing secrets.

## 5. Add the Entra redirect

**Needed before** Sign in with Microsoft works inside the installed app. The unsigned build, the camera, and the TestFlight upload do not need it. The website keeps working without it.

Use the Entra app registration the website already signs in with. Do not rename it. Do not remove the SPA redirects.

The iOS app does **not** run `@azure/msal-browser` inside the web view. A SPA redirect has to be `https` (except localhost), and this scheme is not that. The app opens the system browser (`ASWebAuthenticationSession`) as a public client, which is the same browser MSAL for iOS uses. The redirect you add is:

```text
msauth.com.pjwinstone.gardenplanting://auth
```

That string is exact. The scheme half is `msauth.com.pjwinstone.gardenplanting` and the path is `auth`. It is the value of `IOS_ENTRA_REDIRECT_URI` in `src/iosPublicConfig.ts`, the URL scheme in `ios/App/App/Info.plist`, and the default in `GardenAuthPlugin.swift`.

Entra → App registrations → the existing registration → **Authentication** → Add a platform → **iOS / macOS**.

- Bundle ID: `com.pjwinstone.gardenplanting`
- The redirect the portal shows must be `msauth.com.pjwinstone.gardenplanting://auth`

If the portal offers **Mobile and desktop applications** instead of iOS / macOS, add that same URI there and enable public client flows. Leave the SPA redirects in place:

- `http://localhost:5173/`
- `https://pjwinstone.github.io/gardenplanting/`

No client secret. Details: [mobile app configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-mobile-app-configuration), [MSAL redirect URIs for iOS](https://learn.microsoft.com/en-us/entra/msal/objc/redirect-uris-ios), and [entra-onedrive-setup.md](entra-onedrive-setup.md).

Graph scopes stay `User.Read` and `Files.ReadWrite`. The iOS sign-in also asks for `offline_access`, `openid`, and `profile` so it can refresh a token and show your name. Originals still upload to `/Garden Survey/photos/` with the same manifest as the website.

## 6. Create the TestFlight internal group

**Needed before** the phone can install a build. The upload itself can succeed without the group. Create the group before the first dispatch if you want the build to appear without a second click.

On the iPhone, install **TestFlight** from the App Store.

In App Store Connect, open Garden Planting → **TestFlight** → Internal Testing → create a group named `Paul`. Add your Account Holder user. Turn on **automatic distribution**. Internal testers are App Store Connect users, up to 100. An internal build is not sent for beta review. External testing can require review, starting with the first build you add to an external group ([overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), [add internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)).

Accept the invite in the TestFlight app. Builds last 90 days ([overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)).

You do not register the phone’s UDID. That is the ad-hoc path, which this pipeline does not use.

## What looks like it needs a Mac

| Usual Mac step | What you do instead |
|---|---|
| Install Xcode and plug in the phone | You don’t. Pull requests run an unsigned simulator build (`CODE_SIGNING_ALLOWED=NO`). You install from TestFlight. The simulator cannot see the lens. |
| Keychain Access → request a certificate | You don’t. The TestFlight workflow passes the API key to `xcodebuild`. |
| A CSR, if a run really needs one | The runner creates it. The command below is what that job would run. You do not run it on the iPhone. |
| Download a provisioning profile by hand | `-allowProvisioningUpdates` with the API key creates and downloads profiles. |
| Register the phone’s UDID | Not for TestFlight. |
| Draw the icon in Icon Composer | The project already has a 1024×1024 app icon. Xcode 14 and later can use that single image. |
| Watch the console while you tap | TestFlight crash reports are in App Store Connect, in the browser. A live console still needs a Mac. |

`fastlane match` stores a certificate in a private git repo, or in S3 or Google Cloud, unlocked with a passphrase ([match](https://docs.fastlane.tools/actions/match/)). Use it only if cloud signing keeps making a new development certificate. If that day comes, add `MATCH_PASSWORD` and `MATCH_GIT_URL` pointing at a private repo that is not this public one.

If a job must make a CSR without Keychain Access:

```bash
openssl req -nodes -newkey rsa:2048 \
  -keyout distribution.key \
  -out distribution.csr \
  -subj "/CN=Garden Planting Distribution/O=Individual/C=GB"
```

## After the first build appears

1. Open TestFlight on the iPhone and install Garden Planting.
2. If the build says **Missing Compliance**, open App Store Connect → TestFlight → the build → Provide Export Compliance Information. The project sets `ITSAppUsesNonExemptEncryption` to false, because the only encryption is HTTPS ([Xcode’s key](https://help.apple.com/xcode/mac/current/en.lproj/dev0dc15d044.html), [beta compliance](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/)). One browser answer clears a build the plist did not cover.
3. Each later upload uses a higher build number (`CFBundleVersion`). The workflow sets `CURRENT_PROJECT_VERSION` from `github.run_number` ([CFBundleVersion](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion)). The version you see in TestFlight is `package.json` `version` (`MARKETING_VERSION`), not a number typed into the workflow.

## Survey shutter

The in-app shutter is the wide back camera at 1×. It writes JPEG from `fileDataRepresentation()`. If the camera does not offer JPEG it writes HEVC and labels that file `.heic` / `image/heic`. It does not save HEVC bytes under a `.jpg` name. Tap-to-lock sets focus and exposure. Before the shutter fires, the photo connection’s rotation comes from `AVCaptureDevice.RotationCoordinator` (`videoRotationAngleForHorizonLevelCapture`), so the EXIF orientation follows how the phone was held.

Processing is pinned so one phone’s stills stay comparable:

- `photoQualityPrioritization` is `speed` on the output and on the capture settings. That skips the Smart HDR / Deep Fusion blend.
- Auto red-eye reduction is off.
- Geometric distortion correction is set **off** when the device supports it. Content-aware distortion correction is also left **off**. The photo record stores whether each was supported and whether it was enabled. The same sidecar is copied onto the OneDrive `photos/manifest.json` row.
- The shutter asks for 4032×3024 (12 MP) when the active format offers it, and records that requested size next to the delivered width and height.

A calibration matrix is not part of this still. Focal length and lens model are read from the file when the file has them. **fx is calibrated per lens and per resolution.** This shutter is 12 MP. The iPhone Camera app may shoot 24 MP of the same lens, and that frame is a different calibration. A checkerboard used to find `fx` has to be shot with this shutter, on the same lens, at this resolution.

Sign-in uses the redirect in step 5. Token refresh is one in-flight request: overlapping uploads share it.

## Device smoke test

Do this on the **TestFlight** install, at a real station (the add-point you are standing on). Use the in-app shutter. Do not use the iPhone Camera app, and do not pick the file from the library.

1. **TestFlight sign-in round trip.** Sign in with Microsoft. The system browser should open and return to the app. Sign out. Sign in again. The second sign-in should land back in the app with your account shown. A second tap while the browser is already open should join that sign-in, not show an error that sign-in is already open.
2. **Capture at the station.** Add a point and take the photo. The original should upload to `/Garden Survey/photos/`. The shutter must not crash.
3. **EXIF orientation in all four holds.** From that same station, take four stills with the rear camera. On each uploaded original, EXIF Orientation is the value for that hold, and `FocalLength` and `LensModel` are present.

| Hold | EXIF Orientation |
|---|---|
| Portrait | 6 |
| Upside down | 8 |
| Landscape, home indicator on the right | 1 |
| Landscape, home indicator on the left | 3 |

4. **A real 4032×3024 capture.** At least one of those stills is 4032×3024. That is the 12 MP shutter frame, not a 24 MP Camera.app frame. `requestedWidth` / `requestedHeight` on the photo match that size when the wide camera offered it.
5. **Distortion correction off.** In the photo metadata (`nativeCapture` on the garden photo, and the same fields on the `photos/manifest.json` row), `geometricDistortionCorrectionEnabled` is `false` and `contentAwareDistortionCorrectionEnabled` is `false`. `photoQualityPrioritization` is `speed`.
6. **Gravity sign against the maker-note tilt.** The sidecar `gravity` is CoreMotion’s device frame: +X to the right, +Y up, +Z out of the screen. Hold the phone upright and expect about `(0, −1, 0)`. Apple MakerNote `AccelerationVector` (ExifTool tag `0x0008`) points the opposite way. Negate each maker-note axis, then compare with `gravity`. They should agree after that flip. A raw match, without the negation, is the wrong sign.
