# site/ — eshyra.app static site

The `eshyra.app` landing page. Presents Eshyra as under construction and offers
the D&D 5e SRD 5.1 rules pack (CC BY 4.0) as a standalone download.

This site has its **own release cycle**, independent of the Eshyra application.
It is intentionally **not** part of the npm workspaces and not wired into the
application build.

```bash
node build.mjs            # generate ./dist (static HTML + rules-pack ZIP)
npx --yes serve dist      # preview locally
```

- Source: `src/` (HTML/CSS) + `build.mjs` (assembles the download, injects
  metadata).
- Output: `dist/` (generated, git-ignored, rebuilt on every deploy).
- Hosting + CI + credential setup: see
  [`../docs/site-deployment.md`](../docs/site-deployment.md).

## Pages

`build.mjs` renders each registered HTML template in `src/` through one shared
substitution table (record counts, pack size, source hash, build date), so page
metadata cannot drift apart. Templates are registered explicitly with
`renderTemplate(...)` calls; add a page by adding a template and one such call —
no framework, bundler, static-site generator, or automatic template discovery is
involved.

- `src/index.html.tmpl` → `dist/index.html` — the landing page + download.
- `src/rules-pack.html.tmpl` → `dist/rules-pack/index.html` (served at
  `/rules-pack/`) — a long-form engineering article on why the rules pack
  exists and how the source-grounded rules compiler / executable-curation
  pipeline that produces it works. It links to and from the homepage download
  section. See `docs/rules-pack-compiler.md`, ADR 0017, and ADR 0007 for the
  canonical architecture the article narrates.
