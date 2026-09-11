import { describe, expect, it } from 'vitest';
import {
  renderContextPacketMessage,
  runDiscoveryStages,
} from '../../src/internal.js';
import { DIAGNOSTIC_FIXTURES } from '../diagnostics/index.js';
import { freshDbWithSession } from '../support/db.js';
import { installJhptCampaignRules } from './support/jhptCampaignRules.js';
import { moduleForFixture, scenarioForFixture } from './support/scenario.js';

function run(probeId: string) {
  const fixture = DIAGNOSTIC_FIXTURES.find((item) => item.probeId === probeId);
  if (fixture === undefined) throw new Error(`missing fixture ${probeId}`);
  const execution = fixture.executions[0];
  const db = freshDbWithSession();
  const module = moduleForFixture(fixture);
  const rulesPackResolver = undefined;
  const campaignRules = installJhptCampaignRules(
    db,
    fixture,
    execution,
    rulesPackResolver,
  );
  const trace = runDiscoveryStages({
    db,
    rulesPackResolver,
    scenario: scenarioForFixture(fixture, execution, module),
    campaignRuleSeam: campaignRules.seam,
    campaignPosition: campaignRules.campaignPosition,
  });
  return { trace, db };
}

describe('context-packet message renderer', () => {
  it('renders real Fireball and dragon prose, with limits in-band', () => {
    const { trace, db } = run('P3');
    try {
      const rendered = renderContextPacketMessage(trace);
      expect(rendered.text).toContain(
        'or half as much damage on a successful one',
      );
      expect(rendered.text).toContain(
        'The typed save projection omits the source success branch',
      );
      expect(rendered.text).not.toContain('\\n');
      expect(rendered.text).not.toContain('\\"');
      expect(rendered.modelUsageClaim).toBeNull();
      expect(rendered.bytes).toBe(Buffer.byteLength(rendered.text, 'utf8'));
    } finally {
      db.close();
    }
  });

  it('renders Fireball area prose and its projection limit', () => {
    const { trace, db } = run('P4');
    try {
      const rendered = renderContextPacketMessage(trace);
      expect(rendered.text).toContain('a 20-foot-radius sphere');
      expect(rendered.text).toContain(
        'The source describes an area, but no typed mechanics.area projection exists.',
      );
    } finally {
      db.close();
    }
  });

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
    expect(renderContextPacketMessage(trace)).toEqual(first);
  });
});
