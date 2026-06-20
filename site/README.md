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
