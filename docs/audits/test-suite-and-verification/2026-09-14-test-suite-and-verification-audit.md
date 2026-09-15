# Test suite and verification system audit

**Date:** 2026-09-14
**Baseline:** `origin/main` at `a3a5219` (test/source content identical to
`ec65cfd`, the post-PR-#546 merge; the four commits between them are Dependabot
bumps touching only `package-lock.json` and `packages/core/package.json`).
**Scope:** audit and design only. No test was deleted, no production code
refactored, and no proof machinery added to perform this audit.

This document is evidence and a proposal. It is not repository authority. Where
it recommends retiring a contract it states the reasoning chain explicitly so a
reviewer can reject the disposition without re-deriving the measurement.

---

## 0. Summary of what the measurement changed about the question

The audit was commissioned on the hypothesis that ~5,600 tests are themselves
the problem. **They are not, and the raw count is close to irrelevant.** Three
measured facts reframe it:

1. **The test:source ratio has been flat or falling for three months** (1.67 in
   June, 1.40 today). Tests are not outgrowing the system. The system is
   growing, and tests are tracking it. An audit aimed only at tests would have
   addressed the smaller half of the growth.
2. **The OOM is not caused by suite size.** It is caused by unbounded worker
   fan-out (default 20 workers) multiplied against a per-worker cost that a
   handful of files drive into the gigabytes. A 500-test suite with the same
   topology would OOM the same way.
3. **A single assertion accounts for ~14.4 seconds and ~2.4 GB** — roughly 30%
   of the suite's wall-clock critical path and the largest single allocation in
   the entire verification run. It protects a property the module boundary
   already guarantees, and it is written in the most expensive form available.

The accidental-contract hypothesis is **supported**, but its most expensive
instances are not scattered across thousands of small tests. They concentrate in
a few places, and the largest one is an entire subsystem.

---

## 1. Current baseline

### 1.1 Suite size and shape

| Measure | Value |
| --- | --- |
| Test files | 309 (285 `@eshyra/core`, 24 `@eshyra/cli`) |
| Test suites (`describe` blocks) | 1,261 |
| Tests collected | 5,611 |
| Passing | 5,608 |
| Skipped | 3 |
| Failing | 0 |
| Test LOC | 151,621 |
| Source LOC (`src` + `scripts`, non-test) | 108,117 |
| Test : source LOC ratio | 1.40 |

Only 3 tests skip on this host because `dolt` 2.3.3 is installed and no live
model credentials are present; the two live-API integration suites
(`model.integration.test.ts`, `campaignBibleFaithfulness.integration.test.ts`)
gate at the `describe` level and contribute the skips. On a host without
`dolt`, six further suites (`checkpoint.*`, `cli/test/checkpoints`,
`cli/test/play`) gate out. This matches the documented expectation in
`AGENTS.md` — nothing outside the documented skips fails.

### 1.2 Growth history (first-parent `main`)

| Date | Test files | Test LOC | Source LOC | Ratio |
| --- | --- | --- | --- | --- |
| 2026-06-07 | 95 | 28,633 | 17,177 | 1.67 |
| 2026-06-20 | 133 | 48,830 | 23,537 | 2.07 |
| 2026-07-07 | 213 | 83,028 | 53,971 | 1.54 |
| 2026-07-19 | 240 | 105,841 | 78,516 | 1.35 |
| 2026-08-29 | 267 | 123,241 | 90,646 | 1.36 |
| 2026-09-14 | 309 | 151,621 | 108,117 | 1.40 |

**The ratio is stable.** This is the single most important baseline fact in the
document, and it contradicts the framing that prompted the audit. Test growth is
not outpacing the system; both are growing at roughly 6× since June. Any
remediation aimed only at the test suite addresses less than half of the cost.

### 1.3 Where the growth went (net LOC since 2026-07-09)

| Area | Net LOC |
| --- | --- |
| `packages/core/test/` (root) | +43,607 |
| `packages/core/scripts/importers/` | +24,366 |
| `packages/core/src/state/` | +18,444 |
| `packages/core/test/discovery/` | +13,002 (entirely new) |
| `packages/core/src/rules/` | +12,180 |
| `packages/core/test/importers/` | +7,987 |
| `packages/core/src/orchestrator/` | +7,930 |
| `packages/core/src/discovery/` | +7,689 (entirely new) |

The `discovery` subsystem — ~20,700 LOC of source plus test, created from
nothing since July — is the largest single new area. Section 5 addresses it.

### 1.4 Execution configuration

`vitest.config.ts` is three lines:

```ts
export default defineConfig({
  test: { include: ['packages/**/test/**/*.test.ts'] },
});
```

Everything else is Vitest 5.0.0 defaults:

- `pool: 'forks'`
- `isolate: true` — each test file gets a fresh module registry, so every
  module-level cache (including the SRD pack cache) is rebuilt **per file**, not
  per worker
- `fileParallelism: true`
- **`maxWorkers` defaults to `os.availableParallelism()` = 20 on this host**

There is no worker cap, no project partitioning, no per-file resource policy,
and no timing or memory instrumentation. `npm test` is `vitest run` over all
309 files undifferentiated.

`verify:worktree` runs `format` → `check` → `typecheck` → `test` from the
resolved git root. CI runs `typecheck` → `test` → `smoke:cli-install` →
`check` on one Node 24 Linux runner, with a three-OS install-smoke matrix. **CI
is a single unsharded job.**

### 1.5 Gate cost (measured, this host)

| Step | Wall | Peak RSS |
| --- | --- | --- |
| `format:check` | 0.7 s | 263 MB |
| `typecheck` (`tsc --build --force` + scripts project) | 8.9 s | 844 MB |
| `test` @ `--maxWorkers=6` | 48 s | 4,897 MB (process tree) |
| `test` @ `--maxWorkers=4` | 55 s | 4,116 MB |
| `test` @ `--maxWorkers=1` | 181 s | 3,051 MB |

Tests dominate the gate in both time and memory by an order of magnitude.

---

## 2. OOM assessment

**Confidence: high.** The mechanism is measured, not inferred, and it decomposes
into two independent contributors that happen to coincide.

### 2.1 Host envelope

20 CPUs, 7,790 MB RAM, 2,048 MB swap — of which **1,862 MB (91%) is already
consumed at idle**. Effective headroom for a test run is roughly 6.1 GB, and
there is essentially **no swap reserve to absorb a spike**. This is why the
symptom is a hard OOM kill rather than thrashing.

### 2.2 Contributor A — a single pathological test file

`packages/core/test/contextAssembler.test.ts` peaks at **3,009 MB in one worker
and runs for 18 s**, against a harness baseline of 528 MB for a trivial file.
Within it, one test — `projects position-active rules, source associations, and
immutable ambiguities` — accounts for **15.9 s of the file's 17.0 s**.

That test is 307 lines with 28 `expect()` calls. Its final assertion is
`contextAssembler.test.ts:779`:

```ts
const packBefore = readFileSync(packPath);   // records.json, 7.4 MB
/* … 260 lines … */
const packAfter = readFileSync(packPath);
expect(packBefore).toEqual(packAfter);
```

Measured directly, in isolation:

| Form | Time | Peak RSS |
| --- | --- | --- |
| `expect(a).toEqual(b)` on two 7.4 MB Buffers | **14,354 ms** | **2,414 MB** |
| `expect(a.equals(b)).toBe(true)` | **1 ms** | — |

`toEqual` drives Vitest's structural deep-equality over 7.4 million Buffer
elements and builds diff state for them. **This one assertion is ~12% of the
suite's total summed file duration, the whole critical path at any worker count
≥ 4, and the single largest allocation in the verification run.** It is
individually responsible for making `contextAssembler.test.ts` the most
expensive file in the repository.

### 2.3 Contributor B — unbounded worker fan-out

Measured scaling:

| `maxWorkers` | Wall | Peak process-tree RSS | Largest single process |
| --- | --- | --- | --- |
| 1 | 181 s | 3,051 MB | 2,480 MB |
| 4 | 55 s | 4,116 MB | — |
| 6 | 48 s | 4,897 MB | 2,596 MB |
| **20 (default)** | **not run — see below** | **projected ≥ 13 GB** | — |

Per-file peak RSS for the heaviest files, each measured alone at
`--maxWorkers=1`:

| File | Peak RSS | Wall |
| --- | --- | --- |
| `contextAssembler.test.ts` | 3,009 MB | 18 s |
| `srdGeneratedPack.test.ts` | 1,055 MB | 3 s |
| `activeEffects.test.ts` | 1,035 MB | 7 s |
| `discovery/shadowRuntime.test.ts` | 952 MB | 6 s |
| `importers/dnd5e-srd-5.1/pipeline.test.ts` | 922 MB | 3 s |
| `discovery/shadowEvidenceIntegrity.test.ts` | 837 MB | 2 s |
| `campaignRuleStore.test.ts` | 809 MB | 3 s |
| `srdStructureAudit.test.ts` | 753 MB | 2 s |

Vitest schedules test files **largest-first**. The heaviest files are also the
largest files, so at `maxWorkers=20` essentially every one of the eight files
above is resident simultaneously in the first seconds of the run, alongside
twelve more. Summing just those eight marginal costs already exceeds the host's
6.1 GB of headroom before the other twelve workers, the Vite parent (~500 MB),
and the supervising agent process are counted.

**The default configuration was deliberately not executed.** The projection is
built from measured points rather than from a run that would risk killing the
supervising session, per the audit's own instruction.

### 2.4 Why parallelism past ~6 buys nothing

Wall clock is 181 s at 1 worker, 55 s at 4, and 48 s at 6. The sum of all file
durations is 120.8 s, and the top 10 files are 44.8% of it, the top 25 are
65.4%. Past about six workers the run is **latency-bound on
`contextAssembler.test.ts`**, which alone takes 18 s. Raising `maxWorkers` from
6 to 20 therefore costs roughly 3× the peak memory for approximately **zero**
wall-clock improvement.

This is the cleanest result in the audit: the default topology is strictly
worse than a bounded one, on both axes, with no trade-off to weigh.

### 2.5 Contributors examined and found *not* to be primary

Ruling these out matters as much as the positive findings:

- **Aggregate suite size** — not primary. At `maxWorkers=1` the entire 5,611-test
  suite peaks at 3,051 MB, and 2,480 MB of that is one process running one file.
- **The bundled SRD pack** — not primary, despite 51 test files (31,280 LOC)
  loading it. Measured directly: 1,812 records, 132 ms to load, ~48 MB RSS
  delta, ~12 MB heap. Per-file re-parsing under `isolate: true` is real but
  costs ~132 ms and ~48 MB each, not gigabytes. **This was my leading hypothesis
  before measurement and it was wrong.**
- **Subprocess accumulation** — not primary. Only 5 test files spawn
  subprocesses (`cli.test.ts`, `releaseLauncher`, `hiddenUnicodeCheck`,
  `installerChecksum`, `captainSeats`).
- **Per-file worker startup** — real but small. Under `isolate: true` Vitest
  spawns one worker per test file; it reports 309 spawns at ~98 ms each and
  estimates *"at least ~4.93 s faster with `isolate: false`"*. Worth ~10% of
  wall clock, and `isolate: false` trades away the per-file module-registry
  isolation that several suites rely on. Not recommended, and not a memory
  lever.
- **Vitest 5 specifically** — no evidence either way, and **no controlled v4/v5
  comparison was run**. The measured mechanism (deep-equality on a 7.4 MB
  Buffer; `availableParallelism()` fan-out) is version-independent in kind, so
  such a comparison would not change any recommendation here. Manufacturing that
  work is not justified.

### 2.6 Corroboration from existing Beads

Two open beads are independently-observed symptoms of exactly this contention,
both filed with the cause marked *unverified*:

- **`eshyra-da8d`** (P3, open) — `foundation1ProcedureProof.test.ts` times out
  its 10 s hook under full-suite load, passes alone. Filed 2026-09-12, confirmed
  reproducible on a clean checkout.
- **`eshyra-5g3d`** (P3, open) — `cli.test.ts > package smoke` times out under
  full-suite load, passes alone; three of five `verify:worktree` runs failed on
  it.

This audit supplies the verified cause both beads lack. It also shows the
already-taken remedy was applied at the wrong layer: commit `473424d`
("Budget the Foundation-1 PDF-extraction hook by measurement") raised a timeout
budget — `eshyra-da8d`'s own candidate fix #1 — to absorb resource contention
caused by worker fan-out. Raising budgets to accommodate over-subscription
makes the gate slower and less sensitive without addressing the cause, and the
next heavy file will reproduce it.

`eshyra-5g3d` records "296 workers observed". That number comes from Vitest's
own end-of-run line, which reports one spawned worker *per test file* under
`isolate: true` — they are spawned sequentially through a pool of `maxWorkers`,
not held concurrently. The bead's reading of the number is understandable and
its underlying observation of over-subscription is correct; the concurrency
figure that matters is `maxWorkers`.

---

## 3. Test-family taxonomy

Classified by the durable claim protected, not by directory. Sizes are
indicative rather than exact, since files span categories.

| Family | Representative members | Durable claim | Assessment |
| --- | --- | --- | --- |
| **Source fidelity (SRD)** | `srdGeneratedPack`, `importers/**/parse*`, `extract`, `emit` | Generated pack matches the vendored SRD artifact | **Durable.** Protected by `AGENTS.md` and `docs/importer-fix-protocol.md`. Do not weaken. |
| **Importer/compiler regression** | `pipeline`, `mechanicsProjections`, `parseTables`, `sourceRegionLedger` | Compiler stages are deterministic and reproducible | **Durable**, with real consolidation headroom (§7). |
| **Deterministic domain invariant** | `activeEffects`, `actionEconomy`, `hpLifecycle`, `spellSlots`, `spellUpcast`, `usageCounters` | Rules math, lifecycle, resource accounting | **Durable.** ADR 0020 assigns these to deterministic systems permanently. |
| **Persistence / state integrity** | `liveStateSchema`, `migrationRunner`, `migrationLegacyAdoption`, `domainMutations`, `itemState` | Atomic, attributable, migratable state | **Durable.** ADR 0015. |
| **Replay / rollback / checkpoint** | `checkpoint.*`, `cli/test/checkpoints` | Dolt checkpoint, fork, restore integrity | **Durable**; environment-gated, correctly. |
| **Public / provider-neutral contract** | `model/*`, `agentSdkClient`, `releaseEditions`, `releaseInstallerPolicy` | Adapter seam holds; ADR 0010 | **Durable.** |
| **Security / visibility boundary** | `inventoryQueryGuard`, `characterCustody`, `playerVisibleRollLedger` | Player cannot see or reach hidden state | **Durable.** Highest-consequence family in the repo. |
| **Environment / toolchain policy** | `nodeRuntimePolicy`, `hiddenUnicodeCheck`, `installerChecksum` | Native-dep and Unicode policy hold | **Durable**, cheap, high leverage. |
| **Provenance / identity** | `provenanceBinding`, `provenancePartition`, `fieldProvenance` | Every claim traces to a source region | **Durable** under ADR 0020. |
| **Rules discovery** | `discovery/discoveryStages`, `signals`, `expansion` | Candidate retrieval surfaces governing sources | **Authorized but unproven** — §5. |
| **Proof machinery, and tests of it** | `srdStructureAudit`, `srdPlayabilityAudit`, `shadowEvidenceIntegrity`, `discoveryProbes`, `blockerRepairProbes`, `deterministicCapabilityLedger`, `srdSourceInventoryArtifact` | The evidence apparatus itself behaves | **8,747 src LOC ↔ 17,736 test LOC.** Authorized by the review policy's "proof mechanisms are implementation" rule, but disproportionate — §5, §7. |
| **Generalized historical defect class** | 151 bead-named `describe` blocks across 52 files | A named past defect cannot recur | **Mixed** — §4. |
| **Exploratory / historical reproducer** | The long tail inside the above | (often none remaining) | **Primary consolidation target** — §7. |

---

## 4. Hotspots

### 4.1 By cost

Already tabulated in §2.2–2.3. The ranking is: `contextAssembler` (memory *and*
time, by a wide margin), then `activeEffects`, `srdGeneratedPack`,
`shadowRuntime`, `pipeline`, `shadowEvidenceIntegrity`, `campaignRuleStore`,
`srdStructureAudit`.

### 4.2 By structure — `srdGeneratedPack.test.ts`

7,642 lines, 250 cases, 311 KB. Its organizing principle is **the bead that
caused each block**, not the invariant each block protects: 38 of its `describe`
blocks are named for a bead ID (`'subclass-granted feature regression
(loreweaver-fak)'`, `'feature boundary regression (eshyra-0m9.13)'`, …). It is a
chronological ledger of repairs.

Repo-wide there are **151 bead-named `describe` blocks across 52 files**. This
is the structural signature of one-permanent-reproducer-per-finding. It is not
by itself proof of redundancy — for source fidelity an exact SRD regression is
exactly right — but it means the suite cannot answer "what invariant does this
protect?" without reading each block.

A single block inside it, `'table coverage regression baseline (loreweaver-46m,
loreweaver-hvp, loreweaver-uuk)'`, spans **1,619 lines** (4520–6138) with 34
tests and 345 literal data lines.

### 4.3 `activeEffects.test.ts`

153 KB, 111 cases, 1,035 MB, 7 s. Flagged in the assignment as a structural
candidate. **It is not defective.** It protects deterministic effect lifecycle —
a durable ADR 0020 family — and its cost is proportionate to a genuinely large
state space. It is a decomposition candidate for maintainability and worker
isolation, **not** a reduction candidate. See §6.

### 4.4 Under-used parameterization

Only **28 of 309 files** use `it.each`/`describe.each` (84 call sites total).
Given 151 bead-named blocks and 345 literal data lines in a single `describe`,
much repetitive case structure is hand-written. This is the mechanical half of
§7.

---

## 5. Accidental-contract findings

Each states: `existing behavior/test → claimed invariant → actual authority →
disposition → replacement evidence/responsibility`.

### F1 — Pack-file immutability asserted by 7.4 MB Buffer deep-equality

> **Existing:** `contextAssembler.test.ts:518,778–779` reads
> `data/rules-packs/.../records.json` (7.4 MB) before and after exercising
> context assembly and asserts `expect(packBefore).toEqual(packAfter)`.
>
> **Claimed invariant:** assembling campaign-rules context does not mutate the
> bundled rules pack on disk.
>
> **Actual authority:** none located. ADR 0013 makes the generated pack the
> runtime pack; nothing requires a runtime *read* path to prove non-mutation of
> its source file. The loader (`rules/packLoader.ts`, reached via
> `bundledSrdPack.ts`) opens the pack read-only and exposes no write path;
> `assembleCampaignRulesContext` never touches the filesystem. The property is
> guaranteed by the module boundary.
>
> **Disposition: retire the assertion.** If the team judges that a non-mutation
> guard still carries value as defence-in-depth against a future write path,
> **narrow and re-implement it**, not keep it: `expect(a.equals(b)).toBe(true)`
> is 1 ms versus 14,354 ms and drops ~2.4 GB of peak RSS. Cheaper still, compare
> `statSync(packPath).mtimeMs` or a content hash.
>
> **Replacement responsibility:** the read-only loader boundary; optionally one
> cheap hash assertion sited once in a pack-loader test rather than inside the
> heaviest context-assembly test.

This is the highest-value single change identified by the audit: ~30% of suite
wall-clock and the largest allocation in the run, for a property nothing
threatens.

It is also the clearest instance of the loop in the assignment's hypothesis. The
observation ("nothing proves the pack isn't mutated") is technically true. It
was never dispositioned against a requirement. The resulting defence was
generalized to the strongest available form — full byte-for-byte structural
equality — and made permanent. The cost was never measured.

### F2 — One test case carrying seventeen unrelated claims

> **Existing:** `contextAssembler.test.ts` — `projects position-active rules,
> source associations, and immutable ambiguities`, 307 lines, 28 assertions.
>
> **Claimed invariant:** at least seventeen distinct ones — position-active rule
> ordering, `governingRecordKeys` on superseded rules, future-rule exclusion,
> ambiguity ordering and shape, successor visibility, revocation, ruling
> resolution binding, question preservation, `UNRESOLVED` prompt rendering,
> resolved-ruling rendering, no duplicate ruling lines, rebound-stack ambiguity
> dropping, `unboundRulings` reporting, absent-ambiguity messaging, and F1's
> pack immutability.
>
> **Actual authority:** the individual invariants are real and largely
> authorized (campaign overlay canon, ADR 0014; campaign-rule lifecycle,
> `eshyra-jhpt`). **The bundling is not authorized by anything.**
>
> **Disposition: split.** The accretion here is at the *case* level — successive
> review rounds appended assertions to an existing passing test instead of
> adding focused ones. The `eshyra-jhpt` chain that produced much of this ran
> **15 review rounds** (`eshyra-jhpt.rev1`…`rev16`).
>
> **Replacement evidence:** the same assertions as ~8–10 focused tests sharing
> one `beforeEach` fixture. No protection is lost; failure localization improves
> markedly, since today any of seventeen regressions reports as the same
> red test.

### F3 — The discovery experiment's instrumentation has become permanent product contract

This is the largest accidental-contract surface in the repository, and the one
requiring the most care.

> **Existing:** `packages/core/src/discovery/` (~7,700 LOC) and
> `packages/core/test/discovery/` (~13,000 LOC), created since July — the
> largest new area in the repo. Includes `measurements.ts` (864 LOC, the M1–M12
> experiment measurements), `blockerRepairs.ts` (14.5 KB, runtime observation of
> five *process* blockers B1–B5), `shadow.ts` (65 KB), `harness.ts`,
> `traceDerivation.ts`, plus `shadowEvidenceIntegrity.test.ts` (1,852 LOC, 93
> cases), `discoveryProbes.test.ts`, `blockerRepairProbes.test.ts`,
> `stateEffectMeasurement.test.ts`.
>
> **Claimed invariant:** varies per module; collectively, that discovery
> captures, measurements, and blocker observations are faithful and
> tamper-evident.
>
> **Actual authority:** the integrated transition design
> (`docs/audits/rules-awareness-transition/2026-07-30-integrated-transition-design.md`,
> merged PR #485) authorizes all of it — **as experiment infrastructure for
> Phases 0–4** (§12). Phase 4 is bead `eshyra-o9bd.19.15`, still **open at P2**.
> The authority is real and current.
>
> **The gap is that this authority has no sunset.** The design carefully
> dispositions every *pre-existing* artifact (§5.1–§5.10, "repurposed, or
> retired with reasons") but says nothing about what happens to the probes,
> measurements, shadow captures, and blocker observations **after the experiment
> concludes**. Absent a stated disposition, permanent-regression status accrues
> by default.
>
> **Measured reachability:** `discoveryMode` defaults to `'off'`
> (`orchestrator.ts:718`). **No production caller sets it** — not the CLI, not
> anything in `src` outside discovery itself. Only two test files
> (`shadowRuntime.test.ts`, `packetIntervention.test.ts`) ever activate it.
> **Nothing from `discovery/` is exported from the core root export**
> (`src/index.ts`); every symbol reaches only `internal.ts`, which `AGENTS.md`
> defines as carrying *"no compatibility promise"* and being *"for co-developed
> callers inside this repo (e.g. tests)"*. For `measurements.ts`,
> `blockerRepairs.ts`, `traceDerivation.ts`, and `harness.ts`, **the test suite
> is the entire consumer set.**
>
> **Disposition: legitimize with an explicit sunset — do not retire now.** The
> experiment is authorized and unfinished; deleting staged infrastructure would
> destroy authorized work. What is missing is the disposition clause the design
> applied to everything else. The owning bead (`eshyra-o9bd.19.15`) should be
> amended to require, as a Phase 4 exit condition, that each module be
> classified: *promoted* to product (with a real non-test consumer and a root
> export), *demoted* to development-only tooling outside the default gate, or
> *retired*.
>
> **Replacement responsibility:** Phase 4 exit criteria in
> `eshyra-o9bd.19.15`. Until then the code stays; §9 moves its ~3,700 MB and
> ~12 s of test cost off the default developer loop without weakening the
> handoff gate.

`blockerRepairs.ts` is the sharpest illustration. It is production code that, on
every shadow capture, observes at runtime whether five items from a design
document's §9 have been repaired — **process state encoded as runtime product
behavior**, with permanent validation in `shadow.ts` (`failAt('blockerRepairs',
…)`) and a dedicated permanent test file. Its module doc is explicit that each
probe must observe live conditions "rather than trusting a bead's closure
state". That is careful, well-reasoned engineering *in service of a requirement
that is a project-management artifact*, and it will outlive the blockers unless
something retires it.

### F4 — Duplicate proof: generalized audits re-run inside narrow reproducers

> **Existing:** `srdGeneratedPack.test.ts` invokes `auditSrdStructure(pack)` /
> `auditSrdPlayability(...)` at **9 sites**, typically as a trailing assertion
> inside a narrow bead-named reproducer — e.g. the `table-owner-link` block
> asserts specific `tableRefs` values *and then* asserts
> `auditSrdStructure(pack).filter(f => f.category === 'table-owner-link')` is
> empty.
>
> **Claimed invariant:** the specific table links are correct **and** the
> generalized audit gate is clean.
>
> **Actual authority:** the transition design §5.1 retains these audits as
> *"bounded regression guards"* — authorized. But the same property is now
> asserted in three places: the narrow reproducer, the inline audit re-run, and
> `srdStructureAudit.test.ts` (1,925 LOC), which tests the audit itself.
>
> **Disposition: retire the inline audit re-runs only.** Keep the narrow
> reproducer (it distinguishes a bad state the category-level audit does not:
> *wrong* refs versus *missing* refs). Keep `srdStructureAudit.test.ts`. The
> middle layer adds no distinguishing power and pays full pack-audit cost inside
> the suite's second-largest file.
>
> **Replacement evidence:** one whole-pack `auditSrdStructure(pack)` clean-gate
> assertion sited once, in `srdStructureAudit.test.ts`.

### F5 — Duplicate ADR numbers weaken the authority chain

> **Existing:** `docs/adr/` contains two ADR 0011s
> (`0011-core-owned-rules-pack-bound-character-sheet.md`,
> `0011-multi-provider-installer-editions.md`) and two ADR 0012s
> (`0012-character-continuity-and-custody.md`,
> `0012-rules-pack-campaign-template-adventure-module-campaign-instance.md`).
>
> **Claimed invariant:** ADR numbers identify decisions.
>
> **Actual authority:** `AGENTS.md` and `docs/design-and-pr-review-policy.md`
> both require reviewers to read "applicable accepted ADRs", and ADRs are cited
> bare by number throughout — `docs/install.md:32` ("ADR 0011"),
> `docs/game-state.md:21` ("ADR 0011"), ADR 0020 lines 92/145/337 ("ADR 0012"),
> ADR 0016 ("ADR 0011"). Each is ambiguous on its face.
>
> **Disposition: repair.** Not a test finding, but it is a defect in the
> authority chain this audit was instructed to treat as primary, found while
> reading it. Renumber one of each pair (or add explicit disambiguating slugs at
> every bare citation).
>
> **Replacement evidence:** a cheap repo check asserting ADR number uniqueness,
> alongside the existing `nodeRuntimePolicy` / hidden-Unicode policy tests.

### F6 — Structural pressure in the review policy itself

Not a code finding, but it is the mechanism behind F1–F4 and the reason §10
matters more than any individual cleanup.

`docs/design-and-pr-review-policy.md` ("Findings discipline") states: *"If a
defect is worth fixing ever, it is worth fixing now. Every valid finding blocks
approval and is repaired in the current PR regardless of its size or impact."*
"Review the mechanism" requires each defect to be generalized into its invariant,
sibling-searched, varied across state dimensions, and given *"permanent
regression evidence that distinguishes the bad state from the good state."*

Each rule is individually sound. Composed, they form exactly the loop the audit
hypothesized, because **the disposition gate is asymmetric**: accepting a
finding requires nothing extra, while rejecting one requires *"recorded
reasoning that explains why the governing invariant and authority require no
change."* When accepting is cheaper than rejecting, a sufficiently capable
reviewer — and frontier models are extremely capable at generating technically
valid observations — accepts by default. Every acceptance then mandates a
generalized repair plus permanent evidence plus a widened sibling search, which
enlarges the surface the next review examines.

The measured signature of this loop in live Beads: **1,103 beads; 100 named
`Dispatch:`; `eshyra-jhpt` carrying a 15-round `rev` chain; and an attempt
distribution of 45 tasks at attempt 1 but 4 reaching attempt 6, 2 reaching
attempt 7, 2 attempt 8, and 2 attempt 9.** The policy already says a defect
class surviving two repair cycles should trigger a fresh full review rather than
another narrow patch; attempt-9 tasks indicate that escape hatch is not firing.

**Disposition: amend the policy** (§10). Note that F6 predicts F1: an
unmeasured, maximally-defensive, permanent assertion is precisely what this loop
produces.

---

## 6. Clearly durable coverage — do not casually reduce

Named explicitly so that a later cleanup pass does not read "large" as
"suspect".

- **`activeEffects.test.ts`** (153 KB, 111 cases). Deterministic effect and
  concentration lifecycle. ADR 0020 assigns this to deterministic systems
  permanently; ADR 0018 bounds it. Large because the state space is large.
  Decompose for isolation if useful; **do not reduce.**
- **Exact SRD source-fidelity regressions** across `srdGeneratedPack.test.ts`
  and `importers/**`. `AGENTS.md` is explicit: *"Do not weaken regression tests
  or audit expectations to match current generated output."* Consolidating these
  into a "broader" audit would violate the standing protocol. The bead-named
  organization is cosmetically unfortunate but the *content* is durable. §7's
  proposals here are structural only.
- **Security and visibility boundaries** — `inventoryQueryGuard` (543 LOC, 7
  bead-named blocks), `characterCustody`, `playerVisibleRollLedger`. Highest
  consequence-of-failure in the repo; ADR 0012 and ADR 0020 both assign
  visibility and authorization to deterministic systems. Density here is
  justified even where it looks repetitive.
- **Checkpoint / replay / rollback** — `checkpoint.*`. Expensive and correctly
  environment-gated. Expense is intrinsic to what they prove.
- **Migration and adoption compatibility** — `migrationRunner`,
  `migrationLegacyAdoption`. ADR 0015 is migration-first; these protect stored
  player data. Cheap and irreplaceable.
- **Environment / toolchain policy** — `nodeRuntimePolicy`,
  `hiddenUnicodeCheck`, `installerChecksum`. Very cheap, and they protect
  decisions (ADR 0008, ADR 0016) that are costly to rediscover.
- **Provenance and field-level ownership** — ADR 0019 / ADR 0020 make
  provenance a first-class product property, not scaffolding. Distinguish these
  from F3's *measurement* machinery, which is scaffolding.

---

## 7. Consolidation opportunities

Ordered by value per unit of risk. Every item preserves the distinguishing power
of what it replaces; none is justified by count reduction.

**C1 — Fix F1's assertion.** One line. ~14.4 s and ~2.4 GB. Highest value in
the document by a wide margin.

**C2 — Split F2's mega-test** into ~8–10 focused cases over a shared fixture.
Net case count rises; failure localization improves; cost is unchanged.

**C3 — Remove the 9 inline audit re-runs (F4).** Keep narrow reproducers and
the dedicated audit tests. Removes a full pack audit from 9 sites in the
second-largest file.

**C4 — Parameterize the bead-named source-fidelity blocks.** With 151 bead-named
blocks, 345 literal data lines in a single `describe`, and only 28 of 309 files
using `.each`, most of `srdGeneratedPack.test.ts`'s exact-value regressions are
hand-written near-duplicates of a common shape:
*(record key, field, expected value, originating bead)*.

Converting them to `it.each` tables preserves **every exact expectation and
every bead attribution** — the originating bead becomes a table column instead
of a `describe` name — while collapsing thousands of lines of boilerplate. This
satisfies `docs/importer-fix-protocol.md`'s requirement that regression intent
be preserved, because no expectation changes. **This is a mechanical
transformation, not a reduction**, and it is the only way to make
`srdGeneratedPack.test.ts` navigable without weakening it.

**C5 — Decompose `srdGeneratedPack.test.ts` (7,642 lines) by invariant.**
Reorganize from bead-chronology into the five ADR 0020 concerns — source
fidelity, discovery, adjudication, deterministic capability, state integrity —
which `docs/design-and-pr-review-policy.md` requires be kept analytically
separate. The 1,619-line table-coverage block becomes its own file. Also
splits one 1,055 MB worker peak into several smaller ones. Pairs naturally
with C4.

**C6 — Decompose `activeEffects.test.ts`** for worker isolation and
maintainability. **No case removal.** Purely a memory- and navigability-driven
split.

**C7 — Hoist per-file pack loading where files re-parse it needlessly.** 51
files load the pack at ~132 ms and ~48 MB each under `isolate: true`. Worth
~5 s total — real but an order of magnitude below C1, and listed here so it is
not mistaken for a major lever.

**Explicitly rejected as a consolidation target:** replacing exact SRD
regressions with generated audit counts. A generated audit or scenario count
does not prove source fidelity; `AGENTS.md` forbids weakening these to match
generated output; and category-level audits demonstrably fail to distinguish
bad states the narrow tests catch (§F4).

---

## 8. Obsolete / superseded contracts

The search for architecture-transition fossils **returned less than expected**,
and that is a genuine finding: the repository has been disciplined about
retiring contracts explicitly. The transition design §5 dispositions
pre-existing artifacts by name, and ADR 0013's retired placeholder pack id is
handled by an active fail-fast path (`toolLookupRules.ts:128`) rather than a
compatibility shim — a real current contract, not a fossil.

Candidates found, all conditional:

| Candidate | Replacing responsibility | Status |
| --- | --- | --- |
| `blockerRepairs.ts` + `blockerRepairProbes.test.ts` | Becomes fossil when B1–B5 are closed and Phase 4 exits | **Not yet obsolete.** Sunset via `eshyra-o9bd.19.15` (F3). |
| `measurements.ts` (M1–M12) + `stateEffectMeasurement.test.ts` | Experiment measurement; superseded by whatever Phase 4 concludes | **Not yet obsolete.** Same sunset. |
| `harness.ts`, `traceDerivation.ts` | Phase 1 offline harness | **Not yet obsolete.** Same sunset. |
| Inline audit re-runs (F4) | `srdStructureAudit.test.ts` | **Obsolete now.** |
| F1's Buffer comparison | Read-only loader boundary | **Obsolete now.** |

**No SRD source-fidelity, discovery, capability, adjudication, or
state-integrity defect is hidden by any disposition proposed here** — the
condition `docs/design-and-pr-review-policy.md` places on retirement.

A caution the assignment specifically raises: an older deterministic mechanics
test may now protect a contract intentionally superseded by model adjudication
under ADR 0020. **I found no confirmed instance**, and I did not read every
mechanics test. This deserves a dedicated pass (bead T7, §11) rather than an
inference from the ADR's existence — ADR 0020 moves *interpretation* to the
model while explicitly keeping dice, arithmetic, atomic mutation, resource
accounting, identity, persistence, replay, and visibility deterministic. Most
mechanics tests sit on the deterministic side.

---

## 9. Execution architecture recommendation

Treating *how* tests execute separately from *which* tests are required, as
instructed. **Nothing here weakens the authoritative gate — the required union
of durable coverage is unchanged.**

### R1 — Cap workers (immediate, highest value/effort ratio)

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    maxWorkers: process.env.CI ? 4 : 6,
  },
});
```

Measured: 6 workers is 48 s versus 181 s at 1 and ~55 s at 4, with a 4.9 GB
peak against a 6.1 GB envelope. The default of 20 is strictly worse on both
axes (§2.4). A cap makes `eshyra-da8d` and `eshyra-5g3d` failures
**deterministic rather than load-dependent**, which is the precondition for
diagnosing them properly instead of raising more budgets.

Do **not** express this as a percentage; the value must be absolute so that a
20-CPU agent host and a 2-CPU CI runner both land in a measured envelope.

### R2 — Isolate the heavy files

After C1 lands, re-measure. If `contextAssembler` still peaks above ~1 GB, give
it and the other >800 MB files (§2.3) a dedicated Vitest project with
`maxWorkers: 1`, so aggregate peak is bounded by *policy* rather than by which
files happen to co-schedule.

### R3 — Partition into Vitest projects

Split by execution character, not by convenience:

| Project | Contents | Character |
| --- | --- | --- |
| `unit` | Deterministic domain, state, orchestrator, rules | Fast, low memory, high parallelism |
| `importer` | `test/importers/**`, `srdGeneratedPack`, audits | Pack-heavy, memory-bound, low parallelism |
| `discovery` | `test/discovery/**` | Experiment infrastructure (F3); ~3.7 GB, ~12 s |
| `system` | `cli.test.ts`, `checkpoint.*`, subprocess/Dolt suites | Subprocess- and IO-bound; serialize |

This is what makes R4 and R6 possible and gives F3 a clean seam if Phase 4
demotes discovery to development-only tooling.

### R4 — Focused development commands

```
npm run test:unit        # unit project — the inner-loop command
npm run test:importer
npm run test:discovery
npm run test:system
npm test                 # unchanged: the full authoritative union
```

Agents get a fast loop; the handoff gate is untouched. `verify:worktree`
continues to run the **full** suite and remains the only thing that authorizes a
commit. This directly addresses the audit's goal of focused feedback without
weakening the gate.

### R5 — Keep `verify:worktree` authoritative, and keep its ordering

`format` → `check` → `typecheck` → `test`, still mutating-before-commit. No
change. Worth stating because R4 introduces cheaper commands that must not be
mistaken for the gate.

### R6 — Shard CI

CI is one unsharded `build-test` job. With R3 the projects shard naturally
across runners. Also add `--reporter=json` artifact retention so per-file
duration and failure history become observable over time instead of being
rediscovered by audit.

### R7 — Cheap standing instrumentation

Record wall time and peak RSS per verification run (e.g. `/usr/bin/time -v`
around the test step in CI). The two open flake beads exist because this data
was unavailable; every number in §2 had to be generated from scratch. This is
one line in CI, and it is the difference between the next regression being
noticed and being absorbed into a raised budget.

### R8 — On Vitest 4 vs 5

No controlled comparison was run, and none is recommended. The measured
mechanisms are version-independent in kind, and the assignment is explicit that
work should not be manufactured to perform that comparison.

---

## 10. Long-term test and review policy

The assignment's draft policy is sound. Refinements below are the ones
repository evidence actually supports.

### 10.1 Permanent-evidence policy (proposed, for `AGENTS.md`)

> A permanent regression test protects a durable invariant, contract,
> independently meaningful boundary, or justified known defect class that
> stronger evidence does not already protect.
>
> A reproducer or adversarial example created during development or review is
> **not automatically permanent**. After disposition and repair it normally
> becomes generalized regression evidence or is retired, unless the exact case
> has independent semantic significance. **Exact source-fidelity regressions
> against a vendored source artifact always have that significance** and are
> never retired under this rule (`docs/importer-fix-protocol.md`).
>
> Tests are evidence of requirements, never authority for requirements. A
> test's existence does not establish that the behavior it protects is
> required.
>
> Permanent proof burden is proportionate to the governing invariant. **A
> proof mechanism's own cost is part of the proportionality judgment.** An
> assertion costing seconds of wall clock or hundreds of megabytes must be
> justified against a correspondingly serious consequence of failure.
>
> Proof machinery — checkers, probes, ledgers, baselines, measurements — is
> implementation and needs tests, but **the evidence apparatus does not inherit
> the proof burden of the product**. Test it in proportion to the decisions it
> gates.
>
> **Infrastructure authorized for a bounded experiment or transition must
> carry an explicit disposition at that boundary** — promoted to product with a
> real non-test consumer, demoted to development-only tooling, or retired.
> Absent a stated disposition, scaffolding acquires permanent-contract status
> by default.

The fourth and sixth clauses are the ones this audit's measurements uniquely
motivate: F1 exists because nobody costed an assertion, and F3 exists because
the transition design dispositioned every pre-existing artifact but none of the
new scaffolding.

### 10.2 Review-policy amendment (proposed, for `docs/design-and-pr-review-policy.md`)

Add an explicit **observation → disposition → finding** pipeline ahead of
"Findings discipline", and make the two paths symmetrically cheap:

> A technically correct observation is not a finding. Before publishing one,
> record: the governing invariant; the authority for it; the ownership and
> consumer boundary; applicability or reachability where material; the actual
> consequence of violation; the proportionate closure condition; and the
> proportionate permanent evidence.
>
> An observation that cannot name an operative authority and a real
> producer or consumer is **dispositioned as "no requirement"**, in one line,
> and is not a finding. This costs no more than accepting it. "We could make
> this more defensive" is not "the system requires this defense."
>
> A finding must state whether its permanent evidence is a **generalized
> invariant** or an **exact reproducer**, and why that choice is proportionate.
> Prefer one generalized invariant over many near-identical reproducers, except
> where the exact case has independent semantic significance.
>
> Reachability is a first-class disposition axis. A defect on a path no
> producer or consumer reaches is dispositioned at its real severity, not at the
> severity it would have on a live path.

The second clause is the load-bearing one. "Findings discipline" is correct that
valid findings must not be deferred; the failure is upstream, where an
asymmetric cost makes acceptance the default (§F6). Making rejection exactly as
cheap as acceptance is the minimal change that lets rigor converge.

Also strengthen the existing two-cycle rule: the attempt distribution shows
tasks reaching attempt 9, so the escape to a fresh full review is not firing.
Make it mechanical — a third dispatch on the same defect class **requires** a
fresh full review of the subsystem.

**What must not change:** sibling search, state-dimension variation,
proof-mechanism review, and the ban on nonblocking/follow-up labels. Those
produce genuine defect discovery. The amendment targets only the disposition
gate.

---

## 11. Bead / epic decomposition

Derived from live Beads (1,103 issues). **No existing bead covers test-suite
execution architecture, permanent-evidence policy, or accidental-contract
retirement** — searches for vitest, worker, memory, OOM, partition, consolidate,
and redundant across titles and descriptions return only the two flake beads and
unrelated matches. This work is new, with two exceptions noted below.

Proposed epic: **`Verification system: cost, topology, and evidence policy`**

| ID | Title | P | Depends on | Notes |
| --- | --- | --- | --- | --- |
| **T1** | Replace the 7.4 MB Buffer deep-equality pack-immutability assertion (F1/C1) | P1 | — | ~14.4 s, ~2.4 GB. One line. |
| **T2** | Cap Vitest `maxWorkers` and record per-run time/peak RSS (R1, R7) | P1 | — | Makes the flakes deterministic. |
| **T3** | Split the 17-claim context-assembler mega-test (F2/C2) | P2 | T1 | Same file as T1. |
| **T4** | Partition the suite into Vitest projects and add focused commands (R3, R4) | P2 | T2 | Gate unchanged. |
| **T5** | Adopt the permanent-evidence policy in `AGENTS.md` (§10.1) | P1 | — | Independent; do early. |
| **T6** | Amend the review policy with observation→disposition→finding (§10.2) | P1 | — | Independent; do early. |
| **T7** | Parameterize and decompose `srdGeneratedPack.test.ts` (C4, C5) | P2 | T4 | **Follows `docs/importer-fix-protocol.md`.** No expectation may change. |
| **T8** | Remove the 9 inline generalized-audit re-runs (F4/C3) | P2 | T7 | |
| **T9** | Amend `eshyra-o9bd.19.15` with Phase 4 exit dispositions for discovery scaffolding (F3) | P1 | T6 | **Amend the existing bead; do not create a parallel lifecycle.** |
| **T10** | Decompose `activeEffects.test.ts` for isolation (C6) | P3 | T4 | No case removal. |
| **T11** | Resolve duplicate ADR numbers 0011 / 0012 and guard uniqueness (F5) | P2 | — | Independent. |
| **T12** | Audit deterministic mechanics tests for ADR 0020 supersession (§8) | P3 | T6 | Unresolved question, not a known defect. |
| **T13** | Shard CI across the R3 projects (R6) | P3 | T4 | |

**Existing beads to update rather than duplicate:**

- **`eshyra-da8d`** and **`eshyra-5g3d`** — add the verified cause from §2 and
  make them depend on **T2**. Both should be re-examined *after* the worker cap,
  since a deterministic reproduction may show the timeouts were purely
  contention. Note in `eshyra-da8d` that commit `473424d` treated the symptom.
- **`eshyra-o9bd.19.15`** — amend per **T9**. Do not open a competing bead.
- **`eshyra-o9bd.19.1.8`** ("Make known-finding regressions test the actual
  generalized defect") — **already open and directly adjacent to C4/T7.** Its
  scope should be reconciled with T7 before either starts.
- **`eshyra-tba9`** ("Add generated cross-family fail-closed clause regression
  matrix", P2, open) — flagged deliberately: this proposes *new* proof
  machinery. It should be re-dispositioned against §10.1 before it is built,
  not because it is wrong, but because it is exactly the class of work the new
  policy asks to cost first.

---

## 12. Implementation order

**T1, T2, T5, T6 have no dependencies and should land first.** T1 and T2 recover
essentially all of the immediate cost; T5 and T6 stop the loop that produced it.
Doing the cleanup without the policy change would leave the generating mechanism
intact.

Two parallel paths after that:

**Path A — execution topology** (mechanical, low semantic risk)
`T2 → T4 → T13`, with `T10` and `T3` alongside.

**Path B — evidence and contracts** (semantic, needs authority judgment)
`T5, T6 → T9 → T12`, with `T7 → T8` once T4 provides the partition, and `T11`
independent.

The paths touch disjoint files and can run concurrently. The one serialization
that matters: **T7 must not start before T4**, so the importer partition exists
to absorb the reorganized files, and **not before T5/T6**, so the policy that
governs which evidence is permanent is settled before anyone rewrites 7,642
lines of it.

Given a 7 GB host, write-capable work on Path A and Path B should be serialized
at the process level even though the paths are logically parallel.

---

## 13. Risk analysis

Where cleanup is most likely to weaken a legitimate proof boundary, most severe
first.

**Highest risk — T7 (`srdGeneratedPack.test.ts`).** 7,642 lines of exact SRD
source-fidelity evidence, explicitly protected by `AGENTS.md` and
`docs/importer-fix-protocol.md`. The failure mode is subtle: a `.each`
conversion that *normalizes* an expectation while transcribing it silently
weakens a source regression, and the test still passes. **Mitigations:** convert
mechanically, never by retyping; require that the generated pack be unchanged
and the diff contain no altered expected *values*; preserve every bead
attribution as a table column; review under the `rules-clause-complete` profile.
If this cannot be done with confidence, **C5 (decomposition) alone still
delivers most of the maintainability and memory benefit at far lower risk** —
take that and skip C4.

**High risk — T8 (inline audit re-runs).** The argument that the narrow
reproducer plus the dedicated audit test fully covers the removed assertion must
be verified per site, not assumed. A broad test does not subsume a narrow one
merely by executing more code. **Mitigation:** for each of the 9 sites, confirm
the audit test actually distinguishes the same bad state; where it does not,
keep the inline re-run.

**High risk — T9 (discovery sunset).** Retiring scaffolding prematurely would
destroy authorized, unfinished Phase 4 work. **Mitigation:** T9 as scoped
changes *no code* — it adds exit conditions to an existing bead. Any actual
retirement is a later, separately-authorized decision.

**Moderate risk — T1.** Low but non-zero: if some future path *can* write the
pack, replacing the assertion with a hash or `mtime` check preserves the guard
at ~0 cost. Recommended regardless, since it also documents the intent, which
the current form does not.

**Moderate risk — T4 partitioning.** The real hazard is not technical but
procedural: cheap focused commands could be mistaken for the gate. **Mitigation:**
`verify:worktree` keeps running the full union and remains the only
commit authorization; state this explicitly in `AGENTS.md` alongside the new
commands.

**Low risk — T2, T10, T11, T13.**

**Meta-risk, stated because the assignment names it.** This audit could itself
become a source of accidental requirements. Guards applied: it adds **no new
proof machinery**; all instrumentation was temporary and removed (the working
tree is clean); it proposes **no test-count target**; and every proposed
retirement carries an explicit authority chain a reviewer can reject on its
merits. The one new permanent check proposed anywhere is the ADR-uniqueness
guard in F5, which is a handful of lines and guards the authority chain the
whole review process depends on.

---

## Appendix — measurement method

All figures measured on this host (20 CPU, 7,790 MB RAM, 2,048 MB swap with
1,862 MB consumed at idle; Linux 6.18 WSL2; Node 24.16.0; Vitest 5.0.0;
`dolt` 2.3.3 present, no live model credentials).

- Process-tree RSS sampled at 1 Hz over the run's process group via
  `ps -e -o pgid=,rss=`, with the run launched under `setsid` so the group is
  exact. An earlier `pstree`-based sampler double-counted threads and was
  discarded; figures in this document come only from the process-group sampler.
- Per-file timings from `vitest run --reporter=json`.
- Per-file peak RSS from single-file runs at `--maxWorkers=1`.
- The Buffer-comparison figures come from a temporary probe placed under
  `packages/core/test/__tmpprobe/`, run once, and deleted; `git status` was
  verified clean afterwards.
- **The default `maxWorkers=20` configuration was deliberately not executed**,
  per the audit instruction not to repeatedly run a configuration known to risk
  killing the supervising agent. Its projection is extrapolated from the
  measured 1/4/6-worker points and the per-file peaks, and is labelled as a
  projection wherever it appears.
