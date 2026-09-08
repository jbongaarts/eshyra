# Campaign rules and disputed turns

Campaign rulings and house rules are durable prose. A ruling resolves a known
source ambiguity or recurring question; a house rule deliberately changes clear
canonical behavior. Both the DM and mechanics auditor receive the same active
rules. The immutable rules pack remains the source and is never edited by a
campaign choice.

Use `/rules list`, `/rules show <identity>`, and `/rules history` to inspect the
campaign's rules. Ordinary additions, supersessions, and revocations take effect
prospectively. They do not rewrite an accepted turn's recorded context.

When the DM asks about an unresolved source ambiguity, the CLI offers the
published interpretations after the turn. Choosing one records a prospective
ruling. Declining leaves it unresolved. An accepted action can also establish a
precedent when it clearly selects exactly one known interpretation: for example,
summoning both a ghast and a wight selects the mixed composition interpretation.
The DM proposes that precedent with `accept_ambiguity_precedent`; the runtime
checks the source and interpretation IDs and the auditor checks the action and
reason. Only the accepted candidate commits the ruling. Its narration visibly
acknowledges the lasting precedent. Questions, ordinary contextual judgments,
and violations of unambiguous canonical rules do not establish precedents.

## Objecting to the latest adjudication

Immediately after an adjudication, enter `/dispute` or supply the intended rule
prose directly:

```text
/dispute We don't use spell components.
```

Choose `house-rule`, identify the governing source (`rule:components` in this
example), and explicitly confirm the proposed replay. For a source ruling,
provide the ambiguity and known interpretation IDs; for a recurring question,
provide its question ID. An existing rule can be superseded by naming it.
Cancellation makes no changes.

The runtime restores pre-turn state and replays the original player input with
the same seed and acting character. The approved rule applies from the start of
that turn in both model contexts. The replay replaces the original scene log,
state effects, and canonical turn trace. The abandoned trace remains diagnostic
history associated with the corrective rule.

Only the latest accepted, unreplayed adjudication is eligible. Reusing an
accepted turn ID through ordinary `runTurn` is rejected. Intervening state
changes, including management commands or a completed session close, invalidate
the saved replay rather than being erased. This is an immediate objection
workflow, not historical editing.

If the provider or audit fails during replay, pre-turn state and the approved
rule remain saved. Use `/dispute retry` to resume the same approved action.
Other play commands pause until recovery completes. `/quit` preserves the open
session and recovery state; reopening play offers the same recovery path.
A replay can be corrected once; retries recover that same replay rather than
introducing further retroactive rules.

## Storage and capability boundaries

Migration 0028 adds one replaceable recovery snapshot per campaign and a
separate abandoned-trace diagnostic table. Snapshots use the existing checkpoint
row serialization, exclude recovery and failure-diagnostic tables to avoid
recursive history, and include the original turn input. A post-turn hash guards
against overwriting later state. Restoration, rule admission, and pending
recovery are one SQLite transaction; model execution follows under the existing
turn and candidate savepoints. No Dolt process runs on the per-turn path.
Storage and snapshot work scale with the campaign database; only one recovery
snapshot is retained, not a snapshot for every turn.

The campaign-owned item preflight reads active ambiguity rulings at the persisted
campaign position and returns them with the bounded capability result. The
`use_item` error carries that context when blocked. Resolving the Cube of Force
same-face duration ambiguity does **not** discharge engine-pending clauses:
both known choices still leave its operation blocked. This supplies ruling
context to capability preflight; it does not add a new item capability or compile
arbitrary prose into mechanics.

The offline acceptance suite is
`packages/core/test/campaignRulesEndToEnd.test.ts`; the CLI approval and recovery
suite is `packages/cli/test/playDispute.test.ts`. They cover the ten jhpt
scenarios, persisted DM/auditor identity evidence, rollback and recovery,
non-Dolt checkpoint restoration, and unchanged pack bytes. Scripted models prove
runtime boundaries; they do not certify a live model's semantic judgment.
