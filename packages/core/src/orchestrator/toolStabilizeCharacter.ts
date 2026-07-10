import { stabilizeCharacter } from '../state/hpLifecycle.js';
import { MutateStateError } from '../state/mutateState.js';
import type { Tool } from './toolRegistry.js';
import {
  asRecord,
  CHARACTER_TARGET_SCHEMA,
  err,
  ok,
  resolveTargetCharacterId,
} from './toolRegistry.js';

export const stabilizeCharacterTool: Tool = {
  name: 'stabilize_character',
  // Writes character life state — a canon write (eshyra-dwkm).
  mutates: true,
  description:
    'Mark a dying character stable, after a successful DC 10 Wisdom ' +
    '(Medicine) check (rolled via `roll`) or a stabilizing effect. A stable ' +
    'character stays at 0 HP and unconscious but makes no more death saves; ' +
    'their death-save counters reset. If still at 0 HP after 1d4 hours, ' +
    'they regain 1 hit point (apply it with `adjust_hp` when that time ' +
    'passes). Damage knocks a stable character back to dying.',
  inputSchema: {
    type: 'object',
    properties: {
      character: CHARACTER_TARGET_SCHEMA,
    },
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args) ?? {};
    const target = resolveTargetCharacterId(a.character, ctx);
    if ('ok' in target) {
      return target;
    }
    try {
      const result = stabilizeCharacter(ctx.db, {
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
        characterId: target.id,
      });
      return ok(result);
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
