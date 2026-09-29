# Condition→condition discovery relationships

Owning bead: `eshyra-o9bd.19.3.4` (remaining item 2), design bead
`eshyra-o9bd.19.3.4.2`. Finding-registry row: `condition-structure-no-regression`
(`sol:CAP-002`), already narrowed by slice 1 (PR #582). This design adds
discovery relationships only. It does not reopen that row. Related row
`canonical-discovery` (`sol:CAP-011`, "Canonical relationships and DM discovery
are durable") is owned by `eshyra-o9bd.19.2.4`. This design contributes
evidence toward that row but does not change its status.

Status: **proposed, revision 3** (design review 1 at `48875bd3`: a `null`
table mapping must not erase a declared occurrence; design re-review at
`2bfca47e`: reconcile the new outcome with the committed-pack gate and the
accepted F-09 design; see C1, C7, invariant 2, and §9). This document asks for design authorization
under `docs/design-and-pr-review-policy.md` ("Design authorization"). No
implementation lands with it.

## 1. Authority

In order:
[ADR 0020](../adr/0020-rules-pack-as-rule-awareness-infrastructure-with-bounded-deterministic-capabilities.md)
(the pack is rule-awareness infrastructure, and discovery relationships are
first-class);
[ADR 0007](../adr/0007-rules-pack-ingestion-policy.md) (a pack claim needs
licensed-source support);
[ADR 0017](../adr/0017-rules-pack-compiler-and-executable-curation-architecture.md)
and `docs/rules-pack-compiler.md` (curated projections);
`docs/importer-fix-protocol.md` (this change touches the importer and the
generated pack); `AGENTS.md`; the owning bead.

The relationship-manifest contract is `packages/core/src/rules/recordRelationships.ts`
(`record-relationships-v1`, eshyra-jgxl F1). Its rules still apply:

- declarations resolve per producing pack;
- there is no default disposition;
- every declared `reference` occurrence yields exactly one typed outcome.
  This design keeps that rule without exception: it adds one outcome
  (`excluded`, C1) rather than any path that emits nothing.

## 2. Problem (verified on `main` @ `de7df402`)

The SRD source states three kinds of condition→condition relationship,
in six occurrences.
Condition records already carry typed projections of them in
`data.mechanics.effects`. No discovery relationship is declared for any of
them. A model that looks up `condition:stunned` gets no signal that it should
also read `condition:incapacitated`, even though the source text says
"(see the condition)".

| Source (SRD 5.1 Appendix PH-A, pp. 358–359) | Record | Existing projection |
|---|---|---|
| "A paralyzed creature is incapacitated (see the condition) …" (p. 358) | `condition:paralyzed` | `{kind:'impliesCondition', condition:'incapacitated'}` |
| "The creature is incapacitated (see the condition), can't move or speak …" (Petrified, p. 359) | `condition:petrified` | same |
| "A stunned creature is incapacitated (see the condition) …" (p. 359) | `condition:stunned` | same |
| "An unconscious creature is incapacitated (see the condition) …" (p. 359) | `condition:unconscious` | same |
| "The creature drops whatever it's holding and falls prone." (Unconscious, p. 359) | `condition:unconscious` | `{kind:'imposesCondition', condition:'prone'}` |
| "The condition ends if the grappler is incapacitated (see the condition)." (Grappled, p. 358) | `condition:grappled` | `{kind:'conditionEndsWhen', condition:'grappled', trigger:'grappler-incapacitated'}`. The target condition appears **only inside an opaque trigger string**. |

Why the existing machinery cannot declare these:

1. **Resolver shape.** `record-name` resolution
   (`resolveRecordRelationships`) takes the relation from a sibling field.
   The sibling's value must belong to `CONDITION_RELATION_VALUES` (`applies`,
   `removes`, …, `mention`), which is the effect-to-condition vocabulary for
   `mechanics.conditions` entries. In condition effects, the discriminating
   sibling is `kind` (`impliesCondition`, `imposesCondition`,
   `conditionEndsWhen`). If the pointer were declared as it stands, every
   occurrence would come back `indeterminate` / `relation-not-recognized`.
2. **Overloaded leaf.** The pointer `/mechanics/effects/*/condition` also
   matches `conditionEndsWhen`. There, `condition` names the record's **own**
   condition (`grappled` on `condition:grappled`), which is a self-reference
   and not a relationship. Across other kinds, `/mechanics/effects/*/condition`
   holds prose preconditions: 76 magic-item leaves such as "wearer is not a
   dwarf", and 33 creature leaves such as "While in sunlight". The design must
   not treat a field name as a link. That is the defect the manifest exists to
   prevent.
3. **Grappled's trigger.** The only structured carrier of "incapacitated"
   there is the string `'grappler-incapacitated'`. A relationship cannot be
   declared on part of a string.
4. **Silent loader drop.** `packLoader.ts`'s
   `parseRecordRelationshipDeclaration` ignores unknown declaration keys. Any
   new declaration field this design adds could therefore be misspelled in a
   pack manifest and silently dropped. The loader would then interpret that
   declaration under different semantics than its author wrote, and nothing
   would report it.

## 3. Decisions

**C1 — Relation vocabulary is declared per declaration, with explicit
exclusions.** A `record-name` declaration may carry
`relationByFieldValue: Readonly<Record<string, string | null>>`. It is a
closed table from the sibling value (`relationField`) to the relation name
that the resolver emits.

- A sibling value that maps to a **string** yields that relation. The
  occurrence then resolves as today: `resolved`, `unresolved-target`, or
  `indeterminate`.
- A sibling value that maps to **`null`** is a declared, reviewable
  per-occurrence exclusion. The resolver emits an **`excluded`** outcome for
  it (below). It never emits nothing: the occurrence is covered by a
  `reference` declaration, so it must stay observable and distinguishable
  from an occurrence the resolver failed to retain. A declaration-level
  `not-a-reference` is different: it covers no `reference` occurrence, and its
  emit-nothing behavior is unchanged.
- A sibling value that is **absent from the table** yields `indeterminate` /
  `relation-not-recognized`. That is loud, and the committed-pack resolution
  gate fails on it.
- When `relationByFieldValue` is **absent**, resolution is unchanged: the
  sibling value must be a `CONDITION_RELATION_VALUES` member and is used
  verbatim. The existing five `mechanics.conditions` declarations are not
  migrated. This keeps the change additive and the emitted SRD manifest for
  those five rows byte-stable.
- `buildRecordRelationshipManifest` validates the table:
  - only with `targetResolution: 'record-name'` and a `relationField`;
  - non-empty keys;
  - values that are non-empty strings or `null`;
  - at least one string value, since a table of all nulls declares nothing
    and is a mis-declared `not-a-reference`;
  - **no `relation` beside a table.** Today every `reference` must carry
    `relation`, and the five existing `record-name` declarations fill it with
    the placeholder `'condition'`, which the sibling value always overrides.
    That is a required field filled mechanically to satisfy a validator (a
    recurring defect idiom recorded in the bd memory
    `srd-audit-design-invalidated-2026-07-27`). A table-bearing declaration
    must therefore omit `relation`, and `buildRecordRelationshipManifest`
    rejects the combination. The rule becomes: a `reference` declares its
    relation **exactly once**, either as `relation` (fixed) or as
    `relationByFieldValue` (per occurrence). The existing five keep their
    legacy `relation` plus sibling form, unchanged per invariant 4. Their
    placeholder is recorded in the C6 follow-up and not repaired here.

**The `excluded` outcome.** `RelationshipResolution` gains a fourth member:

```ts
| {
    readonly outcome: 'excluded';
    readonly sourceRecordKey: string;
    readonly pointer: string;
    readonly reason: 'relation-table-exclusion';
    /** The sibling value whose table entry is `null`. */
    readonly relationFieldValue: string;
    readonly declaration: RecordRelationshipDeclaration;
  }
```

It carries no `relation`, no `targetRecordKey`, and no leaf value: an
exclusion makes no claim about a target (resolution order, step 3). It is
positive evidence that a declared exclusion fired, and it differs from every
other outcome:

- `resolved` / `unresolved-target` make a claim about a target;
- `indeterminate` says the occurrence's data could not be read;
- `excluded` says the data was read and the manifest disposes of this
  occurrence as not-a-relationship, citing the table entry that did so.

A path that loses an occurrence produces none of the four, so a consumer can
tell an authorized exclusion from a dropped one. The module doc comment's
"exactly one typed outcome" list is updated to name all four.

**Consumer handling of `excluded`.** Every site that branches on
`outcome` was enumerated on `main` @ `b9f4fa9e`. Sites that select only
`resolved` for traversal or edge listing (for example the reverse-index
pass in `expansion.ts`) are correct unchanged: `excluded` must never
traverse. The sites that assume the three-member union are:

- `discovery/expansion.ts` records it in `relationshipResolutions` like every
  outcome, creates no traversal, and does **not** record a `StageLoss`. A
  declared exclusion is a disposition, not a loss, so it must not move
  measured loss counts. The current `outcome !== 'resolved'` → loss test
  becomes an explicit per-outcome switch, so a future fifth outcome fails
  type-checking instead of being counted silently as a loss.
- `ruleAwareness` (and so the `lookup_rules` envelope) passes it through
  unchanged, as it does every outcome; no facade code changes. The envelope
  already states that it is Eshyra runtime context; the `excluded` entry is
  self-describing. The accepted F-09 design states a three-member union for
  this field, so C7 amends it.
- The committed-pack resolution gate in `recordRelationships.test.ts`
  (`outcome !== 'resolved'` → failure) is redefined by invariant 2.

*Rejected: widening `CONDITION_RELATION_VALUES`.* That list is the closed
effect-to-condition contract for deterministic consumers
(`conditionRelations.ts`: "a consumer may act on these"). "Implies" is not
"applies": a paralyzed creature's incapacitation is part of the paralyzed
state and ends with it. Adding values there would change a contract owned by
a different producer and consumer pair.

*Rejected: an importer-emitted `conditionRef: 'condition:…'` beside
`condition`.* That creates two sources of truth for one source fact, and one
of them can drift.

*Rejected: renaming the `condition` leaf per effect kind.* It churns the live
consumer `conditionImpliesIncapacitated` (`state/activeEffects.ts`), which
reads `effect.condition`, and the shared effect-kind shape used by other
kinds.

**C2 — `record-name` with a fixed relation.** A `record-name` declaration may
omit `relationField` and use its own `relation` verbatim. This is allowed only
when every occurrence at the pointer has the same meaning. Today
`relationField` is required for `record-name`, because the only record-name
occurrences carried per-occurrence relations. A fixed relation assumes
nothing, so the reason for the requirement (never re-derive a sibling from the
pointer string) still holds. `relationByFieldValue` without `relationField` is
rejected.

**C3 — Source-backed structure for grappled's trigger.** The importer
(`conditionMechanics.ts`, `Grappled`) adds `triggerCondition: 'incapacitated'`
to the `grappler-incapacitated` `conditionEndsWhen` effect. It keeps
`trigger` unchanged, because it is the lifecycle discriminator and no
consumer changes. The value is the source's own "(see the condition)" cross
reference. It is a compiler projection under the existing
`(condition, /mechanics)` field-provenance declaration, so there is no new
provenance class. The `removed-from-grappler-reach` effect gets no
`triggerCondition`: its source clause names no condition. It cites the
*thunderwave* spell only as an example, and C6 excludes that.

**C4 — Declarations** (emitted by
`scripts/importers/dnd5e-srd-5.1/recordRelationshipDeclarations.ts`):

```ts
{ kind: 'condition', pointerPrefix: '/mechanics/effects/*/condition',
  linkField: 'data.mechanics.effects[].condition', disposition: 'reference',
  targetResolution: 'record-name',
  targetKind: 'condition', relationField: 'kind',
  relationByFieldValue: {
    impliesCondition: 'implied-condition',
    imposesCondition: 'imposed-condition',
    conditionEndsWhen: null, // names the record's own condition: a self-reference, not a relationship
  },
  reason: '…' }
{ kind: 'condition', pointerPrefix: '/mechanics/effects/*/triggerCondition',
  linkField: 'data.mechanics.effects[].triggerCondition', disposition: 'reference',
  relation: 'ending-trigger-condition', targetResolution: 'record-name',
  targetKind: 'condition', reason: '…' }
```

**Resolution order for a table-bearing declaration.** The resolver reads the
declared sibling **first**, then applies the rest of the resolution:

1. If the sibling is missing or not a string, the result is `indeterminate`,
   with the existing reasons.
2. If the sibling value is absent from the table, the result is
   `indeterminate` / `relation-not-recognized`.
3. If the value maps to `null`, the result is `excluded` /
   `relation-table-exclusion`, whatever the leaf value is. A declared
   exclusion makes no claim about the excluded leaf, so no leaf check runs.
4. Otherwise, the existing leaf checks apply: `value-not-a-string`, then
   resolution by name.

For declarations without a table, the current order is unchanged.

The first declaration carries no `relation` (C1), and every resolved
relation comes from its table. The resolver's current
`declaration.relation as string` initialization must not be reached for a
table-bearing declaration. A resolved relation for such a declaration is
always a table value.

**C5 — Loader rejects unknown declaration keys.**
`parseRecordRelationshipDeclaration` accepts exactly the declared field set,
now including `relationByFieldValue`, and throws `RulesPackError` naming any
other key. This closes problem 4 for this field and for every future one. The
committed SRD manifest and the in-repo fixture manifests are checked against
it.

**C7 — Amendment to the accepted F-09 design.** This PR amends
`docs/design/rule-record-runtime-statements.md` (merged with PR #594) in
place, as amendment A2, so the two accepted designs do not disagree about
the model-facing contract:

- R5's `relationships` field comment names the full four-member union:
  `resolved | unresolved-target | indeterminate | excluded`.
- Invariant 9 says the envelope keeps **every** resolution outcome,
  including `excluded`, and still says it keeps `unresolved-target` and
  `indeterminate` (the failure semantics that invariant protects).
- The status line records A2 and points here.

A2 changes no F-09 behavior: the facade already passes the union through
unfiltered. Its permanent evidence (invariant 9's `lookup_rules` cases) is
unchanged; the implementation PR adds one assertion that a Grappled lookup
envelope carries the `excluded` outcome, since that is the first committed
producer of it.

**C6 — Scope.**

In scope:
- condition records, the four relationships in §2;
- the resolver generalization (C1, C2);
- the loader hardening (C5).

Explicitly **out** of scope, each recorded as a finding for its owner:
- **Undeclared condition-name leaves in other kinds.** These are
  `creature` `/actions|legendaryActions|reactions|traits/*/mechanics/conditions/*/condition`
  (359 leaves at `de7df402`), `ancestry` `/traits/*/mechanics/conditions/*/condition`
  (5), and the differently shaped `magic-item` `/mechanics/effects/*/conditions/*`
  (18) and `failedSaveCondition` (9) leaves. They have the same fail-open
  shape as §2, but each belongs to the owning domain bead: creatures
  `eshyra-o9bd.19.4.2`/`.3`, ancestry `eshyra-o9bd.19.3.1`, and magic items
  `eshyra-o9bd.19.4.5`. The magic-item leaves also hold non-condition values
  (`suffocating`, `any-disease`, `one exhaustion level`), so they need their
  own disposition work. The follow-up bead `eshyra-o9bd.19.3.5` records the enumeration. Membership
  comes from a generated query, never from these snapshot counts.
- **Adding `/mechanics/effects/*/condition` to
  `LEGACY_RELATIONSHIP_BEARING_POINTER_SHAPES`.** That would force a
  declaration for every kind that emits the overloaded leaf, most of which hold
  prose. It is recorded in the same follow-up, not done here.
- **Condition→spell or condition→rule edges.** Grappled's *thunderwave* is an
  illustrative example, not a governing relationship. The pack also renders
  the name as `thunder-wave`, faithful to the PDF's in-word hyphen, so a
  name-resolved edge would be `unresolved-target` anyway. Exhaustion's
  food-and-water exception already exists (PR #582).
- **Rewiring `conditionImpliesIncapacitated`** to consume relationships. The
  runtime consumer keeps reading its own typed data, and no behavior changes.
- **Expansion depth.** Discovery expansion is one hop
  (`expandTypedRelationships`; the second pass in design §12.1 seeds only
  rule-join promotions). So a spell that applies *stunned* brings in
  `condition:stunned`, but not, transitively, `condition:incapacitated`. The
  new edges reach the model in two cases:
  - when the condition itself is a discovery seed;
  - through the `lookup_rules` `ruleAwareness` envelope, when the DM reads the
    condition.

  Changing hop policy belongs to the discovery design, not to this repair, and
  is not proposed here.

## 4. Producer–consumer boundaries

- **Producer:** the SRD importer. `conditionMechanics.ts` adds C3's leaf.
  `recordRelationshipDeclarations.ts` adds C4. Regenerating writes
  `records.json` and `record-relationships.json`. `field-provenance.json`,
  `manifest.json`, and `source-*.json` are checked for incidental change.
  Only hashes of changed artifacts may move, and the freeze-manifest stays
  untouched (bd memory `srd-freeze-manifest-hashes-frozen-until-o9bd-closes`).
- **Contract:** `recordRelationships.ts`, which covers C1, C2, and C5's
  validation half, and `packLoader.ts` (C5).
- **Consumers:**
  - discovery expansion (`discovery/expansion.ts`): **changed**. Loss
    accounting becomes an exhaustive per-outcome switch in which `excluded`
    is neither a traversal nor a `StageLoss` (C1). Its traversal passes,
    which select only `resolved`, are unchanged.
  - the `ruleAwareness` facade and `lookup_rules` envelope (landed with
    PR #594): **code unchanged**, contract amended (C7). Both call
    `resolveRecordRelationships` with the producing pack's manifest, so the
    new edges and the `excluded` outcome reach them without code changes.
  - the committed-pack resolution gate (test code): **changed**, per
    invariant 2.
  - `state/activeEffects.ts`: unchanged; it does not read the manifest.
- **Discovery retention budget:** new edges from condition seeds can add
  candidates to a packet. The existing discovery probe and intervention suites
  (`test/discovery/discoveryProbes.test.ts`, `packetIntervention.test.ts`) must
  stay green: M1 must-consider coverage and M3 no lost routes. If a new
  candidate displaces must-consider material, that is a design failure (§8),
  not a budget to retune in the implementation PR.
- **Add-on packs:** per-producer resolution is unchanged. An add-on without a
  manifest gets none of these edges. An add-on manifest may use C1/C2 for its
  own fields.

## 5. Invariants

1. **Every declared occurrence is typed.** With C4 in place, every
   `/mechanics/effects/*/condition` leaf in a condition record is one of:
   - `resolved`;
   - `unresolved-target`;
   - `indeterminate`;
   - `excluded`, meaning its sibling maps to `null`.

   Nothing disappears, for a declared reason or an undeclared one: the
   resolver's result for a declared occurrence is never empty. An unknown effect `kind`
   carrying a `condition` leaf fails the committed-pack gate
   (`relation-not-recognized`).
2. **Committed-pack resolution gate: generalized, not weakened.** The
   existing test ("resolves every declared reference occurrence in the
   committed pack", `recordRelationships.test.ts`) today fails on any
   outcome other than `resolved`, so it would fail on every legitimate
   exclusion. Its durable responsibility is unchanged: a committed declared
   reference must never become `unresolved-target` or `indeterminate`. Its
   predicate becomes an exhaustive switch over `outcome`:
   - `resolved` → accepted;
   - `unresolved-target`, `indeterminate` → failure, exactly as today;
   - `excluded` → accepted **only** if its `(declaration.kind,
     declaration.pointerPrefix, relationFieldValue)` triple is in the gate's
     explicit justified-exclusion list, and every entry in that list has an
     invariant-7-style committed-pack assertion proving the exclusion is
     source- and pack-correct. Today the list has exactly one entry:
     `(condition, /mechanics/effects/*/condition, conditionEndsWhen)`. An
     `excluded` outcome from any other declaration or sibling value fails
     the gate, so a new `null` mapping cannot land without its own
     justification evidence.
   - an unknown outcome fails type-checking (the switch is exhaustive).

   The six source occurrences in §2 must be `resolved`. The one
   `conditionEndsWhen` `condition` leaf on `condition:grappled` must be
   `excluded`. The gate is renamed to say it accepts resolved and justified
   excluded occurrences.
3. **No self-edges.** No emitted relationship has `targetRecordKey ===
   sourceRecordKey` for these declarations.
4. **Existing declarations are unchanged.** Resolutions for the five
   `mechanics.conditions` declarations are identical before and after. The
   emitted declaration objects for those rows are byte-identical in
   `record-relationships.json`.
5. **Loader fails closed.** A manifest declaration with an unknown key is
   rejected at load. A malformed `relationByFieldValue` is rejected at build.
6. **Source support.** Each emitted edge traces to a quoted source clause in
   §2 (ADR 0007). `triggerCondition` is emitted only where the source clause
   names a condition.
7. **Declared exclusions are checked, not assumed.** The `null` entry for
   `conditionEndsWhen` encodes a claim: in a condition record, that effect's
   `condition` leaf names the record's own condition. A committed-pack test
   asserts that claim for every excluded occurrence: the leaf's normalized
   value equals the record's normalized name. If a future importer change
   points a `conditionEndsWhen` at another condition, the test fails loudly,
   and the exclusion never hides the edge.
8. **Liveness.** `assertRecordRelationshipDeclarationsAreLive` passes: both new
   declarations match emitted leaves.

## 6. Evidence plan

The claim is small and source-backed, and the edges are few. Every condition
record in the committed pack is exercised directly, so no separate
vertical slice is needed.

| Evidence | Kind |
|---|---|
| Identity assertion on resolved edges, **permanent**. `paralyzed`, `petrified`, `stunned` → `implied-condition condition:incapacitated`. `unconscious` → `implied-condition condition:incapacitated` and `imposed-condition condition:prone`. `grappled` → `ending-trigger-condition condition:incapacitated` and no self-edge. Every other condition record → no condition-effect edges, and exhaustion keeps exactly its lifecycle exception. | durable discovery contract; identities, not counts |
| Resolver unit tests (`recordRelationships.test.ts`, synthetic manifests), **permanent**. Table string → `resolved`/`unresolved-target`. Table `null` → exactly one `excluded` outcome carrying the pointer and sibling value, including when the leaf is not a string (no leaf check runs). Sibling value absent from the table → `indeterminate`/`relation-not-recognized`. Missing and non-string sibling → `indeterminate`. The test asserts these as four distinct outcomes for one synthetic record, so an exclusion can never be confused with a missing, malformed, or unrecognized occurrence. Fixed-relation `record-name`. Each `buildRecordRelationshipManifest` rejection in C1/C2. | contract boundary |
| Expansion unit test, **permanent**: an `excluded` resolution appears in `relationshipResolutions` and produces neither a traversal nor a `StageLoss`. | consumer boundary |
| Loader test, **permanent**: an unknown declaration key is rejected, naming the key and path. | contract boundary |
| Discovery probe: seeding `condition:stunned` expands to `condition:incapacitated` through `expandTypedRelationships` with the bundled manifest source. **Permanent** only if no existing probe already proves that `record-name` expansion reaches discovery; otherwise it is dropped after it is observed. | real consumer |
| Importer test (`conditionMechanics.test.ts`): Grappled's `triggerCondition` is present only on the `grappler-incapacitated` effect. Any existing exact-projection assertion for Grappled is **extended**, not weakened, with §2's source clause as evidence (`docs/importer-fix-protocol.md`). | producer |
| Committed-pack resolution gate (invariant 2), **permanent**, redefined. It still fails on an introduced `unresolved-target` or `indeterminate`. It accepts `excluded` only for the listed, justified triple. The implementation PR proves the gate's discrimination once by observation (a synthetic `unresolved-target`, a synthetic `indeterminate`, and an unlisted `excluded` each make it fail), then keeps the gate itself as the permanent evidence. | protects the durable committed-pack contract |
| `lookup_rules` envelope for `condition:grappled` carries the `excluded` outcome (C7), **permanent**. | amended F-09 contract, first committed producer |
| Committed-pack exclusion check (invariant 7), **permanent**. It reads the `excluded` outcomes the resolver emits for the committed pack (Grappled's `conditionEndsWhen`), reads the leaf at each outcome's `pointer`, and asserts the self-reference. It therefore checks the occurrences the resolver actually excluded, not a re-derivation of them. | protects a declared assumption |
| Existing condition source-fidelity tests (slice 1) unchanged and green. | regression |

No corpus-wide completeness test is added (ADR 0020).

## 7. Exclusions

- No change to `CONDITION_RELATION_VALUES` or `mechanics.conditions`
  semantics.
- No change to `conditionImpliesIncapacitated` or any runtime state module.
- No declarations for kinds other than `condition` (C6 follow-up).
- No change to `LEGACY_RELATIONSHIP_BEARING_POINTER_SHAPES`.
- No `record-relationships` schema version bump. Loader and pack ship
  together in one release artifact. An older loader cannot load the new
  manifest at all. Its `buildRecordRelationshipManifest` rejects both new
  declarations and throws `RulesPackError`:
  - the table declaration has no `relation` ("reference requires relation");
  - the fixed-relation declaration has no `relationField` ("record-name
    requires a non-empty relationField").

  That fails closed and loudly, and never produces a wrong edge.
- No freeze-manifest hash change and no thaw note (the freeze guard is dormant
  until `eshyra-o9bd.14`).

## 8. Next state

1. **Authorization** of this design.
2. **Implementation PR** under `eshyra-o9bd.19.3.4`, containing C1–C5, the
   regenerated pack artifacts, and the §6 evidence. It also contains the
   inventory-script rerun
   (`packages/core/scripts/inventory-semi-structured-boundary.ts`) that pack
   field changes require.
3. `eshyra-o9bd.19.3.4` item 2 is then complete. Whether it clears the bead
   depends on the opus:F-09 generalization, which is item 1.

**On failure:** stop, record it on the bead, and revise this design before
continuing. Failure cases include:
- a new occurrence does not resolve;
- a declared occurrence yields no outcome;
- a self-edge appears;
- an existing declaration's resolutions change;
- the loader hardening rejects a manifest already committed in the repo that
  should be valid.

## 9. Revision history

- **Revision 3** (design re-review at `2bfca47e`, CHANGES REQUESTED). The
  review confirmed revision 2 fixed the original defect class and found one
  sibling in its blast radius: the new terminal outcome was not reconciled
  with (a) the committed-pack gate, whose `outcome !== 'resolved'` predicate
  fails every legitimate exclusion and contradicted invariant 1, or (b) the
  accepted F-09 design's three-member union in R5 and invariant 9. Repair:
  invariant 2 redefines the gate as an exhaustive switch that still fails
  `unresolved-target`/`indeterminate` and accepts `excluded` only for an
  explicit, individually justified list; C7 amends the F-09 design in place
  (amendment A2); §4 now names the consumers whose code changes; §6 adds the
  gate and envelope evidence. Branch merged with `main` @ `b9f4fa9e`
  (PR #594 landed during review).
- **Revision 2** (design review 1 at `48875bd3`, CHANGES REQUESTED). The
  review found that revision 1's `null` table mapping made a covered
  `reference` occurrence emit nothing, breaking the manifest invariant that
  every declared occurrence yields exactly one typed outcome. Defect class:
  every `relationByFieldValue` `null` mapping (a general manifest feature, not
  only Grappled). Repair: the new `excluded` outcome (C1), resolution order
  step 3, invariant 1, explicit consumer handling in expansion and
  `ruleAwareness`, and resolver/expansion evidence that distinguishes an
  exclusion from missing, malformed, and unrecognized occurrences (§6).
  Invariant 7's committed-pack self-reference assertion is kept. String
  mappings, absent-table entries, fixed-relation `record-name`, and the
  Grappled `triggerCondition` projection are unchanged.
