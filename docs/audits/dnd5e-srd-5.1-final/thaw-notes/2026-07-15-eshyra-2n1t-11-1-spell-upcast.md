# Thaw note: deterministic spell upcast scaling

Bead: `eshyra-2n1t.11.1`  
Related merged work: PR #452 / `eshyra-o9bd.18.7.6`

The frozen SRD pack was intentionally thawed to compile the 92 reviewed
`At Higher Levels` clauses into source-bound typed `data.upcast` payloads.
The ten cantrip advancement clauses are explicitly classified as
`character-level` and do not emit slot-upcast data. Existing S1 summoning
scaling remains authoritative and is adapted by the runtime resolver without
duplication.

The SRD PDF text layer's malformed Animal Friendship clause is retained
verbatim and matched by an exact spell/page/text correction whose deterministic
projection restores the source-backed “for each slot level” count. The emitted
correction now names a stable correction ID, retained extracted phrase and
SHA-256, reviewed phrase, and explanatory note; runtime evidence returns the
reviewed phrase and the complete correction tuple so the operation is
reproducible without hidden compiler knowledge. Damage
subjects use clause-local unique types and source-named components, while S1
results retain their creation/control scope and selection semantics.
Reviewed clause-level coverage pins complete multi-threshold schedules and
independent branches. Qualifiers carry a minimum applicable slot, damage
subjects distinguish choices from all-component transforms, and affected-HP
pool dice remain separate from damage and flat healing points.
All 92 clauses are independently pinned by canonical spell key, exact source
page, and verbatim-source SHA-256. A second independent oracle pins the complete
typed projection plus every legal-slot resolver result for every clause.
Etherealness and the four 30-foot multi-target spells retain their targeting
constraints; Counterspell and Dispel Magic resolve their automatic spell-level
threshold directly from the selected slot; Glyph of Warding carries an
exclusive typed branch; and False Life emits flat temporary-hit-point scaling.
Resolved adjustments carry stable semantic source-operation IDs rather than
array offsets. Their source binding identifies the owning pack ID/version,
structured source reference and locator, compact ordered override-chain
identity, exact clause/page, reviewed operation phrase, and any raw-source
extraction correction.

The schema validator and runtime share one closed parser, including operation /
subject compatibility and S1 fail-closed checks. Threshold schedules use the
same `semanticId + choice group + choice option` axis in validation and runtime,
including multiple thresholds within each exclusive branch. Both model-facing
tools resolve the exact campaign base and ordered add-ons by system, pack, and
version. Slot capacity is derived from a character resolver over that same
resolved stack, so an add-on class progression override cannot diverge from the
spell source. The slot tool retains legacy `{ spell }` replay compatibility
while canonicalizing new calls to `spellRef`.

Generated scope:

- no records added or removed;
- 92 spell records receive higher-slot payloads and 102 spell records receive
  explicit source-marker metadata (92 higher-slot, 10 character-level);
- equipment, magic-item, and non-spell records are unchanged;
- raw `higherLevels` text remains retained verbatim;
- exactly one generated record changes in the review follow-up:
  `spell:animal-friendship` gains the explicit source-correction tuple;
- canonical regeneration and `verify:dnd5e-srd-pack` are byte-identical.

Evidence: `spellUpcastInventory.ts`, `spellUpcast.test.ts`, the semi-structured
boundary inventory, and the canonical importer verification.

Updated frozen `records.json` SHA-256:

`7ad477f6271ab96472c685061ebdabc603f6a6a9899929b6d3f05d0568b5b89a`
