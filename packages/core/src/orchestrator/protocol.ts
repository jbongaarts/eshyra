import type { ToolRequest } from './toolRequest.js';
import type { ToolRegistry, ToolResult } from './tools.js';

/**
 * DM system prompt and the fenced text-channel tool-call protocol (E5).
 *
 * This module owns the *fenced* transport: the model emits fenced ```tool_call
 * blocks, this parser turns them into the transport-neutral {@link ToolRequest}
 * shape the orchestrator executes, and `renderToolResults` feeds ```tool_result
 * blocks back. When the model replies with no tool_call block, that reply is the
 * final narration. Native provider tool use is a separate producer of the same
 * {@link ToolRequest} shape; the loop does not care which transport a request
 * arrived through once it has been normalized.
 */

const TOOL_CALL_FENCE = /```tool_call[^\S\n]*\n([\s\S]*?)```/g;

/**
 * Extract every fenced tool call from a model reply, in document order, as
 * transport-neutral {@link ToolRequest}s tagged `source: 'fenced'`. Malformed
 * blocks are returned as `ok: false` entries (never thrown) so the orchestrator
 * can feed the parse error back to the model as a tool_result.
 */
export function parseToolCalls(modelText: string): ToolRequest[] {
  const calls: ToolRequest[] = [];
  for (const match of modelText.matchAll(TOOL_CALL_FENCE)) {
    const raw = match[1].trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      calls.push({
        ok: false,
        source: 'fenced',
        error: `malformed tool_call JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
        raw,
      });
      continue;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { tool?: unknown }).tool !== 'string'
    ) {
      calls.push({
        ok: false,
        source: 'fenced',
        error: 'tool_call must be a JSON object with a string "tool" field',
        raw,
      });
      continue;
    }
    const obj = parsed as { tool: string; args?: unknown };
    calls.push({
      ok: true,
      source: 'fenced',
      tool: obj.tool,
      args: obj.args ?? {},
    });
  }
  return calls;
}

/**
 * Serialize tool results into the user-message text fed back to the model
 * before the next model call.
 */
export function renderToolResults(
  results: ReadonlyArray<{ tool: string; result: ToolResult }>,
): string {
  const blocks = results.map(({ tool, result }) => {
    const payload = result.ok
      ? { tool, ok: true, data: result.data }
      : { tool, ok: false, code: result.code, message: result.message };
    return ['```tool_result', JSON.stringify(payload), '```'].join('\n');
  });
  return [
    'Tool results follow. Continue the turn: call more tools if needed, ' +
      'otherwise reply with final narration only.',
    ...blocks,
  ].join('\n');
}

/**
 * Which tool transport the system prompt should describe:
 *  - `native`: tools reach the model through the provider's native tool channel
 *    (the adapter forwards the Eshyra tool definitions). The prompt MUST NOT
 *    instruct the model to emit fenced ```tool_call blocks — that confused
 *    native-tool models into reporting the described tools were "not present"
 *    (eshyra-eznk). The model calls tools through the provider mechanism.
 *  - `fenced`: legacy/test-only transport where the model emits fenced
 *    ```tool_call blocks parsed out of its text. Retained for adapters with no
 *    native tool channel and for deterministic offline tests.
 */
export type ToolProtocol = 'native' | 'fenced';

export interface BuildSystemPromptOptions {
  /** Tool transport the prompt should describe. Defaults to `fenced` (legacy). */
  readonly toolProtocol?: ToolProtocol;
}

/**
 * Build the DM system prompt: persona plus the refined-Hybrid rules contract,
 * with the live tool roster and a transport-appropriate tool-call protocol
 * section. With `toolProtocol: 'native'` the fenced-block instructions are
 * replaced by guidance to use the provider-native tool interface; with the
 * default `fenced` the legacy fenced protocol spec is appended.
 */
export function buildSystemPrompt(
  registry: ToolRegistry,
  options?: BuildSystemPromptOptions,
): string {
  const toolProtocol = options?.toolProtocol ?? 'fenced';
  const toolLines = registry
    .list()
    .sort()
    .map((name) => {
      const tool = registry.get(name);
      return `- ${name}: ${tool?.description ?? ''}`;
    });

  const explicitActionTools = registry.listRequiresExplicitAction().sort();

  const protocolSection =
    toolProtocol === 'native'
      ? [
          '## Tool-Call Protocol',
          '',
          'The tools listed above are available to you directly through your',
          'native tool interface — call them the normal way. Do NOT describe a',
          'tool call in prose and do NOT emit fenced `tool_call` blocks; issue',
          'a real tool call. You may make several tool calls in one turn; you',
          'will receive their results back as tool results. Inspect the results,',
          'call more tools if needed, and when the turn is mechanically',
          'resolved, reply with ONLY the final narration prose and no further',
          'tool calls. That tool-call-free reply is the turn the player sees.',
        ]
      : [
          '## Tool-Call Protocol',
          '',
          'To call a tool, emit a fenced block tagged `tool_call` containing a JSON',
          'object `{"tool": "<name>", "args": {...}}`. You may emit several in one',
          'reply; they run in order. Example:',
          '',
          '```tool_call',
          '{"tool": "roll", "args": {"dice": "1d20+5", "reason": "attack roll"}}',
          '```',
          '',
          'After your tool calls you will receive `tool_result` blocks. Inspect them,',
          'call more tools if needed, and when the turn is mechanically resolved,',
          'reply with ONLY the final narration prose — no tool_call block. That',
          'tool-call-free reply is the turn the player sees.',
        ];

  const inventoryGuardSection =
    explicitActionTools.length > 0
      ? [
          '## Inventory and Equipment Guard',
          '',
          `The following tools require explicit player action intent: ${explicitActionTools.join(', ')}.`,
          'Call them ONLY when the player is explicitly doing something — receiving,',
          'purchasing, dropping, using, or losing an item. Do NOT call them merely',
          'because the player asked what they are carrying or equipped with.',
          '',
          'When a player asks about their inventory or equipment:',
          '- Read the current state from the context snapshot provided — it is already there.',
          '- If the inventory is empty, say so clearly (e.g. "You have nothing recorded',
          '  in your inventory.") and offer to begin starting-equipment selection if',
          '  character setup appears incomplete. Do NOT silently populate default gear.',
          '- If inventory is partially set up, surface that as character-setup debt and',
          '  offer to continue equipment selection — do not invent missing items.',
        ]
      : [];

  return [
    'You are the Dungeon Master for a long-running solo fantasy campaign.',
    'You narrate vividly and in the second person, keep continuity with',
    'established canon, and play NPCs consistently.',
    '',
    '## The Hybrid Contract',
    '',
    'Narrate freely — prose, dialogue, description, and pacing are yours.',
    'But everything mechanical is NOT yours to assert in prose:',
    '',
    '- All dice and math go through the `roll` tool. Never invent a die result.',
    '- All changes to canonical game state go through a state tool:',
    '  `adjust_hp` for HP, `add_condition`/`remove_condition` for conditions,',
    '  `give_item`/`remove_item` for inventory, `update_clock` for time and',
    '  location, `set_plot_flag` for narrative flags, `set_world_fact` for',
    '  world-template overlays. Prose that claims a state change without a',
    '  tool call does NOT change the game — always call the tool.',
    '- Before running ANY creature in a scene (combat or otherwise) or invoking',
    '  any rules mechanic, call `lookup_rules` to fetch the real record from the',
    '  campaign rules system. Do not run a creature or rule from memory.',
    '- Use `world_query` to resolve locations, NPCs, and lore before narrating',
    '  them, and `memory_drilldown` to retrieve older history not in context.',
    '- Use `mark_scene` to open and close scenes at natural narrative breaks.',
    '',
    '## Available Tools',
    '',
    ...toolLines,
    '',
    ...(inventoryGuardSection.length > 0 ? [...inventoryGuardSection, ''] : []),
    ...protocolSection,
  ].join('\n');
}
