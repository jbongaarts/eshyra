import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

// The character registry owns a separate SQLite database. Its records and
// events never enter campaign checkpoint snapshots or turn replay snapshots;
// those tables are created/used only by CharacterChronicleStore. Its rowid
// tiebreak therefore remains stable within its own store and is not part of
// the campaign restore-order contract.
const rowidAllowlist = new Map([
  [
    'character/characterChronicle.ts',
    'separate character registry DB; not checkpointed or replayed',
  ],
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.name.endsWith('.ts')
        ? [path]
        : [];
  });
}

describe('SQL rowid usage guard', () => {
  it('allows only documented consumers outside campaign restore state', () => {
    const occurrences = sourceFiles(sourceRoot).flatMap((path) => {
      const relativePath = relative(sourceRoot, path).replaceAll('\\', '/');
      const stringLiterals = readFileSync(path, 'utf8').matchAll(
        /`[\s\S]*?`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g,
      );
      return [...stringLiterals].some(([literal]) =>
        /\browid\b/i.test(literal.replace(/\$\{[^}]*\}/g, '')),
      )
        ? [{ file: relativePath }]
        : [];
    });
    const unexpected = occurrences.filter(
      (entry) => !rowidAllowlist.has(entry.file),
    );
    expect(unexpected).toEqual([]);
    expect([...rowidAllowlist.entries()]).toEqual([
      [
        'character/characterChronicle.ts',
        'separate character registry DB; not checkpointed or replayed',
      ],
    ]);
  });
});
