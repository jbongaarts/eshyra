import { describe, expect, it } from 'vitest';
import type {
  Db,
  DiscoveryTrace,
  RetentionBudget,
} from '../../src/internal.js';
import {
  buildContextPacket,
  classifyFieldPointer,
  getBundledDnd5eSrdFieldProvenanceManifest,
  getBundledDnd5eSrdPack,
  renderContextPacketMessage,
  runDiscoveryStages,
} from '../../src/internal.js';
import type { DiagnosticFixture } from '../diagnostics/index.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import { freshDbWithSession } from '../support/db.js';
import { installJhptCampaignRules } from './support/jhptCampaignRules.js';
import {
  installScenarioBinding,
  moduleForFixture,
  scenarioForFixture,
} from './support/scenario.js';

/**
 * The three headings `packetMessage.ts` renders, quoted once here rather
 * than retyped at every call site — the "Unclassified" heading is the fourth
 * and appears only when a candidate actually carries residue, so it stays a
 * literal at its one use site below instead of joining this list.
 */
const SOURCE_PROSE_HEADING = '### Source prose (verbatim; authoritative)';
const SOURCE_DERIVED_HEADING =
  '### Source-derived facts (deterministic parser output from the cited source; NOT a verbatim quotation)';
const PROJECTION_HEADING =
  '### Typed projection (does not replace the source prose above)';

/**
 * W10 (`eshyra-o9bd.19.12`) permanent evidence for the context-packet
 * RENDERER: design section 7.1's required content reaching the text a DM would
 * actually read, section 7.2's partial-projection rules, and section 7.3's
 * prohibitions.
 *
 * Every case below renders a packet built by the real offline stage harness
 * over the real rules pack. A renderer proven only against a hand-authored
 * `ContextPacket` literal would prove nothing about the prose, the provenance,
 * or the projection limits the pack actually carries — which is the whole
 * subject of section 7.
 *
 * The renderer does not inject anything. Injection is W10's third workstream;
 * what is established here is only that a packet CAN be stated truthfully.
 */

function fixtureFor(probeId: string): DiagnosticFixture {
  const fixture = DIAGNOSTIC_FIXTURES.find((item) => item.probeId === probeId);
  if (fixture === undefined) throw new Error(`missing fixture ${probeId}`);
  return fixture;
}

function run(
  probeId: string,
  options: {
    readonly executionId?: string;
    readonly budget?: Partial<RetentionBudget>;
  } = {},
): { trace: DiscoveryTrace; db: Db } {
  const fixture = fixtureFor(probeId);
  const execution =
    options.executionId === undefined
      ? fixture.executions[0]
      : (fixture.executions.find(
          (item) => item.executionId === options.executionId,
        ) ??
        (() => {
          throw new Error(
            `missing execution ${probeId}/${options.executionId}`,
          );
        })());
  const db = freshDbWithSession();
  // The pack binding lives in the database, not in the scenario: P11's add-on
  // stack and P8's item record are only resolvable once it is installed.
  const rulesPackResolver = installScenarioBinding(fixture, db);
  const campaignRules = installJhptCampaignRules(
    db,
    fixture,
    execution,
    rulesPackResolver,
  );
  const trace = runDiscoveryStages({
    db,
    scenario: scenarioForFixture(fixture, execution, moduleForFixture(fixture)),
    campaignRuleSeam: campaignRules.seam,
    campaignPosition: campaignRules.campaignPosition,
    ...(rulesPackResolver === undefined ? {} : { rulesPackResolver }),
    ...(options.budget === undefined ? {} : { budget: options.budget }),
  });
  return { trace, db };
}

/**
 * The span of one candidate's own block: from its heading to the next
 * candidate's heading, or to the end of the text for the last candidate.
 *
 * "In band, beside the projection" (section 7.2) is a claim about WHERE a
 * disclosure sits. A bare `toContain` cannot distinguish a note rendered
 * beside its projection from one collected into a trailing appendix, which is
 * exactly the difference the section is about.
 */
function candidateSpan(text: string, candidateKey: string): string {
  const heading = `## Candidate ${candidateKey}\n`;
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`no rendered block for ${candidateKey}`);
  const next = text.indexOf('\n## Candidate ', start + heading.length);
  return next < 0 ? text.slice(start) : text.slice(start, next);
}

/** Render one probe and hand back the text, closing the database. */
function render(
  probeId: string,
  options?: Parameters<typeof run>[1],
): ReturnType<typeof renderContextPacketMessage> {
  const { trace, db } = run(probeId, options);
  try {
    return renderContextPacketMessage(trace);
  } finally {
    db.close();
  }
}

/** Render one probe and ALSO hand back its packet candidates, so a test can
 * compare rendered text against the structured `PacketCandidate` it came
 * from (F2's generic evidence case needs both). */
function renderWithCandidates(
  probeId: string,
  options?: Parameters<typeof run>[1],
): {
  readonly rendered: ReturnType<typeof renderContextPacketMessage>;
  readonly candidates: DiscoveryTrace['packet']['packet']['candidates'];
} {
  const { trace, db } = run(probeId, options);
  try {
    return {
      rendered: renderContextPacketMessage(trace),
      candidates: trace.packet.packet.candidates,
    };
  } finally {
    db.close();
  }
}

/**
 * One heading's own block within a candidate span: from the line after the
 * heading to the next `### ` heading, or to the end of the span. Mirrors
 * `candidateSpan`'s reasoning at the sub-heading level — "under the Typed
 * projection heading" and "under the Source prose heading" are claims about
 * WHICH block text sits in, and a bare `toContain` over the whole candidate
 * span cannot tell the two apart.
 */
function headingBlock(span: string, heading: string): string {
  const start = span.indexOf(heading);
  if (start < 0) throw new Error(`heading '${heading}' missing from span`);
  const from = start + heading.length;
  const next = span.indexOf('\n### ', from);
  return next < 0 ? span.slice(from) : span.slice(from, next);
}

/**
 * A leaf value rendered exactly as `emitLeaves`'s private `valueText`
 * (`packetMessage.ts`) would render it: the string itself, or a JSON
 * encoding for everything else. Duplicated here rather than imported because
 * the renderer's own helper is module-private — this test independently
 * reconstructs the rendered LINE FORMAT, not the renderer's behavior.
 */
function rawValueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Walk every leaf under a rules-record `data` value, calling `visit` with
 * BOTH pointer conventions in play at once: `displayPointer` keeps concrete
 * array indices (matching what `emitLeaves` actually renders, e.g.
 * `/data/actions/5/mechanics/...`) and `normalizedPointer` collapses every
 * index to `*` (matching `classifyFieldPointer`'s own required convention,
 * `rules/fieldProvenance.ts`). `bead-E4`'s sweep needs both: one to look the
 * leaf's class up in the manifest, the other to build the exact rendered
 * line to search for.
 */
function walkClassifiedLeaves(
  data: unknown,
  visit: (
    displayPointer: string,
    normalizedPointer: string,
    value: unknown,
  ) => void,
  displayPointer = '/data',
  normalizedPointer = '',
): void {
  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      walkClassifiedLeaves(
        item,
        visit,
        `${displayPointer}/${index}`,
        `${normalizedPointer}/*`,
      );
    });
    return;
  }
  if (data !== null && typeof data === 'object') {
    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (value === undefined) continue;
      walkClassifiedLeaves(
        value,
        visit,
        `${displayPointer}/${key}`,
        `${normalizedPointer}/${key}`,
      );
    }
    return;
  }
  visit(displayPointer, normalizedPointer, data);
}

describe('context-packet message renderer', () => {
  // E1 — source prose reaches the text verbatim, not as a JSON encoding.
  it('renders dragon and Fireball source prose verbatim', () => {
    const dragon = render('P3');
    expect(dragon.text).toContain('or half as much damage on a successful one');
    const fireball = render('P4');
    expect(fireball.text).toContain('a 20-foot-radius sphere');
    // A prose field that went through JSON.stringify would carry these; the
    // fixture corpus's field-9 substrings are matched against readable text.
    for (const rendered of [dragon, fireball]) {
      expect(rendered.text).not.toContain('\\n');
      expect(rendered.text).not.toContain('\\"');
      expect(rendered.bytes).toBe(Buffer.byteLength(rendered.text, 'utf8'));
    }
  });

  /**
   * `eshyra-o9bd.19.12.11` evidence E1 (F1-rr, PR #543's second re-review):
   * the defect this bead closes, verified directly against the real
   * `creature:adult-black-dragon` record (`armorClass: {value: 19, source:
   * 'natural armor', sourceText: '19 (natural armor)'}`). The deleted
   * `PROJECTION_CONTAINER_KEYS` heuristic put ALL THREE of these under
   * "Source prose (verbatim; authoritative)", because `armorClass` never
   * matched a container name — but `value` and `source` are
   * `parseArmorClassText`'s PARSED OUTPUT, not a quotation, and only
   * `sourceText` is the literal printed statline. The bundled
   * field-provenance manifest declares exactly that split: `(creature,
   * /armorClass)` is `source-derived`, overridden at `(creature,
   * /armorClass/sourceText)` to `source-prose`.
   */
  it('bead-E1/F1-rr — creature armorClass.value and .source are source-derived, never verbatim source prose', () => {
    const span = candidateSpan(
      render('P3').text,
      'creature:adult-black-dragon',
    );
    const source = headingBlock(span, SOURCE_PROSE_HEADING);
    const derived = headingBlock(span, SOURCE_DERIVED_HEADING);
    expect(source).toContain('/data/armorClass/sourceText: 19 (natural armor)');
    expect(derived).toContain('/data/armorClass/value: 19');
    expect(derived).toContain('/data/armorClass/source: natural armor');
    expect(source).not.toContain('/data/armorClass/value');
    expect(source).not.toContain('/data/armorClass/source: natural armor');
  });

  // `eshyra-o9bd.19.12.11` evidence E2 — the re-review's named sibling class:
  // every structured statline field a creature record carries renders as
  // source-derived, never as verbatim source prose, exactly like
  // `armorClass`.
  it('bead-E2 — hit points, speed, and ability scores render as source-derived, never as verbatim prose', () => {
    const span = candidateSpan(
      render('P3').text,
      'creature:adult-black-dragon',
    );
    const source = headingBlock(span, SOURCE_PROSE_HEADING);
    const derived = headingBlock(span, SOURCE_DERIVED_HEADING);
    expect(derived).toContain('/data/hitPoints/value: 195');
    expect(derived).toContain('/data/hitPoints/formula: 17d12 + 85');
    expect(derived).toContain('/data/speed/walk: 40');
    expect(derived).toContain('/data/abilityScores/strength: 23');
    expect(source).not.toContain('/data/hitPoints/value');
    expect(source).not.toContain('/data/hitPoints/formula');
    expect(source).not.toContain('/data/speed/walk');
    expect(source).not.toContain('/data/abilityScores/strength');
  });

  /**
   * F2 (PR #543 review, `eshyra-o9bd.19.12.8`): the packet used to split a
   * candidate's record body by primitive TYPE — every string under "Source
   * prose", every non-string under "Typed projection" — which is not a
   * provenance boundary. `spell:fireball`'s `mechanics.saves[0]` is
   * `{ability: 'dexterity', damageOnSuccess: 'half'}`: both importer-derived
   * typed values, both strings, both therefore landing under "verbatim;
   * authoritative" source prose. These cases prove the repair: the split is
   * now read from the pack's own field-provenance manifest
   * (`rules/fieldProvenance.ts`), by leaf pointer, at build time in the
   * producer — `(spell, /mechanics)` is declared `compiler-projection`.
   */
  it("F2 — moves fireball's typed string values out of source prose and into projection", () => {
    const span = candidateSpan(render('P4').text, 'spell:fireball');
    const source = headingBlock(
      span,
      '### Source prose (verbatim; authoritative)',
    );
    const projection = headingBlock(
      span,
      '### Typed projection (does not replace the source prose above)',
    );
    // The exact defect verified against the real pack: both values are
    // strings, and only their CONTAINER (`mechanics`), not their JS type,
    // may decide where they land.
    expect(projection).toContain('/data/mechanics/saves/0/ability: dexterity');
    expect(projection).toContain(
      '/data/mechanics/saves/0/damageOnSuccess: half',
    );
    expect(source).not.toContain('/data/mechanics/saves/0/ability: dexterity');
    expect(source).not.toContain(
      '/data/mechanics/saves/0/damageOnSuccess: half',
    );
    // Source prose is not merely absent of the projection values — it still
    // carries the real prose, verbatim, including the area design section 7.2
    // says the typed projection omits.
    expect(source).toContain('a 20-foot-radius sphere');
    expect(source).toContain(
      'A target takes 8d6 fire damage on a failed save, or half as much damage on a successful one',
    );
  });

  /**
   * F2, positional case: `creature:adult-black-dragon` `data.actions[5]` has
   * a `.text` prose field and a sibling `.mechanics` projection at the SAME
   * array index. A top-level-only rule gets this wrong (nothing at the
   * top level of a `creature` record is named `mechanics`); the rule must
   * apply at any depth.
   */
  it('F2 — splits a nested actions[5].text/actions[5].mechanics pair positionally', () => {
    const span = candidateSpan(
      render('P3').text,
      'creature:adult-black-dragon',
    );
    const source = headingBlock(
      span,
      '### Source prose (verbatim; authoritative)',
    );
    const projection = headingBlock(
      span,
      '### Typed projection (does not replace the source prose above)',
    );
    expect(source).toContain('/data/actions/5/text: ');
    expect(source).toContain('or half as much damage on a successful one');
    expect(source).not.toContain('/data/actions/5/mechanics');
    // The whole mechanics subtree — object, array, and number leaves reached
    // only by descending through it — is projection, not just its top field.
    expect(projection).toContain('/data/actions/5/mechanics/recharge/roll: d6');
    expect(projection).toContain(
      '/data/actions/5/mechanics/saves/0/ability: dexterity',
    );
    expect(projection).toContain('/data/actions/5/mechanics/saves/0/dc: 18');
    expect(projection).toContain(
      '/data/actions/5/mechanics/damage/0/average: 54',
    );
    expect(projection).toContain(
      '/data/actions/5/mechanics/damage/0/dice: 12d8',
    );
    expect(projection).not.toContain('/data/actions/5/text');
  });

  // F2 — a NULL-valued projection leaf (`magic-item:cube-of-force`'s
  // `mechanics.ambiguities[0].canonicalResolution`, verified null in the real
  // pack) stays projection. A type-based rule already handled null one way
  // consistently; this proves the CONTAINER rule does too, for the one
  // primitive type `emitLeaves` treats specially at the object-vs-leaf split.
  it('F2 — keeps a null-valued projection leaf under Typed projection', () => {
    const span = candidateSpan(
      render('P7', { executionId: 'without-active-ruling' }).text,
      'magic-item:cube-of-force',
    );
    const source = headingBlock(
      span,
      '### Source prose (verbatim; authoritative)',
    );
    const projection = headingBlock(
      span,
      '### Typed projection (does not replace the source prose above)',
    );
    expect(projection).toContain(
      '/data/mechanics/ambiguities/0/canonicalResolution: null',
    );
    expect(source).not.toContain(
      '/data/mechanics/ambiguities/0/canonicalResolution',
    );
  });

  // F2, P10: the review names P10 by id without specifying which of its
  // fields are prose versus typed. P10 targets the SAME `spell:fireball`
  // record as P4 (this time beside an active house rule), so it carries the
  // identical split: `components` is source-DERIVED — a parsed
  // "V"/"S"/"M" token list, not a quotation of source prose (F1-rr,
  // `eshyra-o9bd.19.12.11`; the bundled manifest declares
  // `(spell, /components)` as `source-derived`, not `source-prose`) — the
  // failed-save description is source prose, and
  // `mechanics.saves`/`mechanics.damage`/`upcast` are projection.
  it('F2/F1-rr — P10 splits its governing spell:fireball record the same way as P4', () => {
    const span = candidateSpan(render('P10').text, 'spell:fireball');
    const source = headingBlock(span, SOURCE_PROSE_HEADING);
    const derived = headingBlock(span, SOURCE_DERIVED_HEADING);
    const projection = headingBlock(span, PROJECTION_HEADING);
    // Prose fields P10's own fixture facts require (design amendment 11.1).
    expect(derived).toContain('/data/components/0: V');
    expect(source).not.toContain('/data/components/0: V');
    expect(source).toContain('A target takes 8d6 fire damage on a failed save');
    // The same typed fields P4 proves, present here too and still projection.
    expect(projection).toContain('/data/mechanics/saves/0/ability: dexterity');
    expect(projection).toContain(
      '/data/mechanics/saves/0/damageOnSuccess: half',
    );
    expect(source).not.toContain('/data/mechanics/saves/0/ability: dexterity');
    expect(source).not.toContain(
      '/data/mechanics/saves/0/damageOnSuccess: half',
    );
  });

  /**
   * `eshyra-o9bd.19.12.11` evidence E4, generic sweep. The named-field
   * assertions above prove the split for specific values the reviewer named;
   * none of them would catch a NEW `source-derived` or `compiler-projection`
   * leaf introduced later regressing back onto the verbatim-authoritative
   * side (e.g. a renderer change that iterates the wrong field, or a future
   * manifest edit this test never learns about because it hardcoded the OLD
   * expectation instead of re-deriving one).
   *
   * This is why the check is driven from the MANIFEST at assertion time
   * rather than from `packet.ts`'s own already-split candidate fields: it
   * independently re-walks each retained candidate's REAL record (fetched
   * fresh from `getBundledDnd5eSrdPack()`, not derived from the packet under
   * test), classifies every leaf with the SAME `classifyFieldPointer` the
   * producer uses, and asserts that a leaf the manifest calls
   * `source-derived` or `compiler-projection` never appears — at its exact
   * pointer-qualified rendered line — under that candidate's Source prose
   * heading. A future reclassification in the manifest moves this test's own
   * expectation with it, because the expectation is computed here, not
   * copied from one run's output.
   *
   * P9 retains both `rules-record` and `adventure-entity` candidates, so the
   * sweep exercises both `packetCandidate` branches (the adventure-entity
   * branch contributes no rules-record leaves to check, and is skipped for
   * exactly that reason).
   */
  it('bead-E4 — no source-derived or compiler-projection leaf appears under Source prose, for every retained candidate', () => {
    const { rendered, candidates } = renderWithCandidates('P9');
    expect(candidates.length).toBeGreaterThan(1);
    const manifest = getBundledDnd5eSrdFieldProvenanceManifest();
    const pack = getBundledDnd5eSrdPack();
    let checked = 0;
    for (const candidate of candidates) {
      const record = pack.records.find(
        (item) => item.key === candidate.identity.key,
      );
      if (record === undefined) continue; // adventure-entity: no kind, no manifest.
      const span = candidateSpan(rendered.text, candidate.identity.key);
      const source = headingBlock(span, SOURCE_PROSE_HEADING);
      walkClassifiedLeaves(
        record.data,
        (displayPointer, normalizedPointer, value) => {
          const cls = classifyFieldPointer(
            manifest,
            record.kind,
            normalizedPointer,
          );
          if (cls !== 'source-derived' && cls !== 'compiler-projection') return;
          checked += 1;
          const line = `${displayPointer}: ${rawValueText(value)}`;
          expect(
            source,
            `${candidate.identity.key} rendered manifest-${cls} pointer "${displayPointer}" under Source prose`,
          ).not.toContain(line);
        },
      );
    }
    // The sweep itself must exercise real classified leaves, or a corpus
    // change that emptied every retained record could pass vacuously.
    expect(checked).toBeGreaterThan(0);
  });

  /**
   * `eshyra-o9bd.19.12.11` evidence E5, the no-manifest case (design item 5).
   *
   * `loadFieldProvenanceManifest` is optional (`rules/packLoader.ts`), and a
   * hand-authored test-corpus add-on pack may ship none. Decision: an absent
   * manifest is treated IDENTICALLY to one that declares nothing —
   * `buildContextPacket`'s manifest parameter defaults to `undefined`, and
   * `classifyRecordBody` (`packet.ts`) never calls `classifyFieldPointer`
   * when it is `undefined`, so every leaf becomes a
   * `'no-provenance-declaration'` residue entry. A pack attesting nothing can
   * never be read by a consumer as attesting verbatim source authority
   * merely because the manifest argument was omitted.
   *
   * Exercised through the REAL exported `buildContextPacket`, over the REAL
   * `RetentionTrace` the offline harness already produced for
   * `creature:adult-black-dragon` — never a hand-authored packet — with only
   * the manifest argument varied from the harness's own call.
   */
  it('bead-E5 — a packet built with no field-provenance manifest treats every leaf as unattested, never as verbatim source', () => {
    const { trace, db } = run('P3');
    try {
      const noManifest = buildContextPacket(trace.retention);
      const dragon = noManifest.packet.candidates.find(
        (item) => item.identity.key === 'creature:adult-black-dragon',
      );
      expect(dragon).toBeDefined();
      // Nothing is classified into any of the three declared buckets — each
      // stays wrapped under `data` (the same shape a populated bucket would
      // carry, per `splitRecordData`'s doc comment) but with no leaves in it.
      expect(dragon?.sourceProse).toEqual({ data: {} });
      expect(dragon?.sourceDerived).toEqual({ data: {} });
      expect(dragon?.projection).toEqual({ data: {} });
      // ...every leaf becomes disclosed residue instead, with the reason that
      // says WHY: no manifest was supplied, so nothing attests it.
      expect(dragon?.residue.length).toBeGreaterThan(0);
      expect(
        dragon?.residue.every(
          (item) => item.reason === 'no-provenance-declaration',
        ),
      ).toBe(true);
      expect(
        dragon?.residue.some(
          (item) => item.pointer === '/data/armorClass/value',
        ),
      ).toBe(true);
      const rendered = renderContextPacketMessage({
        retention: { overflow: trace.retention.overflow },
        packet: {
          packet: noManifest.packet,
          byteOverflow: noManifest.byteOverflow,
          dropped: noManifest.dropped,
        },
      });
      const span = candidateSpan(rendered.text, 'creature:adult-black-dragon');
      const source = headingBlock(span, SOURCE_PROSE_HEADING);
      const derived = headingBlock(span, SOURCE_DERIVED_HEADING);
      // A reader can tell "attested prose" from "unattested content": neither
      // classified heading claims the armor class at all...
      expect(source).not.toContain('armorClass');
      expect(source).not.toContain('19 (natural armor)');
      expect(derived).not.toContain('armorClass');
      // ...and the disclosure names the exact pointer and why.
      expect(span).toContain(
        '- /data/armorClass/value: number (no-provenance-declaration)',
      );
    } finally {
      db.close();
    }
  });

  // E2 — both section 7.2 worked cases, disclosed INSIDE their own block.
  it('discloses each projection limit in its own candidate block', () => {
    const dragonSpan = candidateSpan(
      render('P3').text,
      'creature:adult-black-dragon',
    );
    expect(dragonSpan).toContain(
      'The typed save projection omits the source success branch',
    );
    expect(dragonSpan).toContain('/data/actions/5/mechanics/saves');
    expect(dragonSpan).toContain(
      'The source describes an area, but no typed mechanics.area projection exists.',
    );

    const fireballSpan = candidateSpan(render('P4').text, 'spell:fireball');
    expect(fireballSpan).toContain(
      'The source describes an area, but no typed mechanics.area projection exists.',
    );
    // ... and the note sits beside the projection it qualifies, not after the
    // capability contract at the end of the block.
    expect(fireballSpan.indexOf('### Projection limit')).toBeGreaterThan(
      fireballSpan.indexOf('### Typed projection'),
    );
    expect(fireballSpan.indexOf('### Projection limit')).toBeLessThan(
      fireballSpan.indexOf('### Deterministic capability'),
    );
  });

  // E3 — a projection never presents itself as the adjudicated outcome, and
  // never converts into a capability.
  it('states that the typed projection does not replace the source prose', () => {
    const span = candidateSpan(
      render('P3').text,
      'creature:adult-black-dragon',
    );
    expect(span).toContain(
      '### Typed projection (does not replace the source prose above)',
    );
    // P3 carries projection limits and no positively selected capability, so
    // the presence of typed fields must not have produced a contract.
    expect(span).toContain('no capability was positively selected');
    expect(span).not.toContain('POSITIVE BOUNDED CONTRACT');
  });

  // E4 — a positively selected capability is a bounded contract.
  it('renders P8 capability availability as a positive bounded contract', () => {
    const span = candidateSpan(
      render('P8').text,
      'magic-item:ammunition-1-2-or-3',
    );
    expect(span).toContain('POSITIVE BOUNDED CONTRACT');
    expect(span).toContain('operation=hit-target');
    expect(span).toContain('revision=derived-magic-item-clauses-v1');
    expect(span).toContain('status=available');
    expect(span).toContain('- required inputs:');
    expect(span).toContain('- explicit exclusions:');
    expect(span).toContain('- residual DM interpretation:');
    // The contract's own exclusions are quoted, not restated.
    expect(span).not.toContain('explicit exclusions: none');
  });

  // E5 — absence of a binding is a bounded negative, never "no mechanics".
  it('renders capability absence with its full disclaimer', () => {
    const span = candidateSpan(
      render('P3').text,
      'creature:adult-black-dragon',
    );
    expect(span).toContain('no capability was positively selected');
    expect(span).toContain(
      'This is not a claim that the record has no mechanics, is irrelevant, or is safe to ignore.',
    );
  });

  /**
   * A DECLARED capability the phase never evaluated is not a selection.
   *
   * P4 declares `spell-upcast` for `spell:fireball`, and the offline packet
   * reports it `not-evaluated-offline`. Rendering that as a bounded contract
   * would state a commitment nothing made — the laundering design sections 7.2
   * and 7.3 forbid, and the defect this case was written against.
   */
  it('never renders an unevaluated declaration as a bounded contract', () => {
    const span = candidateSpan(render('P4').text, 'spell:fireball');
    expect(span).toContain('no capability was positively selected');
    expect(span).toContain(
      'This is not a claim that the record has no mechanics, is irrelevant, or is safe to ignore.',
    );
    expect(span).toContain(
      'A declaration is not a selection and grants nothing.',
    );
    expect(span).not.toContain('POSITIVE BOUNDED CONTRACT');
  });

  // E6 — campaign material appears beside its governing source material, with
  // the jhpt-owned identity, scope, provenance and lifecycle intact.
  it('renders a house rule and a ruling inside the governing candidate block', () => {
    const houseRule = candidateSpan(render('P10').text, 'spell:fireball');
    for (const field of [
      'identity=',
      'kind=house-rule',
      'status=',
      'scope=',
      'provenance=',
      'effective position=',
      'supersededBy=',
      'revokedPosition=',
      'governing records=',
    ])
      expect(houseRule).toContain(field);

    const ruling = candidateSpan(
      render('P7', { executionId: 'with-active-ruling' }).text,
      'magic-item:cube-of-force',
    );
    expect(ruling).toContain('kind=ruling');
    expect(ruling).toContain('- ambiguity id=');
    expect(ruling).toContain('selected interpretation id=');
  });

  // E7 — a must-consider candidate never disappears silently, under EITHER
  // budget (design section 6.3).
  it('discloses must-consider overflow from both budgets', () => {
    for (const budget of [{ maxCandidates: 1 }, { maxPacketBytes: 400 }]) {
      const rendered = render('P9', { budget });
      expect(
        rendered.mustConsiderOverflow.length,
        `budget ${JSON.stringify(budget)} produced no overflow`,
      ).toBeGreaterThan(0);
      expect(rendered.text).toContain('## Must-consider overflow');
      for (const item of rendered.mustConsiderOverflow) {
        expect(rendered.text).toContain(item.candidateKey);
        // The producer's own reason, never a replacement authored here.
        expect(rendered.text).toContain(item.reason);
        for (const route of item.routes)
          expect(rendered.text).toContain(`route ${route.routeClass}`);
      }
    }
  });

  // E8 — source ambiguity is stated, never silently resolved.
  it('renders a source ambiguity with its interpretations unresolved', () => {
    const span = candidateSpan(
      render('P7', { executionId: 'without-active-ruling' }).text,
      'magic-item:cube-of-force',
    );
    expect(span).toContain('ambiguity:cube-of-force-same-face-duration-reset');
    expect(span).toContain('- interpretations: ');
    expect(span).toContain('- canonical resolution: absent');
  });

  // E9 — section 7.3 and section 13.2: no usage claim, no score.
  it('claims no model usage and reports no coverage figure', () => {
    for (const probeId of ['P3', 'P4', 'P8', 'P9', 'P12']) {
      const rendered = render(probeId);
      expect(rendered.modelUsageClaim).toBeNull();
      expect(rendered.text).not.toMatch(
        /\b(coverage|completeness|readiness score|\d+\s*%|\d+\s*of\s*\d+\s*rules)\b/iu,
      );
      expect(rendered.text).not.toMatch(
        /\bthe model (?:used|relied on|consulted)\b/iu,
      );
    }
  });

  // E10 — an empty packet is legible as empty, and rendering is deterministic.
  it('renders an empty packet distinctly and deterministically', () => {
    const trace = {
      retention: { overflow: [] },
      packet: {
        packet: {
          candidates: [],
          bytes: 2,
          projectionLimitNotes: [],
          modelUsageClaim: null,
        },
        byteOverflow: [],
        dropped: [],
      },
    } as const;
    const first = renderContextPacketMessage(trace);
    expect(first.text).toContain('Discovery retained nothing.');
    expect(first.candidateCount).toBe(0);
    expect(renderContextPacketMessage(trace)).toEqual(first);

    // ... and a real packet renders identically twice, so the injected text a
    // later phase compares across runs is a stable fact about the packet.
    const { trace: real, db } = run('P4');
    try {
      expect(renderContextPacketMessage(real).text).toBe(
        renderContextPacketMessage(real).text,
      );
    } finally {
      db.close();
    }
  });

  // Standing structural check behind M8: a rules record that reached the
  // packet with no attribution is marked, never presented as authority.
  it('marks an unattributed provenance rather than rendering it blank', () => {
    const rendered = render('P12');
    expect(rendered.text).toContain('- sourceRef: ');
    expect(rendered.text).not.toContain('- sourceRef: \n');
  });
});
