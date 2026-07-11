import type { DamagePacketInput, DamageType } from './resolution.js';
import {
  DAMAGE_TYPES,
  ResolutionError,
  resolveDamage,
  validateDamageTarget,
  validateModifiers,
} from './resolution.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  MODIFIERS_SCHEMA,
  parseVisibility,
  VISIBILITY_SCHEMA,
} from './toolResolutionShared.js';

function parsePacket(raw: unknown, where: string): DamagePacketInput {
  const record = asRecord(raw);
  if (
    record === undefined ||
    typeof record.dice !== 'string' ||
    record.dice.length === 0
  ) {
    throw new ResolutionError(`${where}: requires { dice: string, type }`);
  }
  if (
    typeof record.type !== 'string' ||
    !DAMAGE_TYPES.includes(record.type as DamageType)
  ) {
    throw new ResolutionError(
      `${where}: type must be one of ${DAMAGE_TYPES.join(', ')}`,
    );
  }
  if (
    record.label !== undefined &&
    (typeof record.label !== 'string' ||
      record.label.length === 0 ||
      record.label.length > 80)
  ) {
    throw new ResolutionError(`${where}: label must be a non-empty string`);
  }
  return {
    dice: record.dice,
    type: record.type as DamageType,
    ...(typeof record.label === 'string' ? { label: record.label } : {}),
    modifiers: validateModifiers(record.modifiers, where),
  };
}

export const resolveDamageTool: Tool = {
  name: 'resolve_damage',
  // Pure deterministic damage composition from the seeded RNG; writes no
  // canon — apply the result with adjust_hp / update_combatant explicitly.
  mutates: false,
  description:
    'Roll and compose damage with code-owned math. Declare one packet per ' +
    'damage source ({ dice: "NdM+K", type, label?, modifiers? }); on a ' +
    'critical hit pass critical:true and the ENGINE doubles the dice — never ' +
    'rewrite the dice expression yourself. One call = one damage instance: ' +
    'same-type packets aggregate before any math, so how you split packets ' +
    'never changes totals. Damage is rolled once and applied to every ' +
    'declared target; per target and per type the engine zeroes immune ' +
    'types, halves resisted types (round down) and then doubles vulnerable ' +
    'types, after all modifiers; each type total never goes below 0. WHICH ' +
    'resistances apply stays your ruling. This tool does not change HP — ' +
    'follow up with ' +
    'adjust_hp (party) or update_combatant (monsters). args: { reason, ' +
    'packets, critical?, targets?, visibility? }.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description:
          'Short justification, e.g. "longsword damage vs goblin". Recorded in the turn trace and roll ledger.',
        minLength: 1,
      },
      packets: {
        type: 'array',
        description:
          'One entry per damage source: weapon dice, sneak attack, smite, ...',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            dice: {
              type: 'string',
              description:
                'Plain damage dice, e.g. "1d8+3" or "2d6" (no keep/drop).',
              minLength: 1,
            },
            type: {
              type: 'string',
              enum: DAMAGE_TYPES,
              description: 'Damage type of this packet.',
            },
            label: {
              type: 'string',
              description: 'Source label, e.g. "longsword", "sneak attack".',
              minLength: 1,
              maxLength: 80,
            },
            modifiers: MODIFIERS_SCHEMA,
          },
          required: ['dice', 'type'],
          additionalProperties: false,
        },
      },
      critical: {
        type: 'boolean',
        description:
          "True on a critical hit: the engine rolls each packet's dice twice (doubled count), modifiers added once.",
      },
      targets: {
        type: 'array',
        description:
          "Targets this one roll applies to (roll once, apply to all). Declare each target's applicable resistances/vulnerabilities/immunities.",
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Target name/id.',
              minLength: 1,
              maxLength: 80,
            },
            resistances: {
              type: 'array',
              items: { type: 'string', enum: DAMAGE_TYPES },
            },
            vulnerabilities: {
              type: 'array',
              items: { type: 'string', enum: DAMAGE_TYPES },
            },
            immunities: {
              type: 'array',
              items: { type: 'string', enum: DAMAGE_TYPES },
            },
          },
          required: ['label'],
          additionalProperties: false,
        },
      },
      visibility: VISIBILITY_SCHEMA,
    },
    required: ['reason', 'packets'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.reason !== 'string' ||
      a.reason.length === 0 ||
      !Array.isArray(a.packets)
    ) {
      return err(
        'invalid_args',
        'resolve_damage requires { reason: string, packets: array }',
      );
    }
    if (a.critical !== undefined && typeof a.critical !== 'boolean') {
      return err('invalid_args', 'resolve_damage critical must be a boolean');
    }
    try {
      const packets = a.packets.map((raw, i) =>
        parsePacket(raw, `resolve_damage packets[${i}]`),
      );
      const targets =
        a.targets === undefined
          ? undefined
          : Array.isArray(a.targets)
            ? a.targets.map((raw, i) =>
                validateDamageTarget(raw, `resolve_damage targets[${i}]`),
              )
            : (() => {
                throw new ResolutionError(
                  'resolve_damage targets must be an array',
                );
              })();
      const resolution = resolveDamage(
        {
          packets,
          ...(a.critical === true ? { critical: true } : {}),
          ...(targets === undefined ? {} : { targets }),
        },
        ctx.rng,
      );
      const visibility = parseVisibility(a.visibility);
      return ok({
        reason: a.reason,
        ...(visibility === undefined ? {} : { visibility }),
        category: 'damage',
        ...resolution,
      });
    } catch (e) {
      if (e instanceof ResolutionError) {
        return err('invalid_resolution', e.message);
      }
      throw e;
    }
  },
};
