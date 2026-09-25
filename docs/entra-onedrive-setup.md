# Entra ID + OneDrive setup (Garden Survey)

Stage 1 persistence: sign in with Microsoft (MSAL SPA), then save/load `garden.json` to OneDrive via Microsoft Graph.

**Canonical OneDrive path:** `/Garden Survey/garden.json` under the signed-in user's OneDrive (not the app-data folder). The app also keeps **localStorage** as an offline cache; **Export / Import** remain as backup.

**Hosted app URL (GitHub Pages):** https://pjwinstone.github.io/gardenplanting/

---

## 1. Register a single-page application in Entra

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) (or Azure Portal → **Microsoft Entra ID**).
2. Go to **App registrations** → **New registration**.
3. Name: e.g. `Garden Survey`.
4. **Supported account types:** choose what matches your account:
   - Personal Microsoft + work/school → **Accounts in any organisational directory and personal Microsoft accounts** (maps to tenant `common`).
   - Or restrict to your single tenant if you prefer (then use that **Directory (tenant) ID**).
5. **Redirect URI** — platform **Single-page application (SPA)**:
   - Local: `http://localhost:5173/`
   - Pages: `https://pjwinstone.github.io/gardenplanting/`
6. Register.

### Copy these values (paste back to the project)

| What | Where in Entra | Env / secret name |
|------|----------------|-------------------|
| **Application (client) ID** | Overview | `VITE_MSAL_CLIENT_ID` |
| **Directory (tenant) ID** | Overview — or use the literal `common` for multi-tenant + personal | `VITE_MSAL_TENANT_ID` |

You do **not** need a client secret for this SPA (public client + PKCE).

---

## 2. API permissions

App registration → **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**:

| Permission | Why |
|------------|-----|
| `User.Read` | Show who is signed in |
| `Files.ReadWrite` | Create `/Garden Survey/` and read/write `garden.json` |

Click **Grant admin consent** if your tenant requires it (personal Microsoft accounts usually consent at first sign-in; work/school tenants may need an admin).

**Authentication** tip: under **Authentication**, ensure both SPA redirect URIs above are listed. Enable **ID tokens** if the portal offers the checkbox for the SPA platform (access tokens for Graph are requested at runtime with scopes).

---

## 3. Environment variables

### Local development (`.env.local` — not committed)

```bash
cp .env.example .env.local
```

```env
VITE_MSAL_CLIENT_ID=<Application (client) ID>
VITE_MSAL_TENANT_ID=common
VITE_MSAL_REDIRECT_URI=http://localhost:5173/
```

Then `npm run dev` and open the redirect URI host/port you registered.

### GitHub Actions → Pages

Repo → **Settings** → **Secrets and variables** → **Actions** → add repository secrets:

| Secret | Typical value |
|--------|----------------|
| `VITE_MSAL_CLIENT_ID` | Application (client) ID |
| `VITE_MSAL_TENANT_ID` | `common` or your tenant GUID |
| `VITE_MSAL_REDIRECT_URI` | `https://pjwinstone.github.io/gardenplanting/` |

The workflow `.github/workflows/deploy-pages.yml` injects these at build time. Until secrets exist, the site still deploys; the Microsoft panel shows that sign-in is not configured, and local export/import still works.

---

## 4. Enable GitHub Pages

1. Repo **Settings** → **Pages**.
2. **Source:** GitHub Actions (not “Deploy from a branch”).
3. Push to `main` (or run **Deploy GitHub Pages** manually). First deploy may need you to approve the `github-pages` environment.
4. Open https://pjwinstone.github.io/gardenplanting/ on the phone (HTTPS required for a reliable PWA / MSAL redirect).

Vite `base` is `/gardenplanting/` for this project site.

---

## 5. What you must paste back

Only you can create the Entra app. Send (or set as secrets):

1. **Application (client) ID**
2. **Tenant** — either `common` or your **Directory (tenant) ID**
3. Confirm redirect URIs include local + Pages URLs above

No client secret is required for Stage 1.
