import type { ModelClient, ModelMessage } from '../model/client.js';
import type { CampaignBibleInput, SessionRecapRecord } from './summary.js';
import { MemorySummaryError } from './summary.js';

/**
 * System prompt the arc-summary model call runs under. The text is shaped for
 * the future-DM-model audience: a continuity primer it can read on the next
 * session to keep canon and tone consistent across multi-session arcs.
 */
const ARC_SUMMARY_SYSTEM_PROMPT = [
  'You write continuity primers for a fantasy tabletop campaign DM model.',
  'Read the chronological session recaps below and produce a concise narrative',
  'summary of the campaign arc so far, suitable to feed back into the DM model',
  'context in future sessions. Write in second person, present tense.',
  'Target 300-500 words. Highlight ongoing threads, named NPCs, factions, and',
  'recent canon mutations.',
  'A campaign bible of established world facts, NPCs, factions, and open threads is provided before the recaps; reference its entries canonically.',
  'Write as an in-world chronicle; do not address the',
  'player about meta concerns.',
].join(' ');

export interface ComposeArcSummaryInput {
  campaignId: string;
  arcId: string;
  recaps: SessionRecapRecord[];
  bible: CampaignBibleInput;
}

/**
 * Author an arc summary from the campaign's ordered session recaps.
 *
 * Pure read-side: no DB access, no writes. Caller supplies the recap list and
 * a ModelClient; the returned text is the model's completion verbatim. Errors
 * from the provider propagate as ModelClientError per the ModelClient
 * contract; the caller decides how to handle them (the CLI close pipeline
 * skips the rollup and logs a warning).
 */
export async function composeArcSummary(
  model: ModelClient,
  input: ComposeArcSummaryInput,
): Promise<string> {
  if (input.recaps.length === 0) {
    throw new MemorySummaryError(
      'composeArcSummary requires at least one session recap',
    );
  }
  const userContent = renderBibleAndRecaps(input.bible, input.recaps);
  const messages: ModelMessage[] = [{ role: 'user', content: userContent }];
  const result = await model.complete({
    system: ARC_SUMMARY_SYSTEM_PROMPT,
    messages,
    // Usage attribution (eshyra-f0hj): mark this maintenance call as an arc
    // rollup and stamp the arc it summarizes. Spans many sessions, so it
    // carries no single sessionId.
    trace: {
      campaignId: input.campaignId,
      arcId: input.arcId,
      extra: { purpose: 'arc_rollup' },
    },
  });
  return result.text;
}

function renderBibleAndRecaps(
  bible: CampaignBibleInput,
  recaps: SessionRecapRecord[],
): string {
  return [renderBible(bible), renderRecaps(recaps)].join('\n\n');
}

function renderBible(bible: CampaignBibleInput): string {
  const sections: Array<readonly [string, readonly string[]]> = [
    ['worldFacts', bible.worldFacts],
    ['majorNpcs', bible.majorNpcs],
    ['factions', bible.factions],
    ['openThreads', bible.openThreads],
  ];
  const blocks = sections.map(([name, items]) => {
    const body =
      items.length === 0 ? '(none)' : items.map((s) => `- ${s}`).join('\n');
    return `### ${name}\n${body}`;
  });
  return ['## campaign bible', ...blocks].join('\n');
}

function renderRecaps(recaps: SessionRecapRecord[]): string {
  const blocks = recaps.map((recap) => {
    const delta =
      recap.stateDelta.length === 0
        ? '(no canon mutations)'
        : recap.stateDelta
            .map((entry) => `  - ${JSON.stringify(entry)}`)
            .join('\n');
    return [
      `## ${recap.sessionId} (${recap.createdAt})`,
      recap.recap,
      'Canon mutations:',
      delta,
    ].join('\n');
  });
  return blocks.join('\n\n');
}
