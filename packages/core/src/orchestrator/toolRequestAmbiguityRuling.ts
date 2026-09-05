import { lookupCampaignAmbiguity } from '../campaign/ambiguityResolution.js';
import { getCurrentCampaignPosition } from '../campaign/campaignPosition.js';
import { CampaignRuleError } from '../campaign/campaignRules.js';
import type { Tool } from './toolRegistry.js';
import { asRecord, err, ok } from './toolRegistry.js';

export const requestAmbiguityRulingTool: Tool = {
  name: 'request_ambiguity_ruling',
  mutates: false,
  description:
    'Call when an outcome depends on an ambiguity marked UNRESOLVED in Campaign Rules. Then narrate the published uncertainty, present the interpretations neutrally, and tell the player they will be asked to choose. Never choose an interpretation yourself. If status is resolved, apply the active ruling.',
  inputSchema: {
    type: 'object',
    properties: {
      ambiguityId: {
        type: 'string',
        description: 'Stable ambiguity id from the Campaign Rules context.',
        minLength: 1,
      },
    },
    required: ['ambiguityId'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const record = asRecord(args);
    if (record === undefined || typeof record.ambiguityId !== 'string') {
      return err(
        'invalid_args',
        'request_ambiguity_ruling requires { ambiguityId }',
      );
    }
    const position = getCurrentCampaignPosition(ctx.db, ctx.campaignId);
    if (position === undefined) {
      return err(
        'campaign_position_unavailable',
        `campaign '${ctx.campaignId}' has no persisted current turn position`,
      );
    }
    try {
      const result = lookupCampaignAmbiguity(ctx.db, {
        campaignId: ctx.campaignId,
        ambiguityId: record.ambiguityId,
        position,
        resolveRulesPack: ctx.resolveRulesPack,
      });
      return ok({
        ambiguityId: record.ambiguityId,
        question: result.ambiguity.question,
        interpretations: result.ambiguity.interpretations,
        status: result.status,
        ruling:
          result.ruling === undefined
            ? null
            : {
                ruleIdentity: result.ruling.ruleIdentity,
                selectedInterpretationId:
                  result.ruling.selectedInterpretationId,
                prose: result.ruling.prose ?? '',
              },
      });
    } catch (error) {
      if (error instanceof CampaignRuleError) {
        const known = error.message.match(/known ambiguity ids: (.*)$/)?.[1];
        return err(
          'unknown_ambiguity',
          error.message,
          known === undefined
            ? undefined
            : {
                knownAmbiguityIds:
                  known === '(none)'
                    ? []
                    : known.split(',').map((id) => id.trim()),
              },
        );
      }
      throw error;
    }
  },
};
