import { describe, expect, it } from 'vitest';
import type { RulesPack } from '../../src/internal.js';
import {
  buildContextPacket,
  bundledDnd5eSrdFieldProvenanceSource,
  classifyFieldPointer,
  getBundledDnd5eSrdFieldProvenanceManifest,
  getBundledDnd5eSrdPack,
  PATHFINDER2E_REMASTER_RULES_PACK,
  renderContextPacketMessage,
  resolveRulesStack,
  retainCandidates,
} from '../../src/internal.js';

/**
 * PR #543 re-review finding 1: a field-provenance manifest may attest ONLY the
 * values produced by the artifact it describes.
 *
 * The previous revision handed one manifest to the whole resolved stack and
 * classified by `RulesRecordKind`, so an add-on, a custom resolver result, or
 * a foreign-system pack reusing familiar kinds inherited the SRD importer's
 * authority over content it never produced. These cases attack the ASSOCIATION
 * MECHANISM itself — object identity against the cached bundled pack — rather
 * than re-asserting the classifications that mechanism then yields.
 */

const SOURCE_PROSE_HEADING = '### Source prose (verbatim; authoritative)';

/** A pack that is metadata-identical to the bundled SRD pack but is a
 * different artifact carrying different content. */
function aliasOfBundledSrd(overrides: Partial<RulesPack> = {}): RulesPack {
  const real = getBundledDnd5eSrdPack();
  return {
    meta: { ...real.meta },
    records: real.records.slice(0, 1).map((record) => ({
      ...record,
      data: { description: 'CONTENT THE SRD IMPORTER NEVER PRODUCED' },
    })),
    ...overrides,
  };
}

describe('field-provenance is bound to the producing pack', () => {
  const source = bundledDnd5eSrdFieldProvenanceSource();

  it('answers for the canonical bundled pack', () => {
    expect(source(getBundledDnd5eSrdPack())).toBe(
      getBundledDnd5eSrdFieldProvenanceManifest(),
    );
  });

  it('refuses a pack that merely reproduces the bundled metadata', () => {
    const alias = aliasOfBundledSrd();
    // Every metadata route the review forbids is satisfied by this pack.
    expect(alias.meta.packId).toBe(getBundledDnd5eSrdPack().meta.packId);
    expect(alias.meta.version).toBe(getBundledDnd5eSrdPack().meta.version);
    expect(alias.meta.systemId).toBe(getBundledDnd5eSrdPack().meta.systemId);
    expect(alias.records[0].kind).toBe(
      getBundledDnd5eSrdPack().records[0].kind,
    );
    // ... and it still gets nothing, because it is not that artifact.
    expect(source(alias)).toBeUndefined();
  });

  it('refuses a shallow copy of the real pack object', () => {
    // Structurally equal, same records by reference, different object. A
    // deep-equality or metadata association would accept this; identity does
    // not, and identity is the question actually being asked.
    const real = getBundledDnd5eSrdPack();
    expect(source({ ...real })).toBeUndefined();
  });

  it('refuses a different base system with overlapping record kinds', () => {
    const pf2e = PATHFINDER2E_REMASTER_RULES_PACK;
    // The overlap is real: PF2e reuses kinds the SRD manifest declares.
    const srdKinds = new Set(
      getBundledDnd5eSrdPack().records.map((record) => record.kind),
    );
    expect(pf2e.records.some((record) => srdKinds.has(record.kind))).toBe(true);
    expect(source(pf2e)).toBeUndefined();
  });
});

/**
 * The same question end to end, through the real packet builder: what a
 * record's producing pack is decides which heading its content may appear
 * under.
 */
describe('packet classification follows the producing pack', () => {
  function packetFor(
    base: RulesPack,
    addons: readonly RulesPack[] = [],
    only?: readonly string[],
  ) {
    const stack = resolveRulesStack({ base, addons: [...addons] });
    const all = [...stack.recordsByKey.values()];
    const entries =
      only === undefined
        ? all.slice(0, 8)
        : all.filter((entry) => only.includes(entry.record.key));
    const candidates = entries.map((entry) => ({
      candidateKey: entry.record.key,
      targetKind: 'rules-record' as const,
      entry,
      routes: [
        {
          routeClass: 'explicit-name-or-alias' as const,
          trigger: 'test',
          evidence: {},
          signalId: 'signal-0',
        },
      ],
      traversals: [],
      campaignRules: [],
      campaignRulings: [],
    }));
    return buildContextPacket(
      retainCandidates(candidates),
      [],
      512_000,
      bundledDnd5eSrdFieldProvenanceSource(),
    );
  }

  it('classifies real bundled SRD records', () => {
    const trace = packetFor(getBundledDnd5eSrdPack());
    const classified = trace.packet.candidates.filter(
      (item) =>
        Object.keys((item.sourceProse as { data: object }).data).length > 0 ||
        Object.keys((item.sourceDerived as { data: object }).data).length > 0 ||
        Object.keys((item.projection as { data: object }).data).length > 0,
    );
    expect(classified.length).toBeGreaterThan(0);
    // Nothing from the canonical pack falls through to unattested.
    for (const item of trace.packet.candidates)
      expect((item.unattested as { data: object }).data).toEqual({});
  });

  it('does not let a foreign-system pack inherit the SRD manifest', () => {
    const trace = packetFor(PATHFINDER2E_REMASTER_RULES_PACK);
    expect(trace.packet.candidates.length).toBeGreaterThan(0);
    for (const item of trace.packet.candidates) {
      expect((item.sourceProse as { data: object }).data).toEqual({});
      expect((item.sourceDerived as { data: object }).data).toEqual({});
      expect((item.projection as { data: object }).data).toEqual({});
      // The content is still delivered — labelled, never dropped.
      expect(
        Object.keys((item.unattested as { data: object }).data).length,
      ).toBeGreaterThan(0);
    }
    const text = renderContextPacketMessage({
      retention: { overflow: [] },
      packet: {
        packet: trace.packet,
        byteOverflow: trace.byteOverflow,
        dropped: trace.dropped,
      },
    }).text;
    expect(text).toContain('### Unattested record content');
    // Every candidate's prose heading carries NONE of that pack's content.
    // Asserted against the pack's real record text rather than against an
    // empty string: an empty bucket still renders a `- /data: {}` marker, and
    // pinning that formatting detail would test the renderer's punctuation
    // instead of the claim that matters.
    const proseSections = text
      .split('## Candidate ')
      .slice(1)
      .map((span) => {
        const start = span.indexOf(SOURCE_PROSE_HEADING);
        if (start < 0) return '';
        const rest = span.slice(start + SOURCE_PROSE_HEADING.length);
        const end = rest.indexOf('\n### ');
        return end < 0 ? rest : rest.slice(0, end);
      });
    const pf2eStrings = PATHFINDER2E_REMASTER_RULES_PACK.records
      .flatMap((record) => [
        record.name,
        ...Object.values(record.data as object),
      ])
      .filter((value): value is string => typeof value === 'string');
    expect(pf2eStrings.length).toBeGreaterThan(0);
    for (const section of proseSections)
      for (const value of pf2eStrings) expect(section).not.toContain(value);
  });

  /**
   * The override sibling the review named: an add-on overrides a path the
   * BASE manifest classifies `source-prose` (a spell's `description`). The
   * overriding value was authored by the add-on, not by the SRD importer, so
   * it must not appear under the verbatim-source heading — even though the
   * pointer, the kind, and the record key are all identical to the SRD one.
   */
  it('does not let an add-on override inherit the base manifest for the same pointer', () => {
    const real = getBundledDnd5eSrdPack();
    const fireball = real.records.find((item) => item.key === 'spell:fireball');
    if (fireball === undefined) throw new Error('spell:fireball missing');
    // The base classification for this exact pointer is `source-prose` —
    // otherwise this case would prove nothing.
    const baseManifest = getBundledDnd5eSrdFieldProvenanceManifest();
    if (baseManifest === undefined) throw new Error('no bundled manifest');
    expect(classifyFieldPointer(baseManifest, 'spell', '/description')).toBe(
      'source-prose',
    );

    const addon: RulesPack = {
      meta: {
        ...real.meta,
        packId: 'rules:test-description-addon',
        role: 'addon',
        title: 'Description override add-on',
        compatibleBaseSystems: [
          { systemId: real.meta.systemId, versions: [real.meta.version] },
        ],
      },
      records: [
        {
          ...fireball,
          source: 'test-addon',
          overrides: [`${real.meta.packId}/${fireball.key}`],
          data: {
            ...(fireball.data as object),
            description: 'ADD-ON AUTHORED DESCRIPTION, NOT SRD SOURCE TEXT',
          },
        },
      ],
    };
    const trace = packetFor(real, [addon], ['spell:fireball']);
    const candidate = trace.packet.candidates.find(
      (item) => item.identity.key === 'spell:fireball',
    );
    if (candidate === undefined) throw new Error('fireball not in packet');
    const authored = 'ADD-ON AUTHORED DESCRIPTION, NOT SRD SOURCE TEXT';
    expect(JSON.stringify(candidate.sourceProse)).not.toContain(authored);
    expect(JSON.stringify(candidate.sourceDerived)).not.toContain(authored);
    expect(JSON.stringify(candidate.projection)).not.toContain(authored);
    expect(JSON.stringify(candidate.unattested)).toContain(authored);
  });

  it('does not let a metadata-alias resolver result inherit the SRD manifest', () => {
    const trace = packetFor(aliasOfBundledSrd());
    const candidate = trace.packet.candidates[0];
    if (candidate === undefined)
      throw new Error('alias pack produced no candidate');
    expect((candidate.sourceProse as { data: object }).data).toEqual({});
    expect(
      JSON.stringify((candidate.unattested as { data: object }).data),
    ).toContain('CONTENT THE SRD IMPORTER NEVER PRODUCED');
  });
});
