import type {
  CampaignRulesPackResolver,
  Db,
  RecordRelationshipManifestSource,
  RulesPack,
  RulesRecord,
} from '../../../src/internal.js';
import {
  buildRecordRelationshipManifest,
  bundledDnd5eSrdRecordRelationshipManifestSource,
  getBundledDnd5eSrdPack,
  writeCampaignRulesBinding,
} from '../../../src/internal.js';

/**
 * A synthetic record whose typed edge reaches a record carrying a real
 * `RulesAmbiguity`.
 *
 * No record in the generated SRD pack typed-links TO an ambiguity-carrying
 * record — verified by scanning every typed link field against the three
 * records that declare `mechanics.ambiguities` — so the corpus cannot exercise
 * an ambiguity first discovered during the second expansion pass. This add-on
 * supplies that case, as design section 12.1's evidence requires and as
 * the review permits. It asserts nothing about the real SRD corpus, and the
 * ambiguity it reaches is the genuine Cube of Force one.
 */
export const LATE_AMBIGUITY_PACK_ID = 'rules:test-late-ambiguity-addon';
export const LATE_AMBIGUITY_VERSION = '1.0.0';
export const LATE_AMBIGUITY_ROOT_KEY = 'feature:test-late-ambiguity-root';
export const LATE_AMBIGUITY_TARGET_KEY = 'magic-item:cube-of-force';
export const LATE_AMBIGUITY_ID =
  'ambiguity:cube-of-force-same-face-duration-reset';

export interface LateAmbiguityAddonInstall {
  readonly resolver: CampaignRulesPackResolver;
  /**
   * Governs the SRD base pack under its own bundled semantics and this
   * add-on under its OWN, separately declared manifest (eshyra-jgxl F1
   * evidence (c): "an add-on carrying its own differing manifest resolves
   * under its own semantics"). `runDiscoveryStages` no longer applies the
   * bundled SRD manifest to every producer in the stack regardless of which
   * pack actually emitted a record, so this add-on's synthetic `feature`
   * record needs its OWN declaration for `/source` to keep traversing —
   * inheriting the SRD's would be exactly the cross-producer laundering F1
   * closed. Pass this as `DiscoveryRunInput.relationshipManifestSource`.
   */
  readonly relationshipManifestSource: RecordRelationshipManifestSource;
}

export function installLateAmbiguityAddon(
  db: Db,
  at: string,
): LateAmbiguityAddonInstall {
  const base = getBundledDnd5eSrdPack();
  const template = base.records.find((record) => record.kind === 'feature');
  if (template === undefined) throw new Error('missing template feature');

  const root: RulesRecord = {
    ...structuredClone(template),
    key: LATE_AMBIGUITY_ROOT_KEY,
    name: 'Test Late Ambiguity Root',
  };
  // `data.source` is a typed link field the expansion stage traverses under
  // THIS add-on's own manifest (below), so the root reaches the
  // ambiguity-carrying record in exactly one hop.
  (root as { data: unknown }).data = {
    source: LATE_AMBIGUITY_TARGET_KEY,
    level: 1,
    description: 'Synthetic root whose typed edge reaches a real ambiguity.',
  };

  const addon: RulesPack = {
    meta: {
      ...base.meta,
      packId: LATE_AMBIGUITY_PACK_ID,
      title: 'Test late-ambiguity add-on',
      description: 'Supplies a typed edge into an ambiguity-carrying record.',
      role: 'addon',
      version: LATE_AMBIGUITY_VERSION,
      order: 1,
      compatibleBaseSystems: [
        { systemId: base.meta.systemId, versions: [base.meta.version] },
      ],
    },
    records: [root],
  };

  writeCampaignRulesBinding(db, {
    base: {
      systemId: base.meta.systemId,
      packId: base.meta.packId,
      version: base.meta.version,
    },
    addons: [
      {
        systemId: addon.meta.systemId,
        packId: addon.meta.packId,
        version: addon.meta.version,
      },
    ],
    resolvedAt: at,
  });

  // This add-on's OWN declaration for its synthetic `feature`'s `/source`
  // field — deliberately identical in effect to the SRD's `(feature,
  // /source)` declaration, but a SEPARATE manifest object the add-on's own
  // producer identity governs. Proving F1 evidence (c) does not require this
  // fixture to differ in outcome from the SRD's declaration, only that it
  // resolves under its OWN producer's association rather than inheriting or
  // losing the SRD's.
  const addonManifest = buildRecordRelationshipManifest([
    {
      kind: 'feature',
      pointerPrefix: '/source',
      linkField: 'data.source',
      disposition: 'reference',
      relation: 'granted-by',
      targetResolution: 'record-key',
      reason:
        'Test fixture (eshyra-jgxl F1 evidence c): this add-on declares its ' +
        'own semantics for its synthetic feature, proving an add-on with its ' +
        'own manifest resolves under its own semantics rather than ' +
        "inheriting the SRD base pack's.",
    },
  ]);
  const bundledSource = bundledDnd5eSrdRecordRelationshipManifestSource();

  return {
    resolver: (binding) =>
      binding.packId === addon.meta.packId
        ? addon
        : binding.packId === base.meta.packId
          ? base
          : undefined,
    relationshipManifestSource: (pack) =>
      pack === addon ? addonManifest : bundledSource(pack),
  };
}
