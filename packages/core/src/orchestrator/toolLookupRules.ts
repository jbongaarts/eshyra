import type { CampaignRulesBinding } from '../rules/binding.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import { DND5E_SRD_RULES_PACK } from '../rules/dnd5eSrd.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../rules/pathfinder2eRemaster.js';
import { resolveRulesStack } from '../rules/stack.js';
import type { RulesPack, RulesRecordKind } from '../rules/types.js';
import { RulesPackError } from '../rules/types.js';
import type { Tool, ToolContext } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

const BUNDLED_RULES_PACKS: readonly RulesPack[] = [
  DND5E_SRD_RULES_PACK,
  PATHFINDER2E_REMASTER_RULES_PACK,
];

function findBundledPackById(packId: string): RulesPack | undefined {
  return BUNDLED_RULES_PACKS.find((pack) => pack.meta.packId === packId);
}

function findBundledBaseBySystemId(systemId: string): RulesPack | undefined {
  return BUNDLED_RULES_PACKS.find(
    (pack) => pack.meta.systemId === systemId && pack.meta.role === 'base',
  );
}

function resolveBindingBasePack(ctx: ToolContext): RulesPack | undefined {
  const binding: CampaignRulesBinding =
    readCampaignRulesBinding(ctx.db) ?? DEFAULT_DND5E_SRD_BINDING;
  return findBundledPackById(binding.base.packId);
}

export const lookupRulesTool: Tool = {
  name: 'lookup_rules',
  // Read-only rules lookup through the campaign binding; no canon write (eshyra-dwkm).
  mutates: false,
  description:
    'Look up a rules record (creature, spell, class, ancestry, feat, ' +
    'equipment, etc.) by exact name or ref through the campaign rules ' +
    'binding. args: { kind, name?: string, ref?: string, systemId?: string }. ' +
    'Omit systemId to use the campaign binding; pass it to query a specific ' +
    'bundled rules system (e.g. "dnd5e-srd", "pathfinder2e-remaster").',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: [
          'ability',
          'action',
          'ancestry',
          'background',
          'class',
          'condition',
          'creature',
          'equipment',
          'feat',
          'feature',
          'hazard',
          'magic-item',
          'rule',
          'spell',
          'subclass',
          'table',
        ],
        description: 'The kind of rules record to look up.',
      },
      name: {
        type: 'string',
        description: 'Exact record name (mutually exclusive with ref).',
        minLength: 1,
      },
      ref: {
        type: 'string',
        description: 'Stable record ref (mutually exclusive with name).',
        minLength: 1,
      },
      systemId: {
        type: 'string',
        description:
          'Optional bundled rules system id (e.g. "dnd5e-srd", ' +
          '"pathfinder2e-remaster"). Omit to use the campaign binding.',
        minLength: 1,
      },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.kind !== 'string' ||
      (typeof a.name !== 'string' && typeof a.ref !== 'string')
    ) {
      return err(
        'invalid_args',
        'lookup_rules requires { kind, name } or { kind, ref }',
      );
    }
    if (a.systemId !== undefined && typeof a.systemId !== 'string') {
      return err('invalid_args', 'lookup_rules systemId must be a string');
    }
    const kind = a.kind as RulesRecordKind;

    const basePack =
      a.systemId !== undefined
        ? findBundledBaseBySystemId(a.systemId)
        : resolveBindingBasePack(ctx);

    if (basePack === undefined) {
      const detail =
        a.systemId !== undefined
          ? `systemId '${a.systemId}' is not a bundled rules system`
          : 'campaign rules binding references a pack that is not bundled in core';
      return err('unknown_pack', `lookup_rules: ${detail}`);
    }

    try {
      const stack = resolveRulesStack({ base: basePack });
      const result =
        typeof a.ref === 'string'
          ? lookupRulesRecord(stack, { kind, ref: a.ref })
          : lookupRulesRecord(stack, { kind, name: a.name as string });

      if (result.ok) {
        return ok({
          record: result.record,
          sourcePack: result.pack,
          license: result.license,
          overrideChain: result.overrideChain,
        });
      }
      return err(result.code, result.message);
    } catch (e) {
      if (e instanceof RulesPackError) {
        return err('rules_pack_error', e.message);
      }
      throw e;
    }
  },
};
