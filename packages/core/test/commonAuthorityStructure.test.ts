import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

// Common authority is the documentation a contributor or agent must load before
// working here: CLAUDE.md, which a Claude Code session reads first, and
// AGENTS.md, which owns the guidance it points to.
//
// This file observes only whether that authority stays REACHABLE. What it says
// is owned by the authority hierarchy, the owning Bead or accepted design, and
// semantic-system review of any change to it. A test restating policy prose
// cannot show that a later version of the policy is correct — an authorized bad
// edit updates document and assertion together, while an equivalent rewording
// breaks the assertion.
//
// Reachability is different in kind: it fails silently, survives review of a
// diff that looks fine in isolation, and is machine-checkable without encoding
// any sentence.

const AUTHORITY_DOCUMENTS = ['AGENTS.md', 'CLAUDE.md'];

// Both ways Markdown names a link target: inline — [label](target "title") —
// and a reference definition — [label]: target "title". Reading only the inline
// form would let the guard pass while checking nothing, because rewriting the
// links in the other form renders identically.
const LINK_TARGET = [
  /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g,
  /^\[[^\]]+\]:\s*(\S+)/gm,
];

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

/**
 * Link targets that name a file in this repository, so a missing one is a
 * broken repository reference rather than someone else's dead URL. External
 * URLs and bare fragments are not repository structure and are left alone.
 */
function repositoryLinkTargets(document: string): string[] {
  const text = readText(document);
  const targets: string[] = [];

  for (const pattern of LINK_TARGET) {
    for (const [, target] of text.matchAll(pattern)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) {
        continue;
      }

      const [path] = target.split('#');

      if (path !== '') {
        targets.push(normalize(join(dirname(document), path)));
      }
    }
  }

  return targets;
}

describe('common authority structure', () => {
  it('keeps CLAUDE.md loading AGENTS.md', () => {
    // The import is the mechanism, not a statement about one. Without it a
    // session never loads repository authority at all, however carefully either
    // document is worded.
    expect(readText('CLAUDE.md')).toContain('@AGENTS.md');
  });

  it('resolves every repository document common authority points to', () => {
    const missing: string[] = [];
    const checked: string[] = [];

    for (const document of AUTHORITY_DOCUMENTS) {
      for (const target of repositoryLinkTargets(document)) {
        checked.push(`${document} -> ${target}`);

        if (!existsSync(join(process.cwd(), target))) {
          missing.push(`${document} -> ${target}`);
        }
      }
    }

    // An empty result would otherwise be indistinguishable from a clean one, so
    // a link syntax this file cannot read has to fail rather than quietly check
    // nothing. Common authority always points somewhere.
    expect(checked.length).toBeGreaterThan(0);

    // An obligation nobody can follow is not an obligation. This holds whatever
    // the links are called and wherever their targets move to, so renaming a
    // document or relabelling a link passes as long as the pointer is updated
    // with it.
    expect(missing).toEqual([]);
  });
});
