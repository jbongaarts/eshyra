import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { type CampaignPosition, CampaignRuleError } from './campaignRules.js';

/** Resolve the durable chronology anchor for a turn, assigning it once. */
export function resolveCampaignPosition(
  db: Db,
  input: {
    readonly campaignId: string;
    readonly sessionId: string;
    readonly turnId: string;
  },
): CampaignPosition {
  return withTransaction(db, (txn) => {
    txn
      .prepare(
        `INSERT OR IGNORE INTO campaign_turn_position
       (campaign_id, session_id, turn_id, ordinal)
       VALUES (?, ?, ?, COALESCE((SELECT MAX(ordinal) + 1 FROM campaign_turn_position WHERE campaign_id = ?), 1))`,
      )
      .run(input.campaignId, input.sessionId, input.turnId, input.campaignId);
    const row = txn
      .prepare(
        `SELECT session_id, turn_id, ordinal FROM campaign_turn_position
       WHERE campaign_id = ? AND session_id = ? AND turn_id = ?`,
      )
      .get(input.campaignId, input.sessionId, input.turnId) as
      | { session_id: string; turn_id: string; ordinal: number }
      | undefined;
    if (row === undefined)
      throw new CampaignRuleError('campaign turn position was not persisted');
    return {
      sessionId: row.session_id,
      turnId: row.turn_id,
      ordinal: row.ordinal,
    };
  });
}

/** Read the latest persisted chronology anchor without allocating a turn. */
export function getCurrentCampaignPosition(
  db: Db,
  campaignId: string,
): CampaignPosition | undefined {
  const row = db
    .prepare(
      `SELECT session_id, turn_id, ordinal FROM campaign_turn_position
       WHERE campaign_id = ? ORDER BY ordinal DESC LIMIT 1`,
    )
    .get(campaignId) as
    | { session_id: string; turn_id: string; ordinal: number }
    | undefined;
  return row === undefined
    ? undefined
    : {
        sessionId: row.session_id,
        turnId: row.turn_id,
        ordinal: row.ordinal,
      };
}

/** Read the persisted chronology anchor for one campaign ordinal. */
export function getCampaignPositionAtOrdinal(
  db: Db,
  campaignId: string,
  ordinal: number,
): CampaignPosition | undefined {
  const row = db
    .prepare(
      `SELECT session_id, turn_id, ordinal FROM campaign_turn_position
       WHERE campaign_id = ? AND ordinal = ?`,
    )
    .get(campaignId, ordinal) as
    | { session_id: string; turn_id: string; ordinal: number }
    | undefined;
  return row === undefined
    ? undefined
    : {
        sessionId: row.session_id,
        turnId: row.turn_id,
        ordinal: row.ordinal,
      };
}
