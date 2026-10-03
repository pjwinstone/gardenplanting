# Set up iOS builds without a Mac

Browser and iPhone only. No Xcode on your desk. This prepares the accounts. It does not add the app or the GitHub workflow. Those come later. The decision note is [IOS_APP_OPTIONS.md](IOS_APP_OPTIONS.md).

You will enrol as an individual, create an API key, register a bundle id, create the App Store Connect record, add yourself as an internal TestFlight tester, paste four GitHub secrets, and add one redirect to the existing Entra app.

Replace every placeholder. Use the same bundle id in every step.

| Placeholder | Example | Where you get the real value |
|---|---|---|
| `<APP_BUNDLE_ID>` | `com.<yourname>.gardenplanting` | You invent the `<yourname>` part. Reverse-DNS, letters, digits, dots. It cannot be changed later. |
| `<APPLE_TEAM_ID>` | `A1B2C3D4E5` | Membership page, after enrolment. Ten characters. |
| `<KEY_ID>` | `AB12CD34EF` | Shown next to the API key. |
| `<ISSUER_ID>` | a UUID | Top of the App Store Connect API page. |
| `<APP_SKU>` | `garden-planting-ios` | Only Apple and you see it. |

## 1. Enrol in the Apple Developer Program

Do this as an **individual**, not an organisation. An organisation needs a D‑U‑N‑S number and extra checks. Your legal name becomes the seller name if the app is ever on the public store. TestFlight does not publish that.

Use the **Apple Developer** app on the iPhone. That is the smoother path: the ID photo and the payment happen on the phone, and you already have the device. Enrolment on the web also works. In India the app is the only route. Some regions cannot enrol at all ([program enrolment](https://developer.apple.com/help/account/membership/program-enrollment), [enrolling in the app](https://developer.apple.com/help/account/membership/enrolling-in-the-app)).

You need:

- The Apple Account you want as Account Holder, with two-factor authentication on.
- Your legal name, address, and phone number. Not a nickname, and not a company name in the name fields.
- Face ID, Touch ID, or a passcode on the phone. Stay on that same phone until enrolment finishes.
- 99 USD for the year, in local currency. In the app this is an auto-renewable subscription. On the web you pay at checkout. The price is on [what’s included](https://developer.apple.com/programs/whats-included/).

In the Apple Developer app: Account → Enrol. When it asks, photograph a government photo ID. Apple accepts a passport in most regions. Some regions also accept a driving licence ([identity verification](https://developer.apple.com/help/account/membership/identity-verification)). Which extra documents the UK asks for is not spelled out beyond that. If it asks, send what it asks.

After you pay, Apple says the confirmation email should arrive within 24 hours. If it does not, contact Developer Support and include the Enrollment ID ([program enrolment](https://developer.apple.com/help/account/membership/program-enrollment)). A photo-ID check can make this longer than 24 hours. Nothing else in this guide works until the membership is active.

Then open [Account](https://developer.apple.com/account) in the browser and copy **Team ID** into `<APPLE_TEAM_ID>`.

A free Apple Account is not a substitute. It cannot upload to TestFlight.

## 2. Create the App Store Connect API key

In the browser: [App Store Connect](https://appstoreconnect.apple.com) → Users and Access → Integrations → App Store Connect API. Apple’s guide is [Creating API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api). The page layout moves; if “Integrations” is missing, look for “Keys” under Users and Access.

1. Copy the **Issuer ID** at the top. That is `<ISSUER_ID>`.
2. Generate a key. Name: `Garden Planting CI`. Access: **Admin**.
3. Download the `.p8` file. Apple shows it **once**. If you close the page without downloading, revoke that key and make another. You cannot retrieve it.
4. Copy the **Key ID**. That is `<KEY_ID>`.

Admin is the role to use because cloud signing creates profiles and may create a certificate. Whether App Manager is enough for that is not clearly stated. Do not pick Developer, Marketing, or a key limited to notarisation.

Keep the `.p8` only until step 6. Then delete the download from the phone or the computer you used. GitHub will hold the copy.

## 3. Register the bundle id

Browser: [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) → Identifiers → **+** → App IDs → App → Continue.

- Description: `Garden Planting`
- Bundle ID: Explicit, `<APP_BUNDLE_ID>`
- Capabilities: leave them **off**

Camera, motion, and photo-library access are not capabilities. They are usage strings the project puts in Info.plist (`NSCameraUsageDescription`, `NSMotionUsageDescription`). The `msauth.` URL scheme is also Info.plist, not a checkbox here. Sign in with Apple, Push Notifications, and Associated Domains stay off.

Register. This page does not need a Mac.

## 4. Create the app in App Store Connect

Browser: [My Apps](https://appstoreconnect.apple.com/apps) → **+** → New App. Apple’s steps: [Add a new app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app).

- Platforms: iOS
- Name: `Garden Planting` (if that name is taken, add a suffix; the name must be unique on the store)
- Primary language: English (U.K.)
- Bundle ID: the one you just registered
- SKU: `<APP_SKU>`
- User access: Full access

You do not submit the app for review. The record only has to exist so TestFlight has somewhere to put a build.

## 5. Add yourself as an internal tester

On the iPhone, install **TestFlight** from the App Store.

In App Store Connect, open the app → **TestFlight** → Internal Testing → create a group named `Paul`. Add your Account Holder user. Turn on **automatic distribution** so a later upload does not wait for a second click. Internal testers are App Store Connect users, up to 100. An internal build is not sent for beta review. External testing can require review, starting with the first build you add to an external group ([overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), [add internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)).

Accept the invite in the TestFlight app on the survey iPhone. There is no build yet. The app will say so. That is fine.

Builds last 90 days ([overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)).

## 6. Add the GitHub secrets

Repo → **Settings** → Secrets and variables → **Actions** → Repository secrets. You need admin on the repo. Names must match exactly. [How secrets work](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions).

| Name | Value |
|---|---|
| `APP_STORE_CONNECT_KEY_ID` | `<KEY_ID>` |
| `APP_STORE_CONNECT_ISSUER_ID` | `<ISSUER_ID>` |
| `APP_STORE_CONNECT_KEY_P8` | The whole `.p8` file, including the `BEGIN PRIVATE KEY` and `END PRIVATE KEY` lines |
| `APPLE_TEAM_ID` | `<APPLE_TEAM_ID>` |

Paste the `.p8` as the secret value. A multi-line secret is allowed. Do not base64 it unless a future workflow says so. Do not commit the file.

The signing workflow, when it exists, runs only on a push to `main` and on **Run workflow** (`workflow_dispatch`). It must not run on pull requests. GitHub already withholds secrets from a pull request that comes from a fork. A pull request inside this repo would still receive them, which is why the workflow stays off `pull_request`. Only someone with write access can start `workflow_dispatch`.

This public repo can use the standard `macos-latest` runner without a minutes bill. Larger runners are billed even on public repos ([billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)).

There is no workflow to run today. When it lands, Actions → the signing workflow → Run workflow. The first upload can sit in “Processing” for several minutes before TestFlight offers it.

## 7. Add the OneDrive redirect

Use the Entra app registration the website already signs in with. Leave its name as it already appears in the portal. Add a platform. Do not remove the GitHub Pages redirect. The OneDrive folder stays `/Garden Survey/`. That folder name is legacy and is kept so existing files stay put.

Entra → App registrations → the existing registration → **Authentication** → Add a platform → **iOS / macOS**.

Bundle ID: `<APP_BUNDLE_ID>`

The redirect it shows must be exactly:

```text
msauth.<APP_BUNDLE_ID>://auth
```

Example, if the bundle id is `com.<yourname>.gardenplanting`:

```text
msauth.com.<yourname>.gardenplanting://auth
```

Also add that same string under Mobile and desktop applications if the iOS button did not. Enable public client flows if the page asks. Leave the SPA redirects (`http://localhost:5173/` and `https://pjwinstone.github.io/gardenplanting/`) in place. No client secret. Details: [mobile app configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-mobile-app-configuration), [MSAL redirect URIs](https://learn.microsoft.com/en-us/entra/msal/objc/redirect-uris-ios), and [entra-onedrive-setup.md](entra-onedrive-setup.md).

The URL scheme inside the app is project work, not a second portal click.

## What looks like it needs a Mac

| Usual Mac step | What you do instead |
|---|---|
| Install Xcode and plug in the phone | You don’t. GitHub’s macOS runner has Xcode. You install from TestFlight. |
| Keychain Access → Certificate Assistant → Request a Certificate | You don’t. Distribution signing uses the API key: `xcodebuild -allowProvisioningUpdates -authenticationKeyPath <path> -authenticationKeyID <KEY_ID> -authenticationKeyIssuerID <ISSUER_ID>` ([WWDC21 session 10204](https://developer.apple.com/videos/play/wwdc2021/10204/)). Apple keeps the distribution key. |
| A CSR, if a run really needs one | The runner creates it. The command below is what that job runs. You do not run it on the iPhone. |
| Download a provisioning profile by hand | The same `xcodebuild` flags create and download profiles. The developer site can also create one in the browser once a certificate exists. |
| Register the phone’s UDID | Not for TestFlight. UDID registration is the ad-hoc path, which we are not using. |
| App icons in Icon Composer | The project commits one 1024×1024 PNG. Xcode 14 and later can use that single image. If a later Xcode insists on a full set, the CI log will say so and the fix stays in the repo. |
| Watch the console while you tap | TestFlight crash reports are in App Store Connect, in the browser. A live console still needs a Mac. This pipeline does not have one. |

`fastlane match` is the other signing tool. It builds the certificate itself and stores it encrypted in a **private** git repo, or in S3 or Google Cloud, unlocked with a passphrase ([match](https://docs.fastlane.tools/actions/match/)). Use it only if cloud signing keeps making a new development certificate. If that day comes, add two more secrets, `MATCH_PASSWORD` and `MATCH_GIT_URL`, pointing at a private repo that is not this public one. Do not set those up now.

If a job must make a CSR without Keychain Access, this is the command. It writes a key and a request in the current directory. Keep the key private.

```bash
openssl req -nodes -newkey rsa:2048 \
  -keyout distribution.key \
  -out distribution.csr \
  -subj "/CN=Garden Planting Distribution/O=Individual/C=GB"
```

## After the first build appears

1. Open TestFlight on the iPhone and install Garden Planting.
2. If the build says **Missing Compliance**, open it in App Store Connect → TestFlight → the build → Provide Export Compliance Information. The project should set `ITSAppUsesNonExemptEncryption` to false, because the only encryption is HTTPS ([Xcode’s key](https://help.apple.com/xcode/mac/current/en.lproj/dev0dc15d044.html), [beta compliance](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/)). One browser answer clears a build the plist did not cover.
3. Each later upload must use a higher build number (`CFBundleVersion`). The workflow uses the GitHub run number so you do not edit it by hand ([CFBundleVersion](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion)).

The camera check happens on that TestFlight build. The Simulator in CI cannot see the lens.
