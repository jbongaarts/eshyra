import type {
  CampaignRulesPackResolver,
  Db,
  RulesPack,
  RulesRecord,
} from '../../../src/internal.js';
import {
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

export function installLateAmbiguityAddon(
  db: Db,
  at: string,
): CampaignRulesPackResolver {
  const base = getBundledDnd5eSrdPack();
  const template = base.records.find((record) => record.kind === 'feature');
  if (template === undefined) throw new Error('missing template feature');

  const root: RulesRecord = {
    ...structuredClone(template),
    key: LATE_AMBIGUITY_ROOT_KEY,
    name: 'Test Late Ambiguity Root',
  };
  // `data.source` is a typed link field the expansion stage traverses, so the
  // root reaches the ambiguity-carrying record in exactly one hop.
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

  return (binding) =>
    binding.packId === addon.meta.packId
      ? addon
      : binding.packId === base.meta.packId
        ? base
        : undefined;
}
