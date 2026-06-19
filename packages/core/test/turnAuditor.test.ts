import { describe, expect, it } from 'vitest';
import type {
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from '../src/model/client.js';
import {
  AuditError,
  ModelTurnAuditor,
  parseAuditVerdict,
} from '../src/orchestrator/turnAuditor.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';

/**
 * Unit coverage for the mechanics-audit gate (eshyra-oobh): strict-JSON verdict
 * parsing and the model-backed auditor. No live model call — the auditor's model
 * client is a deterministic fake.
 */

/** A model client that records its input and returns a fixed text reply. */
class FakeAuditModel implements ModelClient {
  readonly seen: ModelCompleteInput[] = [];
  constructor(private readonly reply: string) {}
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    return Promise.resolve({ text: this.reply });
  }
}

const rollExecuted: ExecutedToolCall = {
  tool: 'roll',
  args: { dice: '2d8' },
  result: { ok: true, data: { total: 11 } },
  source: 'native-mcp',
};

describe('parseAuditVerdict', () => {
  it('parses a clean accept verdict', () => {
    const v = parseAuditVerdict(
      '{"verdict":"accept","missingRequiredTools":[],"reason":"ok","repairInstruction":""}',
    );
    expect(v.verdict).toBe('accept');
    expect(v.missingRequiredTools).toEqual([]);
  });

  it('parses a reject verdict with missing tools', () => {
    const v = parseAuditVerdict(
      '{"verdict":"reject","missingRequiredTools":["roll"],"reason":"dice without roll","repairInstruction":"call roll"}',
    );
    expect(v.verdict).toBe('reject');
    expect(v.missingRequiredTools).toEqual(['roll']);
    expect(v.repairInstruction).toBe('call roll');
  });

  it('tolerates a fenced JSON block', () => {
    const v = parseAuditVerdict(
      '```json\n{"verdict":"accept","missingRequiredTools":[]}\n```',
    );
    expect(v.verdict).toBe('accept');
  });

  it('tolerates surrounding prose by extracting the object', () => {
    const v = parseAuditVerdict(
      'Here is my verdict: {"verdict":"reject","missingRequiredTools":["roll"]} done.',
    );
    expect(v.verdict).toBe('reject');
    expect(v.missingRequiredTools).toEqual(['roll']);
  });

  it('throws AuditError on a non-JSON reply', () => {
    expect(() => parseAuditVerdict('I think it is fine')).toThrowError(
      AuditError,
    );
  });

  it('throws AuditError on an invalid verdict value', () => {
    expect(() =>
      parseAuditVerdict('{"verdict":"maybe","missingRequiredTools":[]}'),
    ).toThrowError(AuditError);
  });
});

describe('ModelTurnAuditor', () => {
  it('delegates to the model and returns the parsed verdict', async () => {
    const model = new FakeAuditModel(
      '{"verdict":"reject","missingRequiredTools":["roll"],"reason":"r","repairInstruction":"call roll"}',
    );
    const auditor = new ModelTurnAuditor(model, 'claude-haiku-test');

    const verdict = await auditor.audit({
      playerInput: 'roll 2d8',
      candidateResponse: 'You rolled an 11.',
      providedToolNames: ['roll', 'world_query'],
      executedToolCalls: [],
    });

    expect(verdict.verdict).toBe('reject');
    expect(auditor.modelId).toBe('claude-haiku-test');
    // The auditor asks for JSON and carries NO Eshyra tools (it only judges).
    expect(model.seen).toHaveLength(1);
    expect(model.seen[0].responseFormat).toBe('json');
    expect(model.seen[0].tools).toBeUndefined();
  });

  it('includes executed tool calls (incl. native-mcp) and provided tools in the prompt', async () => {
    const model = new FakeAuditModel(
      '{"verdict":"accept","missingRequiredTools":[]}',
    );
    const auditor = new ModelTurnAuditor(model, 'm');

    await auditor.audit({
      playerInput: 'roll 2d8',
      candidateResponse: 'You rolled an 11.',
      providedToolNames: ['roll'],
      executedToolCalls: [rollExecuted],
    });

    const userMessage = model.seen[0].messages[0].content;
    expect(userMessage).toContain('roll');
    expect(userMessage).toContain('native-mcp');
    // The candidate and player input are presented for judgement.
    expect(userMessage).toContain('You rolled an 11.');
    expect(userMessage).toContain('roll 2d8');
  });

  it('forwards the audit trace purpose for debug labelling', async () => {
    const model = new FakeAuditModel(
      '{"verdict":"accept","missingRequiredTools":[]}',
    );
    const auditor = new ModelTurnAuditor(model, 'm');
    await auditor.audit({
      playerInput: 'p',
      candidateResponse: 'c',
      providedToolNames: [],
      executedToolCalls: [],
      trace: { sessionId: 's1', extra: { purpose: 'turn_audit' } },
    });
    expect(model.seen[0].trace?.extra?.purpose).toBe('turn_audit');
  });
});
