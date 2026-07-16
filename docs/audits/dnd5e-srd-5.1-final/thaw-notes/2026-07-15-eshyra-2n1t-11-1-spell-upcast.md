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
verbatim and matched by an exact spell/page/text override whose deterministic
projection restores the source-backed “for each slot level” count. Damage
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
array offsets, together with the exact clause/page/phrase provenance tuple.

The schema validator and runtime share one closed parser, including operation /
subject compatibility and S1 fail-closed checks. Both model-facing tools resolve
the exact campaign base and ordered add-ons by system, pack, and version. The
slot tool retains legacy `{ spell }` replay compatibility while canonicalizing
new calls to `spellRef`.

Generated scope:

- no records added or removed;
- 92 spell records receive higher-slot payloads and 102 spell records receive
  explicit source-marker metadata (92 higher-slot, 10 character-level);
- equipment, magic-item, and non-spell records are unchanged;
- raw `higherLevels` text remains retained verbatim;
- canonical regeneration and `verify:dnd5e-srd-pack` are byte-identical.

Evidence: `spellUpcastInventory.ts`, `spellUpcast.test.ts`, the semi-structured
boundary inventory, and the canonical importer verification.

Updated frozen `records.json` SHA-256:

`af4b7dafdefe9e5bd4f99ab4306a72bb82ee090028525d38999931c7cb32a204`
