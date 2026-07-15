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

`c4e86f48a056c5dc3f07f4607198d72c9e8a4516fb0e403af849416de64edc5f`
