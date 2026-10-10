import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DETERMINISTIC_CAPABILITY_INVENTORY,
  getBundledDnd5eSrdPack,
  MAGIC_ITEM_OPERATION_READINESS_CAPABILITY,
  MODULE_DISPOSITIONS,
  NON_CAPABILITY_TOOLS,
  RULE_DETERMINISTIC_CAPABILITY_CONTRACTS,
  summarizeMagicItemCapabilityBacklog,
} from '../src/internal.js';
import { createDefaultToolRegistry } from '../src/orchestrator/tools.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const registry = createDefaultToolRegistry();
const toolEntries = DETERMINISTIC_CAPABILITY_INVENTORY.filter(
  (entry) => entry.surface.kind === 'tool',
);
const engineEntries = DETERMINISTIC_CAPABILITY_INVENTORY.filter(
  (entry) => entry.surface.kind === 'engine',
);

describe('deterministic capability inventory (ADR 0020 section 3)', () => {
  it('accounts for every registered tool exactly once, as a capability or a named non-capability', () => {
    const accounted = [
      ...toolEntries.map((entry) =>
        entry.surface.kind === 'tool' ? entry.surface.name : '',
      ),
      ...Object.keys(NON_CAPABILITY_TOOLS),
    ];
    expect(new Set(accounted).size).toBe(accounted.length);
    expect([...accounted].sort()).toEqual([...registry.list()].sort());
    for (const reason of Object.values(NON_CAPABILITY_TOOLS))
      expect(reason.length).toBeGreaterThan(0);
  });

  it('keeps revisions unique and references each ledger contract exactly once', () => {
    const revisions = DETERMINISTIC_CAPABILITY_INVENTORY.map(
      (entry) => entry.revision,
    );
    expect(new Set(revisions).size).toBe(revisions.length);
    const referenced = DETERMINISTIC_CAPABILITY_INVENTORY.flatMap((entry) =>
      entry.ledgerContract === undefined ? [] : [entry.ledgerContract],
    );
    expect([...referenced].sort()).toEqual(
      Object.keys(RULE_DETERMINISTIC_CAPABILITY_CONTRACTS).sort(),
    );
    expect(
      referenced.filter(
        (revision) =>
          revision === MAGIC_ITEM_OPERATION_READINESS_CAPABILITY.revision,
      ),
    ).toHaveLength(1);
  });

  it('quotes ledger contracts by reference instead of restating them', () => {
    for (const entry of DETERMINISTIC_CAPABILITY_INVENTORY) {
      if (entry.ledgerContract === undefined) continue;
      const contract = RULE_DETERMINISTIC_CAPABILITY_CONTRACTS[
        entry.ledgerContract
      ] as (typeof RULE_DETERMINISTIC_CAPABILITY_CONTRACTS)[string];
      expect(entry.revision).toBe(contract.revision);
      expect(entry.operationId).toBe(contract.operationId);
      expect(entry.operation).toBe(contract.operation);
      expect(entry.requiredInputs).toBe(contract.requiredInputs);
      expect(entry.exclusions).toBe(contract.exclusions);
      expect(entry.residualDmInterpretation).toBe(
        contract.residualDmInterpretation,
      );
      expect(entry.runtimeOwner).toBe(contract.runtimeOwner);
      expect(entry.evidence).toBe(contract.evidence);
    }
  });

  it('states every ADR 0020 section 3 field on every entry', () => {
    for (const entry of DETERMINISTIC_CAPABILITY_INVENTORY) {
      expect(entry.revision, entry.operationId).toBeTruthy();
      expect(entry.operation, entry.revision).toBeTruthy();
      expect(entry.requiredInputs.length, entry.revision).toBeGreaterThan(0);
      expect(entry.exclusions.length, entry.revision).toBeGreaterThan(0);
      expect(
        entry.residualDmInterpretation.length,
        entry.revision,
      ).toBeGreaterThan(0);
      expect(entry.runtimeOwner.length, entry.revision).toBeGreaterThan(0);
      expect(entry.evidence.length, entry.revision).toBeGreaterThan(0);
      expect(['state-integrity', 'bounded-procedure']).toContain(
        entry.category,
      );
    }
  });

  it('names each tool entry by its registered tool and covers its schema required inputs', () => {
    for (const entry of toolEntries) {
      if (entry.surface.kind !== 'tool') continue;
      const tool = registry.get(entry.surface.name);
      expect(tool, entry.revision).toBeDefined();
      expect(entry.operationId).toBe(entry.surface.name);
      for (const field of tool?.inputSchema.required ?? [])
        expect(entry.requiredInputs, entry.revision).toContain(field);
    }
  });

  it('points every runtime owner, evidence test, and engine entry point at something that exists', () => {
    for (const entry of DETERMINISTIC_CAPABILITY_INVENTORY) {
      for (const path of [...entry.runtimeOwner, ...entry.evidence])
        expect(
          existsSync(resolve(repoRoot, path)),
          `${entry.revision}: ${path}`,
        ).toBe(true);
      for (const path of entry.evidence)
        expect(path, entry.revision).toMatch(/^packages\/core\/test\/.+\.ts$/);
    }
    for (const entry of engineEntries) {
      if (entry.surface.kind !== 'engine') continue;
      const module = resolve(repoRoot, entry.surface.module);
      expect(existsSync(module), entry.revision).toBe(true);
      expect(readFileSync(module, 'utf8'), entry.revision).toContain(
        entry.surface.entryPoint,
      );
      expect(entry.runtimeOwner, entry.revision).toContain(
        entry.surface.module,
      );
    }
  });

  it('dispositions every core module file exactly once: covered by its runtime-owner entries or not a commitment, with the reason', () => {
    const sourceRoot = resolve(repoRoot, 'packages/core/src');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((dirent) =>
        dirent.isDirectory()
          ? walk(join(dir, dirent.name))
          : dirent.name.endsWith('.ts')
            ? [relative(repoRoot, join(dir, dirent.name)).replaceAll('\\', '/')]
            : [],
      );
    const modules = walk(sourceRoot)
      .filter(
        (path) =>
          path !== 'packages/core/src/index.ts' &&
          path !== 'packages/core/src/internal.ts',
      )
      .sort();
    expect(Object.keys(MODULE_DISPOSITIONS).sort()).toEqual(modules);
    for (const [path, disposition] of Object.entries(MODULE_DISPOSITIONS)) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(true);
      const owners = DETERMINISTIC_CAPABILITY_INVENTORY.filter((entry) =>
        entry.runtimeOwner.includes(path),
      ).map((entry) => entry.revision);
      if (disposition.disposition === 'covered') {
        expect(owners.length, path).toBeGreaterThan(0);
        expect([...disposition.by].sort(), path).toEqual([...owners].sort());
      } else {
        expect(owners, path).toEqual([]);
        expect(disposition.reason.length, path).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the inventory bounded: no universal completeness claim in any statement', () => {
    for (const entry of DETERMINISTIC_CAPABILITY_INVENTORY) {
      const text = [
        entry.operation,
        ...entry.exclusions,
        ...entry.residualDmInterpretation,
      ].join('\n');
      expect(text, entry.revision).not.toMatch(
        /\b(complete(ly)? (implement|cover)|all rules|every rule)\b/i,
      );
    }
  });
});

describe('legacy magic-item capability backlog summary', () => {
  const records = getBundledDnd5eSrdPack().records;
  const summary = summarizeMagicItemCapabilityBacklog(records);

  it('is an unselected candidate backlog, computed from the pack by query', () => {
    expect(summary.disposition).toBe('unselected-candidate-backlog');
    expect(summary.nonClaim).toMatch(/not counted as implemented/i);
    expect(summary.nonClaim).toMatch(/not counted as absent/i);
    expect(summary.records).toBe(
      records.filter((record) => record.kind === 'magic-item').length,
    );
  });

  it('is structurally consistent and non-negative', () => {
    const counts = [
      summary.records,
      summary.recordsWithReadiness,
      summary.clauses,
      summary.enginePendingClauses,
      summary.hookCarryingClauses,
      summary.enginePendingHookCarryingClauses,
    ];
    for (const count of counts) {
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);
    }
    expect(summary.recordsWithReadiness).toBeLessThanOrEqual(summary.records);
    expect(summary.enginePendingClauses).toBeLessThanOrEqual(summary.clauses);
    expect(summary.hookCarryingClauses).toBeLessThanOrEqual(summary.clauses);
    expect(summary.enginePendingHookCarryingClauses).toBeLessThanOrEqual(
      Math.min(summary.enginePendingClauses, summary.hookCarryingClauses),
    );
    expect(summary.records).toBeGreaterThan(0);
  });

  it('counts only magic-item records and ignores other kinds', () => {
    const other = records.filter((record) => record.kind !== 'magic-item');
    const empty = summarizeMagicItemCapabilityBacklog(other);
    expect(empty.records).toBe(0);
    expect(empty.clauses).toBe(0);
  });
});
