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

/** The canonical lazy clock row; budget reset remains F2's responsibility. */
export function ensureTurnClockRow(
  db: Db,
  campaignId: string,
  combatInstanceId: string,
  participant: TurnClockParticipant,
  provenance: string,
  sessionId: string,
  at: string,
): void {
  db.prepare(
    `INSERT INTO combat_turn_budget(
       campaign_id, combat_instance_id, participant_kind, participant_ref,
       provenance, session_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, combat_instance_id, participant_kind,
                 participant_ref) DO NOTHING`,
  ).run(
    campaignId,
    combatInstanceId,
    participant.kind,
    participant.ref,
    provenance,
    sessionId,
    at,
  );
}
