import { describe, expect, it } from 'vitest';
import type { RulesPack } from '../../src/internal.js';
import {
  buildContextPacket,
  buildFieldProvenanceManifest,
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
/**
 * A positive attestation may remain valid only while the exact artifact it
 * attests is unchanged. Object identity is the proof, so the artifact it
 * proves things about has to be incapable of drifting underneath it — these
 * cases attack that directly, at every nesting depth rather than only the top
 * level (PR #543 re-review round 4, finding 1).
 */
describe('the attested artifact cannot drift under its own proof', () => {
  it('is deep-frozen: top-level, nested object, array element and array length', () => {
    const pack = getBundledDnd5eSrdPack();
    expect(Object.isFrozen(pack)).toBe(true);
    expect(Object.isFrozen(pack.records)).toBe(true);

    const fireball = pack.records.find((item) => item.key === 'spell:fireball');
    if (fireball === undefined) throw new Error('spell:fireball missing');
    const data = fireball.data as Record<string, unknown>;
    expect(Object.isFrozen(fireball)).toBe(true);
    expect(Object.isFrozen(data)).toBe(true);

    // The exact drift the review named: a changed description must not remain
    // attested as verbatim source prose.
    const description = data.description;
    expect(() => {
      (data as { description: unknown }).description = 'TAMPERED';
    }).toThrow(TypeError);
    expect(data.description).toBe(description);

    // Nested object, one level down.
    const mechanics = data.mechanics as Record<string, unknown>;
    expect(Object.isFrozen(mechanics)).toBe(true);
    expect(() => {
      (mechanics as { concentration: unknown }).concentration = true;
    }).toThrow(TypeError);

    // Array element AND array length — a frozen array must refuse both.
    const saves = mechanics.saves as unknown[];
    expect(Object.isFrozen(saves)).toBe(true);
    expect(() => {
      saves[0] = { ability: 'strength' };
    }).toThrow(TypeError);
    expect(() => saves.push({ ability: 'strength' })).toThrow(TypeError);

    // An element deep inside that array is frozen too, which a shallow
    // freeze of the array would have left writable.
    const firstSave = saves[0] as Record<string, unknown>;
    expect(Object.isFrozen(firstSave)).toBe(true);
    expect(() => {
      (firstSave as { ability: unknown }).ability = 'strength';
    }).toThrow(TypeError);
  });

  /**
   * The sibling found by searching this defect class rather than the reported
   * example: the MANIFEST is the attestation, so a proof riding on it is only
   * as stable as it is. A mutable declaration list would let one assignment
   * reclassify a whole kind as verbatim source authority.
   */
  it('deep-freezes the manifest itself, not only the pack it attests', () => {
    const manifest = getBundledDnd5eSrdFieldProvenanceManifest();
    if (manifest === undefined) throw new Error('no bundled manifest');
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.declarations)).toBe(true);
    const first = manifest.declarations[0];
    if (first === undefined) throw new Error('empty manifest');
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { class: unknown }).class = 'source-prose';
    }).toThrow(TypeError);
    expect(() =>
      (manifest.declarations as unknown as unknown[]).push({}),
    ).toThrow(TypeError);
  });

  it('freezes every record reachable in the pack, not just the sampled one', () => {
    const pack = getBundledDnd5eSrdPack();
    const unfrozen = pack.records.filter(
      (record) =>
        !Object.isFrozen(record) ||
        (typeof record.data === 'object' &&
          record.data !== null &&
          !Object.isFrozen(record.data)),
    );
    expect(pack.records.length).toBeGreaterThan(1000);
    expect(unfrozen.map((record) => record.key)).toEqual([]);
  });
});

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

  /**
   * The three attestation states, kept distinct (`eshyra-o9bd.19.12.11` items
   * 4 and 5). A present-but-incomplete artifact is a PRODUCER DEFECT and must
   * not read as the deliberate "this producer attests nothing" state.
   */
  it('distinguishes no artifact from an artifact that fails to cover a pointer', () => {
    const real = getBundledDnd5eSrdPack();
    const baseManifest = getBundledDnd5eSrdFieldProvenanceManifest();
    if (baseManifest === undefined) throw new Error('no bundled manifest');

    // A manifest that is genuinely PRESENT but deliberately incomplete: every
    // declaration except the one covering a spell's description.
    const incomplete = buildFieldProvenanceManifest(
      baseManifest.declarations.filter(
        (item) =>
          !(item.kind === 'spell' && item.pointerPrefix === '/description'),
      ),
    );
    expect(incomplete.declarations.length).toBe(
      baseManifest.declarations.length - 1,
    );

    const stack = resolveRulesStack({ base: real });
    const entry = stack.recordsByKey.get('spell:fireball');
    if (entry === undefined) throw new Error('spell:fireball missing');
    const candidateOf = (source: Parameters<typeof buildContextPacket>[3]) => {
      const trace = buildContextPacket(
        retainCandidates([
          {
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
          },
        ]),
        [],
        512_000,
        source,
      );
      const candidate = trace.packet.candidates[0];
      if (candidate === undefined) throw new Error('no candidate built');
      return { candidate, trace };
    };

    // State 2 — artifact present, this pointer uncovered.
    const withIncomplete = candidateOf(() => incomplete);
    expect(withIncomplete.candidate.provenanceArtifact).toBe('present');
    const uncovered = withIncomplete.candidate.residue.filter(
      (item) => item.reason === 'no-provenance-declaration',
    );
    expect(uncovered.map((item) => item.pointer)).toContain(
      '/data/description',
    );
    // The VALUE is still delivered, never discarded...
    expect(JSON.stringify(withIncomplete.candidate.unattested)).toContain(
      'bright streak',
    );
    // ...and never as verbatim source prose.
    expect(JSON.stringify(withIncomplete.candidate.sourceProse)).not.toContain(
      'bright streak',
    );

    // State 1 — no artifact at all. Same value-preserving treatment, but NOT
    // the same disclosure: nothing here is a producer defect.
    const withNone = candidateOf(undefined);
    expect(withNone.candidate.provenanceArtifact).toBe('absent');
    expect(
      withNone.candidate.residue.filter(
        (item) => item.reason === 'no-provenance-declaration',
      ),
    ).toEqual([]);
    expect(JSON.stringify(withNone.candidate.unattested)).toContain(
      'bright streak',
    );

    // State 3 — positively classified, for contrast.
    const withReal = candidateOf(bundledDnd5eSrdFieldProvenanceSource());
    expect(withReal.candidate.provenanceArtifact).toBe('present');
    expect(JSON.stringify(withReal.candidate.sourceProse)).toContain(
      'bright streak',
    );

    // The rendered text separates states 1 and 2 for a reader.
    const render = (built: ReturnType<typeof candidateOf>) =>
      renderContextPacketMessage({
        retention: { overflow: [] },
        packet: {
          packet: built.trace.packet,
          byteOverflow: built.trace.byteOverflow,
          dropped: built.trace.dropped,
        },
      }).text;
    expect(render(withIncomplete)).toContain(
      'supplied a field-provenance artifact that does NOT cover these fields',
    );
    expect(render(withNone)).toContain('supplied NO field-provenance artifact');
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
