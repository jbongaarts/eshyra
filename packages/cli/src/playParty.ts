import type { Db } from '@eshyra/core';
import {
  CharacterResolutionError,
  listParty,
  resolveCharacterRef,
  setActiveCharacterId,
} from '@eshyra/core';
import type { CliIO } from './playTypes.js';

/** Print the party roster: one line per member, active member flagged. */
export function showParty(io: CliIO, db: Db): void {
  const party = listParty(db);
  if (party.length === 0) {
    io.write('No party members yet.');
    return;
  }
  io.write('Party:');
  for (const m of party) {
    const who = m.name ?? m.id;
    const descriptor =
      [m.ancestry, m.className].filter(Boolean).join(' ') || 'unclassed';
    const tags: string[] = [];
    if (m.role !== 'pc') {
      tags.push(m.role);
    }
    if (m.isActive) {
      tags.push('active');
    }
    const tag = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
    const conditions =
      m.conditions.length > 0
        ? `, conditions: ${m.conditions.map((c) => c.id).join(', ')}`
        : '';
    io.write(
      `  - ${who} (${descriptor}) L${m.level}, HP ${m.hpCurrent}/${m.hpMax}${conditions}${tag}`,
    );
  }
}

/** Set the active character by id or name, reporting the outcome. */
export function switchActiveCharacter(io: CliIO, db: Db, ref: string): void {
  if (ref.length === 0) {
    io.write('Usage: /switch <character id or name>');
    return;
  }
  try {
    const id = resolveCharacterRef(db, ref);
    setActiveCharacterId(db, id);
    const member = listParty(db).find((m) => m.id === id);
    io.write(`Active character is now ${member?.name ?? id}.`);
  } catch (e) {
    if (e instanceof CharacterResolutionError) {
      io.write(e.message);
      return;
    }
    throw e;
  }
}
