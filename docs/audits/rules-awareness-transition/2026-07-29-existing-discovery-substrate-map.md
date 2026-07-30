# Existing rules-awareness discovery substrate map

Date: 2026-07-29

Scope: accepted ADR 0020 transition evidence; current implementation only

Bead: `eshyra-jued`

## 1. Executive summary

The current DM runtime does not discover potentially governing rules
automatically. The normal path gives the DM a deterministic campaign-state and
memory snapshot, a static system prompt, and the complete static tool roster.
It does **not** place rules-pack records in the initial turn context. The prompt
instructs the model to call `lookup_rules` before using a creature or rules
mechanic; whether a lookup happens, which kind/name/ref it uses, and whether it
looks up enough records are model choices. The model-based turn auditor can
reject an unsupported final assertion and request target-specific lookups on a
retry, but that is post-hoc detection, not pre-decision discovery.

`lookup_rules` is a deterministic exact identity/name resolver over the active
campaign stack. It supports normalized names and a small set of generated and
hard-coded aliases, returns the complete matched record plus provenance and
override evidence, and fails closed on ambiguity. It performs no query
derivation, full-text search, candidate ranking, relationship expansion, or
cross-kind search. Its only candidate truncation is the 12-key cap on an
ambiguous exact-name result. The reason an alias matched is not returned.

The pack already contains useful but heterogeneous discovery substrate:
stable keys, kinds, display names, source locators, source prose, per-kind
references, prerequisites, tables, mechanics projections, unresolved
`RulesAmbiguity` objects, and magic-item execution-readiness/engine-hook
metadata. These fields are not a sufficient discovery system merely by
existing. `RulesRecord.data` is intentionally kind-specific and typed as
`unknown` at the common boundary; references are spread across many fields;
there is no common alias field or complete relationship vocabulary; and the
runtime does not traverse those references after lookup.

Deterministic capabilities and prose currently meet only after the model has
chosen a tool. Every default capability is presented statically as a tool
definition, independent of which rule record was found. Some state tools
resolve pack records internally and enforce structured mechanics. Other
deterministic state callers use a legacy base-only lookup that ignores add-ons
and silently falls back to the bundled D&D pack. A successful prose lookup
therefore does not prove that a capability is available, and the capability
roster does not communicate a discovered record's operation-specific limits.

Accepted-turn evidence is comparatively strong: the turn trace stores the
rendered initial context, final narration, full successful and failed tool
calls, successful rule-lookup results, resolution projections, and a
tool-argument projection of state mutations. It does not store the candidate
universe, lookup trigger/reason, alias route, relationship expansion,
rank/truncation decisions, or which supplied material the model used. Rejected
audited attempts are rolled back and are absent from the durable turn trace;
optional debug JSONL retains structural audit events, not a durable replayable
rules-discovery record.

Three concrete defects are visible in the executable path:

1. `lookup_rules` omits the addressable `stat-block` kind from its input schema,
   so the registry rejects a stat-block lookup before the tool body runs.
2. Normal CLI gameplay never passes `resolveAdventureModule` to `runTurn`.
   Consequently an active adventure produces no adventure context, and
   `start_encounter` by authored `encounterId` fails for lack of a resolver.
3. `lookupCampaignRecord` and the private encounter creature lookup resolve
   only a base pack, ignore campaign add-ons, match the base by `packId` alone,
   and silently fall back to bundled D&D. Their structured mechanical results
   can diverge from both strict `lookup_rules` and the persisted campaign
   binding.

These are current defects, not optional transition ideas.

## 2. Authority and code surfaces inspected

### Authority

The conclusions below were checked against executable code after reading:

- `AGENTS.md`;
- [ADR 0007](../../adr/0007-rules-pack-ingestion-policy.md);
- [ADR 0010](../../adr/0010-api-native-vs-agent-harness-adapter-seam.md);
- both accepted records numbered 0012:
  [character continuity and custody](../../adr/0012-character-continuity-and-custody.md)
  and
  [content/state layers](../../adr/0012-rules-pack-campaign-template-adventure-module-campaign-instance.md);
- [ADR 0013](../../adr/0013-runtime-srd-pack-is-the-generated-pack.md);
- [ADR 0014](../../adr/0014-campaign-overlay-canon.md);
- [ADR 0017](../../adr/0017-rules-pack-compiler-and-executable-curation-architecture.md);
- [ADR 0018](../../adr/0018-single-class-engine-boundary.md);
- [ADR 0019](../../adr/0019-typed-boundary-for-semi-structured-source-strings.md);
- [ADR 0020](../../adr/0020-rules-pack-as-rule-awareness-infrastructure-with-bounded-deterministic-capabilities.md);
- [rules-pack compiler guide](../../rules-pack-compiler.md).

ADR 0020 controls where older compiler/readiness language is broader: pack
prose is rule-awareness material, deterministic support is a bounded positive
claim, and absence of a capability is not a negative rules conclusion.

### Executable surfaces

The inspection followed real consumers, not exports alone:

| Surface | Files and principal symbols |
|---|---|
| CLI input and dependency wiring | `packages/cli/src/play.ts` `runPlay`; `playTurnLoop.ts` `turnLoop`; `playTypes.ts` `PlayDeps`; `index.ts` `buildPlayDeps`, `makeGameplayClient`; `adventures.ts` `makeModuleResolver` |
| Turn orchestration | `packages/core/src/orchestrator/orchestrator.ts` `runTurn`; `turnLoop.ts` `runModelLoop`; `protocol.ts` `buildSystemPrompt` |
| Context and memory | `contextAssembler.ts` `assembleContext`, `readStateSnapshot`, `assembleAdventureContext`, `renderContextMessage`; `adventureContext.ts` `buildAdventureContextSlice`, `renderAdventureContextSlice`; `memory/summary.ts` `selectAlwaysOnMemory`; `memory/characterChronicle.ts`; scene/session/arc stores |
| Provider-neutral and provider-specific seams | `model/client.ts` `ModelClient`, `ModelCompleteInput`, `ModelAdapterCapabilities`; `model/anthropicNativeClient.ts`; `model/openaiNativeClient.ts`; `model/agentSdkMcpClient.ts`; `model/codexSdkMcpClient.ts` |
| Tools and capabilities | `toolRegistry.ts` `Tool`, `ToolContext`, `ToolRegistry`; `tools.ts` `DEFAULT_TOOLS`, `createDefaultToolRegistry`; all registered `tool*.ts` implementations, with representative resolution and mutation paths traced through `toolResolveCheck.ts`, `toolAdjustHp.ts`, `toolUseItem.ts`, and `toolStartEncounter.ts` |
| Rules loading and lookup | `rules/types.ts`; `packLoader.ts`; `bundledSrdPack.ts`; `binding.ts`; `stack.ts`; `lookup.ts`; `recordCard.ts`; `orchestrator/toolLookupRules.ts`; `state/campaignRecordLookup.ts`; `character/rulesPackResolver.ts` |
| Structured mechanics and mutation | `state/mutateState.ts`; `domainMutations.ts`; `hpLifecycle.ts`; `activeEffects.ts`; `actionEconomy.ts`; `usageCounters.ts`; `attunement.ts`; `itemState.ts`; `itemExecutionReadiness.ts`; `encounterCombatants.ts`; `rules/*Mechanics.ts` and kind validators |
| World and overlay paths | `world/worldQuery.ts`; `world/campaignOverlayLore.ts`; `orchestrator/toolWorldQuery.ts`; `toolRecordWorldFact.ts`; adventure run and module reference validators |
| Audit, debug, and durable evidence | `turnAuditor.ts` `ModelTurnAuditor`, `buildAuditUserMessage`; `debug/sessionDebug.ts`; CLI `sessionDebug.ts`; `memory/turnTrace.ts`; `turnTraceProjection.ts`; persistence schema/migrations |

Tests were read where they exercise these real seams, especially
`tools.test.ts`, `rulesStack.test.ts`, `contextAssembler.test.ts`,
`protocol.test.ts`, `e5.integration.test.ts`, `orchestrator.test.ts`,
`turnAuditor.test.ts`, `turnTraceProjection.test.ts`, `world.test.ts`, all four
provider-adapter suites, and CLI `play.test.ts`. Importer claims and generated
data were sampled only with read-only queries; generated pack output was not
changed.

Per the assignment, the parallel current-state claim report was neither read
nor awaited.

## 3. End-to-end runtime flow

```text
terminal input
  │  CLI turnLoop: slash commands bypass the DM turn
  ▼
runTurn ── overall SQLite savepoint
  │
  ├─ assembleContext
  │    campaign/party/state + bounded recaps/scene/chronicle
  │    + adventure slice only when a resolver is supplied
  │    + player input
  │    (no automatic rules-pack records)
  │
  ├─ buildSystemPrompt + renderContextMessage
  │    static tool contract + explicit instruction to call lookup_rules
  │
  ▼
runModelLoop ── provider-neutral tool definitions
  │
  ├─ model chooses narration and/or tool calls
  ├─ lookup_rules: exact kind + name/ref → full record/tool result
  ├─ pure resolution tools: seeded deterministic result
  └─ mutation tools: validated domain operation → SQLite writes
       (all attempt writes remain inside savepoints)
  │
  ▼
model candidate
  │
  ├─ no auditor: accept
  └─ auditor: post-hoc model review of candidate + bounded tool evidence
       ├─ accept/repair
       └─ reject → rollback attempt → corrective retry
  │
  ▼
accepted narration + scene log + turn trace
  │
  └─ release overall savepoint; on failure roll back the whole turn
```

### Stage-by-stage producer/consumer map

| Stage | Exact producer → consumer | Input → output | Character and retained/discarded rule-awareness evidence | Failure, tests, and bypasses |
|---|---|---|---|---|
| Player entry | CLI `playTurnLoop.ts:turnLoop` → `orchestrator.ts:runTurn` | Trimmed terminal string plus campaign/session/turn IDs, timestamp, seed, recap limit → `RunTurnInput` | Player wording is retained in initial context and transcript. Slash commands are handled outside `runTurn` and do not enter this path. | Failed turn is reported and loop continues. `packages/cli/test/play.test.ts` covers input, failure, replay, and lifecycle. Direct core consumers can call `runTurn` without the CLI. |
| Dependency handoff | CLI `index.ts:buildPlayDeps` and `playTurnLoop.ts:turnLoop` → `RunTurnDeps` | Model, auditor, registry, DB, optional debug/diagnostics/chronicle → orchestration dependencies | Default rules binding still works through bundled fallback. The CLI drops both optional pack and adventure resolvers. | Missing rules packs fail strict tool calls; missing adventure resolver silently removes context and makes authored encounter start fail. Core tests usually inject the resolvers directly, bypassing CLI wiring. |
| Snapshot/context | `contextAssembler.ts:assembleContext` → `renderContextMessage`/DM | SQLite campaign, party, memory, state, scene, active runs, chronicle, input → `AssembledContext` then one user message | Automatic context contains live refs such as inventory `packRef`, actor `rulesRef`, and encounter references but never expands them to records. Memory source IDs and recap state deltas exist in store shapes but the renderer drops most provenance. | Invalid live JSON fails closed. Hard slice limits discard older entries. An unresolved adventure module is silently skipped. Covered by `contextAssembler*.test.ts`; callers can omit optional inputs. |
| System contract | `protocol.ts:buildSystemPrompt` → every model adapter | Tool definitions/profile → static system string | Instructs the DM to use `lookup_rules` before any creature or mechanic and to use tools for math/state. It does not identify relevant records for this turn. | Compliance is model-derived. `protocol.test.ts` pins instruction text/tool presentation. |
| Provider invocation | `turnLoop.ts:runModelLoop` → `ModelClient.complete` | System, messages, all registry definitions, executor, trace/profile → normalized text/tool calls/executed calls | All providers receive the same logical roster. API-native adapters return calls for the core loop to execute; MCP adapters own their loop and invoke the executor in-process. | Round limits, empty narration, adapter errors, and malformed calls fail closed. Adapter suites cover translation. Provider-owned intermediate messages are not returned as a transcript. |
| Rules lookup | Model call → `ToolRegistry.invoke` → `toolLookupRules.ts:lookupRulesTool` → strict stack/`lookupRulesRecord` | `{kind, name}` or `{kind, ref}`, optional `systemId` → full record, card, pack, license, override chain; or structured error | Exact identity/provenance survives. Alias route, query reason, nearby candidates, and relationships other than card parent do not. No expansion follows refs. | Schema/not-found/ambiguous/binding/pack errors. `tools.test.ts`, `rulesStack.test.ts`, `e5.integration.test.ts`. A supplied `systemId` deliberately selects a bundled base outside the campaign stack. |
| Tool result feedback | `runModelLoop` executor → model's next round | `ToolResult` → native tool result or MCP result | Full successful lookup result is available to the primary model. No core truncation is applied in this feedback loop. | Failed result is also fed back. Fenced-text is defined but not gameplay-capable under current policy. MCP loop details remain adapter-owned. |
| Adjudication | Primary model → resolution/capability tool call | Model-selected rule interpretation, modifiers/DC/targets/operation → deterministic calculation or validation | Example: `resolve_check` owns dice/math but the model owns which modifiers and DC apply. `use_item` resolves strict structured mechanics and readiness internally. | Tool validation errors return `ok:false`; prose alone writes nothing. `e5.integration.test.ts` demonstrates prose-only state assertions do not mutate. |
| State effect | Tool → domain operation → SQLite | Validated tool args + campaign state/pack records/seed → transactional state rows and structured result | Provenance is normally `model:<turnId>` plus session/time. Narrow structured mechanics may constrain a write. Raw `mutateState` is internal-only and explicitly not model-facing. | Tool/domain transaction plus attempt and turn savepoints provide nested rollback. Domain suites cover lifecycle invariants. Direct internal callers and CLI slash commands are alternate mutation paths. |
| Runtime audit | `orchestrator.ts:runTurn` → `turnAuditor.ts:ModelTurnAuditor` | Candidate, player input, provided tool names, executed calls, current snapshot, recent scene evidence, explicit-action list → JSON verdict | Auditor can demand target-specific `lookup_rules`; successful calls are evidence, failed calls are not. Tool JSON is depth/entry/string bounded and then capped at 800 characters, so load-bearing lookup fields can be absent. | Malformed/auditor errors fail closed. Reject rolls back the attempt and adds a corrective note. `turnAuditor.test.ts` and audit retry cases in `orchestrator.test.ts`. No-auditor core call bypasses this gate; CLI supplies it. |
| Commit/evidence | `runTurn` → scene/session stores and `memory/turnTrace.ts:recordTurnTrace` | Accepted candidate + executed calls + rendered initial context → logs and `TurnTraceRecord` | Accepted full lookup results persist in `toolCalls` and `rulesResolution.rulesLookups`; successful mutations are projected. Discovery reasons and rejected-attempt evidence do not. | Any later exception rolls back the whole turn and records only a failure diagnostic outside the savepoint. `e5.integration.test.ts`, `memoryTrace.test.ts`, `turnTraceProjection.test.ts`. Debug files are optional/best effort, not the durable trace. |

The ordering matters: mutation tools may run before the auditor sees the
candidate, but the attempt savepoint keeps their effects provisional. An audit
rejection rolls them back; only the accepted attempt reaches the final release.

## 4. Current rules-discovery paths

“Discovery” below means any path by which potentially governing material can
reach the DM. It does not imply that the path is complete or adequate.

| Path and trigger | Cardinality/overlap and expansion | What survives or can be discarded | Capability pairing and observability |
|---|---|---|---|
| Initial campaign context, automatically assembled each turn | One snapshot brings many state facts, memory entries, and active entities. The same fact can also recur in recaps, scene tail, bible, or tool results. State refs do not expand into rules records. | `renderContextMessage` is retained as `retrievedContext`; memory provenance is mostly rendered away. Bounded windows can remove prior material. | Static capability roster is separate. Observable after acceptance as the rendered initial context. |
| Active adventure context, automatically attempted for each active run | Location/scene selection expands deterministically to related module NPCs, objectives, encounters, secrets, clocks, completions, and deviations; `Set`s deduplicate IDs while module order wins. Creature/stat-block refs render as refs only. | Entire slice disappears when resolver is absent/unresolved. No retrieval reason beyond current run/location is persisted separately. | Prose/refs are not paired with rules capabilities. Present in the retained initial context only when resolved. |
| Campaign bible, closed arc summaries, recent recaps, scene tail, and portable chronicle | Multiple memory paths can repeat the same material; there is no semantic deduplication. Bible/all closed arcs are unbounded by count here; recap, scene, and chronicle windows are bounded. | Renderer drops bible source IDs and recap source scene IDs/state deltas. Chronicle keeps source campaign/session labels. Older windows disappear. | Memory contains prose, not capability declarations. Initial rendered context is observable; selection rationale is not. |
| Live entity refs in state/module records (`packRef`, `rulesRef`, spell refs, table refs) | One entity can point to one record and records can point to many other records in heterogeneous fields. Initial context never follows those links. | The ref often survives in rendered state/module prose; its target content does not. | Some later state tools dereference the ref internally, but the model is not automatically shown that result. Trace shows the state tool, not an implicit candidate set. |
| Explicit `lookup_rules`, triggered by the model | One call addresses one kind plus one exact normalized name/ref. Repeated calls can reach the same record by alias/name/ref; one ambiguous name can return up to 12 keys. No related rules or exceptions expand. | Full success survives as tool result and accepted trace. Trigger, alias used as a route, and why the record mattered are only inferable from call args/order. Ambiguous overflow survives only as `(+N more)` prose, not a total/truncated field. | Static tools are already visible, but record-specific capability/limits are not joined to the result. Accepted calls are observable; rejected-attempt calls are not durably traced. |
| Static system-prompt instructions | Automatically tells every turn's model when it should look up. It can cause many calls but carries no derived signal or record candidates. | Prompt is reconstructed from code; it is not stored verbatim in `TurnTraceRecord`. | It presents generic capability descriptions and a lookup duty, not record-specific support. Model compliance is visible only through calls/audit outcome. |
| Tool-result feedback in the model loop | A lookup/world query or state tool can expose many nested facts to later model rounds. Multiple tools can expose overlapping prose or refs. Core performs no related-record expansion. | Full primary-loop result is supplied. API-native calls remain in the core message list; provider-owned MCP intermediates are not returned as a complete transcript. Accepted tool args/results persist. | The invoked tool's declared behavior is visible in the original roster, not attached to each result. “Used” versus merely received is unobservable. |
| Model memory (provider context within a turn) | Prior rounds, tool results, and corrective notes can all repeat material. Cross-turn provider memory is not an authority; durable memory comes from Eshyra stores. | Within-turn content lasts until completion. The core persists final accepted calls, not the provider's reasoning or all intermediate text. | No additional capability guarantee. Partially observable for API-native loops, opaque inside provider-owned loops. |
| Auditor feedback after a rejected candidate | Model-derived audit can name multiple missing calls/targets and the retry note accumulates newly found evidence classes. It does not itself retrieve records. | The corrective note reaches the retry model. Structural verdicts can reach opt-in debug output, but rejected attempts and verdicts are absent from durable turn trace. | Auditor checks tool use/assertions post hoc; it cannot turn discovered prose into capability support. |
| `world_query`, model-chosen direct entity/search lookup | Exact module entity resolution folds campaign state overlays over template data. Search flattens module fields, uses substring matching, and separately searches overlay lore; results are interleaved. This is world canon, not rules-pack search. | Results carry canon tier, source, identity, visibility, truth status, and summary. Search caps at 1–50 (default 20); interleaving discards overflow without a truncation marker. | No rules capability pairing. Accepted calls/results persist; auditor sees a bounded summary. |
| Campaign overlay lore, explicitly recorded then queried | `record_world_fact` persists durable lore; `world_query` can retrieve it by ID/filter/search and fold related lore into entity results (limit 10). Multiple records support supersession/invalidation. | Rich provenance, truth, scope, significance, visibility, source, tags, and introduced turn/session survive in SQLite. It is absent from initial context unless another memory path mentions it. | Lore is not a campaign rules ruling and carries no deterministic capability. Tool/trace makes current-turn writes and reads observable. |
| Direct structured record lookup inside state code | A state operation may dereference a spell, creature, condition, feature, item, or table without a preceding model-visible lookup. Strict callers use the full campaign stack; legacy callers do not. | The model normally sees only the state tool result/error, not the entire internally used record or lookup route. Some results expose clause/source bindings. | This is the strongest existing prose-to-capability enforcement path, but it is local to each tool and may be invisible as discovery evidence. |
| Character creation/progression resolver | Guided non-turn flows query pack records by key/name and project character mechanics. It is an alternate consumer, not DM turn discovery. | Character sheet and state projections persist; the lookup candidate/reason does not become turn evidence. | Code-owned capability outside the DM runtime. Covered by character/progression tests. |

No production code automatically calls `lookup_rules`. Searching every real
caller found the registry/model route plus tests and human-facing error messages
that tell the model to look up an exact ref. Those messages do not perform a
lookup.

### `lookup_rules` caller inventory

The complete production invocation chain is:

1. `tools.ts:DEFAULT_TOOLS` registers `lookupRulesTool`.
2. `runModelLoop` gives `ToolRegistry.definitions()` to the selected model
   adapter.
3. The model emits the tool name and arguments.
4. For API-native/fenced calls, `runModelLoop` directly calls
   `registry.invoke`; for Agent SDK/Codex SDK, the in-process MCP executor
   supplied by `runModelLoop` calls the same method.
5. `ToolRegistry.invoke` validates the schema and invokes
   `lookupRulesTool.run`.

There is no context-assembler, auditor, state-module, CLI, or scheduler caller
that invokes `lookup_rules` on the model's behalf. The auditor can name it in a
rejection, but only the retry model can execute it. `tools.test.ts`,
`e5.integration.test.ts`, `startingEquipment.integration.test.ts`, and scripted
model-evaluation fixtures are test consumers; CLI usage diagnostics merely
record the tool name.

### The two search systems are not one system

`worldQuery.ts:worldSearch` is a separate module/overlay search:

- module terms are lowercase tokens of at least two characters and **all**
  terms must occur as substrings in a flattened record;
- overlay terms use **any**-term matching;
- two code-owned module aliases exist for authority roles and directional
  exits;
- module results are ordered by table iteration then record ID, overlay results
  by `updated_at,id`, and the two lists alternate until the limit.

None of this is used by `lookup_rules`, and it must not be cited as current
rules-pack discovery.

## 5. Existing pack substrate useful for discovery

### Common identity and provenance

`rules/types.ts:RulesRecord` provides:

- `systemId`, `kind`, and stable `key`;
- display `name`;
- kind-specific `data`;
- short source label;
- license;
- `RecordProvenance { sourceRef, locator?, note? }`;
- optional explicit `overrides`.

`RulesPackMeta` adds pack/system/version/role, dependency and base compatibility
metadata, license, upstream source identity/hash/date, and the pack's record
provenance policy. `packLoader.ts:loadRulesPackFromDirectory` parses,
validates, and key-sorts records deterministically. `stack.ts:resolveRulesStack`
orders add-ons, validates dependencies/compatibility, requires explicit
overrides for collisions, and preserves the complete override chain.

The common interface has no generic `aliases`, `references`, `relationships`,
`clauses`, or `capabilities` field. Consumers must know each kind's `data`
shape.

### Observed generated D&D pack census

A read-only `jq` probe over the accepted generated artifact found 1,813
records:

| Kind | Count | Kind | Count |
|---|---:|---|---:|
| action | 10 | ancestry | 13 |
| background | 1 | class | 12 |
| condition | 15 | creature | 317 |
| equipment | 218 | feat | 1 |
| feature | 184 | hazard | 25 |
| magic-item | 240 | rule | 335 |
| spell | 319 | stat-block | 2 |
| subclass | 12 | table | 109 |

There are no generated `ability` records despite `ability` being a declared and
advertised kind. That is an absence in this artifact, not proof that an ability
record cannot exist in another compatible pack.

Every generated record has the common top-level keys
`data,key,kind,license,name,provenance,source,systemId`. Useful observed
kind-specific fields include:

| Substrate | Examples in accepted data/contracts | Current runtime use |
|---|---|---|
| Source prose | `description`, `text`, traits/actions/reactions, `higherLevels`, source labels/locators | Returned wholesale only after exact lookup; selectively rendered in adventure/world context |
| Structural refs | `tableRefs`, `progressionTableRef`, `spellTableRefs`, `statBlockRefs`, `parentClass`, feature source/grantor, features by level, creature refs, spell refs | Validators/audits and some state capabilities follow selected refs; lookup does not expand them |
| Prerequisites and choices | feat/class/feature prerequisites, choice options, proficiency/equipment/spell choices | Character creation/progression and validations; not generic DM discovery |
| Mechanics projections | 744 records have `data.mechanics`; observed families cover actions/economies/resources, conditions/effects, saves, damage, duration/timing, concentration, areas, scaling, spell attacks/grants/stores, state machines, curses, operations, random procedures, and inter-item behavior | A bounded subset is consumed by dedicated state tools; the rest can reach the model only as raw lookup data |
| Conditions/actions/timing/resources | condition effects/levels, creature actions/reactions/legendary actions, item operations/economies/timers, spell duration/concentration, feature resources | Some dedicated deterministic consumers; otherwise model adjudication |
| Tables | 109 stable `table:*` records with columns/rows/legend/projection and owner refs | Direct table lookup and selected mechanics such as item initialization/upcast; no automatic owner/table expansion |
| Parent/card relationships | Feature `data.source`, subclass `data.parentClass`; `recordCard.ts` projects `grantedBy` or `parentClass` | Returned in a successful lookup card; only these two relationships are normalized there |
| Aliases | Normalized punctuation/dashes/case, apostrophe-free forms, stripped trailing parentheses, comma reorder, equipment pluralization, and three key-specific alias groups | Name index only; aliases and chosen match route are not stored in the record or returned |
| Ambiguity | Three observed `RulesAmbiguity` objects with stable ambiguity/clause IDs, source locators, affected mechanics, interpretations, null canonical resolution, and campaign-ruling ownership | Pack validation and selected item capability blocking; no campaign ruling store/resolver was found |
| Execution metadata | All 240 magic-item records have `executionReadiness`; 795 readiness clauses carry nonempty `engineHooks` in the current artifact | `itemExecutionReadiness.ts:assertMagicItemOperationReady` gates `use_item` operations; raw metadata also appears in a full lookup result |

The execution-readiness census describes current data, not an ADR 0020 bounded
capability contract. Its hook descriptions and clause assessments predate the
new positive-capability/declared-limits requirement, are magic-item-specific,
and are returned as raw record data rather than as an operation offered to the
model with explicit inputs, exclusions, revision, and residual interpretation.

### Identity/name resolution

`stack.ts:recordLookupNames` creates a per-kind index. A record can therefore be
reached through several normalized names, and several records can occupy one
normalized name. `lookup.ts:lookupRulesRecord` requires the caller to supply the
kind:

- ref lookup is exact against that kind's `byKey`;
- name lookup succeeds only when exactly one indexed record matches;
- multiple matches return sorted canonical keys and require an exact ref
  retry;
- cross-kind duplicates never meet because kinds are separate indexes.

This is useful deterministic substrate. It is not search: no token, substring,
source-text, field, prerequisite, reference, or mechanic query exists.

## 6. Context assembly, ranking, truncation, and deduplication

### Initial context

`contextAssembler.ts:assembleContext` performs deterministic selection, not
relevance ranking:

- campaign bible: whole current object;
- closed arc summaries: all returned records;
- recaps: newest `recentSessionLimit` (default 5), then chronological rendering;
- scene transcript: last 12 entries;
- recent scene evidence: accepted DM entries from that tail, each compacted to
  280 characters;
- character chronicle: first 8 eligible entries after portable/private
  filtering;
- state: the current SQLite projection;
- nearby inventory: query 21, enforce a 20-entry character-context budget;
- adventure runs: every active run whose module resolver returns a module;
- player input: whole string.

There is no turn-wide token budget, semantic rank, or cross-section
deduplication. Repeated material can appear in the bible, arc summaries,
recaps, chronicle, scene, adventure slice, state, and later tool results.

`renderContextMessage` imposes the final section order. It does not include the
campaign rules binding, rules-pack records, alias index, or a derived rules
signal. It includes references embedded in state/adventure shapes but does not
dereference them.

### Adventure selection

`adventureContext.ts:buildAdventureContextSlice` uses deterministic
location/scene and progress filters. It expands IDs referenced by the selected
scene/location into related module entities and uses `Set`s to deduplicate each
category. The source module's order determines final order. It does not score
relationships or recursively expand rules refs. There is no explicit item cap
inside the slice.

The normal CLI path currently supplies no resolver. This is proven by the
combination of:

- `playTypes.ts:PlayDeps`, which has no `resolveAdventureModule`;
- `index.ts:buildPlayDeps`, which constructs only a module **listing** function;
- `playTurnLoop.ts:turnLoop`, which omits the resolver from `RunTurnDeps`;
- `contextAssembler.ts:assembleAdventureContext`, which returns `[]` without
  it; and
- `encounterCombatants.ts:findEncounterInActiveRun`, which throws
  `start_encounter requires an active adventure module resolver`.

`adventures.ts:makeModuleResolver` exists, but its real consumer is the
read-only `adventures show` audit path, not gameplay. CLI tests cover selection
and binding but use a fake `runTurn`, so they do not expose this handoff gap.
Core context/encounter tests inject a resolver and therefore bypass it.

### Lookup and audit truncation

The primary `lookup_rules` success is not truncated. The full record becomes a
tool result. The exact-name ambiguous path sorts keys and retains 12; overflow
is reported only in the human message.

The auditor does not receive that full result faithfully.
`turnAuditor.ts:boundedAuditJson` recursively caps:

- depth at 3;
- object/array entries at 20;
- strings at 200 characters;
- serialized JSON at 800 characters.

The traversal follows object insertion order, not rules importance. A source
locator, exception, operation limit, or ambiguity can therefore fall outside
the auditor's view even though it reached the primary model and accepted-turn
trace. The auditor also does not receive the assembled campaign bible,
adventure slice, recap set, or entire system prompt; it receives a current
state snapshot, compact recent-scene evidence, and bounded current-turn tool
evidence.

## 7. Capability presentation and adjudication boundary

### Provider-neutral presentation

`toolRegistry.ts:ToolRegistry.definitions` projects every registered tool to
`{name, description, inputSchema}`. `tools.ts:DEFAULT_TOOLS` registers the same
roster for all providers. `protocol.ts:buildSystemPrompt` repeats descriptions
in a static tool-contract section. Capabilities are not filtered or generated
from the current rules stack, discovered records, acting character, or state.

`model/client.ts` keeps the logical seam provider-neutral:

- Anthropic and OpenAI native adapters translate definitions to native API
  tools; the core owns the multi-round loop.
- Agent SDK and Codex SDK adapters translate definitions to in-process MCP
  tools; the provider harness owns the loop but calls the same registry
  executor.

The adapters change transport, loop ownership, message flattening, and trace
visibility. They do not change rules discovery semantics.

### Model versus deterministic ownership

Current boundaries are local to each tool:

- The model decides that a rule matters, which lookup arguments to use, which
  interpretation applies, which capability to call, and adjudicative inputs
  such as modifiers, DC, target, operation ID, or transition choice.
- Pure tools such as `resolve_check` own seeded randomness and arithmetic.
- Mutation tools validate schemas and call domain operations that own
  persistence and lifecycle invariants.
- Some domain operations resolve the active pack internally. For example,
  `itemState.ts:useItem` performs strict magic-item lookup, validates
  attunement, mechanics, record references, readiness, state machine,
  economies, tables, timers, depletion, and inventory changes in one
  transaction.
- Raw `mutateState` validates fields/shapes/provenance but deliberately does not
  own lifecycle reactions. It is internal-only; the default registry test pins
  the absence of a general `mutate_state` tool.

This yields a real deterministic effect only when a capability is invoked
successfully. A `lookup_rules` success supplies rule-aware prose/structure but
does not execute it. Conversely, a capability can internally consult a record
without the model receiving that record as discovery material.

### Pack-stack inconsistency

Strict model-facing paths use
`campaignRecordLookup.ts:resolveStrictCampaignRulesStack`, which checks exact
system/pack/version and includes ordered add-ons. However:

- `campaignRecordLookup.ts:lookupCampaignRecord` selects a bundled base by
  `packId` only, ignores system/version and every add-on, then falls back to
  bundled D&D if no base matches.
- `encounterCombatants.ts:campaignBasePack` repeats the base-only, silent-D&D
  fallback for creature HP/AC.

Real callers include action economy, active effects, attunement fallback,
usage counters, and encounter creature projection. With a custom or add-on
record, the DM can successfully obtain the strict active-stack record through
`lookup_rules` while the subsequent deterministic caller fails to see it or
uses different base data. This violates one coherent active-stack evidence
path.

### Addressable stat blocks are not model-addressable

`rules/types.ts:RulesRecordKind` and its comments declare `stat-block` to be an
addressable kind, and accepted data contains two such records. Adventure
reference validation also permits encounter refs to `creature` or
`stat-block`. `toolLookupRules.ts:lookupRulesTool.inputSchema`, however, omits
`stat-block`. A real registry invocation returned:

```text
invalid_args: args.kind must be one of ability, action, ancestry, background,
class, condition, creature, equipment, feat, feature, hazard, magic-item,
rule, spell, subclass, table
```

The tool body casts a validated string to `RulesRecordKind`, so registry schema
validation prevents the advertised direct lookup.

### Rules ambiguities and prior rulings

`RulesAmbiguity` is immutable source evidence, not a decision. The current
runtime can return it inside a looked-up record. In the magic-item path,
`itemState.ts:matchStateTransition` throws `ItemStateAmbiguityError` with the
ambiguity ID/question/interpretation IDs and owner `campaign-ruling`.

No campaign-ruling table, type, recording tool, resolver, or context inclusion
path was found. Campaign overlay lore is not equivalent: it models world canon
with truth/significance/visibility, not a selected rules interpretation tied to
an ambiguity. As implemented, the affected item operation remains blocked on
every attempt. Prior rulings therefore do not currently reach the DM or a
deterministic capability as rulings.

## 8. Runtime-auditor and evidence behavior

### Auditor behavior

`turnAuditor.ts` explicitly defines a post-candidate, model-based guard rather
than a full rules validator. Its policy asks whether:

- mechanical assertions have appropriate tool evidence;
- failed calls are being treated as evidence;
- specific records each received required lookup;
- state changes used mutation tools;
- module/overlay assertions have appropriate canon evidence;
- explicit player actions were improperly invented.

`ModelTurnAuditor.audit` makes a second provider call with no tools and requests
a JSON verdict. A verdict can accept, repair narration, or reject with missing
and disallowed tool calls. The orchestrator allows bounded retries, accumulates
target-specific missing calls, rolls back each rejected attempt, and asks the
primary model to recreate the entire intended outcome.

The result is useful enforcement but cannot establish retrieval completeness:

- the auditor learns about a missing rule only if its own model notices the
  assertion;
- it reviews a candidate after the candidate's decision process;
- its tool evidence is mechanically truncated;
- it cannot inspect material never proposed by either model;
- it has no deterministic mapping from situation to governing rules.

### Durable and optional evidence

`memory/turnTrace.ts:TurnTraceRecord` retains for an accepted turn:

- campaign/session/scene/turn IDs and timestamp;
- the rendered initial `retrievedContext`;
- accepted model output;
- full committed tool names, args, results, mutation flag, and source;
- `rulesResolution`, including successful `lookup_rules` payloads and selected
  roll/check/damage/spell-scaling projections;
- `acceptedStateDelta`;
- `rejectedCandidates` for **failed tool calls in the accepted attempt**;
- quality flags.

`turnTraceProjection.ts:deriveTraceFields` does not compute a database diff.
For most successful mutating tools it projects tool arguments; spell-slot use
also retains selected result evidence. The name `acceptedStateDelta` should not
be read as complete before/after state evidence.

Rejected audited attempts are different from `rejectedCandidates`: their
entire savepoint is rolled back and their calls/candidates are not passed to
`recordTurnTrace`. Optional session debug captures structural model-call and
audit events. Full sanitized prompt/content capture is opt-in to a separate
sensitive JSONL file. Debug writes are best effort and default off, so they are
not a parallel durable proof system.

The accepted trace also does not preserve:

- derived or explicit lookup signals as first-class evidence;
- candidate records not selected;
- alias or route/reason for a selected record;
- relationships traversed or declined;
- merge/dedup/rank/truncation decisions;
- a distinct final context packet after tool feedback;
- capability offered together with declared limits;
- whether the model relied on, ignored, or misunderstood supplied material;
- the actual row-level database delta.

## 9. Alternate paths and bypass risks

| Alternate/bypass | Consequence |
|---|---|
| `runTurn` without `auditor` | Core accepts the first validly completed model candidate. The CLI supplies an auditor, but tests and other consumers can omit it. |
| CLI slash commands | Character/progression/wallet and other handled commands bypass DM context, rules lookup, and turn audit; they call dedicated deterministic flows. This is intentional but separate evidence. |
| Explicit `lookup_rules.systemId` | Selects a bundled single-base system outside the campaign binding and omits add-ons. Useful for comparison, but a result is not campaign authority. |
| Legacy `lookupCampaignRecord` | Ignores add-ons/system/version and silently falls back to D&D, creating deterministic divergence from strict lookup. |
| Encounter private base lookup | Repeats the legacy fallback for creature statlines. |
| Missing CLI adventure resolver | Removes active module material from DM context and disables authored encounter instantiation despite a persisted active run. |
| Model-visible refs without expansion | Gives the model an identifier but not the governing record, exceptions, linked table, parent feature, or other related material. |
| Provider-owned MCP loop | Tool execution is captured, but the internal sequence of intermediate messages and how the model used tool content is not returned as a complete core-owned transcript. |
| Exact lookup kind requirement | The model must already choose the correct kind. Cross-kind homonyms are safely separated, but a wrong kind produces not-found rather than candidates. |
| Alias generation | Several names can reach one record, but aliases are code-owned and not returned as match evidence; changes cannot be diagnosed from a trace alone. |
| Auditor evidence bounding | Full primary-model rule material may be reduced to an insertion-order 800-character JSON prefix for audit. |
| Overlay lore as a tempting substitute | Overlay lore is discoverable and durable but is world canon, not source rules or a campaign ambiguity ruling. |
| Prose-only adjudication | Without an auditor, unsupported prose can be accepted; even with an auditor, prose never mutates deterministic state, so narration and state can diverge until detected. |
| Internal/non-turn consumers | Character creation, progression, imports, checkpoint/rest/reset schedulers, and trusted domain code can consult records or mutate state without `lookup_rules`; their evidence belongs to those workflows, not DM discovery. |

## 10. Candidate instrumentation seams

This section identifies narrow existing seams only. It does not select an event
schema, relationship vocabulary, ranker, context format, or storage system.

| Evidence wanted | Existing capability | Narrow possible instrumentation point |
|---|---|---|
| Explicit/derived signals | Player input and complete `AssembledContext` exist before the model call; some refs are already typed in state/module shapes | Immediately after `assembleContext` and before `renderContextMessage` in `runTurn`; record only the existing inputs/derived refs an experiment actually evaluates |
| Candidate records/clauses | Resolved stack exposes deterministic `recordsByKey`/`recordsByKind`; lookup returns exact candidates | Around `lookupRulesRecord`, or an experiment-specific caller beside it, before reducing to a hit/error |
| Route/reason per candidate | Model tool args and audit target-specific missing calls already carry partial explicit reasons | `ToolRegistry.invoke` for `lookup_rules`, `formatCorrectiveNote`, and the handoff between auditor verdict and retry |
| Relationship expansion | Pack refs and selected per-kind validators already expose typed links; stack holds canonical targets | At the bounded code that follows a known typed ref, before/after each traversal; do not infer a universal graph from all strings |
| Merge/dedup decisions | Stack override merge and adventure-slice `Set` dedup are deterministic | `resolveRulesStack:mergeRecord`/index construction and `buildAdventureContextSlice` category assembly |
| Ranking/truncation | Existing code has selection order and explicit caps, though rules lookup has no rank | `selectAlwaysOnMemory`, scene/chronicle slicing, ambiguous lookup cap, `worldSearch:interleaveSearchResults`, and `boundedAuditJson` |
| Final material placed in initial DM context | `renderContextMessage` already produces one exact string stored as `retrievedContext` | The existing render/trace handoff in `runTurn` |
| Material added by tools | Every tool result crosses the `runModelLoop` executor and accepted calls persist | The executor wrapper in `runModelLoop`; for MCP loops, the adapter's in-process executor bridge |
| Capability offered and declared limits | Registry definitions expose offered static schemas/descriptions; selected state code has local readiness checks | `ToolRegistry.definitions` for what was offered, plus the specific capability's preflight/readiness boundary (for example `assertMagicItemOperationReady`) for what it actually supports |
| Material used or ignored by DM | No existing trustworthy signal; only call order, final text, and provider trace exist | A future experiment could compare supplied IDs with explicit model citations/calls at `ModelCompleteResult`, but “used” cannot be inferred reliably from mere inclusion |
| Audit result | Structured `AuditVerdict` already exists | Before rollback/retry in `runTurn`, where verdict, attempt, calls, and cumulative missing targets coexist |
| Adjudication and state mutation | Executed calls, domain results, nested savepoints, provenance, and trace projection already exist | `ToolRegistry.invoke`, domain-operation return, and before/after the attempt/turn savepoint boundaries; a real state diff would have to be explicit, not relabel current arg projections |
| Durable linkage | `TurnTraceRecord` already links turn, context, output, tools, resolution, and projected mutation | Extend or accompany this accepted-turn seam in an experiment rather than creating a competing readiness/proof system |

The least invasive end-to-end experiment boundary is therefore already visible:
initial context render → model call/tool executor → auditor verdict → accepted
turn trace. What is missing is evidence inside discovery and selection, not a
lack of places to observe the current pipeline.

## 11. Evidence gaps and unresolved questions

- No live provider call was made. Credentials and paid execution were not
  needed to verify routing; scripted integration tests and all four adapter
  suites verify the logical seams. Real provider reasoning and provider-owned
  intermediate transcripts remain inaccessible.
- The parallel current-state claim report was deliberately not inspected, so
  no claims here depend on it.
- The generated D&D artifact was censused read-only. Pathfinder is an in-code
  fixture, and no real installed third-party/add-on corpus was available for a
  representative discovery census. Add-on behavior was verified from stack
  code/tests, not from a production campaign corpus.
- No runtime campaign-ruling representation was found. It remains unresolved
  whether a not-yet-landed transition artifact intends to reuse overlay lore,
  introduce a separate structure, or keep such rulings model-only. Current code
  supports none of those as a rules-ambiguity resolution path.
- “Material used or ignored” is not observable from current traces. Tool-call
  order and narration correlation are suggestive, not proof.
- The pack's heterogeneous references and mechanics were inventoried by
  accepted validators, field census, and representative records. This does not
  prove every source relationship is structured or that every structured field
  is semantically complete.
- The current CLI adventure resolver defect was verified by executable wiring
  and tests' dependency shapes, not by a paid interactive session. Existing
  tests do not exercise the selected-module-to-real-`runTurn` handoff.
- The `stat-block` defect was reproduced through a real `ToolRegistry.invoke`.
- The first CLI test run used a broken worktree workspace symlink and therefore
  resolved stale parent build output. After `npm ci` installed correct
  worktree-local workspace links, the same 44 runnable tests passed. The stale
  failure is environmental evidence only, not a product finding.

## 12. Handoff to the integrated transition design

The integrated design can treat the following as verified starting facts:

1. The initial DM context seam, tool executor seam, auditor seam, and accepted
   turn trace already provide a narrow observable spine.
2. Current rules lookup is exact, model-initiated, non-expanding, and
   post-hoc-audited. It must not be described as automatic discovery.
3. Pack identity/provenance and many typed local relationships are reusable,
   but they are heterogeneous and incomplete as a universal discovery model.
4. One situation may imply many records, one record may be reached by many
   paths, and current alias/ref/memory/world paths already overlap. Record kinds
   and scenario paths are not partitions.
5. Discovered prose and deterministic capability support are independent
   claims today. Any transition experiment needs to observe both without
   inferring one from the other.
6. Existing accepted-turn evidence is worth extending; a parallel readiness or
   proof system would duplicate and fragment authority.
7. A transition experiment must make loss visible at candidate generation,
   relationship traversal, merge/dedup, ranking/truncation, final placement,
   capability preflight, audit, and mutation boundaries.
8. The three defects in the executive summary should be accounted for before
   using current runtime behavior as an experiment baseline.

This report intentionally does not choose the future signal model, event
schema, relationship vocabulary, candidate store, ranker, search technology,
context packet, or capability contract. Its handoff is the verified map and
the existing observation points, not a final design.

## Verification record

Commands and probes run from the linked worktree root:

```text
npm run agent:preflight                         # parent checkout, before worktree
bd search ...; bd create; bd update --claim; bd dolt push
git worktree add -b eshyra-jued ... origin/main
rg / nl / jq read-only source and generated-pack inspections
npm exec -- tsx -e <ToolRegistry lookup probe>
npx vitest run <11 focused core files + CLI play test>
npm run typecheck
npm ci
npx vitest run packages/cli/test/play.test.ts
```

Verified results:

- focused core/provider/world/orchestrator/rules suite: 11 files, 341 tests
  passed;
- CLI play suite after correct worktree install: 44 passed, 1 documented
  Dolt-gated skip;
- forced workspace typecheck: passed;
- generated data probes: read-only; no pack output changed;
- `lookup_rules` stat-block registry probe: reproduced `invalid_args`.
