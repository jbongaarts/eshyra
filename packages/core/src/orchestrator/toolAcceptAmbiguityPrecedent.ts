import { lookupCampaignAmbiguity } from '../campaign/ambiguityResolution.js';
import { getCurrentCampaignPosition } from '../campaign/campaignPosition.js';
import { CampaignRuleError } from '../campaign/campaignRules.js';
import { asRecord, err, ok, type Tool } from './toolRegistry.js';

export interface AmbiguityPrecedentProposal {
  ambiguityId: string;
  interpretationId: string;
  reason: string;
  prose: string;
}

export const acceptAmbiguityPrecedentTool: Tool = {
  name: 'accept_ambiguity_precedent',
  mutates: true,
  requiresExplicitAction: true,
  description:
    'Propose a durable precedent ONLY when you accept the actual player action and it unambiguously selects exactly one enumerated interpretation of an unresolved published ambiguity. Supply all matching interpretation IDs and explain why the others do not fit. Never use for a question, canonical-rule violation, house rule, or contextual judgment. The auditor must accept the action and proposal before anything persists; the runtime visibly acknowledges the precedent.',
  inputSchema: {
    type: 'object',
    properties: {
      ambiguityId: { type: 'string', minLength: 1 },
      matchingInterpretationIds: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        minItems: 1,
        maxItems: 1,
      },
      reason: { type: 'string', minLength: 1 },
    },
    required: ['ambiguityId', 'matchingInterpretationIds', 'reason'],
    additionalProperties: false,
  },
  run(args, ctx) {
    if (ctx.proposeAmbiguityPrecedent === undefined)
      return err(
        'audit_required',
        'Implicit precedents require an audited campaign turn.',
      );
    const value = asRecord(args);
    const ids = value?.matchingInterpretationIds;
    if (
      typeof value?.ambiguityId !== 'string' ||
      !Array.isArray(ids) ||
      ids.length !== 1 ||
      typeof ids[0] !== 'string' ||
      typeof value.reason !== 'string' ||
      !value.reason.trim()
    )
      return err(
        'invalid_args',
        'Exactly one known interpretation and a reason are required.',
      );
    const position = getCurrentCampaignPosition(ctx.db, ctx.campaignId);
    if (
      position === undefined ||
      position.turnId !== ctx.turnId ||
      position.sessionId !== ctx.sessionId
    )
      return err('invalid_position', 'A precedent requires the current turn.');
    try {
      const resolution = lookupCampaignAmbiguity(ctx.db, {
        campaignId: ctx.campaignId,
        ambiguityId: value.ambiguityId,
        position,
        resolveRulesPack: ctx.resolveRulesPack,
      });
      if (resolution.status !== 'unresolved')
        return err(
          'ruling_exists',
          'The ambiguity already has an active or conflicting ruling.',
        );
      const upcoming = lookupCampaignAmbiguity(ctx.db, {
        campaignId: ctx.campaignId,
        ambiguityId: value.ambiguityId,
        position: { ...position, ordinal: position.ordinal + 1 },
        resolveRulesPack: ctx.resolveRulesPack,
      });
      if (upcoming.status !== 'unresolved')
        return err(
          'ruling_exists',
          'An existing prospective ruling prevents this precedent.',
        );
      const interpretation = resolution.ambiguity.interpretations.find(
        ({ id }) => id === ids[0],
      );
      if (interpretation === undefined)
        return err(
          'unknown_interpretation',
          'The interpretation is not enumerated by this source ambiguity.',
        );
      const prose = `${resolution.ambiguity.question} Ruling: ${interpretation.summary}`;
      ctx.proposeAmbiguityPrecedent({
        ambiguityId: value.ambiguityId,
        interpretationId: interpretation.id,
        reason: value.reason,
        prose,
      });
      return ok({
        status: 'pending-audit',
        ambiguityId: value.ambiguityId,
        interpretationId: interpretation.id,
        prose,
      });
    } catch (error) {
      if (error instanceof CampaignRuleError)
        return err('invalid_precedent', error.message);
      throw error;
    }
  },
};
