# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest `main`, deployed to the live Pages site | Yes |
| Older commits, forks, and local development builds | No |

The supported release is whatever is on **`main`** right now. That commit is what GitHub Pages serves at <https://pjwinstone.github.io/gardenplanting/>. There is no separately versioned server release.

## Reporting a vulnerability

Report security issues privately. Please do not open a public GitHub issue for a suspected vulnerability.

Use **GitHub private vulnerability reporting** (Security Advisories):

<https://github.com/pjwinstone/gardenplanting/security/advisories/new>

That opens a draft security advisory visible to the maintainers, not the public issue tracker. Include what you found, how to reproduce it, and the impact you expect. If private reporting is unavailable on the repository, contact the maintainer through GitHub and ask them to open an advisory.

## Scope

**In scope**

- The Garden Planting client (the static PWA in this repository): session handling in the browser, survey data stored in `localStorage`, and how the app talks to Microsoft Graph.
- The GitHub Actions workflows that test this repo and deploy it to GitHub Pages.
- A bug that lets someone else read or change a user's garden survey through this app.

**Out of scope**

- Microsoft Entra, Microsoft Graph, OneDrive, or GitHub Pages themselves.
- The signed-in user's own Microsoft account, device, or OneDrive contents.
- Social-engineering the person holding the phone.

## Public client identifiers

Garden Planting is a **client-side PWA**. Microsoft sign-in uses MSAL in the browser as a public client (authorization code + PKCE). There is no backend and no client secret.

The Entra **application (client) ID** and the tenant authority **`common`** are public identifiers. The Pages build embeds them so the browser can start the sign-in flow. They are not secrets. Finding them in the built JavaScript, in Actions logs, or in this repository is expected. Do not send a client secret; this app does not use one.
