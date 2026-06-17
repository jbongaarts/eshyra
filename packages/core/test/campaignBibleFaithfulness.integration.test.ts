import { describe, expect, it } from 'vitest';
import {
  AgentSdkModelClient,
  type CampaignBibleInput,
  extractCampaignBible,
  type SessionRecapRecord,
} from '../src/index.js';
import { resolveLiveModelAuth } from './support/liveModelAuth.js';

/**
 * Live-API faithfulness proof for the campaign bible (loreweaver-q0d).
 *
 * The deterministic tests in `campaignBibleExtractor.test.ts` prove the
 * *input shape* is right — the prior bible appears in the user content and
 * the system prompt carries the no-omit instruction. This test proves the
 * model actually honors that instruction across multiple iterations.
 *
 * Scenario: a single named NPC (Mira the runesmith) is introduced in
 * session-1 and never mentioned again across sessions 2-10. At each
 * iteration we re-extract the bible, feeding the previous iteration's
 * output back in as `priorBible` — the same pattern the CLI uses at every
 * arc-rollover (loreweaver-1jv). The faithfulness contract says Mira must
 * still appear in `majorNpcs` after iteration 10.
 *
 * Like `model.integration.test.ts`, this test is gated on either
 * `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (API key wins when both are
 * set) and is part of the documented set of always-skipped tests when no
 * provider credential is supplied (see `AGENTS.md`). The default model is
 * Opus 4.8; `ESHYRA_MODEL` overrides it.
 */

const liveAuth = resolveLiveModelAuth();

const CAMPAIGN_ID = 'faithfulness-camp';

function recap(
  sessionId: string,
  text: string,
  createdAt: string,
): SessionRecapRecord {
  return {
    campaignId: CAMPAIGN_ID,
    sessionId,
    recap: text,
    sourceSceneIds: [],
    stateDelta: [],
    createdAt,
    updatedAt: createdAt,
  };
}

const RECAPS: SessionRecapRecord[] = [
  recap(
    'session-1',
    'Mira the runesmith joined the party in Emberfall, swearing to hunt down the chalk sigil that scarred her forge. She demonstrated a rune-etched blade that hums in moonlight.',
    '2026-05-01T10:00:00.000Z',
  ),
  recap(
    'session-2',
    "The party investigated a noble's missing emerald in the tea-house. Captain Hess questioned them at length about an unrelated tavern brawl from years prior.",
    '2026-05-02T10:00:00.000Z',
  ),
  recap(
    'session-3',
    'A coastal storm grounded a merchant cog at Saltrim Wharf. The crew bartered passage to the southern islands in exchange for help repairing a snapped mast.',
    '2026-05-03T10:00:00.000Z',
  ),
  recap(
    'session-4',
    'A wandering troupe of bards played at the Copper Cup. One bard cheated at dice and was chased into the alleys by a small mob of dockworkers.',
    '2026-05-04T10:00:00.000Z',
  ),
  recap(
    'session-5',
    'A wagon carrying salted fish overturned on the cliff road. The party helped right it and shared the meal with a family of pilgrims headed to a hill shrine.',
    '2026-05-05T10:00:00.000Z',
  ),
  recap(
    'session-6',
    'A young alchemist asked for help collecting moonpetal blossoms from the cliffside gardens. They returned with a basket of blossoms and a sprained ankle.',
    '2026-05-06T10:00:00.000Z',
  ),
  recap(
    'session-7',
    'A guild of dockside laborers met in secret to draft a petition for higher wages. A passing magistrate found their argument strangely cogent.',
    '2026-05-07T10:00:00.000Z',
  ),
  recap(
    'session-8',
    "Heavy fog rolled in and the lighthouse-keeper's lamp guttered out. The party climbed the cliff stairs to relight the wick and bring word to the watch.",
    '2026-05-08T10:00:00.000Z',
  ),
  recap(
    'session-9',
    'A street magician demonstrated a parlor trick that turned out to be an actual minor enchantment. The local magistrates demanded he register or stop.',
    '2026-05-09T10:00:00.000Z',
  ),
  recap(
    'session-10',
    "A festival of lanterns lit up Emberfall's harbor. Children released paper boats and the party watched the tide carry them out to sea.",
    '2026-05-10T10:00:00.000Z',
  ),
];

describe.skipIf(!liveAuth.available)(
  'campaign bible faithfulness over 10 iterations',
  () => {
    it('keeps the session-1 NPC in majorNpcs even after 9 off-screen recaps', async () => {
      if (!liveAuth.available) return; // narrows the union; describe already skips
      const client = new AgentSdkModelClient(liveAuth.model, liveAuth.auth);

      let priorBible: CampaignBibleInput | undefined;
      for (let n = 1; n <= RECAPS.length; n++) {
        const recapsSoFar = RECAPS.slice(0, n);
        priorBible = await extractCampaignBible(client, {
          campaignId: CAMPAIGN_ID,
          recaps: recapsSoFar,
          priorBible,
        });
      }

      const npcs = priorBible?.majorNpcs ?? [];
      const hasMira = npcs.some((entry) => /mira/i.test(entry));
      expect(
        hasMira,
        `expected an entry containing 'mira' (case-insensitive) in majorNpcs after 10 iterations; got ${JSON.stringify(npcs)}`,
      ).toBe(true);
    }, 600_000);
  },
);
