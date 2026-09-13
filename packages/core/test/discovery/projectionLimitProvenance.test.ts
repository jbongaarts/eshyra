import { describe, expect, it } from 'vitest';
import type {
  FieldProvenanceManifest,
  PacketCandidate,
  RulesPack,
} from '../../src/internal.js';
import {
  buildContextPacket,
  buildFieldProvenanceManifest,
  bundledDnd5eSrdFieldProvenanceSource,
  classifyFieldPointer,
  getBundledDnd5eSrdFieldProvenanceManifest,
  getBundledDnd5eSrdPack,
  renderContextPacketMessage,
  resolveRulesStack,
  retainCandidates,
} from '../../src/internal.js';

/**
 * PR #543 re-review round 5, finding 1: a projection-limit note is
 * model-facing text, and every claim it makes about THE SOURCE must come from
 * positively attested `source-prose`.
 *
 * The previous revision generated these notes from `prose(record.data)` —
 * every string anywhere in the RAW record — so the repaired provenance
 * boundary had a second door: an unattested add-on's strings could raise
 * "source prose remains authoritative context", and a canonical record's own
 * `source-derived` or `compiler-projection` strings could trigger a detector
 * that then spoke about the source.
 *
 * These cases hold the detector's INPUT fixed and vary only the provenance of
 * the matching text, so nothing here can pass because a phrase happens to be
 * present or absent.
 */

const SOURCE_AUTHORITY_CLAIM = 'source prose remains authoritative context';
const AREA_CLAIM = 'The source describes an area';

function packetFor(
  base: RulesPack,
  keys: readonly string[],
  manifest?: FieldProvenanceManifest,
  addons: readonly RulesPack[] = [],
) {
  const stack = resolveRulesStack({ base, addons: [...addons] });
  const entries = keys.map((key) => {
    const entry = stack.recordsByKey.get(key);
    if (entry === undefined) throw new Error(`missing record ${key}`);
    return entry;
  });
  const source =
    manifest === undefined
      ? bundledDnd5eSrdFieldProvenanceSource()
      : (pack: RulesPack) => (pack === base ? manifest : undefined);
  return buildContextPacket(
    retainCandidates(
      entries.map((entry) => ({
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
      })),
    ),
    [],
    50_000_000,
    source,
  );
}

/** The bundled manifest with one declaration's class replaced. */
function reclassified(
  kind: string,
  pointerPrefix: string,
  cls: 'source-prose' | 'source-derived' | 'compiler-projection',
): FieldProvenanceManifest {
  const manifest = getBundledDnd5eSrdFieldProvenanceManifest();
  if (manifest === undefined) throw new Error('no bundled manifest');
  let replaced = 0;
  const declarations = manifest.declarations.map((item) => {
    if (item.kind !== kind || item.pointerPrefix !== pointerPrefix) return item;
    replaced += 1;
    return { ...item, class: cls };
  });
  if (replaced !== 1)
    throw new Error(
      `expected exactly one (${kind}, ${pointerPrefix}) declaration, found ${replaced}`,
    );
  return buildFieldProvenanceManifest(declarations);
}

function stringsIn(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (value !== null && typeof value === 'object')
    return Object.values(value).flatMap(stringsIn);
  return [];
}

function candidate(
  trace: ReturnType<typeof packetFor>,
  key: string,
): PacketCandidate {
  const found = trace.packet.candidates.find(
    (item) => item.identity.key === key,
  );
  if (found === undefined) throw new Error(`${key} not in packet`);
  return found;
}

function render(trace: ReturnType<typeof packetFor>): string {
  return renderContextPacketMessage({
    retention: { overflow: [] },
    packet: {
      packet: trace.packet,
      byteOverflow: trace.byteOverflow,
      dropped: trace.dropped,
    },
  }).text;
}

const DRAGON = 'creature:adult-black-dragon';
const FIREBALL = 'spell:fireball';
const SUCCESS_PHRASE = 'or half as much damage on a successful one';
const AREA_PHRASE = '20-foot-radius sphere';

describe('projection-limit notes are built from attested prose', () => {
  /**
   * The two worked cases design section 7.2 names still get their required
   * disclosure — and now every word of prose backing them is a `source-prose`
   * leaf of the same candidate, not merely a string found somewhere in the
   * record.
   */
  it('still discloses the Dragon success branch and the Fireball area, from attested prose', () => {
    const trace = packetFor(getBundledDnd5eSrdPack(), [DRAGON, FIREBALL]);
    const dragon = candidate(trace, DRAGON);
    const fireball = candidate(trace, FIREBALL);

    const success = dragon.projectionLimits.find(
      (note) => note.kind === 'success-branch',
    );
    expect(success?.evidence.path).toBe('/data/actions/5/mechanics/saves');
    expect(success?.attestedProse).toContain(SUCCESS_PHRASE);

    const area = fireball.projectionLimits.find((note) => note.kind === 'area');
    expect(area?.attestedProse).toContain(AREA_PHRASE);

    // Every note's prose is drawn from the candidate's own attested partition
    // — asserted per line, so a note cannot smuggle in a projection string
    // between two attested ones.
    for (const item of [dragon, fireball]) {
      const attested = new Set(stringsIn(item.sourceProse));
      for (const note of item.projectionLimits)
        for (const line of note.attestedProse.split('\n'))
          if (line.length > 0) expect(attested.has(line)).toBe(true);
    }

    // And the claims reach the DM.
    const text = render(trace);
    expect(text).toContain(SOURCE_AUTHORITY_CLAIM);
    expect(text).toContain(AREA_CLAIM);
  });

  /**
   * The reviewer's named adversary: the matching phrase exists in the record,
   * but not as attested source prose. Only the DECLARATION changes between
   * this case and the one above — the record, the detector, and the typed
   * projection are identical — so a note appearing here could only come from
   * reading raw record strings.
   */
  it('makes no source claim when the matching phrase is classified compiler-projection', () => {
    const base = getBundledDnd5eSrdPack();
    const dragonManifest = reclassified(
      'creature',
      '/actions/*/text',
      'compiler-projection',
    );
    const fireballManifest = reclassified(
      'spell',
      '/description',
      'compiler-projection',
    );
    // The baseline classification really is `source-prose`, or this case
    // would prove nothing.
    const real = getBundledDnd5eSrdFieldProvenanceManifest();
    if (real === undefined) throw new Error('no bundled manifest');
    expect(classifyFieldPointer(real, 'creature', '/actions/*/text')).toBe(
      'source-prose',
    );
    expect(classifyFieldPointer(real, 'spell', '/description')).toBe(
      'source-prose',
    );

    const dragonTrace = packetFor(base, [DRAGON], dragonManifest);
    const dragon = candidate(dragonTrace, DRAGON);
    // The phrase is still in the record, now under the projection heading...
    expect(JSON.stringify(dragon.projection)).toContain(SUCCESS_PHRASE);
    expect(JSON.stringify(dragon.sourceProse)).not.toContain(SUCCESS_PHRASE);
    // ...and the typed save projection it would qualify is still there, still
    // missing the success branch: the detector's projection-side input is
    // unchanged and only the phrase's provenance moved.
    const saves = JSON.stringify(
      (
        (
          (dragon.projection as { data: Record<string, unknown> }).data
            .actions as Record<string, Record<string, Record<string, unknown>>>
        )['5'].mechanics as Record<string, unknown>
      ).saves,
    );
    expect(saves).toContain('dexterity');
    expect(saves).not.toContain('damageOnSuccess');
    // ...but nothing claims the source says it.
    expect(
      dragon.projectionLimits.filter((note) => note.kind === 'success-branch'),
    ).toEqual([]);
    expect(render(dragonTrace)).not.toContain(SOURCE_AUTHORITY_CLAIM);

    const fireballTrace = packetFor(base, [FIREBALL], fireballManifest);
    const fireball = candidate(fireballTrace, FIREBALL);
    expect(JSON.stringify(fireball.projection)).toContain(AREA_PHRASE);
    expect(JSON.stringify(fireball.sourceProse)).not.toContain(AREA_PHRASE);
    expect(
      fireball.projectionLimits.filter((note) => note.kind === 'area'),
    ).toEqual([]);
    expect(render(fireballTrace)).not.toContain(AREA_CLAIM);
  });

  /**
   * The laundering route the review described end to end: a pack whose
   * producer attests nothing, carrying prose that matches every detector. Its
   * content must still be DELIVERED — dropping an add-on's rules content is
   * the worse failure — under a heading that refuses the authority claim, and
   * it must earn no source-authority sentence anywhere.
   */
  it('gives a manifest-less add-on no source-authority claim, while still delivering its content', () => {
    const base = getBundledDnd5eSrdPack();
    const template = base.records.find((record) => record.kind === 'creature');
    if (template === undefined) throw new Error('missing creature template');
    const key = 'creature:test-unattested-breather';
    const addon: RulesPack = {
      meta: {
        ...base.meta,
        packId: 'rules:test-unattested-addon',
        role: 'addon',
        title: 'Unattested add-on',
        order: 1,
        compatibleBaseSystems: [
          { systemId: base.meta.systemId, versions: [base.meta.version] },
        ],
      },
      records: [
        {
          ...structuredClone(template),
          key,
          name: 'Test Unattested Breather',
          data: {
            actions: [
              {
                name: 'Caustic Breath',
                // Every phrase the detectors look for, verbatim.
                text: `The creature exhales acid in a ${AREA_PHRASE}. Each creature in that area must make a DC 15 Dexterity saving throw, taking 22 acid damage on a failed save, ${SUCCESS_PHRASE}.`,
                mechanics: { saves: [{ ability: 'dexterity', dc: 15 }] },
              },
            ],
            executionReadiness: {
              clauses: [{ clauseId: `${key}/c1`, readiness: 'engine-pending' }],
            },
          },
        },
      ],
    };

    const trace = packetFor(base, [key], undefined, [addon]);
    const unattested = candidate(trace, key);
    expect(unattested.provenanceArtifact).toBe('absent');
    // Nothing was attested, so nothing is classified...
    expect(unattested.sourceProse).toEqual({ data: {} });
    expect(unattested.projection).toEqual({ data: {} });
    // ...the content is still delivered...
    expect(JSON.stringify(unattested.unattested)).toContain(SUCCESS_PHRASE);
    expect(JSON.stringify(unattested.unattested)).toContain(AREA_PHRASE);
    // ...and no note makes a claim on its behalf.
    expect(unattested.projectionLimits).toEqual([]);

    const text = render(trace);
    expect(text).toContain(
      "### Unattested record content (this record's producing pack supplied NO field-provenance artifact",
    );
    expect(text).toContain(SUCCESS_PHRASE);
    expect(text).not.toContain(SOURCE_AUTHORITY_CLAIM);
    expect(text).not.toContain(AREA_CLAIM);
    expect(text).not.toContain('### Projection limit');
  });

  /**
   * The same add-on record, with the SAME text, classified by a manifest that
   * really does attest it. The note appears — so the silence above is the
   * provenance boundary doing its job, not the detector failing to fire on
   * add-on-shaped content.
   */
  it('does raise the note for a foreign pack whose producer positively attests the prose', () => {
    const base = getBundledDnd5eSrdPack();
    const template = base.records.find((record) => record.kind === 'creature');
    if (template === undefined) throw new Error('missing creature template');
    const key = 'creature:test-attested-breather';
    const attestedPack: RulesPack = {
      meta: { ...base.meta, packId: 'rules:test-attested-base' },
      records: [
        {
          ...structuredClone(template),
          key,
          name: 'Test Attested Breather',
          data: {
            actions: [
              {
                name: 'Caustic Breath',
                text: `Each creature in a ${AREA_PHRASE} takes 22 acid damage on a failed save, ${SUCCESS_PHRASE}.`,
                mechanics: { saves: [{ ability: 'dexterity', dc: 15 }] },
              },
            ],
          },
        },
      ],
    };
    const manifest = buildFieldProvenanceManifest([
      {
        kind: 'creature',
        pointerPrefix: '/actions/*/name',
        class: 'source-prose',
        reason: 'the entry label printed by this producer.',
      },
      {
        kind: 'creature',
        pointerPrefix: '/actions/*/text',
        class: 'source-prose',
        reason: 'the entry body printed by this producer.',
      },
      {
        kind: 'creature',
        pointerPrefix: '/actions/*/mechanics',
        class: 'compiler-projection',
        reason: "this producer's typed projection of that text.",
      },
    ]);

    const trace = packetFor(attestedPack, [key], manifest);
    const attested = candidate(trace, key);
    const note = attested.projectionLimits.find(
      (item) => item.kind === 'success-branch',
    );
    expect(note?.evidence.path).toBe('/data/actions/0/mechanics/saves');
    expect(note?.attestedProse).toContain(SUCCESS_PHRASE);
    expect(render(trace)).toContain(SOURCE_AUTHORITY_CLAIM);
  });

  /**
   * The `execution-readiness` note makes no claim about the source, so it is
   * not withheld for want of attested prose — but it IS a claim about the
   * typed projection, so it is raised only for material the packet actually
   * presents as one.
   */
  it('raises the readiness note from the projection partition, with no source claim attached', () => {
    const trace = packetFor(getBundledDnd5eSrdPack(), [
      'magic-item:ammunition-1-2-or-3',
    ]);
    const item = candidate(trace, 'magic-item:ammunition-1-2-or-3');
    const note = item.projectionLimits.find(
      (entry) => entry.kind === 'execution-readiness',
    );
    expect(note).toBeDefined();
    expect(JSON.stringify(note?.evidence)).toContain('engine-pending');
    expect(JSON.stringify(item.projection)).toContain('executionReadiness');
    expect(note?.note).not.toContain('source');
  });
});
