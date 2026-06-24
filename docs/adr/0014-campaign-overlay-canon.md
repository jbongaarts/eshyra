# ADR 0014: Campaign Overlay Canon

## Status

Accepted.

## Context

Adventure modules are the authored story spine, but long-running play also needs
room for consequential improvisation. The DM can introduce a local hook, clue,
or NPC report that is useful and valid for play, but if that fact remains only
in prose it cannot be queried, audited, or recalled reliably later.

The Hearthmere playtest exposed the pattern: Old Renn exists, his charcoal cart
is missing, his mule returned alone, fresh axe-cuts marked the north palisade,
drag marks led toward the pines, and villagers might pay someone to investigate.
Those are consequential improvised facts. By contrast, a chipped cup, damp wool
smell, or rough wool clothing are ordinary scene color unless play later makes
them matter.

## Decision

Eshyra uses layered canon:

- Module canon: read-only authored adventure-module facts and prepared content.
  It supports world/mechanics audit as authoritative module evidence.
- Campaign state: deterministic mutable state such as inventory, flags, clocks,
  quest progress, location, relationship state, and module progress. It supports
  audit as canonical state when written by tools.
- Campaign overlay lore: consequential improvised facts intentionally promoted
  during play. It supports audit and future world queries, but it does not
  silently rewrite module canon.
- Scene facts: short-lived current-scene continuity. They support local
  narration, but are not durable long-term canon unless promoted.
- Decorative color: prose-only sensory texture, mood, incidental gestures, and
  mundane props. It should not be stored or relied on later.
- Rumor/belief: persistent attributed information. The fact that someone said or
  believed it is canon; the claim itself is not necessarily true.

Not every DM sentence becomes canon. The DM must promote only consequential lore:
facts that affect player choices, create hooks, define NPC knowledge or motives,
describe evidence/clues, may need later recall, or record consequences of player
actions.

## Truth Status

Campaign overlay lore records use a constrained truth-status vocabulary:

- `true` / `confirmed`: established as true.
- `false` / `disproven`: established as false.
- `unknown`: recorded but not adjudicated.
- `rumored`: circulating as rumor.
- `reported`: attributed to a report.
- `observed`: directly observed evidence.
- `believed`: held as a belief by an NPC or group.
- `lie`: known falsehood told by a source.
- `exaggeration`: contains a distorted or inflated claim.

A record can be player-visible, DM-only, or mixed. Public and private knowledge
can diverge by recording separate lore records or superseding records as play
confirms or disproves a claim.

Audit semantics follow truth status. "Old Renn's mule returned alone" can be an
observed or reported clue. "Old Renn was taken by goblins" is only rumor or
belief until confirmed. A recorded rumor supports "villagers say goblins took
him"; it does not support "goblins took him" as true.

## Consequences

The DM has a constrained `record_world_fact` tool for campaign overlay lore.
Successful calls produce same-turn audit evidence. Failed tool calls never
support assertions. Later `world_query` calls return overlay lore alongside
module canon with tier/source metadata so conflicts are visible instead of
silently resolved.

Campaign overlay lore may record consequences, reveals, or explicit overrides,
but it must not silently rewrite module canon. If module canon and overlay lore
conflict, query/debug output should expose both tiers.
