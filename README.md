# Beads state projection

This ref is a generated, disposable read-only projection. Never edit or merge it; it is not a Git branch.

Beads/Dolt remains authoritative. refs/dolt/data is the canonical remote database transport; ordinary Beads history lives in Dolt, not here. refs/beads/state exists only to make the current state readable. The exact source Dolt Git SHA is recorded in metadata.json.

Consumers should resolve refs/beads/state to its commit SHA and read files from that commit. Never reconstruct Beads state from this projection and write it back.
