# Thaw note: deterministic spell upcast scaling

Bead: `eshyra-2n1t.11.1`  
Related merged work: PR #452 / `eshyra-o9bd.18.7.6`

The frozen SRD pack was intentionally thawed to compile the 92 reviewed
`At Higher Levels` clauses into source-bound typed `data.upcast` payloads.
The nine cantrip advancement clauses are explicitly classified as
`character-level` and do not emit slot-upcast data. Existing S1 summoning
scaling remains authoritative and is adapted by the runtime resolver without
duplication.

Generated scope:

- no records added or removed;
- 92 spell records receive higher-slot payloads and 101 spell records receive
  explicit source-marker metadata (92 higher-slot, 9 character-level);
- equipment, magic-item, and non-spell records are unchanged;
- raw `higherLevels` text remains retained verbatim;
- canonical regeneration and `verify:dnd5e-srd-pack` are byte-identical.

Evidence: `spellUpcastInventory.ts`, `spellUpcast.test.ts`, the semi-structured
boundary inventory, and the canonical importer verification.

Updated frozen `records.json` SHA-256:

`37412901f2250b0d76869a65f0f1d493b24feb4e1c9bea52fbf91a2a12c53df7`
