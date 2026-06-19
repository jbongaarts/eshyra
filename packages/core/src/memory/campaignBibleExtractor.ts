import type { ModelClient, ModelMessage } from '../model/client.js';
import type {
  ArcSummaryRecord,
  CampaignBibleInput,
  SessionRecapRecord,
} from './summary.js';
import { MemorySummaryError } from './summary.js';

const BIBLE_EXTRACTOR_SYSTEM_PROMPT = [
  'You extract structured world facts from session recaps of a fantasy tabletop campaign.',
  'Read the chronological session recaps in the user message and identify:',
  '- worldFacts: durable facts about the setting (places, magic, weather, geography)',
  '- majorNpcs: named non-player characters who have appeared',
  '- factions: named groups, organizations, or political entities',
  '- openThreads: unresolved plot threads, dangling questions, hooks for future play',
  'Each entry must be a short noun phrase or sentence under 20 words.',
  'A "## previously known bible" section may appear before the recaps. Treat every entry in it as canonical: include it in your output unless the recaps explicitly contradict or retire it.',
  'Only drop a previously known entry if the recaps explicitly contradict it or it was clearly an error. Long-lived entities often go off-screen for many sessions — going unmentioned is not a reason to drop them.',
  'When an entry from "openThreads" is resolved by the recaps, omit it from your output\'s openThreads list. Do not introduce a closedThreads field; resolution tracking lives in a future schema change.',
  'Output ONLY a fenced JSON block tagged "bible_json" with this exact shape:',
  '```bible_json',
  '{"worldFacts":[],"majorNpcs":[],"factions":[],"openThreads":[]}',
  '```',
  'Do not include any other text outside the fenced block.',
].join('\n');

const BIBLE_FENCE = /```bible_json\s*\n([\s\S]*?)\n?```/;

export interface ExtractCampaignBibleInput {
  campaignId: string;
  recaps: SessionRecapRecord[];
  /**
   * Previously known bible to seed the extraction. Rendered as a
   * `## previously known bible` block; the model is instructed to carry every
   * entry forward unless the recaps explicitly contradict it. Omit (or pass an
   * all-empty value) on the first-ever extraction call.
   */
  priorBible?: CampaignBibleInput;
  /**
   * Arc summaries for already-closed arcs, in chronological order. Rendered as
   * a `## closed arc summaries` block before the recaps so the model has the
   * shape of the campaign's earlier arcs even when only the open arc's recaps
   * are passed in via {@link recaps}.
   */
  closedArcSummaries?: ArcSummaryRecord[];
}

export async function extractCampaignBible(
  model: ModelClient,
  input: ExtractCampaignBibleInput,
): Promise<CampaignBibleInput> {
  if (input.recaps.length === 0) {
    throw new MemorySummaryError(
      'extractCampaignBible requires at least one session recap',
    );
  }
  const userContent = renderUserContent(input);
  const messages: ModelMessage[] = [{ role: 'user', content: userContent }];
  const result = await model.complete({
    system: BIBLE_EXTRACTOR_SYSTEM_PROMPT,
    messages,
    // JSON-only site (loreweaver-cuu): the system prompt demands a JSON-shaped
    // response. Adapters with a native JSON mode (e.g. provider response_format)
    // may opt in; today's Agent SDK adapter ignores the hint per the contract.
    responseFormat: 'json',
    // Usage attribution (eshyra-f0hj): mark this maintenance call so `eshyra
    // usage` groups it as a campaign-bible extraction rather than a generic
    // maintenance call. Spans many recaps, so it carries no single sessionId.
    trace: {
      campaignId: input.campaignId,
      extra: { purpose: 'campaign_bible' },
    },
  });
  return parseBibleResponse(result.text);
}

/**
 * Extract the campaign bible payload from a model response. Accepts both the
 * fenced form the prompt asks for (a `bible_json` fenced code block wrapping
 * `{...}`) AND a raw JSON object — the latter is the shape a future JSON-mode
 * adapter is permitted to return when it honours `responseFormat: 'json'` and
 * strips the markdown
 * wrapper, so the call site stays robust across adapter capabilities.
 */
function parseBibleResponse(raw: string): CampaignBibleInput {
  const match = BIBLE_FENCE.exec(raw);
  const payload = match !== null ? match[1] : raw.trim();
  if (payload === '') {
    throw new MemorySummaryError('campaign bible response was empty');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new MemorySummaryError(
      match !== null
        ? `campaign bible response could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`
        : 'campaign bible response missing fenced bible_json block and was not raw JSON',
    );
  }
  if (!isCampaignBibleInput(parsed)) {
    throw new MemorySummaryError(
      'campaign bible response did not match the {worldFacts, majorNpcs, factions, openThreads}: string[] shape',
    );
  }
  return parsed;
}

function isCampaignBibleInput(value: unknown): value is CampaignBibleInput {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    isStringArray(obj.worldFacts) &&
    isStringArray(obj.majorNpcs) &&
    isStringArray(obj.factions) &&
    isStringArray(obj.openThreads)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function renderUserContent(input: ExtractCampaignBibleInput): string {
  const sections: string[] = [];
  const priorBibleBlock = renderPriorBible(input.priorBible);
  if (priorBibleBlock !== '') sections.push(priorBibleBlock);
  const closedArcsBlock = renderClosedArcSummaries(input.closedArcSummaries);
  if (closedArcsBlock !== '') sections.push(closedArcsBlock);
  sections.push(renderRecaps(input.recaps));
  return sections.join('\n\n');
}

function renderPriorBible(bible: CampaignBibleInput | undefined): string {
  if (bible === undefined) return '';
  const total =
    bible.worldFacts.length +
    bible.majorNpcs.length +
    bible.factions.length +
    bible.openThreads.length;
  if (total === 0) return '';

  const lists: [string, string[]][] = [
    ['worldFacts', bible.worldFacts],
    ['majorNpcs', bible.majorNpcs],
    ['factions', bible.factions],
    ['openThreads', bible.openThreads],
  ];
  const blocks = lists.map(([label, entries]) => {
    if (entries.length === 0) return `### ${label}\n(none)`;
    return `### ${label}\n${entries.map((e) => `- ${e}`).join('\n')}`;
  });
  return ['## previously known bible', ...blocks].join('\n');
}

function renderClosedArcSummaries(
  arcs: ArcSummaryRecord[] | undefined,
): string {
  if (arcs === undefined || arcs.length === 0) return '';
  const lines = arcs.map((arc) => `- ${arc.arcId}: ${arc.summary}`);
  return ['## closed arc summaries', ...lines].join('\n');
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
