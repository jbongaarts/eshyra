import type { Db } from '../persistence/db.js';

export interface TurnClockParticipant {
  readonly kind: 'character' | 'combatant';
  readonly ref: string;
}

/** Completed turns are the authoritative participant-local combat clock. */
export function readCompletedTurns(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
  participant: TurnClockParticipant,
): number {
  const row = db
    .prepare(
      `SELECT turns_taken FROM combat_turn_budget
       WHERE campaign_id = ? AND combat_instance_id = ?
         AND participant_kind = ? AND participant_ref = ?`,
    )
    .get(campaignId, combatInstanceId, participant.kind, participant.ref) as
    | { turns_taken: number }
    | undefined;
  return row?.turns_taken ?? 0;
}

/**
 * Return the participant-local anchor ordinal at this instant. `turns_taken`
 * counts completed turns; when the participant is currently active, its
 * current turn-start boundary has already occurred and must be included.
 */
export function readAnchorTurnOrdinal(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
  participant: TurnClockParticipant,
): number {
  const completedTurns = readCompletedTurns(
    db,
    campaignId,
    combatInstanceId,
    participant,
  );
  const active = db
    .prepare(
      `SELECT active_participant_kind, active_participant_ref
       FROM combat_instance
       WHERE campaign_id = ? AND combat_instance_id = ?`,
    )
    .get(campaignId, combatInstanceId) as
    | {
        active_participant_kind: TurnClockParticipant['kind'] | null;
        active_participant_ref: string | null;
      }
    | undefined;
  return (
    completedTurns +
    (active?.active_participant_kind === participant.kind &&
    active.active_participant_ref === participant.ref
      ? 1
      : 0)
  );
}
