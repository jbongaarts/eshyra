# eshyra.app site — build & deployment

The `eshyra.app` marketing/landing site is a lightweight static site that
presents Eshyra as under construction while prominently offering the D&D 5e
SRD 5.1 rules pack (CC BY 4.0) as a standalone download.

It lives in [`site/`](../site) and **has its own release cycle, fully decoupled
from the Eshyra application.** The application ships from `release.yml` on `v*`
tags; the site ships from `site-deploy.yml` and never rides an app release.

- **Hosting:** Cloudflare Pages (free tier).
- **Pipeline:** GitHub Actions (`.github/workflows/site-deploy.yml`).
- **Output:** static HTML/CSS plus a generated rules-pack ZIP. No application
  code, no server, no proprietary or non-CC assets are published — only
  `site/src/` and the CC BY rules-pack data under
  `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`.

## What gets built

`node site/build.mjs` produces `site/dist/`:

- `index.html`, `styles.css`, `_headers`, `robots.txt` — copied from
  `site/src/`, with rules-pack metadata (record count, size, hashes) injected
  into the page at build time.
- `downloads/eshyra-srd-5.1-rules-pack.zip` — `manifest.json` + `records.json`
  + `ATTRIBUTION.txt` + `README.md`, assembled from the committed rules pack.
- `downloads/eshyra-srd-5.1-rules-pack.zip.sha256` — checksum.

The build is dependency-free: Node 24 built-ins plus the `zip` CLI (preinstalled
on GitHub `ubuntu-latest` runners). There is no npm install step for the site.

### Build and preview locally

```bash
node site/build.mjs
# preview the static output however you like, e.g.:
npx --yes serve site/dist   # or: python3 -m http.server -d site/dist 8000
```

`site/dist/` is generated and git-ignored; it is rebuilt on every deploy.

## Release cycle / triggers

`site-deploy.yml` runs on:

| Trigger | Effect |
| --- | --- |
| Push a `site-v*` tag (e.g. `site-v1`, `site-v2026.06.19`) | Build **and** deploy to production |
| Manual **Run workflow** (`workflow_dispatch`) | Build **and** deploy to production |
| Pull request touching `site/**` or the rules-pack data | Build only — validates, never deploys |

Cut a site release:

```bash
git tag site-v2026.06.19
git push origin site-v2026.06.19
```

…or open the **Actions → Site deploy** workflow in GitHub and click **Run
workflow**.

## One-time Cloudflare + GitHub credential setup

You only do this once. After that, deploys are just a tag push or a manual run.

### 1. Create the Cloudflare Pages project

1. Sign in (or sign up free) at <https://dash.cloudflare.com>.
2. Go to **Workers & Pages → Create → Pages → Create using direct upload**.
3. Name the project **`eshyra-site`** (this must match `--project-name` in the
   workflow and `name` in `site/wrangler.toml`). You can upload an empty
   placeholder to finish creation; the workflow will overwrite it on the first
   real deploy.

> Alternatively the project is created automatically on the first
> `wrangler pages deploy` if your API token has Pages:Edit — but creating it in
> the dashboard first lets you confirm the name and attach the domain up front.

### 2. Find your Cloudflare Account ID

On the dashboard, open **Workers & Pages**; the **Account ID** is shown in the
right-hand sidebar. (Or run `npx wrangler whoami` while logged in.) This is the
value for the `CLOUDFLARE_ACCOUNT_ID` secret — it is not secret-sensitive, but
we store it as a secret for convenience.

### 3. Create a scoped Cloudflare API token

1. Go to **My Profile → API Tokens → Create Token**
   (<https://dash.cloudflare.com/profile/api-tokens>).
2. Use the **Edit Cloudflare Workers** template, **or** create a custom token
   with the minimum permission for Pages:
   - **Account → Cloudflare Pages → Edit**
3. Under **Account Resources**, scope it to the specific account that owns the
   `eshyra-site` project (not "All accounts").
4. Create the token and **copy it now** — Cloudflare shows it only once. This is
   the value for `CLOUDFLARE_API_TOKEN`.

> Least privilege: the token only needs Pages:Edit. Do not use a Global API Key.
> If the token leaks, revoke it on the same API Tokens page and issue a new one.

### 4. Add the two secrets to the GitHub repository

The workflow reads exactly two repository secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the scoped token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | the account id from step 2 |

With the GitHub CLI (it prompts for the value, so nothing is written to your
shell history):

```bash
gh secret set CLOUDFLARE_API_TOKEN   --repo jbongaarts/eshyra
gh secret set CLOUDFLARE_ACCOUNT_ID  --repo jbongaarts/eshyra
```

Or in the browser: **Repository → Settings → Secrets and variables → Actions →
New repository secret**, once for each name above.

To rotate later, run the same `gh secret set` command (or revoke the Cloudflare
token and create a new one, then update the secret).

### 5. Point eshyra.app at the Pages project

1. Add `eshyra.app` as a zone in Cloudflare (**Add a site**) and update the
   domain's nameservers at your registrar to the ones Cloudflare assigns.
2. In the **`eshyra-site`** Pages project, open **Custom domains → Set up a
   custom domain**, add `eshyra.app` (and `www.eshyra.app` if desired).
   Cloudflare provisions the HTTPS certificate automatically.

Until DNS is live, deploys are still reachable at the project's
`*.pages.dev` URL.

## First deploy checklist

1. Secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set
   (step 4).
2. Pages project `eshyra-site` exists (step 1).
3. Trigger a deploy: push a `site-v*` tag or run the workflow manually.
4. Confirm the run is green and the `*.pages.dev` URL (and, once DNS is live,
   `https://eshyra.app`) serves the page with a working rules-pack download.
