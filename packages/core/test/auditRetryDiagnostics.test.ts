import { describe, expect, it } from 'vitest';
import type { AuditVerdict } from '../src/internal.js';
import {
  classifyAuditPresentationRepair,
  classifyAuditRetryCause,
} from '../src/orchestrator/auditRetryDiagnostics.js';
import type { ExecutedToolCall } from '../src/orchestrator/turnLoop.js';

function reject(overrides: Partial<AuditVerdict>): AuditVerdict {
  return {
    verdict: 'reject',
    missingRequiredTools: [],
    missingRequiredCalls: [],
    disallowedToolCalls: [],
    reason: 'rejected',
    repairInstruction: 'repair',
    ...overrides,
  };
}

function toolCall(
  tool: string,
  result: ExecutedToolCall['result'],
): ExecutedToolCall {
  return {
    tool,
    args: {},
    result,
    mutates: false,
    source: 'native',
  };
}

describe('audit retry diagnostics', () => {
  it('classifies explicit presentation-only roll ledger repair', () => {
    expect(
      classifyAuditPresentationRepair(
        reject({
          missingRequiredCalls: [{ tool: 'roll' }],
          presentationOnlyRepair: { kind: 'roll_ledger' },
        }),
        [
          toolCall('roll', {
            ok: true,
            data: {
              dice: '1d20+5',
              reason: 'attack',
              visibility: 'player_visible',
              category: 'attack',
              rolls: [12],
              modifier: 5,
              total: 17,
            },
          }),
        ],
      ),
    ).toBe('presentation_only_roll_ledger');
  });

  it('does not repair roll presentation when visibility or category metadata is missing', () => {
    expect(
      classifyAuditPresentationRepair(
        reject({ presentationOnlyRepair: { kind: 'roll_ledger' } }),
        [
          toolCall('roll', {
            ok: true,
            data: {
              dice: '1d20+5',
              reason: 'attack',
              rolls: [12],
              modifier: 5,
              total: 17,
            },
          }),
        ],
      ),
    ).toBeNull();
  });

  it('does not repair presentation when state, evidence, disallowed-tool, or failed-tool issues remain', () => {
    expect(
      classifyAuditPresentationRepair(
        reject({
          missingRequiredCalls: [{ tool: 'update_combatant' }],
          presentationOnlyRepair: { kind: 'roll_ledger' },
        }),
        [],
      ),
    ).toBeNull();
    expect(
      classifyAuditPresentationRepair(
        reject({
          disallowedToolCalls: ['give_item'],
          presentationOnlyRepair: { kind: 'roll_ledger' },
        }),
        [],
      ),
    ).toBeNull();
    expect(
      classifyAuditPresentationRepair(
        reject({ presentationOnlyRepair: { kind: 'roll_ledger' } }),
        [
          toolCall('roll', {
            ok: false,
            code: 'invalid_dice',
            message: 'bad dice',
          }),
        ],
      ),
    ).toBeNull();
  });

  it('classifies missing roll visibility from structured auditor requirements', () => {
    expect(
      classifyAuditRetryCause(
        reject({ missingRequiredCalls: [{ tool: 'roll' }] }),
        [],
      ),
    ).toBe('missing_roll_visibility');
  });

  it('classifies missing state mutation requirements', () => {
    expect(
      classifyAuditRetryCause(
        reject({ missingRequiredTools: ['update_combatant'] }),
        [],
      ),
    ).toBe('missing_state');
  });

  it('classifies missing world evidence requirements', () => {
    expect(
      classifyAuditRetryCause(
        reject({
          missingRequiredCalls: [
            { tool: 'world_query', target: 'Warden Sela' },
          ],
        }),
        [],
      ),
    ).toBe('missing_world_evidence');
  });

  it('classifies invalid deterministic tool targets before auditor buckets', () => {
    expect(
      classifyAuditRetryCause(reject({ missingRequiredTools: ['roll'] }), [
        toolCall('update_combatant', {
          ok: false,
          code: 'invalid_target',
          message: 'Unknown combatant id',
        }),
      ]),
    ).toBe('invalid_target');
  });

  it('classifies unexplained rejection as possible auditor over-rejection', () => {
    expect(classifyAuditRetryCause(reject({}), [])).toBe(
      'auditor_over_rejection',
    );
  });

  it('does not assign retry cause to accepted verdicts', () => {
    expect(
      classifyAuditRetryCause(
        {
          verdict: 'accept',
          missingRequiredTools: [],
          missingRequiredCalls: [],
          disallowedToolCalls: [],
          reason: 'ok',
          repairInstruction: '',
        },
        [],
      ),
    ).toBeNull();
  });
});
