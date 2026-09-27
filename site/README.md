# site/ — eshyra.app static site

The `eshyra.app` project site and essay collection. Presents Eshyra as early pre-release and offers
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
- `src/agentic-anti-patterns.html.tmpl` → `dist/agentic-anti-patterns/index.html`
  (served at `/agentic-anti-patterns/`) — an essay, linked from the homepage.
  Its title, subheading, and body are approved publication copy: change
  presentation only, never the words.

## Presentation conventions

The midnight palette keeps terminal details in navigation and metadata. Article
bodies use opaque backgrounds and proportional system serif type, with no
scanlines, flicker, remote fonts, client JavaScript, or framework dependencies.

- `src/essays.html.tmpl` → `dist/essays/index.html` lists published essays.
- `header.html.tmpl`, `footer.html.tmpl`, and `essay-cards.html.tmpl` are shared
  build-time fragments, not pages. The homepage features the current two essays;
  future additions can move to the index without extending the homepage.
- Article templates include `{{ARTICLE_CONTENTS}}`. The builder derives desktop
  and mobile navigation from their existing `<h2 id="...">` headings and adds
  self-links to those headings. Keep IDs stable. Desktop shows a scrollable,
  sticky contents rail; mobile uses a native collapsed disclosure. Both work
  without JavaScript. Preserve article wording when changing presentation.
- The `/making-of/` story-series work remains owned by `eshyra-ss08.1`; this
  redesign does not publish planned stories or change that series' scope.

For a presentation change, build with `node site/build.mjs` and inspect the
homepage, essay index, and both articles on desktop and narrow mobile widths.
Check contents links, keyboard focus, disclosures, download and attribution
links, and compare published article text with the previous version. The normal
repository verification gate still applies.
