# Thaw Note — C6 `damageAbsorption` projection

## Reason for thaw

Implement bead `eshyra-o9bd.18.7.9.12`, slice C6 of the reviewed
creature-entry classification. Four damage-absorption traits were fail-closed
findings because a bare trigger marker did not represent their deterministic
damage negation and healing result.

## Exact refs

- `creature:clay-golem#traits:Acid Absorption`
- `creature:flesh-golem#traits:Lightning Absorption`
- `creature:iron-golem#traits:Fire Absorption`
- `creature:shambling-mound#traits:Lightning Absorption`

Each now receives the closed contract:

```json
{
  "kind": "damageAbsorption",
  "type": "acid | lightning | fire",
  "damageTaken": "none",
  "healing": "damage-dealt"
}
```

## Membership/readiness delta

Before: 72 reviewed creature refs, 16 registry entries consisting of 2
permanent accepted-prose refs and 14 pending findings; C6 contributed 4 pending
findings. After: 72 reviewed refs, 12 registry entries consisting of the same
2 accepted-prose refs and 10 pending findings. C6 contributes zero pending
findings. The remaining findings are C4 2, C7 2, C8 2, and C9 4.

## Source and generated-pack evidence

The importer recognizes only the complete current SRD source strings for the
three golem clauses and the Shambling Mound clause. The latter's source
wording omits “instead”; that variation is matched explicitly. Any changed or
truncated clause fails closed and does not emit `damageAbsorption`. The typed
effect also suppresses the disconnected generic `triggeredEffect` marker.

Regeneration changes exactly the four existing creature records above. No
records are added or removed, and no unrelated creature, spell, record-count,
or mechanics projection changes.

Source PDF and source manifest are unchanged.
