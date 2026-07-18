import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import {
  DND5E_SRD_PACK_ID,
  getBundledDnd5eSrdPack,
  RETIRED_DND5E_SRD_PLACEHOLDER_PACK_ID,
} from '../rules/bundledSrdPack.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../rules/pathfinder2eRemaster.js';
import { buildRulesRecordCard } from '../rules/recordCard.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import { resolveRulesStack } from '../rules/stack.js';
import type { RulesPack, RulesRecordKind } from '../rules/types.js';
import { RulesPackError } from '../rules/types.js';
import {
  CampaignRulesBindingResolutionError,
  resolveStrictCampaignRulesStack,
} from '../state/campaignRecordLookup.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

/**
 * Bundled base rules packs available to `lookup_rules`. The D&D SRD pack is
 * loaded lazily from the packaged data dir on first use (ADR 0013); Pathfinder
 * is still the in-code fixture pending its own importer.
 */
function bundledRulesPacks(): readonly RulesPack[] {
  return [getBundledDnd5eSrdPack(), PATHFINDER2E_REMASTER_RULES_PACK];
}

function findBundledBaseBySystemId(systemId: string): RulesPack | undefined {
  return bundledRulesPacks().find(
    (pack) => pack.meta.systemId === systemId && pack.meta.role === 'base',
  );
}

// Resolving a single-base, no-addon stack is deterministic per pack object, so
// memoize it: the bundled SRD pack is 1811 records and lookups run on the hot
// gameplay path. Keyed on the pack identity (the loader returns the same cached
// object), so a re-import or different pack rebuilds correctly.
const singleBaseStackCache = new WeakMap<RulesPack, ResolvedRulesStack>();

function resolveSingleBaseStack(base: RulesPack): ResolvedRulesStack {
  let stack = singleBaseStackCache.get(base);
  if (stack === undefined) {
    stack = resolveRulesStack({ base });
    singleBaseStackCache.set(base, stack);
  }
  return stack;
}

export const lookupRulesTool: Tool = {
  name: 'lookup_rules',
  // Read-only rules lookup through the campaign binding; no canon write (eshyra-dwkm).
  mutates: false,
  description:
    'Look up a rules record (creature, spell, class, ancestry, feat, ' +
    'equipment, etc.) by name or ref through the campaign rules ' +
    'binding. args: { kind, name?: string, ref?: string, systemId?: string }. ' +
    'Name lookup accepts deterministic punctuation, plural, and common ' +
    'equipment aliases. ' +
    'Omit systemId to use the campaign binding; pass it to query a specific ' +
    'bundled rules system (e.g. "dnd5e-srd", "pathfinder2e-remaster"). ' +
    'If a name matches multiple records of the same kind, the result is an ' +
    'ambiguous error listing candidate keys (also in structured data.candidateKeys); ' +
    're-query by ref with one of them. A successful result includes a `card` ' +
    'summary (key, kind, name, source locator, grantor/parent ref) to ' +
    'disambiguate same- or cross-kind duplicate names without parsing the raw record.',
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

    if (a.systemId !== undefined) {
      const basePack = findBundledBaseBySystemId(a.systemId);
      if (basePack === undefined) {
        return err(
          'unknown_pack',
          `lookup_rules: systemId '${a.systemId}' is not a bundled rules system`,
        );
      }
    } else {
      const binding =
        readCampaignRulesBinding(ctx.db) ?? DEFAULT_DND5E_SRD_BINDING;
      if (binding.base.packId === RETIRED_DND5E_SRD_PLACEHOLDER_PACK_ID) {
        return err(
          'retired_pack',
          'lookup_rules: campaign rules binding references the retired pre-v1 ' +
            `placeholder pack id '${RETIRED_DND5E_SRD_PLACEHOLDER_PACK_ID}'. ` +
            `The canonical D&D SRD pack id is now '${DND5E_SRD_PACK_ID}'. ` +
            'Recreate the pre-v1 campaign or update the binding base pack id.',
        );
      }
    }

    try {
      const stack =
        a.systemId !== undefined
          ? resolveSingleBaseStack(
              findBundledBaseBySystemId(a.systemId) as RulesPack,
            )
          : resolveStrictCampaignRulesStack(ctx.db, ctx.resolveRulesPack);
      const result =
        typeof a.ref === 'string'
          ? lookupRulesRecord(stack, { kind, ref: a.ref })
          : lookupRulesRecord(stack, { kind, name: a.name as string });

      if (result.ok) {
        return ok({
          record: result.record,
          // Kind-aware disambiguating summary (key, kind, name, source
          // locator, grantor/parent ref) so the DM doesn't have to parse an
          // arbitrary per-kind `data` shape to tell same- or cross-kind
          // duplicate names apart (eshyra-o9bd.18.8.6).
          card: buildRulesRecordCard(result.record),
          sourcePack: result.pack,
          license: result.license,
          overrideChain: result.overrideChain,
        });
      }
      // For `ambiguous`, the candidate keys are both embedded in the message
      // (for narration) and carried as structured `data` so the DM can
      // re-query by an exact key without parsing free text (ADR 0013).
      return err(
        result.code,
        result.message,
        result.code === 'ambiguous'
          ? { candidateKeys: result.candidateKeys }
          : undefined,
      );
    } catch (e) {
      if (e instanceof CampaignRulesBindingResolutionError) {
        return err('rules_binding_error', e.message);
      }
      if (e instanceof RulesPackError) {
        return err('rules_pack_error', e.message);
      }
      throw e;
    }
  },
};
