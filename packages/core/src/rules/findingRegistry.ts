import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type FindingStatus =
  | 'accepted'
  | 'rejected'
  | 'narrowed'
  | 'ambiguous'
  | 'disclosed-dependency';

export type MembershipStatus = 'derived' | 'underived';

/**
 * This local copy intentionally mirrors the bootstrap capability ledger's
 * small identity shape.  The ledger lives on a different PR; importing it
 * would make this registry branch-dependent rather than mechanically
 * joinable at the serialized boundary.
 */
export type EngineCapabilityId =
  `engine:F${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`;

export interface CapabilityHookSelector {
  engine: string;
  name: string;
}

export interface CapabilityIdentity {
  capabilityId: EngineCapabilityId;
  primitive: string;
  hookSelector?: CapabilityHookSelector;
  owningBead: string;
}

export type EvidenceKind =
  | 'source-span'
  | 'authoritative-input'
  | 'audit-finding'
  | 'code'
  | 'bead'
  | 'known-missing-source-clause';

export type TargetKind =
  | 'record'
  | 'clause'
  | 'field'
  | 'path'
  | 'relationship'
  | 'capability';

export type MembershipGenerator =
  | 'audited-singleton'
  | 'audited-exact-set'
  | 'pack-record-kind'
  | 'pack-half-damage-branches'
  | 'pack-readiness-clauses'
  | 'pack-engine-pending-clauses'
  | 'audited-artifact-set';

const executableMembershipGenerators = new Set<MembershipGenerator>([
  'pack-record-kind',
  'pack-half-damage-branches',
  'pack-readiness-clauses',
  'pack-engine-pending-clauses',
]);

export interface MembershipIdentity {
  recordKey?: string;
  clauseId?: string;
  path?: string;
  artifactPath?: string;
  jsonPath?: string;
  sourceSpan?: string;
  capability?: CapabilityIdentity;
}

export interface ExactSelector {
  members: MembershipIdentity[];
  capabilityCatalog?: CapabilityIdentity[];
}

export interface FindingRow {
  canonicalId: string;
  aliases: string[];
  title: string;
  status: FindingStatus;
  membershipStatus: MembershipStatus;
  underivedReason?: string;
  owningDerivationBead?: string;
  statusReasoning?: string;
  obligation: {
    obligationId: string;
    evidenceKind: EvidenceKind;
    authority: string;
  };
  target: {
    kind: TargetKind;
    selector: ExactSelector;
  };
  invariant: string;
  violation: {
    queryId: MembershipQueryName;
    expectedAfterRepair: 'empty' | 'stable';
  };
  baselineMembership: {
    capturedAtCommit: string;
    members: MembershipIdentity[];
  };
  membershipDerivation: {
    generator: MembershipGenerator;
    sourceScope: string;
    authority: string;
    currentMatch: 'required' | 'may-be-missing-until-repair';
  };
  owningBead: string;
  regression: {
    evidenceKind: EvidenceKind;
    locator: string;
  };
  clusterJustification?: string;
  sharedQueryJustification?: string;
}

export interface FindingRegistry {
  version: 1;
  rows: FindingRow[];
}

export interface PackRecord {
  key?: unknown;
  kind?: unknown;
  data?: unknown;
  source?: unknown;
  provenance?: unknown;
}

const canonicalQueryIds = [
  'source-authority-opus-f19',
  'source-authority-opus-f20',
  'source-authority-sol-cap-008',
  'source-authority-fable-f1',
  'source-authority-fable-f5',
  'source-authority-fable-f7',
  'language-universe-policy',
  'locator-completeness',
  'ambiguous-coverage',
  'rock-gnome-boundary',
  'equipment-report',
  'spellcasting-granularity',
  'vehicle-tool-row',
  'wererat-crossbow',
  'source-provenance-fields',
  'container-continuation',
  'advancement-qualifiers',
  'proficiency-grants',
  'choice-identifiers',
  'madness-durations',
  'damage-field-shape',
  'equipment-taxonomy',
  'table-empty-cells',
  'display-name-qualification',
  'canonical-discovery',
  'rule-key-duplication',
  'audit-readiness-gate',
  'rule-corpus-procedures',
  'phantom-feature-resources',
  'damage-alternatives',
  'choice-behavior',
  'pit-variants',
  'invocation-effects',
  'bulette-alternative',
  'targeting-qualifiers',
  'option-losses',
  'class-feature-completeness',
  'indomitable-scaling',
  'arcane-recovery-reset',
  'natural-recovery-reset',
  'ki-abilities',
  'divine-sense-uses',
  'condition-structure-no-regression',
  'rules-prose-readiness',
  'ancestry-omissions',
  'background-equipment',
  'hazard-and-healing-potion',
  'spell-completeness',
  'point-origin-areas',
  'magic-missile-projectiles',
  'spell-mechanics-depth',
  'animal-friendship-authority',
  'creature-completeness',
  'half-damage-branches',
  'legendary-economy',
  'druid-dryad-attacks',
  'unicode-minus-damage',
  'ranged-notation',
  'multi-save-entries',
  'creature-statblock-mechanics',
  'creature-ongoing-riders',
  'hazard-completeness',
  'hazard-success-branches',
  'sphere-prose',
  'magic-item-effects',
  'readiness-integrity',
  'engine-capability-ownership',
  'readiness-artifacts',
] as const;

export const MEMBERSHIP_QUERY_NAMES = canonicalQueryIds.map(
  (id) => `finding:${id}`,
);

export type MembershipQueryName =
  `finding:${(typeof canonicalQueryIds)[number]}`;

type Obj = Record<string, unknown>;

const ENGINE_FAMILY_OWNERS: Readonly<Record<EngineCapabilityId, string>> = {
  'engine:F1': 'eshyra-o9bd.19.5.2',
  'engine:F2': 'eshyra-o9bd.19.5.3',
  'engine:F3': 'eshyra-o9bd.19.5.4',
  'engine:F4': 'eshyra-o9bd.19.5.5',
  'engine:F5': 'eshyra-o9bd.19.5.6',
  'engine:F6': 'eshyra-o9bd.19.5.7',
  'engine:F7': 'eshyra-o9bd.19.5.8',
  'engine:F8': 'eshyra-o9bd.19.5.9',
  'engine:F9': 'eshyra-o9bd.19.5.10',
  'engine:F10': 'eshyra-o9bd.19.5.11',
};

/** The 31 primitive spellings used by the bootstrap ledger. */
const CANONICAL_ENGINE_PRIMITIVES = [
  ['engine:F1', 'condition-and-eligibility-relations'],
  ['engine:F1', 'seeded-selection-and-roll-replacement'],
  ['engine:F2', 'turn-action-and-free-interaction-budget'],
  ['engine:F2', 'reaction-and-item-activation-ownership'],
  ['engine:F2', 'legendary-action-allowance-and-option-cost'],
  ['engine:F3', 'concentration-owner-and-damage-save'],
  ['engine:F3', 'active-effect-duration-and-termination'],
  ['engine:F3', 'owned-entity-and-repeat-trigger-lifecycle'],
  ['engine:F4', 'caster-of-record-and-canonical-spell-execution'],
  ['engine:F4', 'spell-slot-gate-and-upcast-transform'],
  ['engine:F4', 'spellbook-copy-cost-and-asset-ledger'],
  ['engine:F5', 'per-instance-usage-and-charge-spend'],
  ['engine:F5', 'recharge-and-reset-scheduling'],
  ['engine:F5', 'attunement-curse-and-identity-constraints'],
  ['engine:F5', 'containment-portal-and-card-pool-instance-state'],
  ['engine:F6', 'hp-healing-and-temporary-buffer'],
  ['engine:F6', 'death-save-dying-and-stable-transitions'],
  ['engine:F6', 'suffocation-and-ongoing-damage-state'],
  ['engine:F7', 'short-rest-hit-dice-recovery'],
  ['engine:F7', 'long-rest-reset-orchestration'],
  ['engine:F7', 'planar-return-and-declared-window-clocks'],
  ['engine:F8', 'save-dc-and-spell-attack-modifier-resolution'],
  ['engine:F8', 'multi-save-and-ability-choice-outcomes'],
  ['engine:F8', 'derived-attack-ac-and-proficiency-modifiers'],
  ['engine:F9', 'point-origin-area-geometry-and-targeting'],
  ['engine:F9', 'damage-rider-and-half-damage-branch-resolution'],
  ['engine:F9', 'forced-movement-contest-and-object-interaction'],
  ['engine:F9', 'capacity-and-variant-arithmetic'],
  ['engine:F10', 'canonical-currency-mutation'],
  ['engine:F10', 'downtime-study-expense-and-training-ledger'],
  ['engine:F10', 'retained-inventory-property-xp-asset-creation'],
] as const;

const CANONICAL_PRIMITIVES_BY_ENGINE = new Map<
  EngineCapabilityId,
  ReadonlySet<string>
>(
  Array.from(
    new Set(CANONICAL_ENGINE_PRIMITIVES.map(([engine]) => engine)),
    (engine) => [
      engine,
      new Set(
        CANONICAL_ENGINE_PRIMITIVES.filter(
          ([candidate]) => candidate === engine,
        ).map(([, primitive]) => primitive),
      ),
    ],
  ),
);

function engineCapabilityId(engine: string, path: string): EngineCapabilityId {
  const capabilityId = `engine:${engine}`;
  if (!(capabilityId in ENGINE_FAMILY_OWNERS)) {
    throw new Error(`${path} must use engine:F1..engine:F10`);
  }
  return capabilityId as EngineCapabilityId;
}

function primitiveForHook(
  capabilityId: EngineCapabilityId,
  hook: string,
): string {
  const lower = hook.toLowerCase();
  const canonicalHookPrimitive = new Map<string, string>([
    [
      'engine:F3\0active effect duration and termination',
      'active-effect-duration-and-termination',
    ],
    [
      'engine:F5\0per-item storage, charge, and reset state',
      'per-instance-usage-and-charge-spend',
    ],
    [
      'engine:F6\0hit-point and condition mutation',
      'death-save-dying-and-stable-transitions',
    ],
    [
      'engine:F9\0geometry, targeting, movement, and contest resolution',
      'forced-movement-contest-and-object-interaction',
    ],
  ]);
  const exactPrimitive = canonicalHookPrimitive.get(`${capabilityId}\0${hook}`);
  if (exactPrimitive !== undefined) return exactPrimitive;
  const primitive = (() => {
    switch (capabilityId) {
      case 'engine:F1':
        return lower.includes('seeded')
          ? 'seeded-selection-and-roll-replacement'
          : 'condition-and-eligibility-relations';
      case 'engine:F2':
        return /reaction|item activation/.test(lower)
          ? 'reaction-and-item-activation-ownership'
          : 'turn-action-and-free-interaction-budget';
      case 'engine:F3':
        return lower.includes('concentration')
          ? 'concentration-owner-and-damage-save'
          : 'owned-entity-and-repeat-trigger-lifecycle';
      case 'engine:F4':
        if (lower.includes('wizard spellbook'))
          return 'spellbook-copy-cost-and-asset-ledger';
        if (lower.includes('slot'))
          return 'spell-slot-gate-and-upcast-transform';
        return 'caster-of-record-and-canonical-spell-execution';
      case 'engine:F5':
        if (/containment|portal|card-pool/.test(lower))
          return 'containment-portal-and-card-pool-instance-state';
        if (/attunement|curse/.test(lower))
          return 'attunement-curse-and-identity-constraints';
        if (/reset|recharge|cooldown|dawn|usage/.test(lower))
          return 'recharge-and-reset-scheduling';
        return 'per-instance-usage-and-charge-spend';
      case 'engine:F6':
        if (lower.includes('suffocation'))
          return 'suffocation-and-ongoing-damage-state';
        if (/death|dying|stable/.test(lower))
          return 'death-save-dying-and-stable-transitions';
        return 'hp-healing-and-temporary-buffer';
      case 'engine:F7':
        if (lower.includes('short-rest')) return 'short-rest-hit-dice-recovery';
        if (/planar|deadline|declared-draw/.test(lower))
          return 'planar-return-and-declared-window-clocks';
        return 'long-rest-reset-orchestration';
      case 'engine:F8':
        if (/multi-save|ability-choice/.test(lower))
          return 'multi-save-and-ability-choice-outcomes';
        if (/save dc|spell attack/.test(lower))
          return 'save-dc-and-spell-attack-modifier-resolution';
        return 'derived-attack-ac-and-proficiency-modifiers';
      case 'engine:F9':
        if (/area|geometry/.test(lower))
          return 'point-origin-area-geometry-and-targeting';
        if (/damage|rider|resistance|vulnerability/.test(lower))
          return 'damage-rider-and-half-damage-branch-resolution';
        if (/capacity|quantity|coverage|volume|variant/.test(lower))
          return 'capacity-and-variant-arithmetic';
        return 'forced-movement-contest-and-object-interaction';
      case 'engine:F10':
        if (lower.includes('downtime'))
          return 'downtime-study-expense-and-training-ledger';
        if (lower.includes('asset'))
          return 'retained-inventory-property-xp-asset-creation';
        return 'canonical-currency-mutation';
    }
  })();
  if (!CANONICAL_PRIMITIVES_BY_ENGINE.get(capabilityId)?.has(primitive)) {
    throw new Error(`no canonical primitive for ${capabilityId}/${hook}`);
  }
  return primitive;
}
const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(
  here,
  '../../../../docs/audits/dnd5e-srd-5.1-final/finding-registry.json',
);
const recordsPath = join(
  here,
  '../../data/rules-packs/rules__dnd5e-srd-5.1/records.json',
);
const packDirectory = dirname(recordsPath);

let defaultRecords: PackRecord[] | undefined;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }
  return value.map((item, index) => requiredString(item, `${path}[${index}]`));
}

function hasForbiddenTotal(value: unknown, path = 'row'): void {
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:count|total|totalCount|storedCount|storedTotal)$/i.test(key)) {
      throw new Error(`${path}.${key} is a hand-copied total`);
    }
    hasForbiddenTotal(child, `${path}.${key}`);
  }
}

function evidenceKind(value: unknown, path: string): EvidenceKind {
  const kind = requiredString(value, path) as EvidenceKind;
  if (
    ![
      'source-span',
      'authoritative-input',
      'audit-finding',
      'code',
      'bead',
      'known-missing-source-clause',
    ].includes(kind)
  ) {
    throw new Error(`${path} is not a supported evidence kind`);
  }
  return kind;
}

function identityKey(identity: MembershipIdentity): string {
  return JSON.stringify(identity);
}

function parseCapabilityIdentity(
  value: unknown,
  path: string,
): CapabilityIdentity {
  if (!isObject(value)) throw new Error(`${path} must be an object`);
  const capabilityId = requiredString(
    value.capabilityId,
    `${path}.capabilityId`,
  );
  if (!(capabilityId in ENGINE_FAMILY_OWNERS)) {
    throw new Error(`${path}.capabilityId must use engine:F1..engine:F10`);
  }
  const typedCapabilityId = capabilityId as EngineCapabilityId;
  const primitive = requiredString(value.primitive, `${path}.primitive`);
  if (!CANONICAL_PRIMITIVES_BY_ENGINE.get(typedCapabilityId)?.has(primitive)) {
    throw new Error(
      `${path}.primitive is unknown for ${typedCapabilityId}: ${primitive}`,
    );
  }
  const hookValue = value.hookSelector;
  let hookSelector: CapabilityHookSelector | undefined;
  if (hookValue !== undefined) {
    if (!isObject(hookValue))
      throw new Error(`${path}.hookSelector must be an object`);
    const hookEngine = requiredString(
      hookValue.engine,
      `${path}.hookSelector.engine`,
    );
    const expectedEngine = typedCapabilityId.slice('engine:'.length);
    if (hookEngine !== expectedEngine) {
      throw new Error(
        `${path}.hookSelector.engine must match ${typedCapabilityId}`,
      );
    }
    hookSelector = {
      engine: hookEngine,
      name: requiredString(hookValue.name, `${path}.hookSelector.name`),
    };
    const hookPrimitive = primitiveForHook(
      typedCapabilityId,
      hookSelector.name,
    );
    if (hookPrimitive !== primitive) {
      throw new Error(
        `${path}.hookSelector is not relevant to primitive ${primitive}`,
      );
    }
  }
  const owningBead = requiredString(value.owningBead, `${path}.owningBead`);
  const expectedOwner = ENGINE_FAMILY_OWNERS[typedCapabilityId];
  if (owningBead !== expectedOwner) {
    throw new Error(
      `${path}.owningBead must be the ${typedCapabilityId} family epic ${expectedOwner}`,
    );
  }
  return {
    capabilityId: typedCapabilityId,
    primitive,
    ...(hookSelector === undefined ? {} : { hookSelector }),
    owningBead,
  };
}

function membershipGenerator(
  value: unknown,
  path: string,
): MembershipGenerator {
  const generator = requiredString(value, path) as MembershipGenerator;
  if (
    ![
      'audited-singleton',
      'audited-exact-set',
      'pack-record-kind',
      'pack-half-damage-branches',
      'pack-readiness-clauses',
      'pack-engine-pending-clauses',
      'audited-artifact-set',
    ].includes(generator)
  ) {
    throw new Error(`${path} is not a supported membership generator`);
  }
  return generator;
}

function parseIdentity(
  value: unknown,
  path: string,
  capabilityCatalog: readonly CapabilityIdentity[] = [],
): MembershipIdentity {
  if (typeof value === 'string') {
    const [kind, locus, nested, capabilityRef, extra] = value.split('|');
    if (kind === 'r' && locus !== undefined && nested === undefined)
      return parseIdentity({ recordKey: locus }, path);
    if (kind === 'c' && locus !== undefined && nested !== undefined)
      return parseIdentity({ recordKey: locus, clauseId: nested }, path);
    if (kind === 'p' && locus !== undefined && nested !== undefined)
      return parseIdentity({ recordKey: locus, path: nested }, path);
    if (kind === 'a' && locus !== undefined && nested !== undefined)
      return parseIdentity({ artifactPath: locus, jsonPath: nested }, path);
    if (
      kind === 'k' &&
      locus !== undefined &&
      nested !== undefined &&
      capabilityRef !== undefined &&
      extra === undefined
    ) {
      if (!/^\d+$/.test(capabilityRef)) {
        throw new Error(`${path} has an invalid capability catalog reference`);
      }
      const capability = capabilityCatalog[Number(capabilityRef)];
      if (capability === undefined) {
        throw new Error(
          `${path} references a missing capability catalog entry`,
        );
      }
      return parseIdentity(
        { recordKey: locus, clauseId: nested, capability },
        path,
        capabilityCatalog,
      );
    }
    throw new Error(`${path} is not a valid compact exact identity`);
  }
  if (!isObject(value)) throw new Error(`${path} must be an object`);
  const result: MembershipIdentity = {};
  for (const key of [
    'recordKey',
    'clauseId',
    'path',
    'artifactPath',
    'jsonPath',
    'sourceSpan',
  ] as const) {
    if (value[key] !== undefined)
      result[key] = requiredString(value[key], `${path}.${key}`);
  }
  for (const [key, selector] of Object.entries(result)) {
    if (key === 'capability') continue;
    if (key === 'sourceSpan') continue;
    if (typeof selector !== 'string') continue;
    if (
      /[?*~]/.test(selector) ||
      /(?:contains|substring|prefix|regex|startsWith)/i.test(selector)
    ) {
      throw new Error(
        `${path}.${key} must be an exact selector, not a search expression`,
      );
    }
  }
  if (
    result.path !== undefined &&
    !/^data(?:\.[A-Za-z_$][\w$-]*|\[\d+\])*$/.test(result.path)
  ) {
    throw new Error(`${path}.path must be a structured data path`);
  }
  if (
    result.jsonPath !== undefined &&
    !/^\$\.[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*$/.test(result.jsonPath)
  ) {
    throw new Error(`${path}.jsonPath must be a structured artifact path`);
  }
  if (
    result.artifactPath !== undefined &&
    (result.artifactPath.startsWith('/') || result.artifactPath.includes('..'))
  ) {
    throw new Error(
      `${path}.artifactPath must stay within the audited artifact root`,
    );
  }
  const locusCount = [
    result.recordKey !== undefined,
    result.artifactPath !== undefined,
  ].filter(Boolean).length;
  if (locusCount !== 1) {
    throw new Error(`${path} must identify exactly one record or artifact`);
  }
  if (result.clauseId !== undefined && result.recordKey === undefined) {
    throw new Error(`${path}.clauseId requires recordKey`);
  }
  if (result.path !== undefined && result.recordKey === undefined) {
    throw new Error(`${path}.path requires recordKey`);
  }
  if (result.jsonPath !== undefined && result.artifactPath === undefined) {
    throw new Error(`${path}.jsonPath requires artifactPath`);
  }
  if (
    result.recordKey === undefined &&
    result.clauseId === undefined &&
    result.path === undefined &&
    result.jsonPath === undefined
  ) {
    throw new Error(`${path} has no exact nested identity`);
  }
  if (value.capability !== undefined) {
    if (result.recordKey === undefined || result.clauseId === undefined) {
      throw new Error(`${path}.capability requires recordKey and clauseId`);
    }
    result.capability = parseCapabilityIdentity(
      value.capability,
      `${path}.capability`,
    );
  }
  return result;
}

function parseMembers(
  value: unknown,
  path: string,
  capabilityCatalog: readonly CapabilityIdentity[] = [],
): MembershipIdentity[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty exact identity array`);
  }
  const members = value.flatMap((item, index) => {
    if (typeof item === 'string') {
      const [kind, locus, nested, capabilityRefs, extra] = item.split('|');
      if (
        kind === 'k' &&
        locus !== undefined &&
        nested !== undefined &&
        capabilityRefs !== undefined &&
        extra === undefined &&
        capabilityRefs.includes(',')
      ) {
        return capabilityRefs
          .split(',')
          .map((capabilityRef) =>
            parseIdentity(
              [kind, locus, nested, capabilityRef].join('|'),
              `${path}[${index}]`,
              capabilityCatalog,
            ),
          );
      }
    }
    return [parseIdentity(item, `${path}[${index}]`, capabilityCatalog)];
  });
  const seen = new Set<string>();
  for (const member of members) {
    const key = identityKey(member);
    if (!seen.add(key))
      throw new Error(`${path} contains a duplicate identity`);
  }
  return members;
}

function parseRegistry(value: unknown): FindingRegistry {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.rows)) {
    throw new Error('finding registry must have version 1 and a rows array');
  }
  const rows = value.rows.map((raw, index): FindingRow => {
    const path = `rows[${index}]`;
    if (!isObject(raw)) throw new Error(`${path} must be an object`);
    hasForbiddenTotal(raw, path);
    const status = requiredString(
      raw.status,
      `${path}.status`,
    ) as FindingStatus;
    if (
      ![
        'accepted',
        'rejected',
        'narrowed',
        'ambiguous',
        'disclosed-dependency',
      ].includes(status)
    ) {
      throw new Error(`${path}.status is invalid`);
    }
    const membershipStatus = requiredString(
      raw.membershipStatus,
      `${path}.membershipStatus`,
    ) as MembershipStatus;
    if (membershipStatus !== 'derived' && membershipStatus !== 'underived') {
      throw new Error(`${path}.membershipStatus is invalid`);
    }
    const underivedReason =
      raw.underivedReason === undefined
        ? undefined
        : requiredString(raw.underivedReason, `${path}.underivedReason`);
    const owningDerivationBead =
      raw.owningDerivationBead === undefined
        ? undefined
        : requiredString(
            raw.owningDerivationBead,
            `${path}.owningDerivationBead`,
          );
    if (membershipStatus === 'underived') {
      if (underivedReason === undefined) {
        throw new Error(`${path}.underivedReason is required`);
      }
      if (owningDerivationBead !== 'eshyra-o9bd.19.1.7') {
        throw new Error(
          `${path}.owningDerivationBead must be eshyra-o9bd.19.1.7`,
        );
      }
    } else if (
      underivedReason !== undefined ||
      owningDerivationBead !== undefined
    ) {
      throw new Error(
        `${path}.underivedReason and owningDerivationBead are only valid for underived rows`,
      );
    }
    const aliases = stringArray(raw.aliases, `${path}.aliases`);
    for (const alias of aliases) {
      if (
        !/^(?:engine:F(?:[1-9]|10)|fable:F[1-8]|opus:(?:F-(?:0[1-9]|[12][0-9]|3[0-5])|residual-unverified-effects-semantics)|sol:CAP-(?:00[1-9]|0[1-9][0-9]|1[0-4])|indep:(?:00[1-9]|0[1-9][0-9]|01[0-2]))$/.test(
          alias,
        )
      ) {
        throw new Error(
          `${path}.aliases contains an unqualified alias: ${alias}`,
        );
      }
    }
    if (status !== 'accepted')
      requiredString(raw.statusReasoning, `${path}.statusReasoning`);
    const obligation = isObject(raw.obligation) ? raw.obligation : undefined;
    const obligationId = requiredString(
      obligation?.obligationId,
      `${path}.obligation.obligationId`,
    );
    if (!/^obl:::[^:]+::[^:]+::[^:]+$/.test(obligationId)) {
      throw new Error(
        `${path}.obligation.obligationId has an invalid shared identity`,
      );
    }
    const parsedEvidence = evidenceKind(
      obligation?.evidenceKind,
      `${path}.obligation.evidenceKind`,
    );
    const authority = requiredString(
      obligation?.authority,
      `${path}.obligation.authority`,
    );
    if (/^(?:pack|current-pack):/i.test(authority)) {
      throw new Error(
        `${path}.obligation.authority may not be the pack under repair`,
      );
    }
    const target = isObject(raw.target) ? raw.target : undefined;
    const targetKind = requiredString(
      target?.kind,
      `${path}.target.kind`,
    ) as TargetKind;
    if (
      ![
        'record',
        'clause',
        'field',
        'path',
        'relationship',
        'capability',
      ].includes(targetKind)
    ) {
      throw new Error(`${path}.target.kind is invalid`);
    }
    const selector = isObject(target?.selector) ? target.selector : undefined;
    const capabilityCatalog =
      targetKind === 'capability'
        ? (() => {
            if (
              !Array.isArray(selector?.capabilityCatalog) ||
              selector.capabilityCatalog.length === 0
            ) {
              throw new Error(
                `${path}.target.selector.capabilityCatalog must be non-empty`,
              );
            }
            const catalog = selector.capabilityCatalog.map((entry, index) =>
              parseCapabilityIdentity(
                entry,
                `${path}.target.selector.capabilityCatalog[${index}]`,
              ),
            );
            if (
              new Set(catalog.map((entry) => JSON.stringify(entry))).size !==
              catalog.length
            ) {
              throw new Error(
                `${path}.target.selector.capabilityCatalog contains duplicates`,
              );
            }
            return catalog;
          })()
        : undefined;
    const members = parseMembers(
      selector?.members,
      `${path}.target.selector.members`,
      capabilityCatalog,
    );
    const capabilityMembers = members.filter(
      (member) => member.capability !== undefined,
    );
    if (targetKind === 'capability') {
      if (capabilityMembers.length !== members.length) {
        throw new Error(
          `${path}.target.kind capability requires a qualified capability identity for every member`,
        );
      }
      if (
        capabilityMembers.some(
          (member) => member.capability?.hookSelector === undefined,
        )
      ) {
        throw new Error(
          `${path}.target.kind capability requires the relevant hookSelector`,
        );
      }
    } else if (capabilityMembers.length > 0) {
      throw new Error(
        `${path}.target.selector contains a capability identity for a non-capability target`,
      );
    }
    const baseline = isObject(raw.baselineMembership)
      ? raw.baselineMembership
      : undefined;
    const baselineMembers = parseMembers(
      baseline?.members,
      `${path}.baselineMembership.members`,
      capabilityCatalog,
    );
    if (JSON.stringify(members) !== JSON.stringify(baselineMembers)) {
      throw new Error(
        `${path}.target.selector must equal the audited baseline identities`,
      );
    }
    const query = isObject(raw.violation) ? raw.violation : undefined;
    const queryId = requiredString(query?.queryId, `${path}.violation.queryId`);
    if (!(MEMBERSHIP_QUERY_NAMES as readonly string[]).includes(queryId)) {
      throw new Error(
        `${path}.violation.queryId is not implemented: ${queryId}`,
      );
    }
    const expectedAfterRepair = requiredString(
      query?.expectedAfterRepair,
      `${path}.violation.expectedAfterRepair`,
    );
    if (expectedAfterRepair !== 'empty' && expectedAfterRepair !== 'stable') {
      throw new Error(`${path}.violation.expectedAfterRepair is invalid`);
    }
    const baselineCommit = requiredString(
      baseline?.capturedAtCommit,
      `${path}.baselineMembership.capturedAtCommit`,
    );
    if (!/^[0-9a-f]{7,64}$/.test(baselineCommit)) {
      throw new Error(
        `${path}.baselineMembership.capturedAtCommit must be a commit`,
      );
    }
    const regression = isObject(raw.regression) ? raw.regression : undefined;
    const membershipDerivation = isObject(raw.membershipDerivation)
      ? raw.membershipDerivation
      : undefined;
    const generator = membershipGenerator(
      membershipDerivation?.generator,
      `${path}.membershipDerivation.generator`,
    );
    const sourceScope = requiredString(
      membershipDerivation?.sourceScope,
      `${path}.membershipDerivation.sourceScope`,
    );
    const derivationAuthority = requiredString(
      membershipDerivation?.authority,
      `${path}.membershipDerivation.authority`,
    );
    if (/^(?:pack|current-pack):/i.test(derivationAuthority)) {
      throw new Error(
        `${path}.membershipDerivation.authority may not be the pack under repair`,
      );
    }
    const currentMatch = requiredString(
      membershipDerivation?.currentMatch,
      `${path}.membershipDerivation.currentMatch`,
    );
    if (
      currentMatch !== 'required' &&
      currentMatch !== 'may-be-missing-until-repair'
    ) {
      throw new Error(`${path}.membershipDerivation.currentMatch is invalid`);
    }
    if (generator === 'audited-singleton' && baselineMembers.length !== 1) {
      throw new Error(
        `${path}.membershipDerivation.generator audited-singleton requires one member`,
      );
    }
    const clusterJustification =
      raw.clusterJustification === undefined
        ? undefined
        : requiredString(
            raw.clusterJustification,
            `${path}.clusterJustification`,
          );
    const sharedQueryJustification =
      raw.sharedQueryJustification === undefined
        ? undefined
        : requiredString(
            raw.sharedQueryJustification,
            `${path}.sharedQueryJustification`,
          );
    return {
      canonicalId: requiredString(raw.canonicalId, `${path}.canonicalId`),
      aliases,
      title: requiredString(raw.title, `${path}.title`),
      status,
      membershipStatus,
      ...(underivedReason === undefined ? {} : { underivedReason }),
      ...(owningDerivationBead === undefined ? {} : { owningDerivationBead }),
      ...(raw.statusReasoning === undefined
        ? {}
        : {
            statusReasoning: requiredString(
              raw.statusReasoning,
              `${path}.statusReasoning`,
            ),
          }),
      obligation: { obligationId, evidenceKind: parsedEvidence, authority },
      target: {
        kind: targetKind,
        selector: {
          members,
          ...(capabilityCatalog === undefined ? {} : { capabilityCatalog }),
        },
      },
      invariant: requiredString(raw.invariant, `${path}.invariant`),
      violation: {
        queryId: queryId as MembershipQueryName,
        expectedAfterRepair,
      },
      baselineMembership: {
        capturedAtCommit: baselineCommit,
        members: baselineMembers,
      },
      membershipDerivation: {
        generator,
        sourceScope,
        authority: derivationAuthority,
        currentMatch,
      },
      owningBead: requiredString(raw.owningBead, `${path}.owningBead`),
      regression: {
        evidenceKind: evidenceKind(
          regression?.evidenceKind,
          `${path}.regression.evidenceKind`,
        ),
        locator: requiredString(
          regression?.locator,
          `${path}.regression.locator`,
        ),
      },
      ...(clusterJustification === undefined ? {} : { clusterJustification }),
      ...(sharedQueryJustification === undefined
        ? {}
        : { sharedQueryJustification }),
    };
  });
  const canonicalIds = new Set<string>();
  const aliases = new Map<string, string>();
  for (const row of rows) {
    if (canonicalIds.has(row.canonicalId))
      throw new Error(`duplicate canonicalId: ${row.canonicalId}`);
    canonicalIds.add(row.canonicalId);
    for (const alias of row.aliases) {
      const previous = aliases.get(alias);
      if (previous !== undefined)
        throw new Error(
          `alias ${alias} resolves to ${previous} and ${row.canonicalId}`,
        );
      aliases.set(alias, row.canonicalId);
    }
  }
  const queries = new Map<string, FindingRow[]>();
  for (const row of rows) {
    const queryRows = queries.get(row.violation.queryId) ?? [];
    queryRows.push(row);
    queries.set(row.violation.queryId, queryRows);
  }
  for (const [query, queryRows] of queries) {
    if (
      queryRows.length > 1 &&
      queryRows.some((row) => row.sharedQueryJustification === undefined)
    ) {
      throw new Error(
        `violation query ${query} is shared without sharedQueryJustification`,
      );
    }
  }
  const underivedReasons = new Map<string, string>();
  for (const row of rows) {
    if (row.membershipStatus !== 'underived') continue;
    const reason = row.underivedReason;
    if (reason === undefined) {
      throw new Error(`${row.canonicalId} underivedReason is required`);
    }
    if (reason.includes(row.canonicalId)) {
      throw new Error(
        `${row.canonicalId} underivedReason must not be a canonicalId template`,
      );
    }
    const previous = underivedReasons.get(reason);
    if (previous !== undefined) {
      throw new Error(
        `underivedReason is shared by ${previous} and ${row.canonicalId}`,
      );
    }
    underivedReasons.set(reason, row.canonicalId);
  }
  const invariantShapes = new Set(
    rows.map((row) =>
      row.invariant.replaceAll(row.canonicalId, '<canonicalId>'),
    ),
  );
  if (invariantShapes.size !== rows.length) {
    throw new Error(
      'invariants must remain defect-specific; a canonicalId template was detected',
    );
  }
  return { version: 1, rows };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function getDefaultRecords(): PackRecord[] {
  if (defaultRecords === undefined)
    defaultRecords = readJson(recordsPath) as PackRecord[];
  return defaultRecords;
}

export function loadFindingRegistry(path = registryPath): FindingRegistry {
  return parseRegistry(readJson(path));
}

export function aliasIndex(
  registry = loadFindingRegistry(),
): Map<string, FindingRow> {
  const index = new Map<string, FindingRow>();
  for (const row of registry.rows)
    for (const alias of row.aliases) index.set(alias, row);
  return index;
}

function recordData(record: PackRecord): Obj {
  return isObject(record.data) ? record.data : {};
}

function getAtPath(value: unknown, path: string): unknown {
  if (
    !path.startsWith('data') ||
    (path.length > 4 && !path.startsWith('data.'))
  )
    return undefined;
  let current: unknown = value;
  const tokens = path
    .slice(4)
    .split(/(?=\.|\[)/)
    .filter(Boolean);
  for (const token of tokens) {
    if (token.startsWith('.') && isObject(current))
      current = current[token.slice(1)];
    else if (/^\[\d+\]$/.test(token) && Array.isArray(current))
      current = current[Number(token.slice(1, -1))];
    else return undefined;
  }
  return current;
}

function clauseIds(record: PackRecord): Set<string> {
  const readiness = recordData(record).executionReadiness;
  const clauses =
    isObject(readiness) && Array.isArray(readiness.clauses)
      ? readiness.clauses
      : [];
  return new Set(
    clauses
      .filter(isObject)
      .map((clause) => clause.clauseId)
      .filter((id): id is string => typeof id === 'string'),
  );
}

function artifactValue(identity: MembershipIdentity): unknown {
  if (identity.artifactPath === undefined) return undefined;
  const absolute = join(packDirectory, identity.artifactPath);
  let value: unknown;
  try {
    value = readJson(absolute);
  } catch {
    return undefined;
  }
  if (identity.jsonPath === undefined) return value;
  if (!identity.jsonPath.startsWith('$.')) return undefined;
  for (const key of identity.jsonPath.slice(2).split('.')) {
    if (!isObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

function recordIdentity(
  record: PackRecord,
  nested: {
    clauseId?: string;
    path?: string;
    capability?: CapabilityIdentity;
  } = {},
): MembershipIdentity {
  if (typeof record.key !== 'string') throw new Error('pack record has no key');
  return { recordKey: record.key, ...nested };
}

function capabilityIdentityForHook(
  engine: string,
  hook: string,
): CapabilityIdentity {
  const capabilityId = engineCapabilityId(engine, 'pack engine hook');
  return {
    capabilityId,
    primitive: primitiveForHook(capabilityId, hook),
    hookSelector: { engine, name: hook },
    owningBead: ENGINE_FAMILY_OWNERS[capabilityId],
  };
}

function generatedReadinessMembers(
  records: PackRecord[],
  predicate: (clause: Obj) => boolean,
): MembershipIdentity[] {
  return records.flatMap((record) => {
    const readiness = recordData(record).executionReadiness;
    const clauses =
      isObject(readiness) && Array.isArray(readiness.clauses)
        ? readiness.clauses.filter(isObject)
        : [];
    return clauses.filter(predicate).map((clause) =>
      recordIdentity(record, {
        clauseId: requiredString(clause.clauseId, 'pack clauseId'),
      }),
    );
  });
}

function generatedCapabilityMembers(
  records: PackRecord[],
): MembershipIdentity[] {
  return records.flatMap((record) => {
    const readiness = recordData(record).executionReadiness;
    const clauses =
      isObject(readiness) && Array.isArray(readiness.clauses)
        ? readiness.clauses.filter(isObject)
        : [];
    return clauses.flatMap((clause) => {
      if (clause.readiness !== 'engine-pending') return [];
      const clauseId = requiredString(clause.clauseId, 'pack clauseId');
      if (
        !Array.isArray(clause.engineHooks) ||
        clause.engineHooks.length === 0
      ) {
        throw new Error(
          `${clauseId} engine-pending clause has no engine hooks`,
        );
      }
      return clause.engineHooks.map((hookValue, hookIndex) => {
        if (!isObject(hookValue)) {
          throw new Error(
            `${clauseId}.engineHooks[${hookIndex}] must be an object`,
          );
        }
        const engine = requiredString(
          hookValue.engine,
          `${clauseId}.engineHooks[${hookIndex}].engine`,
        );
        const hook = requiredString(
          hookValue.hook,
          `${clauseId}.engineHooks[${hookIndex}].hook`,
        );
        return recordIdentity(record, {
          clauseId,
          capability: capabilityIdentityForHook(engine, hook),
        });
      });
    });
  });
}

function generatedHalfDamageMembers(
  records: PackRecord[],
): MembershipIdentity[] {
  const result: MembershipIdentity[] = [];
  const matches = (value: unknown): value is string =>
    typeof value === 'string' &&
    /half as much damage|half the damage|half damage/i.test(value);
  const inspect = (record: PackRecord, path: string, value: unknown): void => {
    if (matches(value)) result.push(recordIdentity(record, { path }));
  };
  records
    .filter((record) => record.kind === 'creature' || record.kind === 'hazard')
    .forEach((record) => {
      const data = recordData(record);
      if (record.kind === 'hazard')
        inspect(record, 'data.description', data.description);
      if (Array.isArray(data.actions))
        data.actions.forEach((action, index) => {
          if (isObject(action))
            inspect(record, `data.actions[${index}].text`, action.text);
        });
      if (Array.isArray(data.traits))
        data.traits.forEach((trait, index) => {
          if (isObject(trait))
            inspect(record, `data.traits[${index}].text`, trait.text);
        });
      const legendaryActions = data.legendaryActions;
      if (isObject(legendaryActions) && Array.isArray(legendaryActions.entries))
        legendaryActions.entries.forEach((entry, index) => {
          if (isObject(entry))
            inspect(
              record,
              `data.legendaryActions.entries[${index}].text`,
              entry.text,
            );
        });
    });
  return result;
}

/** Generate the committed-pack portion of a durable membership snapshot. */
export function generateMembershipSnapshot(
  row: FindingRow,
  records = getDefaultRecords(),
): MembershipIdentity[] {
  switch (row.membershipDerivation.generator) {
    case 'pack-record-kind': {
      const kind = row.canonicalId === 'spell-completeness' ? 'spell' : 'rule';
      return records
        .filter((record) => record.kind === kind)
        .map((record) => recordIdentity(record));
    }
    case 'pack-half-damage-branches':
      return generatedHalfDamageMembers(records);
    case 'pack-readiness-clauses':
      return generatedReadinessMembers(records, () => true);
    case 'pack-engine-pending-clauses':
      return row.target.kind === 'capability'
        ? generatedCapabilityMembers(records)
        : generatedReadinessMembers(
            records,
            (clause) => clause.readiness === 'engine-pending',
          );
    case 'audited-singleton':
    case 'audited-exact-set':
    case 'audited-artifact-set':
      return row.baselineMembership.members;
  }
}

function currentIdentity(
  identity: MembershipIdentity,
  records: PackRecord[],
): MembershipIdentity | undefined {
  if (identity.artifactPath !== undefined)
    return artifactValue(identity) === undefined ? undefined : identity;
  const record = records.find(
    (candidate) => candidate.key === identity.recordKey,
  );
  if (record === undefined) return undefined;
  if (
    identity.clauseId !== undefined &&
    !clauseIds(record).has(identity.clauseId)
  )
    return undefined;
  if (
    identity.path !== undefined &&
    getAtPath(recordData(record), identity.path) === undefined
  )
    return undefined;
  return identity;
}

export function executeMembershipQuery(
  query: MembershipQueryName,
  records = getDefaultRecords(),
  registry = loadFindingRegistry(),
): MembershipIdentity[] {
  if (!Array.isArray(records))
    throw new Error('rules pack records must be an array');
  const row = registry.rows.find(
    (candidate) => candidate.violation.queryId === query,
  );
  if (row === undefined) throw new Error(`unknown membership query: ${query}`);
  return evaluateMembershipQuery(query, records, registry).current;
}

export interface MembershipEvaluation {
  expected: MembershipIdentity[];
  current: MembershipIdentity[];
  missing: MembershipIdentity[];
  currentStatus: Array<{
    identity: MembershipIdentity;
    status: string;
  }>;
}

function currentStatus(
  identity: MembershipIdentity,
  records: PackRecord[],
): string {
  if (identity.artifactPath !== undefined) {
    return artifactValue(identity) === undefined ? 'missing' : 'present';
  }
  const record = records.find(
    (candidate) => candidate.key === identity.recordKey,
  );
  if (record === undefined) return 'missing';
  if (identity.clauseId !== undefined) {
    const readiness = recordData(record).executionReadiness;
    const readinessClauses =
      isObject(readiness) && Array.isArray(readiness.clauses)
        ? readiness.clauses.filter(isObject)
        : [];
    const clause = readinessClauses.find(
      (candidate) => candidate.clauseId === identity.clauseId,
    );
    return typeof clause?.readiness === 'string' ? clause.readiness : 'present';
  }
  return 'present';
}

/**
 * Join the durable source/audit snapshot to the current pack. The expected
 * identities never come from the current violation predicate, so repairing a
 * clause changes its status without erasing the obligation's membership.
 */
export function evaluateMembershipQuery(
  query: MembershipQueryName,
  records = getDefaultRecords(),
  registry = loadFindingRegistry(),
): MembershipEvaluation {
  if (!Array.isArray(records))
    throw new Error('rules pack records must be an array');
  const row = registry.rows.find(
    (candidate) => candidate.violation.queryId === query,
  );
  if (row === undefined) throw new Error(`unknown membership query: ${query}`);
  const expected = row.baselineMembership.members;
  const joined = expected.map((member) => currentIdentity(member, records));
  return {
    expected,
    current: joined.filter(
      (member): member is MembershipIdentity => member !== undefined,
    ),
    missing: expected.filter((_, index) => joined[index] === undefined),
    currentStatus: expected.map((identity, index) => ({
      identity: joined[index] ?? identity,
      status: currentStatus(identity, records),
    })),
  };
}

export interface BeadReferenceCheck {
  skipped: boolean;
  missing: string[];
}

export function checkBeadReferences(
  registry = loadFindingRegistry(),
): BeadReferenceCheck {
  try {
    const output = execFileSync('bd', ['list', '--all', '--json'], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const ids = new Set(
      (JSON.parse(output) as Array<{ id?: unknown }>)
        .map((item) => item.id)
        .filter((id): id is string => typeof id === 'string'),
    );
    return {
      skipped: false,
      missing: [
        ...new Set(
          registry.rows
            .map((row) => row.owningBead)
            .filter((bead) => !ids.has(bead)),
        ),
      ],
    };
  } catch {
    return { skipped: true, missing: [] };
  }
}

function sameIdentitySet(
  expected: MembershipIdentity[],
  actual: MembershipIdentity[],
): boolean {
  const actualKeys = new Set(actual.map(identityKey));
  return (
    expected.length === actual.length &&
    expected.every((member) => actualKeys.has(identityKey(member)))
  );
}

export function findingRegistryClosureBlockers(
  registry = loadFindingRegistry(),
): string[] {
  return registry.rows
    .filter((row) => row.membershipStatus === 'underived')
    .map((row) => row.canonicalId);
}

export function findingRegistryClosureReady(
  registry = loadFindingRegistry(),
): boolean {
  return findingRegistryClosureBlockers(registry).length === 0;
}

export function validateFindingRegistry(
  registry = loadFindingRegistry(),
  records = getDefaultRecords(),
): void {
  const parsed = parseRegistry(registry);
  for (const row of parsed.rows) {
    if (row.membershipStatus === 'derived') {
      if (
        !executableMembershipGenerators.has(row.membershipDerivation.generator)
      ) {
        throw new Error(
          `${row.canonicalId} derived membership must use an executable query generator`,
        );
      }
      const generated = generateMembershipSnapshot(row, records);
      if (!sameIdentitySet(row.baselineMembership.members, generated)) {
        throw new Error(
          `${row.canonicalId} derived membership does not match its executable query`,
        );
      }
    }
    const evaluation = evaluateMembershipQuery(
      row.violation.queryId,
      records,
      parsed,
    );
    if (
      row.membershipDerivation.currentMatch === 'required' &&
      !sameIdentitySet(evaluation.expected, evaluation.current)
    ) {
      throw new Error(
        `${row.canonicalId} lost one or more baseline membership identities`,
      );
    }
    if (
      evaluation.current.some(
        (member) =>
          member.recordKey === undefined && member.artifactPath === undefined,
      )
    ) {
      throw new Error(
        `${row.canonicalId} returned an identity without a stable locus`,
      );
    }
  }
}
