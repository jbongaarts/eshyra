import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_METADATA_ONLY_SPELLS,
  assertGameplayReadinessDispositions,
  buildGameplayReadinessReport,
  buildOverlayParityReport,
  CREATURE_ENTRY_REVIEWED_DISPOSITIONS,
} from '../scripts/create-dnd5e-srd-audit-bundle/cli.js';
import {
  getBundledDnd5eSrdPack,
  type RulesPack,
  type RulesPackLicense,
  type RulesRecord,
} from '../src/internal.js';

const LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'CC-BY-4.0',
  attributionText: 'fixture',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: 'fixture',
  provenancePolicy: 'fixture',
  outputRestrictions: 'fixture',
};

function record(
  partial: Pick<RulesRecord, 'kind' | 'key' | 'name' | 'data'>,
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    source: 'fixture',
    license: LICENSE,
    provenance: { sourceRef: 'fixture', locator: 'p. 1' },
    ...partial,
  };
}

function pack(records: readonly RulesRecord[]): RulesPack {
  return {
    meta: {
      packId: 'rules:dnd5e-srd-5.1',
      title: 'Fixture',
      description: 'Fixture pack.',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: LICENSE,
    },
    records,
  };
}

describe('D&D SRD audit bundle gameplay-readiness report', () => {
  it('counts condition effects and exhaustion levels as partial structure, not prose-only', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'condition',
          key: 'condition:blinded',
          name: 'Blinded',
          data: {
            description: 'A blinded creature cannot see.',
            effects: ['A blinded creature cannot see.'],
          },
        }),
        record({
          kind: 'condition',
          key: 'condition:exhaustion',
          name: 'Exhaustion',
          data: {
            description: 'Exhaustion is measured in six levels.',
            levels: [{ level: 1, effect: 'Disadvantage on ability checks' }],
          },
        }),
      ]),
      [],
    );

    expect(report.byKind.condition).toMatchObject({
      totalRecords: 2,
      recordsWithPartialStructure: 2,
      proseOnlyRecords: 0,
    });
    expect(report.byKind.condition.examples.partialStructure).toEqual([
      'condition:blinded',
      'condition:exhaustion',
    ]);
    expect(report.byKind.condition.examples.proseOnly).toEqual([]);
  });

  // eshyra-txxa: `hasMechanicsProjection` only checked top-level
  // `data.mechanics`/`data.projection`, `data.traits[].mechanics`, and
  // `data.feature.mechanics`, undercounting creature mechanics that live in
  // nested actions/reactions/legendary actions instead.
  it('counts mechanics nested in creature actions, reactions, and legendary actions', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'creature',
          key: 'creature:action-only',
          name: 'Action Only',
          data: {
            actions: [
              {
                name: 'Bite',
                text: 'Melee attack.',
                mechanics: {
                  effects: [{ kind: 'makeAttack', attack: 'bite' }],
                },
              },
            ],
          },
        }),
        record({
          kind: 'creature',
          key: 'creature:reaction-only',
          name: 'Reaction Only',
          data: {
            reactions: [
              {
                name: 'Parry',
                text: 'Reaction.',
                mechanics: { effects: [{ kind: 'acBonus', amount: 2 }] },
              },
            ],
          },
        }),
        record({
          kind: 'creature',
          key: 'creature:legendary-only',
          name: 'Legendary Only',
          data: {
            legendaryActions: {
              description: 'Can take 3 legendary actions.',
              entries: [
                {
                  name: 'Detect',
                  text: 'Perception check.',
                  mechanics: {
                    effects: [{ kind: 'makeAbilityCheck', ability: 'wisdom' }],
                  },
                },
              ],
            },
          },
        }),
        record({
          kind: 'creature',
          key: 'creature:no-mechanics',
          name: 'No Mechanics',
          data: {
            actions: [{ name: 'Bite', text: 'Melee attack, no mechanics.' }],
          },
        }),
      ]),
      [],
    );

    expect(report.byKind.creature).toMatchObject({
      totalRecords: 4,
      recordsWithMechanicsProjections: 3,
    });
    expect(report.byKind.creature.examples.mechanicsProjections).toEqual([
      'creature:action-only',
      'creature:legendary-only',
      'creature:reaction-only',
    ]);
  });

  it('pins the committed pack creature mechanics-projection count to 317/317', () => {
    // Every creature carries at least one typed nested projection after the
    // entry-mechanics pass (eshyra-o9bd.18.7.3) — the former 314/317 baseline
    // (eshyra-txxa) excluded Frog, Sea Horse, and Shrieker, whose traits
    // (Amphibious, Standing Leap, Water Breathing, Shriek) are now modeled.
    const report = buildGameplayReadinessReport(getBundledDnd5eSrdPack(), []);
    expect(report.byKind.creature).toMatchObject({
      totalRecords: 317,
      recordsWithMechanicsProjections: 317,
    });
  });

  it('distinguishes deterministic spell effect semantics from metadata-only mechanics (eshyra-o9bd.18.7.4)', () => {
    const report = buildGameplayReadinessReport(getBundledDnd5eSrdPack(), []);
    const spells = report.spellEffects;
    expect(spells.totalSpells).toBe(319);
    expect(
      spells.spellsWithDeterministicEffects + spells.metadataOnlySpells,
    ).toBe(spells.totalSpells);
    // Deterministic = damage / saves / conditions / effects / structured
    // scaling. `area` is casting metadata (like duration) and does NOT
    // promote a spell into this bucket. The exact membership of the
    // metadata-only complement is pinned by ACCEPTED_METADATA_ONLY_SPELLS,
    // so these counts are exact, not floors. The eshyra-o9bd.18.7.9
    // membership re-audit moved 58 spells with deterministic semantics
    // (senses, teleports, resistances, action economy, stabilization, …)
    // out of the metadata-only bucket: 210 → 268; the S2 rollout then moved
    // 17 reviewed small deterministic-clause spells into typed mechanics, the
    // S1 rollout moved 14 summoning/control spells, S3a moved Alarm, Magic
    // Mouth, and Contingency, and S3b moved Private Sanctum and Tiny Hut.
    // S3c moved Gate, Demiplane, and Passwall into typed mechanics.
    expect(spells.spellsWithDeterministicEffects).toBe(307);
    expect(spells.metadataOnlySpells).toBe(
      ACCEPTED_METADATA_ONLY_SPELLS.length,
    );
    // The metadata-only bucket carries an explicit accepted disposition.
    const disposition = report.dispositions.find(
      (entry) => entry.kind === 'spell' && entry.bucket === 'metadata-only',
    );
    expect(disposition?.status).toBe('accepted-prose-only');
  });

  it('surfaces the exact unresolved source ambiguities in gameplay readiness', () => {
    const report = buildGameplayReadinessReport(getBundledDnd5eSrdPack(), []);
    expect(report.sourceAmbiguities.total).toBe(2);
    expect(
      report.sourceAmbiguities.entries.map(({ recordKey, ambiguity }) => ({
        recordKey,
        id: ambiguity.id,
        canonicalResolution: ambiguity.canonicalResolution,
        interpretationIds: ambiguity.interpretations.map(({ id }) => id),
        disposition: ambiguity.runtimeDisposition,
      })),
    ).toEqual([
      {
        recordKey: 'spell:create-undead',
        id: 'ambiguity:create-undead-ghast-wight-composition',
        canonicalResolution: null,
        interpretationIds: ['homogeneous-alternative', 'mixed-within-total'],
        disposition: {
          status: 'engine-pending',
          owner: 'campaign-ruling',
        },
      },
      {
        recordKey: 'spell:find-familiar',
        id: 'ambiguity:find-familiar-permanent-dismissal-after-zero-hp',
        canonicalResolution: null,
        interpretationIds: ['presence-required', 'active-link-sufficient'],
        disposition: {
          status: 'engine-pending',
          owner: 'campaign-ruling',
        },
      },
    ]);
  });

  it('fails closed by MEMBERSHIP on unreviewed metadata-only spells (eshyra-o9bd.18.7.4 review)', () => {
    // Committed pack: membership matches exactly (no unreviewed, no stale).
    const report = buildGameplayReadinessReport(getBundledDnd5eSrdPack(), []);
    expect(
      report.dispositionErrors.filter((error) => error.startsWith('spell#')),
    ).toEqual([]);
    // A projection regression — a spell whose mechanics degrade to metadata
    // only — is an unreviewed key and fails the gate.
    const regressed = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'spell',
          key: 'spell:regressed',
          name: 'Regressed',
          data: {
            description: 'Deals damage the projection no longer captures.',
            mechanics: { concentration: false, spellAttack: false },
          },
        }),
      ]),
      [],
    );
    expect(
      regressed.dispositionErrors.filter((error) =>
        error.includes('not in the reviewed metadata-only membership'),
      ),
    ).toEqual([expect.stringContaining('spell:regressed')]);
  });

  it('projects a valid structured duration for all 319 committed spells (eshyra-o9bd.18.7.4 review)', () => {
    const spells = getBundledDnd5eSrdPack().records.filter(
      (record) => record.kind === 'spell',
    );
    expect(spells).toHaveLength(319);
    const kinds = ['instantaneous', 'timed', 'until-dispelled', 'special'];
    for (const spell of spells) {
      const mechanics = (
        spell.data as { mechanics?: { duration?: { kind?: string } } }
      ).mechanics;
      expect(
        kinds.includes(mechanics?.duration?.kind ?? ''),
        `${spell.key} must carry a structured mechanics.duration`,
      ).toBe(true);
    }
  });

  it('reports nested creature-entry mechanics coverage (eshyra-o9bd.18.7.3)', () => {
    const report = buildGameplayReadinessReport(getBundledDnd5eSrdPack(), []);
    const entries = report.creatureEntries;
    // Every trait/action/reaction/legendary entry is counted exactly once and
    // lands in exactly one bucket.
    expect(entries.totalEntries).toBeGreaterThan(1400);
    expect(
      entries.entriesWithMechanics +
        entries.mechanicalProse +
        entries.narrativeProse,
    ).toBe(entries.totalEntries);
    // Typed coverage is the dominant bucket, and residual mechanical prose is
    // bounded — a parser regression that silently drops nested projections
    // would blow past this ceiling.
    expect(entries.entriesWithMechanics).toBeGreaterThan(1200);
    expect(entries.mechanicalProse).toBeLessThan(80);
  });

  it('fails closed by MEMBERSHIP on unreviewed prose creature entries (eshyra-o9bd.18.7.3 review)', () => {
    // The committed pack's prose buckets match the reviewed allowlist
    // exactly (no unreviewed, no stale refs)…
    const report = buildGameplayReadinessReport(getBundledDnd5eSrdPack(), []);
    expect(
      report.dispositionErrors.filter((error) =>
        error.startsWith('creature-entry#'),
      ),
    ).toEqual([]);
    // …and a projection regression — an entry with mechanical prose that is
    // NOT in the reviewed membership — is an error, even though the bucket
    // itself has an accepted disposition.
    const regressed = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'creature',
          key: 'creature:regressed',
          name: 'Regressed',
          data: {
            challengeRating: '1',
            traits: [
              {
                name: 'Newly Unmodeled',
                text: 'The creature has advantage on Wisdom (Perception) checks and deals 2d6 fire damage.',
              },
            ],
          },
        }),
      ]),
      [],
    );
    expect(
      regressed.dispositionErrors.filter(
        (error) =>
          error.includes('creature-entry#mechanical-prose') &&
          error.includes('no reviewed disposition'),
      ),
    ).toEqual([
      expect.stringContaining('creature:regressed#traits:Newly Unmodeled'),
    ]);
    expect(() => assertGameplayReadinessDispositions(regressed)).toThrow(
      /no reviewed disposition/,
    );
  });

  it('fails closed by per-ref MEMBERSHIP for an unreviewed narrative-prose entry', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'creature',
          key: 'creature:narrative-regressed',
          name: 'Narrative Regressed',
          data: {
            traits: [
              {
                name: 'Unreviewed Narrative',
                text: 'The creature is known for its distinctive silhouette.',
              },
            ],
          },
        }),
      ]),
      [],
    );

    expect(
      report.dispositions.find(
        (disposition) =>
          disposition.kind === 'creature-entry' &&
          disposition.bucket === 'narrative-prose',
      )?.status,
    ).toBe('reviewed-per-ref');
    expect(report.dispositionErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'creature:narrative-regressed#traits:Unreviewed Narrative has no reviewed disposition in CREATURE_ENTRY_REVIEWED_DISPOSITIONS',
        ),
      ]),
    );
    expect(() => assertGameplayReadinessDispositions(report)).toThrow(
      /has no reviewed disposition in CREATURE_ENTRY_REVIEWED_DISPOSITIONS/,
    );
  });
});

describe('D&D SRD audit bundle overlay-vs-pack parity report (eshyra-jk4d)', () => {
  it('does not flag a prepared-caster class whose pack data matches the overlay, including preparationFormula', () => {
    const report = buildOverlayParityReport(
      pack([
        record({
          kind: 'class',
          key: 'class:cleric',
          name: 'Cleric',
          data: {
            spellcastingAbility: 'wisdom',
            spellPreparation: {
              kind: 'prepared',
              preparationFormula: {
                ability: 'wisdom',
                classLevelDivisor: 1,
                minimum: 1,
              },
              sourceText:
                'You prepare the list of cleric spells that are available for you to cast, choosing from the cleric spell list. When you do so, choose a number of cleric spells equal to your Wisdom modifier + your cleric level (minimum of one spell). Wisdom is your spellcasting ability for your cleric spells.',
            },
          },
        }),
      ]),
    );

    expect(report.summary.mismatchedFacts).toBe(0);
    expect(
      report.checks.filter(
        (check) =>
          check.key === 'class:cleric' && check.field === 'spellPreparation',
      ),
    ).toEqual([
      expect.objectContaining({ key: 'class:cleric', status: 'match' }),
    ]);
  });

  it('still flags a genuine spellPreparation mismatch (e.g. wrong preparationFormula divisor)', () => {
    const report = buildOverlayParityReport(
      pack([
        record({
          kind: 'class',
          key: 'class:cleric',
          name: 'Cleric',
          data: {
            spellcastingAbility: 'wisdom',
            spellPreparation: {
              kind: 'prepared',
              preparationFormula: {
                ability: 'wisdom',
                classLevelDivisor: 2,
                minimum: 1,
              },
              sourceText:
                'You prepare the list of cleric spells that are available for you to cast, choosing from the cleric spell list. When you do so, choose a number of cleric spells equal to your Wisdom modifier + your cleric level (minimum of one spell). Wisdom is your spellcasting ability for your cleric spells.',
            },
          },
        }),
      ]),
    );

    expect(report.summary.mismatchedFacts).toBe(1);
    expect(
      report.checks.find(
        (check) =>
          check.key === 'class:cleric' && check.field === 'spellPreparation',
      ),
    ).toMatchObject({ status: 'mismatch' });
  });
});

describe('gameplay-readiness dispositions (eshyra-o9bd.18.9.6)', () => {
  it('is fail-closed on a not-yet-modeled bucket without a policy entry', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'deity',
          key: 'deity:prose-only',
          name: 'Prose Only',
          data: { description: 'A deity described only in prose.' },
        }),
      ]),
      [],
    );

    // Fixture packs also leave the committed-pack policy entries stale;
    // only the uncovered-bucket error matters here.
    expect(
      report.dispositionErrors.filter((error) =>
        error.startsWith('deity#prose-only'),
      ),
    ).toEqual([expect.stringContaining('no reviewed disposition')]);
    expect(() => assertGameplayReadinessDispositions(report)).toThrow(
      /deity#prose-only/,
    );
  });

  it('does not count trigger-only creature-entry markers as modeled', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'creature',
          key: 'creature:trigger-only',
          name: 'Trigger Only',
          data: {
            traits: [
              {
                name: 'Incomplete Trigger',
                text: 'When the creature is hit, it deals 2d6 fire damage.',
                mechanics: {
                  effects: [{ kind: 'triggeredEffect', trigger: 'When hit' }],
                },
              },
            ],
          },
        }),
      ]),
      [],
    );

    expect(report.creatureEntries).toMatchObject({
      totalEntries: 1,
      entriesWithMechanics: 0,
      mechanicalProse: 1,
      narrativeProse: 0,
    });
    expect(
      report.dispositionErrors.filter(
        (error) =>
          error.includes('creature-entry#mechanical-prose') &&
          error.includes('no reviewed disposition'),
      ),
    ).toEqual([
      expect.stringContaining(
        'creature:trigger-only#traits:Incomplete Trigger',
      ),
    ]);
  });

  it('pins CREATURE_ENTRY_REVIEWED_DISPOSITIONS after the final C4 rollout (2 accepted = 2)', () => {
    // This is a hard pin, not a derived recomputation: it exists so that a
    // future change to the registry (an addition, removal, or silent
    // reclassification) is caught here and forces an update to the
    // classification doc's own reconciliation arithmetic
    // (docs/audits/dnd5e-srd-5.1-final/
    // 2026-07-06-o9bd-18-7-9-membership-classification.md §1/§3), rather
    // than only being caught by the coarser bucket-level fail-closed check.
    //
    // The critical invariant this test guards: exactly the 2 genuinely
    // accepted refs carry `accepted-prose-only`; modeled refs must graduate
    // from this registry, and any future finding must carry explicit
    // bead/slice metadata.
    const entries = Object.entries(CREATURE_ENTRY_REVIEWED_DISPOSITIONS);
    expect(entries).toHaveLength(2);

    const accepted = entries.filter(
      ([, d]) => d.status === 'accepted-prose-only',
    );
    const findings = entries.filter(([, d]) => d.status === 'finding');
    expect(accepted).toHaveLength(2);
    expect(findings).toHaveLength(0);
    expect(accepted.map(([ref]) => ref).sort()).toEqual([
      'creature:vampire#traits:Vampire Weaknesses',
      'creature:vampire-spawn#traits:Vampire Weaknesses',
    ]);

    // Every finding names the parent bead and an explicit slice — the
    // per-ref owner/slice metadata the fail-closed MEMBERSHIP check and the
    // human-readable report both rely on.
    for (const [ref, disposition] of findings) {
      expect(disposition.status).toBe('finding');
      if (disposition.status !== 'finding') continue;
      expect(disposition.bead).toBe('eshyra-o9bd.18.7.9');
      expect(disposition.slice).toMatch(/^C[1-9]$/);
      expect(disposition.reason.length, ref).toBeGreaterThan(0);
    }

    const findingsBySlice: Record<string, number> = {};
    for (const [, disposition] of findings) {
      if (disposition.status !== 'finding') continue;
      findingsBySlice[disposition.slice] =
        (findingsBySlice[disposition.slice] ?? 0) + 1;
    }
    expect(findingsBySlice).toEqual({});

    // The six refs implemented in the §1.6.1 reconciliation pass (existing
    // typed kinds: rejuvenation, extraDamage, movementRestriction) must have
    // graduated out of the registry entirely.
    const allRefs = entries.map(([ref]) => ref);
    expect(allRefs).not.toEqual(
      expect.arrayContaining([
        'creature:guardian-naga#traits:Rejuvenation',
        'creature:spirit-naga#traits:Rejuvenation',
        'creature:lich#traits:Rejuvenation',
        'creature:bugbear#traits:Surprise Attack',
        'creature:doppelganger#traits:Surprise Attack',
        'creature:water-elemental#traits:Freeze',
        'creature:homunculus#traits:Telepathic Bond',
        'creature:otyugh#traits:Limited Telepathy',
        'creature:pseudodragon#traits:Limited Telepathy',
        'creature:sahuagin#traits:Shark Telepathy',
        'creature:dryad#traits:Speak with Beasts and Plants',
        'creature:aboleth#traits:Probing Telepathy',
        'creature:invisible-stalker#traits:Faultless Tracker',
        'creature:minotaur#traits:Labyrinthine Recall',
        'creature:hydra#traits:Wakeful',
        'creature:ettin#traits:Wakeful',
        'creature:animated-armor#traits:False Appearance',
        'creature:awakened-shrub#traits:False Appearance',
        'creature:awakened-tree#traits:False Appearance',
        'creature:cloaker#traits:False Appearance',
        'creature:darkmantle#traits:False Appearance',
        'creature:flying-sword#traits:False Appearance',
        'creature:gargoyle#traits:False Appearance',
        'creature:gray-ooze#traits:False Appearance',
        'creature:ice-mephit#traits:False Appearance',
        'creature:magma-mephit#traits:False Appearance',
        'creature:mimic#traits:False Appearance (Object Form Only)',
        'creature:roper#traits:False Appearance',
        'creature:rug-of-smothering#traits:False Appearance',
        'creature:shrieker#traits:False Appearance',
        'creature:treant#traits:False Appearance',
        'creature:violet-fungus#traits:False Appearance',
        'creature:adult-bronze-dragon#actions:Change Shape',
        'creature:adult-gold-dragon#actions:Change Shape',
        'creature:adult-silver-dragon#actions:Change Shape',
        'creature:ancient-brass-dragon#actions:Change Shape',
        'creature:ancient-bronze-dragon#actions:Change Shape',
        'creature:ancient-copper-dragon#actions:Change Shape',
        'creature:ancient-gold-dragon#actions:Change Shape',
        'creature:ancient-silver-dragon#actions:Change Shape',
        'creature:couatl#actions:Change Shape',
        'creature:deva#actions:Change Shape',
        'creature:night-hag#actions:Change Shape',
        'creature:oni#actions:Change Shape',
        'creature:doppelganger#traits:Shapechanger',
        'creature:imp#traits:Shapechanger',
        'creature:quasit#traits:Shapechanger',
        'creature:mimic#traits:Shapechanger',
        'creature:succubus-incubus#traits:Shapechanger',
        'creature:werebear#traits:Shapechanger',
        'creature:wereboar#traits:Shapechanger',
        'creature:wererat#traits:Shapechanger',
        'creature:weretiger#traits:Shapechanger',
        'creature:werewolf#traits:Shapechanger',
        'creature:clay-golem#traits:Berserk',
        'creature:flesh-golem#traits:Berserk',
        'creature:giant-hyena#traits:Rampage',
        'creature:gnoll#traits:Rampage',
        'creature:shrieker#reactions:Shriek',
        'creature:djinni#traits:Elemental Demise',
        'creature:efreeti#traits:Elemental Demise',
        'creature:shield-guardian#reactions:Shield',
      ]),
    );
    // The two C4 refs have graduated from the registry because their typed
    // projections are now present in the committed pack.
    expect(allRefs).not.toEqual(
      expect.arrayContaining([
        'creature:berserker#traits:Reckless',
        'creature:minotaur#traits:Reckless',
      ]),
    );
  });

  it('does not require dispositions for modeled records', () => {
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'deity',
          key: 'deity:modeled',
          name: 'Modeled',
          data: {
            description: 'Prose plus a mechanics projection.',
            mechanics: { effects: [] },
          },
        }),
      ]),
      [],
    );

    const deityErrors = report.dispositionErrors.filter((error) =>
      error.startsWith('deity#'),
    );
    expect(deityErrors).toEqual([]);
  });

  it('categorizes every committed-pack bucket via the reviewed policy and passes fail-closed', () => {
    const report = buildGameplayReadinessReport(getBundledDnd5eSrdPack(), []);

    expect(report.dispositionErrors).toEqual([]);
    expect(() => assertGameplayReadinessDispositions(report)).not.toThrow();
    // Every disposition is one of the reviewed categories, and every
    // finding is linked to a bead so a future audit cannot rediscover the
    // bucket without a tracked closure decision.
    for (const disposition of report.dispositions) {
      expect([
        'accepted-prose-only',
        'unsupported',
        'finding',
        'reviewed-per-ref',
      ]).toContain(disposition.status);
      if (disposition.status === 'finding') {
        expect(disposition.bead).toMatch(/^eshyra-/);
      }
      expect(disposition.count).toBeGreaterThan(0);
      expect(disposition.reason.length).toBeGreaterThan(0);
    }
    // The broad buckets the 2026-07-01 review flagged are all present and
    // linked to their modeling beads.
    const byKey = new Map(
      report.dispositions.map((d) => [`${d.kind}#${d.bucket}`, d]),
    );
    expect(byKey.get('magic-item#prose-only')?.bead).toBe('eshyra-o9bd.18.7.7');
    expect(byKey.get('rule#prose-only')?.bead).toBe('eshyra-o9bd.18.7.8');
    expect(byKey.get('equipment#prose-only')?.bead).toBe('eshyra-o9bd.18.7.6');
    // Feature runtime projections landed (eshyra-o9bd.18.7.5): the residual
    // prose-only bucket is a reviewed accepted closure, not an open finding.
    expect(byKey.get('feature#prose-only')?.status).toBe('accepted-prose-only');
    // All 317 creatures carry typed nested mechanics; only the narrative
    // bucket remains for the two permanent Vampire Weaknesses headers.
    expect(byKey.get('creature#partial-structure')).toBeUndefined();
    expect(byKey.get('creature-entry#mechanical-prose')).toBeUndefined();
    expect(byKey.get('creature-entry#narrative-prose')?.status).toBe(
      'reviewed-per-ref',
    );
    // The per-ref breakdown is exact: 2 permanent accepts and no findings.
    expect(report.creatureEntries.reviewedDispositions).toEqual({
      acceptedProseOnly: 2,
      pendingFindings: 0,
      findingsBySlice: {},
    });
  });

  it('fails closed by MEMBERSHIP on unreviewed accepted-prose feature records (eshyra-o9bd.18.7.5 review)', () => {
    // Committed pack: the feature bucket memberships match exactly.
    const committed = buildGameplayReadinessReport(
      getBundledDnd5eSrdPack(),
      [],
    );
    expect(
      committed.dispositionErrors.filter((error) =>
        error.startsWith('feature#'),
      ),
    ).toEqual([]);
    // A modeling regression — a feature record that newly carries neither
    // choices nor mechanics — is NOT blessed by the blanket accepted
    // disposition; it must be explicitly reviewed into the membership.
    const regressed = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'feature',
          key: 'feature:test:regressed',
          name: 'Regressed',
          data: {
            source: 'class:test',
            level: 1,
            description: 'A feature whose projection regressed to prose.',
          },
        }),
      ]),
      [],
    );
    expect(
      regressed.dispositionErrors.filter((error) =>
        error.includes('not in the reviewed accepted-prose membership'),
      ),
    ).toEqual([expect.stringContaining('feature:test:regressed')]);
  });

  it('reports a stale policy entry when its bucket is empty', () => {
    // The full policy names magic-item#prose-only (among others); a pack
    // with no magic items leaves those entries stale, which must fail.
    const report = buildGameplayReadinessReport(
      pack([
        record({
          kind: 'creature',
          key: 'creature:with-traits',
          name: 'With Traits',
          data: {
            traits: [{ name: 'Amphibious', text: 'Breathes air and water.' }],
          },
        }),
      ]),
      [],
    );

    expect(report.dispositionErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('stale disposition')]),
    );
    expect(() => assertGameplayReadinessDispositions(report)).toThrow(
      /stale disposition/,
    );
  });
});
