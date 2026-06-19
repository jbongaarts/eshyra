import { describe, expect, it } from 'vitest';
import {
  type ArcSummaryRecord,
  type CampaignBibleInput,
  extractCampaignBible,
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

const VALID_BIBLE_OUTPUT =
  '```bible_json\n' +
  '{\n' +
  '  "worldFacts": ["Emberfall sits on a fault line", "The Lantern Court rules the city"],\n' +
  '  "majorNpcs": ["Mira the runesmith", "Warden Hess"],\n' +
  '  "factions": ["Lantern Court", "Cellar Cabal"],\n' +
  '  "openThreads": ["The chalk sigil is unsolved", "The warden hinted at a debt"]\n' +
  '}\n' +
  '```';

describe('extractCampaignBible', () => {
  it('stamps campaign_bible usage trace with the campaign id (eshyra-f0hj)', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return VALID_BIBLE_OUTPUT;
    });
    await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
    });
    expect(captured?.trace?.campaignId).toBe('camp-1');
    // Bible extraction spans many recaps, so it carries no single sessionId.
    expect(captured?.trace?.sessionId).toBeUndefined();
    expect(captured?.trace?.extra?.purpose).toBe('campaign_bible');
  });

  it('parses a valid fenced bible_json block from the model', async () => {
    const model = fakeModel(() => VALID_BIBLE_OUTPUT);
    const bible = await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [
        recap(
          'session-1',
          'Mira found the chalk sigil.',
          '2026-05-20T10:00:00.000Z',
        ),
      ],
    });
    expect(bible.worldFacts).toEqual([
      'Emberfall sits on a fault line',
      'The Lantern Court rules the city',
    ]);
    expect(bible.majorNpcs).toEqual(['Mira the runesmith', 'Warden Hess']);
    expect(bible.factions).toEqual(['Lantern Court', 'Cellar Cabal']);
    expect(bible.openThreads).toEqual([
      'The chalk sigil is unsolved',
      'The warden hinted at a debt',
    ]);
  });

  it('renders each session recap into the user prompt', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return VALID_BIBLE_OUTPUT;
    });
    await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [
        recap(
          'session-1',
          'Mira found the chalk sigil.',
          '2026-05-20T10:00:00.000Z',
        ),
      ],
    });
    expect(captured?.system).toMatch(/world facts/i);
    expect(captured?.messages).toHaveLength(1);
    const userContent = captured?.messages[0].content ?? '';
    expect(userContent).toContain('session-1');
    expect(userContent).toContain('Mira found the chalk sigil.');
  });

  it('throws MemorySummaryError when the model response has no fenced bible_json block', async () => {
    const model = fakeModel(() => 'Here is the bible: {"worldFacts": []}');
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      }),
    ).rejects.toBeInstanceOf(MemorySummaryError);
  });

  it("passes responseFormat: 'json' to the ModelClient (loreweaver-cuu)", async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return VALID_BIBLE_OUTPUT;
    });
    await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
    });
    // The bible extractor is the JSON-only call site in core; setting the hint
    // lets future adapters opt into a native JSON mode without changing this
    // call site again.
    expect(captured?.responseFormat).toBe('json');
  });

  it('accepts a raw JSON response when an adapter strips the fence (loreweaver-cuu)', async () => {
    // Simulates a future provider adapter that honours responseFormat: 'json'
    // and returns the JSON payload without the markdown wrapper.
    const RAW_JSON_OUTPUT = JSON.stringify({
      worldFacts: ['Emberfall sits on a fault line'],
      majorNpcs: ['Mira the runesmith'],
      factions: ['Lantern Court'],
      openThreads: ['The chalk sigil is unsolved'],
    });
    const model = fakeModel(() => RAW_JSON_OUTPUT);
    const bible = await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
    });
    expect(bible.majorNpcs).toEqual(['Mira the runesmith']);
    expect(bible.openThreads).toEqual(['The chalk sigil is unsolved']);
  });

  it('throws MemorySummaryError when the fenced content is not valid JSON', async () => {
    const model = fakeModel(() => '```bible_json\nnot json at all\n```');
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      }),
    ).rejects.toBeInstanceOf(MemorySummaryError);
  });

  it('throws MemorySummaryError when the JSON has the wrong shape', async () => {
    const model = fakeModel(
      () => '```bible_json\n{"worldFacts": ["ok"], "majorNpcs": ["ok"]}\n```',
    );
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      }),
    ).rejects.toBeInstanceOf(MemorySummaryError);
  });

  it('propagates ModelClientError from the provider', async () => {
    const model: ModelClient = {
      complete: async () => {
        throw new ModelClientError('boom');
      },
    };
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      }),
    ).rejects.toBeInstanceOf(ModelClientError);
  });

  it('throws MemorySummaryError when recaps is empty', async () => {
    const model: ModelClient = {
      complete: async () => ({ text: 'unused' }),
    };
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [],
      }),
    ).rejects.toBeInstanceOf(MemorySummaryError);
  });

  it('system prompt instructs the model not to silently drop prior entries', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return VALID_BIBLE_OUTPUT;
    });
    await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
    });
    const system = captured?.system ?? '';
    expect(system).toMatch(/previously known bible/i);
    expect(system).toMatch(/going unmentioned is not a reason to drop them/i);
  });

  it('renders a previously known bible block when priorBible is populated', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return VALID_BIBLE_OUTPUT;
    });
    const priorBible: CampaignBibleInput = {
      worldFacts: ['Emberfall sits on a fault line'],
      majorNpcs: ['Mira the runesmith', 'Warden Hess'],
      factions: ['Lantern Court'],
      openThreads: ['The chalk sigil is unsolved'],
    };
    await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [recap('session-1', 'A new event.', '2026-05-21T10:00:00.000Z')],
      priorBible,
    });
    const userContent = captured?.messages[0].content ?? '';
    expect(userContent).toContain('## previously known bible');
    expect(userContent).toContain('### worldFacts');
    expect(userContent).toContain('- Emberfall sits on a fault line');
    expect(userContent).toContain('### majorNpcs');
    expect(userContent).toContain('- Mira the runesmith');
    expect(userContent).toContain('- Warden Hess');
    expect(userContent).toContain('### factions');
    expect(userContent).toContain('- Lantern Court');
    expect(userContent).toContain('### openThreads');
    expect(userContent).toContain('- The chalk sigil is unsolved');
    // Prior bible appears before the recap section.
    const bibleIdx = userContent.indexOf('## previously known bible');
    const sessionIdx = userContent.indexOf('## session-1');
    expect(bibleIdx).toBeGreaterThanOrEqual(0);
    expect(sessionIdx).toBeGreaterThan(bibleIdx);
  });

  it('renders empty lists in a priorBible as (none) placeholders', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return VALID_BIBLE_OUTPUT;
    });
    const priorBible: CampaignBibleInput = {
      worldFacts: ['Just one fact'],
      majorNpcs: [],
      factions: [],
      openThreads: [],
    };
    await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [recap('session-1', 'r', '2026-05-21T10:00:00.000Z')],
      priorBible,
    });
    const userContent = captured?.messages[0].content ?? '';
    expect(userContent).toContain('### majorNpcs\n(none)');
    expect(userContent).toContain('### factions\n(none)');
    expect(userContent).toContain('### openThreads\n(none)');
  });

  it('renders closed arc summaries in input order before the recaps', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return VALID_BIBLE_OUTPUT;
    });
    const arcSummary = (
      arcId: string,
      summary: string,
      createdAt: string,
    ): ArcSummaryRecord => ({
      campaignId: 'camp-1',
      arcId,
      summary,
      sourceSessionIds: [],
      createdAt,
      updatedAt: createdAt,
    });
    await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [recap('session-9', 'r', '2026-05-22T10:00:00.000Z')],
      closedArcSummaries: [
        arcSummary(
          'arc-1',
          'The party rescued the runesmith.',
          '2026-05-01T10:00:00.000Z',
        ),
        arcSummary(
          'arc-2',
          'They cracked the Lantern Court.',
          '2026-05-15T10:00:00.000Z',
        ),
      ],
    });
    const userContent = captured?.messages[0].content ?? '';
    expect(userContent).toContain('## closed arc summaries');
    const arc1Idx = userContent.indexOf(
      '- arc-1: The party rescued the runesmith.',
    );
    const arc2Idx = userContent.indexOf(
      '- arc-2: They cracked the Lantern Court.',
    );
    const sessionIdx = userContent.indexOf('## session-9');
    expect(arc1Idx).toBeGreaterThanOrEqual(0);
    expect(arc2Idx).toBeGreaterThan(arc1Idx);
    expect(sessionIdx).toBeGreaterThan(arc2Idx);
  });

  it('falls back to the legacy recap-only layout when priorBible and closedArcSummaries are absent', async () => {
    let capturedNew: ModelCompleteInput | undefined;
    const newModel = fakeModel((input) => {
      capturedNew = input;
      return VALID_BIBLE_OUTPUT;
    });
    const sample: SessionRecapRecord = recap(
      'session-1',
      'Mira found the chalk sigil.',
      '2026-05-20T10:00:00.000Z',
    );
    await extractCampaignBible(newModel, {
      campaignId: 'camp-1',
      recaps: [sample],
    });
    const newContent = capturedNew?.messages[0].content ?? '';
    expect(newContent).not.toContain('## previously known bible');
    expect(newContent).not.toContain('## closed arc summaries');
    expect(newContent.startsWith('## session-1')).toBe(true);
  });

  it('treats an all-empty priorBible as absent (no rendered block)', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return VALID_BIBLE_OUTPUT;
    });
    const emptyBible: CampaignBibleInput = {
      worldFacts: [],
      majorNpcs: [],
      factions: [],
      openThreads: [],
    };
    await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      priorBible: emptyBible,
      closedArcSummaries: [],
    });
    const userContent = captured?.messages[0].content ?? '';
    expect(userContent).not.toContain('## previously known bible');
    expect(userContent).not.toContain('## closed arc summaries');
    expect(userContent.startsWith('## session-1')).toBe(true);
  });
});
