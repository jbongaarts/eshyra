import { ResolutionError, resolveD20 } from './resolution.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';
import {
  ADVANTAGE_SCHEMA,
  DISADVANTAGE_SCHEMA,
  MODIFIERS_SCHEMA,
  PROFICIENCY_SCHEMA,
  parseCheckSide,
  parseVisibility,
  VISIBILITY_SCHEMA,
} from './toolResolutionShared.js';
import {
  newId,
  PARTICIPANT_SCHEMA,
  parseParticipant,
} from './toolRetainedCheckShared.js';

export const rollRetainedCheckTool: Tool = {
  name: 'roll_retained_check',
  mutates: true,
  description:
    'Roll and retain an ability check total for later deterministic comparisons, such as a Dexterity (Stealth) check made to hide. The engine rolls the d20 and applies declared modifiers, proficiency, and advantage/disadvantage. Use resolve_retained_check to compare this recorded total; never reroll or compare totals yourself. Applicability and relevant observers remain your rulings. args: { kind: "ability_check", reason, label, participant?, modifiers?, proficiency?, advantage?, disadvantage?, visibility? }.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['ability_check'] },
      reason: { type: 'string', minLength: 1 },
      label: { type: 'string', minLength: 1, maxLength: 80 },
      participant: PARTICIPANT_SCHEMA,
      modifiers: MODIFIERS_SCHEMA,
      proficiency: PROFICIENCY_SCHEMA,
      advantage: ADVANTAGE_SCHEMA,
      disadvantage: DISADVANTAGE_SCHEMA,
      visibility: VISIBILITY_SCHEMA,
    },
    required: ['kind', 'reason', 'label'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      a.kind !== 'ability_check' ||
      typeof a.reason !== 'string' ||
      !a.reason ||
      typeof a.label !== 'string' ||
      !a.label
    ) {
      return err(
        'invalid_args',
        'roll_retained_check requires { kind: "ability_check", reason, label }',
      );
    }
    try {
      const side = parseCheckSide(a, 'roll_retained_check');
      const participant = parseParticipant(a.participant, ctx);
      const resolution = resolveD20(
        {
          kind: 'ability_check',
          advantage: side.advantage,
          disadvantage: side.disadvantage,
          modifiers: side.modifiers,
          ...(side.proficiency === undefined
            ? {}
            : { proficiency: side.proficiency }),
        },
        ctx.rng,
      );
      const active = ctx.db
        .prepare(
          "SELECT combat_instance_id FROM combat_instance WHERE campaign_id = ? AND status = 'active'",
        )
        .get(ctx.campaignId) as { combat_instance_id: string } | undefined;
      const retainedCheckId = newId();
      const visibility = parseVisibility(a.visibility) ?? 'dm_only';
      ctx.db
        .prepare(`INSERT INTO retained_check (
        campaign_id, retained_check_id, label, participant_kind, participant_ref,
        combat_instance_id, dice, rolls_json, natural, modifier_total, total,
        visibility, status, end_reason, provenance, session_id, created_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, NULL)`)
        .run(
          ctx.campaignId,
          retainedCheckId,
          a.label,
          participant?.kind ?? null,
          participant?.ref ?? null,
          active?.combat_instance_id ?? null,
          resolution.dice,
          JSON.stringify(resolution.rolls),
          resolution.natural,
          resolution.modifierTotal,
          resolution.total,
          visibility,
          `model:${ctx.turnId}`,
          ctx.sessionId,
          ctx.at,
        );
      return ok({
        retainedCheckId,
        reason: a.reason,
        label: a.label,
        visibility,
        category: 'ability_check',
        ...resolution,
      });
    } catch (e) {
      if (e instanceof ResolutionError)
        return err('invalid_resolution', e.message);
      if (e instanceof Error) return err('invalid_args', e.message);
      throw e;
    }
  },
};
