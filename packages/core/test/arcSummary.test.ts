import { describe, expect, it } from 'vitest';
import {
  composeArcSummary,
  MemorySummaryError,
  type ModelClient,
  ModelClientError,
  type ModelCompleteInput,
  type SessionRecapRecord,
} from '../src/internal.js';

function fakeModel(
  handler: (input: ModelCompleteInput) => Promise<string> | string,
): ModelClient {
  return {
    complete: async (input) => ({ text: await handler(input) }),
  };
}

function recap(
  sessionId: string,
  text: string,
  createdAt: string,
  stateDelta: SessionRecapRecord['stateDelta'] = [],
): SessionRecapRecord {
  return {
    campaignId: 'camp-1',
    sessionId,
    recap: text,
    sourceSceneIds: [],
    stateDelta,
    createdAt,
    updatedAt: createdAt,
  };
}

const EMPTY_BIBLE = {
  worldFacts: [],
  majorNpcs: [],
  factions: [],
  openThreads: [],
};

const NON_EMPTY_BIBLE = {
  worldFacts: ['Emberfall sits on a fault line'],
  majorNpcs: ['Mira the runesmith'],
  factions: ['Lantern Court'],
  openThreads: ['The chalk sigil is unsolved'],
};

describe('composeArcSummary', () => {
  it('returns the model-authored summary text verbatim', async () => {
    const model = fakeModel(() => 'You opened the wayhouse door.');
    const summary = await composeArcSummary(model, {
      campaignId: 'camp-1',
      arcId: 'arc-1',
      recaps: [
        recap(
          'session-1',
          'Mira found the chalk sigil.',
          '2026-05-20T10:00:00.000Z',
        ),
        recap(
          'session-2',
          'The warden welcomed you in.',
          '2026-05-21T10:00:00.000Z',
        ),
      ],
      bible: EMPTY_BIBLE,
    });
    expect(summary).toBe('You opened the wayhouse door.');
  });

  it('renders each session recap and stateDelta into the user prompt', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return 'OK';
    });
    await composeArcSummary(model, {
      campaignId: 'camp-1',
      arcId: 'arc-1',
      recaps: [
        recap(
          'session-1',
          'Mira found the chalk sigil.',
          '2026-05-20T10:00:00.000Z',
          [
            {
              target: 'plot_flags',
              field: 'found_sigil',
              op: 'set',
              value: true,
            },
          ],
        ),
      ],
      bible: EMPTY_BIBLE,
    });
    expect(captured?.system).toMatch(/continuity primer/i);
    expect(captured?.messages).toHaveLength(1);
    const userContent = captured?.messages[0].content ?? '';
    expect(userContent).toContain('session-1');
    expect(userContent).toContain('Mira found the chalk sigil.');
    expect(userContent).toContain('found_sigil');
  });

  it('renders the campaign bible into the user prompt', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return 'OK';
    });
    await composeArcSummary(model, {
      campaignId: 'camp-1',
      arcId: 'arc-1',
      recaps: [
        recap(
          'session-1',
          'Mira found the chalk sigil.',
          '2026-05-20T10:00:00.000Z',
        ),
      ],
      bible: NON_EMPTY_BIBLE,
    });
    const userContent = captured?.messages[0].content ?? '';
    expect(userContent).toContain('campaign bible');
    expect(userContent).toContain('Emberfall sits on a fault line');
    expect(userContent).toContain('Mira the runesmith');
    expect(userContent).toContain('Lantern Court');
    expect(userContent).toContain('The chalk sigil is unsolved');
  });

  it('stamps arc_rollup usage trace with campaign and arc ids (eshyra-f0hj)', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return 'OK';
    });
    await composeArcSummary(model, {
      campaignId: 'camp-1',
      arcId: 'arc-1',
      recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      bible: EMPTY_BIBLE,
    });
    expect(captured?.trace?.campaignId).toBe('camp-1');
    expect(captured?.trace?.arcId).toBe('arc-1');
    expect(captured?.trace?.extra?.purpose).toBe('arc_rollup');
  });

  it('propagates ModelClientError from the provider', async () => {
    const model: ModelClient = {
      complete: async () => {
        throw new ModelClientError('boom');
      },
    };
    await expect(
      composeArcSummary(model, {
        campaignId: 'camp-1',
        arcId: 'arc-1',
        recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
        bible: EMPTY_BIBLE,
      }),
    ).rejects.toBeInstanceOf(ModelClientError);
  });

  it('throws MemorySummaryError when recaps is empty', async () => {
    const model: ModelClient = {
      complete: async () => ({ text: 'unused' }),
    };
    await expect(
      composeArcSummary(model, {
        campaignId: 'camp-1',
        arcId: 'arc-1',
        recaps: [],
        bible: EMPTY_BIBLE,
      }),
    ).rejects.toBeInstanceOf(MemorySummaryError);
  });
});
