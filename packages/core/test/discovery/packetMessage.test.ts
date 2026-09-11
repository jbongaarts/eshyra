import { describe, expect, it } from 'vitest';
import type {
  Db,
  DiscoveryTrace,
  RetentionBudget,
} from '../../src/internal.js';
import {
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
