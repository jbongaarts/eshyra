import { describe, expect, it } from 'vitest';
import type { AuditVerdict } from '../src/internal.js';
import { classifyAuditRetryCause } from '../src/orchestrator/auditRetryDiagnostics.js';
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
