# ADR 0018: Single-Class Engine Boundary

- **Status:** Accepted
- **Date:** 2026-07-11
- **Bead:** eshyra-2n1t.1
- **Relates to:** [ADR 0001](0001-product-model-deployment-content-strategy.md),
  [ADR 0009](0009-class-subclass-feature-record-kinds.md),
  [ADR 0011](0011-core-owned-rules-pack-bound-character-sheet.md),
  [ADR 0017](0017-rules-pack-compiler-and-executable-curation-architecture.md)

## Context

The generated D&D 5e SRD 5.1 pack faithfully carries the multiclassing rules:
prerequisite and proficiency tables, total-level proficiency-bonus prose, the
multiclass spellcaster slot table, Pact Magic interaction, and the special
rules for hit points, Hit Dice, Channel Divinity, Extra Attack, Unarmored
Defense, class features, and experience. Reference availability does not mean
that the engine can safely execute those rules.

The current character and progression architecture is single-class throughout:

- `CharacterSheet` schema version 1 has one `class`, at most one `subclass`,
  and one undifferentiated `level`.
- Saving throws and proficiencies are flat results. They do not retain the
  granting class, acquisition order, or whether a grant came from initial-class
  or multiclass proficiency rules.
- The sheet has one spell save DC and attack modifier, a flat spell list, and
  no spell-to-class association. The level-up resolver obtains spell capacity
  from the sole class's progression row.
- The level-up engine increments the sole class, uses that class's Hit Die,
  emits that row's class/subclass feature refs into the auditable change
  set/ledger, and sets proficiency bonus from that same row. The sheet does not
  have an origin-aware feature collection.
- Character creation produces only a level-1 member of one class and grants
  that class's saving throws, proficiencies, and starting equipment.
- Live state has one class mirror and one total level. F4 has not yet added
  spell-slot state and F7 has not yet added Hit Dice pools.

Correct multiclassing would therefore not be an additive slot formula. It would
require a versioned character-schema change, migration and validation policy,
per-class progression state, class-scoped spells and casting abilities,
proficiency/feature provenance, mixed Hit Dice pools, advancement target-class
selection and prerequisite checks, and coordinated changes across F4, F7, and
F8. Treating only some of those concerns as supported would allow legal-looking
but mechanically wrong characters, contrary to Eshyra's complete-accurate-
playable goal and deterministic execution boundary.

Existing design documents already excluded multiclassing from the first
creation and progression implementations. This decision turns that historical
scope note into an explicit engine contract and a fail-closed runtime boundary.

## Decision

### 1. The current engine supports single-class characters only

Multiclass characters are **explicitly deferred**. They are neither supported
now nor intentionally unsupported forever. The supported D&D 5e character-build
domain for the current schema and v1 engine work is one base class plus an
optional subclass belonging to that class.

Within that domain:

- `CharacterSheet.level` is both total character level and the level of
  `CharacterSheet.class` because those values are necessarily equal.
- Proficiency bonus is derived from that single total/class level. F4, F7, F8,
  and other deterministic services may rely on this equality only after the
  shared character-build validation described below succeeds.
- The initial class supplies level-1 hit points, its Hit Die type, saving throws,
  proficiencies, and starting equipment. Later levels always advance that same
  class, use its Hit Die, and never re-grant starting equipment or saving throws.
- Class and subclass features are resolved from the sole class's progression
  row and the selected subclass belonging to it, with grants recorded in the
  level-up change set/ledger under the current progression contract.

The engine must not describe the SRD multiclass rules as executable merely
because their records are retrievable through `lookup_rules`.

### 2. Character creation and advancement remain single-class

Character creation accepts exactly one class and creates a level-1 character.
It has no multiclass or higher-level multiclass input. A recipe, draft, import,
or API request that supplies multiple classes, per-class levels, or an
additional-class selection must fail with the unsupported-build error from §7;
it must not choose the first class, merge grants, or preserve extra input only
as opaque metadata.

Later advancement always advances `sheet.class`. The current level-up API does
not accept a target class. If a caller attempts to provide one through a future
transport or if loaded state contains evidence of multiple classes/per-class
levels, preview and apply both fail before computing a change set. No engine
path may use total level as the sole class level after such evidence is found.

### 3. Total-level-derived and class-level-derived values

For a validated schema-v1 sheet, total level and sole-class level are identical.
Proficiency bonus and XP eligibility use that value as total character level;
class progression rows, subclass feature levels, spell knowledge/preparation,
and class resource scaling use it as sole-class level.

This equality is a declared compatibility property of the single-class schema,
not a general D&D rule. New code must name the semantic value it needs even when
both currently read `sheet.level`, so a future multiclass schema can split them
without rediscovering hidden assumptions.

### 4. Hit points, Hit Dice, grants, and equipment

F7 may initially model the single-class Hit Dice pool as one die type with a
count derived from level. It must not claim to support mixed pools. F8 may apply
fixed-average or seeded rolled HP for advancement in the sole class and may
recalculate Constitution-derived HP over all levels because every level belongs
to that class.

Saving throws and starting equipment remain initial-class-only. Later level-up
must not add another class's saving throws or starting equipment. Flat armor,
weapon, tool, language, and skill proficiency collections remain valid only for
single-class builds; the multiclass-specific proficiency table is reference
data, not an executable grant source.

Subclass selection remains supported for the sole class. A subclass whose
`parentClass` does not equal `sheet.class.key` is invalid, not a second-class
escape hatch. Channel Divinity, Extra Attack, Unarmored Defense, and other
features use only the sole class/subclass progression; their multiclass
combination clauses remain unsupported.

### 5. F4 spell-slot contract

F4 may seed and restore ordinary Spellcasting slots directly from the sole
class's resolved progression row. A single-class Warlock may instead have its
separate Pact Magic slot pool, including its own slot level and recharge timing.

F4 must not:

- calculate an effective multiclass spellcaster level;
- consult the multiclass spellcaster slot table for a character;
- combine full-caster and half-caster levels;
- associate known/prepared spells with multiple classes or casting abilities;
- expose Spellcasting/Pact Magic cross-pool casting as supported for a
  multiclass character.

The service must validate the character-build boundary before seeding,
expending, or restoring slots. This keeps its public contract honest while
leaving the two single-class resource shapes suitable for future composition.

### 6. Rules-pack and importer boundary

No importer or generated-pack change is required for this decision. The current
pack's multiclass rule and table records remain authoritative reference data and
future compiler inputs. Runtime support still requires typed, source-grounded
semantics for prerequisites, multiclass proficiency grants, caster-level
weighting, feature-combination rules, and Pact Magic interaction under ADR
0017; prose and generic table cells alone are not an execution interface.

Coverage/readiness reporting must surface these procedures as deliberately
unsupported/deferred by ADR 0018. It must not count them as implemented,
model-adjudicated support, or silently omit them from the supported-domain
report.

### 7. Fail-closed runtime contract

A shared character-build validator must guard persistence/import, character
creation finalization, and every deterministic service that consumes build
semantics (at minimum progression/level-up, F4 slots, and F7 Hit Dice). It must
reject:

- more than one base class;
- any per-class level collection or additional-class level;
- a subclass not owned by the sole class;
- a non-positive/non-integer level;
- any state whose claimed total and sole-class levels disagree; and
- transport/draft fields that attempt a multiclass target or multiclass grant.

The public failure is a stable typed error (implementation name:
`UnsupportedCharacterBuildError`) with machine-readable code
`MULTICLASS_UNSUPPORTED`, the operation that was refused, and an actionable
message that Eshyra currently supports one class only. CLI/model-facing
surfaces must show that message. They must not repair, flatten, partially load,
or ask the DM model to adjudicate the state.

Unknown JSON fields generally require a schema-validation policy of their own,
but known multiclass-shaped fields such as `classes`, `classLevels`, or a
second-class advancement target are never ignored as harmless extensions.
Existing valid schema-v1 single-class characters continue unchanged. No data
migration is needed for this decision; invalid or hand-edited multiclass-shaped
documents are rejected on load/use rather than migrated lossy.

### 8. Reconsideration gate

Near-term multiclass support requires a dedicated engine epic and a successor
ADR (or explicit revision of this one) before implementation. That design must
land before changing F4/F7/F8 assumptions and must define, at minimum:

- a versioned `classes: [{ class: ref, level }]` representation and total-level
  derivation, preserving acquisition order where rules depend on the initial
  class;
- schema migration/compatibility for current single-class sheets and live-row
  projections;
- advancement target-class selection and both current/new-class prerequisite
  validation;
- origin-aware saving throws, proficiencies, features, and spells;
- mixed Hit Dice pools and per-class HP acquisition;
- class/subclass feature acquisition and combination rules;
- effective-caster-level calculation, ordinary slot pools, separate Pact Magic
  pools, class-associated spells/abilities, and legal cross-pool expenditure;
- source-grounded typed pack semantics and parity tests for all SRD classes; and
- creation/import policy distinct from later advancement.

The implementation sequence is schema/validator and migration first, then
origin-aware build/progression state, prerequisites and grants, F7 Hit Dice/HP,
F4 spellcasting composition, feature-combination rules, and finally creation,
advancement, and end-to-end parity tests. Until all required invariants for a
combination are present, that combination remains rejected.

## Consequences

- F4 and F8 can proceed against a small, explicit single-class interface after
  the shared fail-closed guard lands; F7 receives the same boundary for Hit
  Dice.
- The eight multiclass procedures and the XP multiclass clause remain outside
  the executable v1 domain, visibly deferred rather than ambiguously partial.
- Existing characters need no migration and retain their current semantics.
- Supporting multiclassing later is a deliberate schema-and-engine project,
  not an incremental widening of the meaning of `CharacterSheet.level`.

## Rejected alternatives

- **Implement multiclass slot arithmetic in F4 only.** Rejected because spells,
  casting abilities, Pact Magic, class levels, prerequisites, and feature
  combinations would still be represented incorrectly.
- **Add an optional second class to schema version 1.** Rejected because it
  would silently change the meaning of persisted fields without a migration or
  provenance model and would not scale to more than two classes.
- **Let the DM model adjudicate multiclassing from pack prose.** Rejected because
  advancement, grants, HP, slots, and derived values are deterministic durable
  state transitions under ADR 0001/0017.
- **Declare multiclassing permanently unsupported.** Rejected because the
  source pack includes it and the long-running campaign goal can justify it
  after the core single-class economies are complete; the honest decision now
  is explicit deferral with a reconsideration gate.
