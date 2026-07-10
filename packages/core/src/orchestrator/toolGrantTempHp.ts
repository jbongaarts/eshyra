import { grantTemporaryHp } from '../state/hpLifecycle.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const grantTempHpTool: Tool = {
  name: 'grant_temporary_hp',
  // Writes the character temp-HP buffer — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Grant temporary hit points to a character. Temp HP are a separate ' +
    'buffer consumed by damage before real HP; they are not healing and do ' +
    'not wake a character at 0 HP. They never stack: when a buffer already ' +
    'exists, pass replace=true to take the new pool or replace=false to ' +
    'keep the old one (the player chooses); omitted, the larger pool is ' +
    'kept. The buffer expires on a long rest, or earlier if the granting ' +
    'effect says so.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: {
        type: 'integer',
        description: 'Temporary hit points granted; positive integer.',
        minimum: 1,
      },
      replace: {
        type: 'boolean',
        description:
          'When a temp-HP buffer already exists: true replaces it with the ' +
          'new pool, false keeps the existing one. Omit to keep the larger.',
      },
      character: CHARACTER_TARGET_SCHEMA,
    },
    required: ['amount'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.amount !== 'number') {
      return err(
        'invalid_args',
        'grant_temporary_hp requires { amount: positive integer }',
      );
    }
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const result = grantTemporaryHp(
        ctx.db,
        a.amount,
        {
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          characterId: target.id,
        },
        typeof a.replace === 'boolean' ? { replace: a.replace } : {},
      );
      return ok(result);
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
