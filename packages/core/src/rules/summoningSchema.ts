import { RulesPackError } from './types.js';

type Obj = Record<string, unknown>;
type State = Record<string, string>;

const PROFILES = {
  'control-window-undead': {
    axes: ['control'],
    creation: ['source-animation'],
    identity: 'created-actor',
    hooks: ['F2', 'F3'],
  },
  'animated-object': {
    axes: ['effect', 'form'],
    creation: ['object-animation'],
    identity: 'existing-targets',
    hooks: ['F2', 'F3', 'F9'],
  },
  'ordinary-summon': {
    axes: ['effect', 'presence'],
    creation: ['candidate', 'candidate-menu'],
    identity: 'ordinary',
    hooks: ['F2', 'F3'],
  },
  'exceptional-concentration-summon': {
    axes: ['effect', 'presence', 'control', 'attitude'],
    creation: ['candidate', 'candidate-menu'],
    identity: 'ordinary',
    hooks: ['F2', 'F3'],
  },
  'persistent-familiar': {
    axes: ['presence', 'link'],
    creation: ['fixed-form-menu'],
    identity: 'persistent-linked',
    hooks: ['F2'],
  },
  'persistent-steed': {
    axes: ['presence', 'link'],
    creation: ['fixed-form-menu'],
    identity: 'persistent-linked',
    hooks: ['F2'],
  },
  'target-transformation': {
    axes: ['effect', 'form'],
    creation: ['target-transformation-menu'],
    identity: 'existing-targets',
    hooks: ['F2', 'F3'],
  },
  'phantom-steed': {
    axes: ['effect', 'presence'],
    creation: ['fixed-stat-block'],
    identity: 'ordinary',
    hooks: ['F2', 'F3'],
  },
  simulacrum: {
    axes: ['effect', 'integrity'],
    creation: ['duplicate-target'],
    identity: 'duplicate',
    hooks: ['F3', 'F9', 'F10'],
  },
} as const;

type Profile = keyof typeof PROFILES;
type Axis =
  | 'effect'
  | 'presence'
  | 'link'
  | 'control'
  | 'attitude'
  | 'form'
  | 'integrity';

const STATE_VALUES: Readonly<Record<Axis, ReadonlySet<string>>> = {
  effect: new Set(['active', 'fading', 'ended']),
  presence: new Set(['present', 'absent', 'pocket-dimension']),
  link: new Set(['active', 'none']),
  control: new Set(['controlled', 'uncontrolled']),
  attitude: new Set(['friendly', 'hostile']),
  form: new Set(['manifested', 'original']),
  integrity: new Set(['intact', 'destroyed']),
};

const PROFILE_STATE_VALUES: Readonly<
  Record<Profile, Partial<Record<Axis, ReadonlySet<string>>>>
> = {
  'control-window-undead': {
    control: new Set(['controlled', 'uncontrolled']),
  },
  'animated-object': {
    effect: new Set(['active', 'ended']),
    form: new Set(['manifested', 'original']),
  },
  'ordinary-summon': {
    effect: new Set(['active', 'ended']),
    presence: new Set(['present', 'absent']),
  },
  'exceptional-concentration-summon': {
    effect: new Set(['active', 'ended']),
    presence: new Set(['present', 'absent']),
    control: new Set(['controlled', 'uncontrolled']),
    attitude: new Set(['friendly', 'hostile']),
  },
  'persistent-familiar': {
    presence: new Set(['present', 'absent', 'pocket-dimension']),
    link: new Set(['active', 'none']),
  },
  'persistent-steed': {
    presence: new Set(['present', 'absent']),
    link: new Set(['active', 'none']),
  },
  'target-transformation': {
    effect: new Set(['active', 'ended']),
    form: new Set(['manifested', 'original']),
  },
  'phantom-steed': {
    effect: new Set(['active', 'fading', 'ended']),
    presence: new Set(['present', 'absent']),
  },
  simulacrum: {
    effect: new Set(['active', 'ended']),
    integrity: new Set(['intact', 'destroyed']),
  },
};

const CHALLENGES = new Set([
  '0',
  '1/8',
  '1/4',
  '1/2',
  ...Array.from({ length: 30 }, (_, index) => String(index + 1)),
]);
const SIZES = new Set([
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
]);

function fail(path: string, message: string): never {
  throw new RulesPackError(`${path} ${message}`);
}

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Obj;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0)
    fail(path, 'must be a non-empty array');
  return value;
}

function only(value: Obj, path: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key))
      fail(path, `has unexpected payload key ${JSON.stringify(key)}`);
  }
}

function str(value: Obj, key: string, path: string): string {
  const entry = value[key];
  if (typeof entry !== 'string' || entry.length === 0)
    fail(`${path}.${key}`, 'must be a non-empty string');
  return entry;
}

function integer(value: Obj, key: string, path: string, minimum = 1): number {
  const entry = value[key];
  if (!Number.isInteger(entry) || (entry as number) < minimum)
    fail(`${path}.${key}`, `must be an integer >= ${minimum}`);
  return entry as number;
}

function exactSet(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (actual.length !== new Set(actual).size)
    fail(path, 'must not contain duplicates');
  if (
    actual.length !== expected.length ||
    expected.some((entry) => !actual.includes(entry))
  ) {
    fail(path, `must be exactly [${expected.join(', ')}]`);
  }
}

function exactMultiset(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((entry, index) => entry !== sortedExpected[index])
  ) {
    fail(path, `must be exactly [${expected.join(', ')}]`);
  }
}

function stringArray(value: unknown, path: string): readonly string[] {
  const entries = array(value, path);
  if (!entries.every((entry) => typeof entry === 'string' && entry.length > 0))
    fail(path, 'must contain only non-empty strings');
  const strings = entries as readonly string[];
  if (strings.length !== new Set(strings).size)
    fail(path, 'must not contain duplicates');
  return strings;
}

function validateCardinality(
  value: unknown,
  path: string,
): { mode: string; count: number } {
  const cardinality = obj(value, path);
  only(cardinality, path, ['mode', 'count']);
  const mode = str(cardinality, 'mode', path);
  if (mode !== 'exact' && mode !== 'maximum')
    fail(`${path}.mode`, 'must be exact or maximum');
  return { mode, count: integer(cardinality, 'count', path) };
}

function validateCreatureEligibility(
  value: unknown,
  path: string,
): readonly string[] {
  const eligibility = obj(value, path);
  only(eligibility, path, ['creatureTypes', 'maxChallenge']);
  const types = stringArray(eligibility.creatureTypes, `${path}.creatureTypes`);
  if (eligibility.maxChallenge !== undefined) {
    const challenge = str(eligibility, 'maxChallenge', path);
    if (!CHALLENGES.has(challenge))
      fail(`${path}.maxChallenge`, 'must be an SRD challenge token');
  }
  return types;
}

function creatureRef(value: Obj, key: string, path: string): void {
  if (!str(value, key, path).startsWith('creature:'))
    fail(`${path}.${key}`, 'must be a creature:* reference');
}

function validateCreation(
  value: unknown,
  path: string,
  profile: Profile,
): string {
  const creation = obj(value, path);
  const kind = str(creation, 'kind', path);
  if (!(PROFILES[profile].creation as readonly string[]).includes(kind)) {
    fail(`${path}.kind`, `${kind} is not licensed by profile ${profile}`);
  }
  switch (kind) {
    case 'candidate-menu': {
      only(creation, path, ['kind', 'selection', 'options']);
      if (str(creation, 'selection', path) !== 'choose-one')
        fail(`${path}.selection`, 'must be choose-one');
      const ids = new Set<string>();
      for (const [index, entry] of array(
        creation.options,
        `${path}.options`,
      ).entries()) {
        const option = obj(entry, `${path}.options[${index}]`);
        only(option, `${path}.options[${index}]`, [
          'id',
          'cardinality',
          'eligibility',
        ]);
        const id = str(option, 'id', `${path}.options[${index}]`);
        if (ids.has(id)) fail(`${path}.options[${index}].id`, 'must be unique');
        ids.add(id);
        const card = validateCardinality(
          option.cardinality,
          `${path}.options[${index}].cardinality`,
        );
        if (card.mode !== 'exact')
          fail(
            `${path}.options[${index}].cardinality.mode`,
            'candidate menus require exact counts',
          );
        validateCreatureEligibility(
          option.eligibility,
          `${path}.options[${index}].eligibility`,
        );
      }
      break;
    }
    case 'candidate': {
      only(creation, path, [
        'kind',
        'cardinality',
        'eligibility',
        'sourceEligibility',
      ]);
      const card = validateCardinality(
        creation.cardinality,
        `${path}.cardinality`,
      );
      if (card.mode !== 'exact' || card.count !== 1)
        fail(`${path}.cardinality`, 'a single candidate must be exact 1');
      const candidateTypes = validateCreatureEligibility(
        creation.eligibility,
        `${path}.eligibility`,
      );
      if (creation.sourceEligibility !== undefined) {
        if (profile !== 'exceptional-concentration-summon')
          fail(
            `${path}.sourceEligibility`,
            'is licensed only for exceptional-concentration-summon',
          );
        const source = obj(
          creation.sourceEligibility,
          `${path}.sourceEligibility`,
        );
        only(source, `${path}.sourceEligibility`, [
          'kind',
          'shape',
          'sizeFeet',
          'options',
          'withinSpellRange',
          'candidateRelationship',
        ]);
        if (
          source.kind !== 'area' ||
          source.shape !== 'cube' ||
          source.withinSpellRange !== true ||
          source.candidateRelationship !== 'appropriate-to-source'
        )
          fail(
            `${path}.sourceEligibility`,
            'must be a cube area with an appropriate-to-source candidate relationship',
          );
        integer(source, 'sizeFeet', `${path}.sourceEligibility`);
        if (source.sizeFeet !== 10)
          fail(`${path}.sourceEligibility.sizeFeet`, 'must be 10');
        exactSet(
          stringArray(source.options, `${path}.sourceEligibility.options`),
          ['air', 'earth', 'fire', 'water'],
          `${path}.sourceEligibility.options`,
        );
      }
      if (
        candidateTypes.includes('elemental') &&
        creation.sourceEligibility === undefined
      )
        fail(
          `${path}.sourceEligibility`,
          'is required for the source-dependent elemental candidate',
        );
      break;
    }
    case 'fixed-form-menu': {
      only(creation, path, [
        'kind',
        'selection',
        'cardinality',
        'forms',
        'additionalForms',
      ]);
      if (str(creation, 'selection', path) !== 'choose-one')
        fail(`${path}.selection`, 'must be choose-one');
      const card = validateCardinality(
        creation.cardinality,
        `${path}.cardinality`,
      );
      if (card.mode !== 'exact' || card.count !== 1)
        fail(`${path}.cardinality`, 'fixed-form menus require exact 1');
      const refs = new Set<string>();
      for (const [index, entry] of array(
        creation.forms,
        `${path}.forms`,
      ).entries()) {
        const form = obj(entry, `${path}.forms[${index}]`);
        only(form, `${path}.forms[${index}]`, ['name', 'creatureRef']);
        str(form, 'name', `${path}.forms[${index}]`);
        creatureRef(form, 'creatureRef', `${path}.forms[${index}]`);
        const ref = form.creatureRef as string;
        if (refs.has(ref))
          fail(`${path}.forms[${index}].creatureRef`, 'must be unique');
        refs.add(ref);
      }
      if (
        creation.additionalForms !== undefined &&
        creation.additionalForms !== 'model-adjudicated'
      )
        fail(`${path}.additionalForms`, 'must be model-adjudicated');
      if (
        profile === 'persistent-familiar' &&
        creation.additionalForms !== undefined
      )
        fail(
          `${path}.additionalForms`,
          'is not licensed for persistent-familiar',
        );
      break;
    }
    case 'source-animation': {
      only(creation, path, [
        'kind',
        'cardinality',
        'sourceEligibility',
        'outcomes',
        'distinctSourcePerActor',
        'castingCondition',
      ]);
      validateCardinality(creation.cardinality, `${path}.cardinality`);
      const eligibility = obj(
        creation.sourceEligibility,
        `${path}.sourceEligibility`,
      );
      only(eligibility, `${path}.sourceEligibility`, [
        'kind',
        'creatureType',
        'sizes',
      ]);
      if (str(eligibility, 'kind', `${path}.sourceEligibility`) !== 'remains')
        fail(`${path}.sourceEligibility.kind`, 'must be remains');
      str(eligibility, 'creatureType', `${path}.sourceEligibility`);
      for (const size of stringArray(
        eligibility.sizes,
        `${path}.sourceEligibility.sizes`,
      ))
        if (!SIZES.has(size))
          fail(
            `${path}.sourceEligibility.sizes`,
            `contains unsupported size ${size}`,
          );
      for (const [index, entry] of array(
        creation.outcomes,
        `${path}.outcomes`,
      ).entries()) {
        const outcome = obj(entry, `${path}.outcomes[${index}]`);
        only(outcome, `${path}.outcomes[${index}]`, ['source', 'resultRef']);
        str(outcome, 'source', `${path}.outcomes[${index}]`);
        creatureRef(outcome, 'resultRef', `${path}.outcomes[${index}]`);
      }
      if (
        creation.distinctSourcePerActor !== undefined &&
        creation.distinctSourcePerActor !== true
      )
        fail(`${path}.distinctSourcePerActor`, 'must be true');
      if (
        creation.castingCondition !== undefined &&
        creation.castingCondition !== 'night-only'
      )
        fail(`${path}.castingCondition`, 'must be night-only');
      break;
    }
    case 'object-animation': {
      only(creation, path, ['kind', 'capacity', 'eligibility', 'sizeCosts']);
      const capacity = validateCardinality(
        creation.capacity,
        `${path}.capacity`,
      );
      if (capacity.mode !== 'maximum')
        fail(`${path}.capacity.mode`, 'must be maximum');
      const eligibility = obj(creation.eligibility, `${path}.eligibility`);
      only(eligibility, `${path}.eligibility`, [
        'nonmagical',
        'notWornOrCarried',
        'maximumSize',
      ]);
      if (
        eligibility.nonmagical !== true ||
        eligibility.notWornOrCarried !== true
      )
        fail(
          `${path}.eligibility`,
          'must require nonmagical and not worn or carried',
        );
      if (!SIZES.has(str(eligibility, 'maximumSize', `${path}.eligibility`)))
        fail(`${path}.eligibility.maximumSize`, 'must be an SRD size');
      const costs = obj(creation.sizeCosts, `${path}.sizeCosts`);
      exactSet(
        Object.keys(costs),
        ['tiny', 'small', 'medium', 'large', 'huge'],
        `${path}.sizeCosts keys`,
      );
      for (const size of Object.keys(costs))
        integer(costs, size, `${path}.sizeCosts`);
      break;
    }
    case 'target-transformation-menu': {
      only(creation, path, [
        'kind',
        'selection',
        'options',
        'additionalTargets',
      ]);
      if (str(creation, 'selection', path) !== 'choose-one')
        fail(`${path}.selection`, 'must be choose-one');
      for (const [index, entry] of array(
        creation.options,
        `${path}.options`,
      ).entries()) {
        const option = obj(entry, `${path}.options[${index}]`);
        only(option, `${path}.options[${index}]`, [
          'source',
          'resultRef',
          'cardinality',
        ]);
        str(option, 'source', `${path}.options[${index}]`);
        creatureRef(option, 'resultRef', `${path}.options[${index}]`);
        const card = validateCardinality(
          option.cardinality,
          `${path}.options[${index}].cardinality`,
        );
        if (card.mode !== 'maximum')
          fail(
            `${path}.options[${index}].cardinality.mode`,
            'target alternatives require maximum counts',
          );
      }
      if (
        creation.additionalTargets !== undefined &&
        creation.additionalTargets !== 'model-adjudicated'
      )
        fail(`${path}.additionalTargets`, 'must be model-adjudicated');
      break;
    }
    case 'fixed-stat-block': {
      only(creation, path, [
        'kind',
        'cardinality',
        'creatureRef',
        'description',
        'size',
      ]);
      const card = validateCardinality(
        creation.cardinality,
        `${path}.cardinality`,
      );
      if (card.mode !== 'exact' || card.count !== 1)
        fail(`${path}.cardinality`, 'must be exact 1');
      creatureRef(creation, 'creatureRef', path);
      str(creation, 'description', path);
      if (!SIZES.has(str(creation, 'size', path)))
        fail(`${path}.size`, 'must be an SRD size');
      break;
    }
    case 'duplicate-target': {
      only(creation, path, [
        'kind',
        'cardinality',
        'eligibility',
        'targetRange',
        'rangeContinuity',
      ]);
      const card = validateCardinality(
        creation.cardinality,
        `${path}.cardinality`,
      );
      if (card.mode !== 'exact' || card.count !== 1)
        fail(`${path}.cardinality`, 'must be exact 1');
      validateCreatureEligibility(creation.eligibility, `${path}.eligibility`);
      if (
        creation.targetRange !== 'touch' ||
        creation.rangeContinuity !== 'entire-casting-time'
      )
        fail(path, 'requires touch range for the entire casting time');
      break;
    }
    default:
      fail(`${path}.kind`, `has unknown creation kind ${kind}`);
  }
  return kind;
}

function candidateTypes(creation: Obj): ReadonlySet<string> {
  const out = new Set<string>();
  if (creation.kind === 'candidate') {
    for (const type of (creation.eligibility as Obj).creatureTypes as string[])
      out.add(type);
  }
  if (creation.kind === 'candidate-menu') {
    for (const option of creation.options as Obj[])
      for (const type of (option.eligibility as Obj).creatureTypes as string[])
        out.add(type);
  }
  return out;
}

function validateTypeTreatment(
  value: unknown,
  path: string,
  profile: Profile,
  creation: Obj,
): void {
  const treatment = obj(value, path);
  only(treatment, path, [
    'operation',
    'types',
    'selection',
    'whenCandidateType',
  ]);
  const operation = str(treatment, 'operation', path);
  const types = stringArray(treatment.types, `${path}.types`);
  if (operation === 'add') {
    if (profile !== 'ordinary-summon')
      fail(`${path}.operation`, 'add is licensed only for ordinary-summon');
    if (
      treatment.selection !== undefined ||
      treatment.whenCandidateType !== undefined
    )
      fail(path, 'add forbids replacement fields');
    exactSet(types, ['fey'], `${path}.types`);
  } else if (operation === 'replace') {
    if (
      ![
        'persistent-familiar',
        'persistent-steed',
        'exceptional-concentration-summon',
      ].includes(profile)
    )
      fail(`${path}.operation`, `replace is not licensed by ${profile}`);
    if (treatment.selection !== 'choose-one')
      fail(`${path}.selection`, 'replacement must choose-one');
    if (treatment.whenCandidateType !== undefined) {
      const candidate = str(treatment, 'whenCandidateType', path);
      if (!candidateTypes(creation).has(candidate))
        fail(
          `${path}.whenCandidateType`,
          'must name an eligible candidate type',
        );
      if (profile !== 'exceptional-concentration-summon')
        fail(
          `${path}.whenCandidateType`,
          'conditional replacement is licensed only for exceptional concentration summons',
        );
    }
    if (profile === 'persistent-familiar' || profile === 'persistent-steed')
      exactSet(types, ['celestial', 'fey', 'fiend'], `${path}.types`);
    if (profile === 'exceptional-concentration-summon') {
      exactSet(types, ['fey'], `${path}.types`);
      if (treatment.whenCandidateType !== 'beast')
        fail(`${path}.whenCandidateType`, 'must be beast');
    }
  } else {
    fail(`${path}.operation`, 'must be add or replace');
  }
  if (types.length === 0) fail(`${path}.types`, 'must not be empty');
}

function validatePlacement(value: unknown, path: string): void {
  const placement = obj(value, path);
  const kind = str(placement, 'kind', path);
  if (kind === 'within-spell-range') {
    only(placement, path, ['kind', 'unoccupied', 'visible', 'onGround']);
    for (const key of ['unoccupied', 'visible', 'onGround'])
      if (placement[key] !== undefined && placement[key] !== true)
        fail(`${path}.${key}`, 'must be true');
  } else if (kind === 'relative-to-selected-source') {
    only(placement, path, ['kind', 'withinFeet', 'unoccupied']);
    integer(placement, 'withinFeet', path);
    if (placement.unoccupied !== true)
      fail(`${path}.unoccupied`, 'must be true');
  } else if (kind === 'target-location') {
    only(placement, path, ['kind']);
  } else fail(`${path}.kind`, 'has unknown placement kind');
}

function validateControl(value: unknown, path: string, profile: Profile): void {
  const control = obj(value, path);
  only(control, path, ['relationship', 'initiative', 'command', 'window']);
  const relationship = str(control, 'relationship', path);
  const allowedRelationships = new Set([
    'controlled-obedient',
    'friendly-commanded',
    'independent-always-obeys',
    'bonded-mount',
    'obeys-verbal-commands',
    'friendly-to-caster-and-designated-obeys-spoken',
  ]);
  if (!allowedRelationships.has(relationship))
    fail(`${path}.relationship`, 'is not a recognized S1 relationship');
  if (
    control.initiative !== undefined &&
    !['own-turn', 'grouped-own-turns', 'caster-turn'].includes(
      str(control, 'initiative', path),
    )
  )
    fail(`${path}.initiative`, 'is not recognized');
  if (control.command !== undefined) {
    const command = obj(control.command, `${path}.command`);
    only(command, `${path}.command`, [
      'channel',
      'cost',
      'timing',
      'rangeFeet',
      'batching',
      'generalOrders',
      'orderPersistence',
      'fallback',
      'alignmentLimited',
    ]);
    const channel = str(command, 'channel', `${path}.command`);
    if (!['mental', 'verbal', 'spoken'].includes(channel))
      fail(`${path}.command.channel`, 'is not recognized');
    if (
      command.cost !== undefined &&
      !['bonus-action', 'none'].includes(
        str(command, 'cost', `${path}.command`),
      )
    )
      fail(`${path}.command.cost`, 'is not recognized');
    if (
      command.timing !== undefined &&
      command.timing !== 'on-each-caster-turn'
    )
      fail(`${path}.command.timing`, 'must be on-each-caster-turn');
    if (command.rangeFeet !== undefined)
      integer(command, 'rangeFeet', `${path}.command`);
    if (command.batching !== undefined) {
      const batching = obj(command.batching, `${path}.command.batching`);
      only(batching, `${path}.command.batching`, ['scope', 'command']);
      if (batching.scope !== 'any-or-all' || batching.command !== 'same')
        fail(
          `${path}.command.batching`,
          'must batch any-or-all with the same command',
        );
    }
    if (command.generalOrders !== undefined && command.generalOrders !== true)
      fail(`${path}.command.generalOrders`, 'must be true');
    if (
      command.orderPersistence !== undefined &&
      command.orderPersistence !== 'until-task-complete'
    )
      fail(`${path}.command.orderPersistence`, 'must be until-task-complete');
    if (command.fallback !== undefined) {
      const fallback = obj(command.fallback, `${path}.command.fallback`);
      only(fallback, `${path}.command.fallback`, ['when', 'behavior']);
      if (
        !['no-new-command', 'no-active-order'].includes(
          str(fallback, 'when', `${path}.command.fallback`),
        )
      )
        fail(`${path}.command.fallback.when`, 'is not recognized');
      if (
        !['defend-self-only', 'defend-otherwise-no-actions'].includes(
          str(fallback, 'behavior', `${path}.command.fallback`),
        )
      )
        fail(`${path}.command.fallback.behavior`, 'is not recognized');
    }
    if (
      command.alignmentLimited !== undefined &&
      command.alignmentLimited !== true
    )
      fail(`${path}.command.alignmentLimited`, 'must be true');

    if (['control-window-undead', 'animated-object'].includes(profile)) {
      if (
        channel !== 'mental' ||
        command.cost !== 'bonus-action' ||
        command.batching === undefined ||
        command.generalOrders !== true ||
        command.orderPersistence !== 'until-task-complete' ||
        (command.fallback as Obj | undefined)?.when !== 'no-active-order'
      )
        fail(
          `${path}.command`,
          `${profile} requires the full mental bonus-action persistent-order protocol`,
        );
      const expectedKeys =
        profile === 'control-window-undead'
          ? [
              'channel',
              'cost',
              'timing',
              'rangeFeet',
              'batching',
              'generalOrders',
              'orderPersistence',
              'fallback',
            ]
          : [
              'channel',
              'cost',
              'rangeFeet',
              'batching',
              'generalOrders',
              'orderPersistence',
              'fallback',
            ];
      exactSet(Object.keys(command), expectedKeys, `${path}.command keys`);
      if ((command.fallback as Obj).behavior !== 'defend-self-only')
        fail(`${path}.command.fallback.behavior`, 'must be defend-self-only');
      if (profile === 'animated-object' && command.rangeFeet !== 500)
        fail(`${path}.command.rangeFeet`, 'must be 500');
      if (
        profile === 'control-window-undead' &&
        command.rangeFeet !== 60 &&
        command.rangeFeet !== 120
      )
        fail(`${path}.command.rangeFeet`, 'must be 60 or 120');
    }
    if (
      profile === 'ordinary-summon' ||
      profile === 'exceptional-concentration-summon'
    ) {
      if (
        channel !== 'verbal' ||
        command.cost !== 'none' ||
        (command.fallback as Obj | undefined)?.when !== 'no-new-command'
      )
        fail(
          `${path}.command`,
          `${profile} requires verbal no-action commands and the source fallback`,
        );
      exactSet(
        Object.keys(command),
        command.alignmentLimited === true
          ? ['channel', 'cost', 'fallback', 'alignmentLimited']
          : ['channel', 'cost', 'fallback'],
        `${path}.command keys`,
      );
      if ((command.fallback as Obj).behavior !== 'defend-otherwise-no-actions')
        fail(
          `${path}.command.fallback.behavior`,
          'must be defend-otherwise-no-actions',
        );
    }
    if (profile === 'target-transformation') {
      if (channel !== 'verbal')
        fail(
          `${path}.command`,
          'target-transformation licenses only the source-stated verbal channel',
        );
      exactSet(Object.keys(command), ['channel'], `${path}.command keys`);
    }
    if (profile === 'simulacrum') {
      if (channel !== 'spoken')
        fail(
          `${path}.command`,
          'simulacrum licenses only the source-stated spoken channel',
        );
      exactSet(Object.keys(command), ['channel'], `${path}.command keys`);
    }
  }
  if (control.window !== undefined) {
    if (profile !== 'control-window-undead')
      fail(`${path}.window`, 'is licensed only for control-window-undead');
    const window = obj(control.window, `${path}.window`);
    only(window, `${path}.window`, ['amount', 'unit', 'anchor']);
    integer(window, 'amount', `${path}.window`);
    if (window.unit !== 'hour' || window.anchor !== 'control-established')
      fail(
        `${path}.window`,
        'requires hour units anchored to control-established',
      );
  }
}

function selectorValues(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
): readonly string[] {
  const values = Array.isArray(value)
    ? stringArray(value, path)
    : [
        typeof value === 'string'
          ? value
          : fail(path, 'must be a state value or non-empty array'),
      ];
  for (const entry of values)
    if (!allowed.has(entry))
      fail(path, `contains unsupported state value ${entry}`);
  return values;
}

function validateStateSelector(
  value: unknown,
  path: string,
  profile: Profile,
  requireAllAxes: boolean,
): Record<string, readonly string[]> {
  const selector = obj(value, path);
  const licensed = PROFILES[profile].axes as readonly Axis[];
  only(selector, path, licensed);
  if (Object.keys(selector).length === 0) fail(path, 'must not be empty');
  if (requireAllAxes) exactSet(Object.keys(selector), licensed, `${path} axes`);
  const result: Record<string, readonly string[]> = {};
  for (const [axis, entry] of Object.entries(selector))
    result[axis] = selectorValues(
      entry,
      `${path}.${axis}`,
      PROFILE_STATE_VALUES[profile][axis as Axis] ?? STATE_VALUES[axis as Axis],
    );
  return result;
}

function validateOperation(
  value: unknown,
  path: string,
  profile: Profile,
): string {
  const operation = obj(value, path);
  const kind = str(operation, 'kind', path);
  switch (kind) {
    case 'reassert-control': {
      only(operation, path, [
        'kind',
        'actorEligibility',
        'deadline',
        'cardinality',
        'resetsWindow',
      ]);
      if (
        profile !== 'control-window-undead' ||
        operation.actorEligibility !== 'created-by-this-spell' ||
        operation.deadline !== 'before-current-control-window-expires'
      )
        fail(path, 'has invalid reassert-control eligibility or deadline');
      const card = validateCardinality(
        operation.cardinality,
        `${path}.cardinality`,
      );
      if (card.mode !== 'maximum')
        fail(`${path}.cardinality.mode`, 'must be maximum');
      const reset = obj(operation.resetsWindow, `${path}.resetsWindow`);
      only(reset, `${path}.resetsWindow`, ['amount', 'unit', 'anchor']);
      integer(reset, 'amount', `${path}.resetsWindow`);
      if (reset.unit !== 'hour' || reset.anchor !== 'reassertion-completed')
        fail(
          `${path}.resetsWindow`,
          'must be hour-based and anchored to reassertion-completed',
        );
      break;
    }
    case 'carry-remaining-damage-to-original-form':
      only(operation, path, ['kind']);
      if (profile !== 'animated-object')
        fail(path, 'is licensed only for animated-object');
      break;
    case 'select-new-form':
      only(operation, path, ['kind']);
      if (profile !== 'persistent-familiar')
        fail(path, 'is licensed only for persistent-familiar');
      break;
    case 'restore-same-actor':
      only(operation, path, ['kind', 'hitPoints']);
      if (profile !== 'persistent-steed' || operation.hitPoints !== 'maximum')
        fail(path, 'is licensed only for persistent-steed at maximum HP');
      break;
    case 'destroy-active-duplicates':
      only(operation, path, ['kind', 'ownership']);
      if (
        profile !== 'simulacrum' ||
        operation.ownership !== 'created-by-caster-with-this-spell'
      )
        fail(path, 'has invalid duplicate ownership');
      break;
    case 'place-in-unoccupied-space':
      only(operation, path, ['kind', 'withinFeet']);
      if (profile !== 'persistent-familiar')
        fail(path, 'is licensed only for persistent-familiar');
      integer(operation, 'withinFeet', path);
      break;
    case 'revert-to-snow-and-melt':
      only(operation, path, ['kind']);
      if (profile !== 'simulacrum')
        fail(path, 'is licensed only for simulacrum');
      break;
    default:
      fail(`${path}.kind`, `has unknown operation ${kind}`);
  }
  return kind;
}

interface ValidatedTransition {
  readonly path: string;
  readonly trigger: string;
  readonly when: Record<string, readonly string[]>;
  readonly changes: Readonly<Record<string, string>>;
  readonly operation?: string;
  readonly ambiguityId?: string;
}

const TRIGGERS = new Set([
  'spell-ended',
  'concentration-broken',
  'zero-hit-points',
  'control-window-expired',
  'cast-to-reassert-control',
  'absolute-time-reached',
  'action-temporary-dismissal',
  'action-recall',
  'action-permanent-dismissal',
  'action-dismissal',
  'action-release',
  'cast-again',
  'damage-taken',
  'fade-completed',
  'dispelled',
]);

function validateTransitions(
  value: unknown,
  path: string,
  profile: Profile,
): readonly ValidatedTransition[] {
  const ids = new Set<string>();
  return array(value, path).map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const transition = obj(entry, itemPath);
    only(transition, itemPath, [
      'id',
      'trigger',
      'when',
      'changes',
      'operation',
      'exceptCauses',
      'timer',
      'scope',
      'restrictions',
      'reappearancePlacement',
      'availability',
    ]);
    const id = str(transition, 'id', itemPath);
    if (ids.has(id)) fail(`${itemPath}.id`, 'must be unique');
    ids.add(id);
    const trigger = str(transition, 'trigger', itemPath);
    if (!TRIGGERS.has(trigger))
      fail(`${itemPath}.trigger`, 'is not recognized');
    const when = validateStateSelector(
      transition.when,
      `${itemPath}.when`,
      profile,
      true,
    );
    const changes: Record<string, string> = {};
    if (transition.changes !== undefined) {
      for (const [changeIndex, changeEntry] of array(
        transition.changes,
        `${itemPath}.changes`,
      ).entries()) {
        const changePath = `${itemPath}.changes[${changeIndex}]`;
        const change = obj(changeEntry, changePath);
        only(change, changePath, ['axis', 'to']);
        const axis = str(change, 'axis', changePath) as Axis;
        if (!(PROFILES[profile].axes as readonly string[]).includes(axis))
          fail(
            `${changePath}.axis`,
            `${axis} is not licensed by profile ${profile}`,
          );
        if (changes[axis] !== undefined)
          fail(`${changePath}.axis`, 'must be unique within a transition');
        const to = str(change, 'to', changePath);
        if (
          !(PROFILE_STATE_VALUES[profile][axis] ?? STATE_VALUES[axis])?.has(to)
        )
          fail(`${changePath}.to`, `is invalid for axis ${axis}`);
        changes[axis] = to;
      }
    }
    const operation =
      transition.operation === undefined
        ? undefined
        : validateOperation(
            transition.operation,
            `${itemPath}.operation`,
            profile,
          );
    let ambiguityId: string | undefined;
    if (transition.availability !== undefined) {
      const availability = obj(
        transition.availability,
        `${itemPath}.availability`,
      );
      only(availability, `${itemPath}.availability`, ['kind', 'ambiguityId']);
      if (availability.kind !== 'source-ambiguity')
        fail(`${itemPath}.availability.kind`, 'must be source-ambiguity');
      ambiguityId = str(
        availability,
        'ambiguityId',
        `${itemPath}.availability`,
      );
      if (!ambiguityId.startsWith('ambiguity:'))
        fail(
          `${itemPath}.availability.ambiguityId`,
          'must be an ambiguity:* reference',
        );
      if (
        profile !== 'persistent-familiar' ||
        trigger !== 'action-permanent-dismissal'
      )
        fail(
          `${itemPath}.availability`,
          'is licensed only for familiar permanent dismissal',
        );
      exactSet(
        when.presence ?? [],
        ['absent'],
        `${itemPath}.availability precondition presence`,
      );
      exactSet(
        when.link ?? [],
        ['active'],
        `${itemPath}.availability precondition link`,
      );
    }
    if (when.effect?.includes('ended'))
      fail(`${itemPath}.when.effect`, 'cannot originate from ended state');
    if (when.link?.includes('none'))
      fail(`${itemPath}.when.link`, 'cannot originate from a terminated link');
    if (when.integrity?.includes('destroyed'))
      fail(
        `${itemPath}.when.integrity`,
        'cannot originate from destroyed integrity',
      );
    if (when.form?.includes('original'))
      fail(`${itemPath}.when.form`, 'cannot originate from original form');
    if (changes.link === 'none' && changes.presence !== 'absent')
      fail(
        `${itemPath}.changes`,
        'terminating a persistent link must also leave the actor absent',
      );
    if (
      changes.presence === 'pocket-dimension' &&
      !when.link?.includes('active')
    )
      fail(
        `${itemPath}.changes`,
        'pocket-dimension presence requires an active persistent link',
      );
    if (changes.form === 'original' && changes.effect !== 'ended')
      fail(
        `${itemPath}.changes`,
        'returning to original form must end the transformation effect',
      );
    if (changes.integrity === 'destroyed' && changes.effect !== 'ended')
      fail(
        `${itemPath}.changes`,
        'destroyed integrity must end the duplicate effect',
      );
    if (
      ['ordinary-summon', 'exceptional-concentration-summon'].includes(
        profile,
      ) &&
      changes.presence === 'absent' &&
      changes.effect !== 'ended'
    )
      fail(
        `${itemPath}.changes`,
        'ordinary summon removal must end the effect',
      );
    if (Object.keys(changes).length === 0 && operation === undefined)
      fail(itemPath, 'must change state or perform an operation');
    if (transition.exceptCauses !== undefined) {
      exactSet(
        stringArray(transition.exceptCauses, `${itemPath}.exceptCauses`),
        ['concentration-broken'],
        `${itemPath}.exceptCauses`,
      );
      if (
        profile !== 'exceptional-concentration-summon' ||
        trigger !== 'spell-ended'
      )
        fail(
          `${itemPath}.exceptCauses`,
          'is valid only on exceptional spell-ended transitions',
        );
    }
    if (transition.timer !== undefined) {
      const timer = obj(transition.timer, `${itemPath}.timer`);
      only(timer, `${itemPath}.timer`, ['amount', 'unit', 'anchor']);
      integer(timer, 'amount', `${itemPath}.timer`);
      if (!['hour', 'minute'].includes(str(timer, 'unit', `${itemPath}.timer`)))
        fail(`${itemPath}.timer.unit`, 'is not recognized');
      if (
        !['spell-cast', 'transition-trigger'].includes(
          str(timer, 'anchor', `${itemPath}.timer`),
        )
      )
        fail(`${itemPath}.timer.anchor`, 'is not recognized');
      if (trigger === 'absolute-time-reached' && timer.anchor !== 'spell-cast')
        fail(
          `${itemPath}.timer.anchor`,
          'absolute-time-reached must be anchored to spell-cast',
        );
      if (
        trigger !== 'absolute-time-reached' &&
        timer.anchor !== 'transition-trigger'
      )
        fail(
          `${itemPath}.timer.anchor`,
          'relative transition timers must be anchored to transition-trigger',
        );
    } else if (trigger === 'absolute-time-reached')
      fail(`${itemPath}.timer`, 'is required for absolute-time-reached');
    if (transition.scope !== undefined) {
      if (
        !['each-target', 'all-matching-active-duplicates'].includes(
          str(transition, 'scope', itemPath),
        )
      )
        fail(`${itemPath}.scope`, 'is not recognized');
      if (
        transition.scope === 'each-target' &&
        profile !== 'target-transformation'
      )
        fail(
          `${itemPath}.scope`,
          'each-target is licensed only for target-transformation',
        );
      if (
        transition.scope === 'all-matching-active-duplicates' &&
        profile !== 'simulacrum'
      )
        fail(
          `${itemPath}.scope`,
          'duplicate scope is licensed only for simulacrum',
        );
    }
    if (transition.restrictions !== undefined) {
      exactSet(
        stringArray(transition.restrictions, `${itemPath}.restrictions`),
        ['caster-cannot-dismiss'],
        `${itemPath}.restrictions`,
      );
      if (
        profile !== 'exceptional-concentration-summon' ||
        trigger !== 'concentration-broken'
      )
        fail(
          `${itemPath}.restrictions`,
          'is licensed only on the exceptional concentration-break transition',
        );
    }
    const restoresPersistentPresence =
      (profile === 'persistent-familiar' || profile === 'persistent-steed') &&
      trigger === 'cast-again' &&
      changes.presence === 'present';
    if (
      (transition.reappearancePlacement !== undefined) !==
      restoresPersistentPresence
    )
      fail(
        `${itemPath}.reappearancePlacement`,
        restoresPersistentPresence
          ? 'must reuse creation-placement for persistent restoration'
          : 'is not licensed for this transition',
      );
    if (
      transition.reappearancePlacement !== undefined &&
      transition.reappearancePlacement !== 'creation-placement'
    )
      fail(`${itemPath}.reappearancePlacement`, 'must be creation-placement');
    if (
      trigger === 'cast-again' &&
      (profile === 'persistent-familiar' || profile === 'persistent-steed') &&
      !when.link?.includes('active')
    )
      fail(
        `${itemPath}.when.link`,
        'same-identity cast-again requires an active persistent link',
      );
    if (
      operation === 'reassert-control' &&
      !when.control?.includes('controlled')
    )
      fail(
        `${itemPath}.when.control`,
        'reassert-control requires controlled state before expiry',
      );
    return {
      path: itemPath,
      trigger,
      when,
      changes,
      operation,
      ambiguityId,
    };
  });
}

function stateKey(state: State, axes: readonly string[]): string {
  return axes.map((axis) => `${axis}=${state[axis]}`).join('|');
}

function matches(
  state: State,
  selector: Record<string, readonly string[]>,
): boolean {
  return Object.entries(selector).every(([axis, values]) =>
    values.includes(state[axis]),
  );
}

function validateReachability(
  initial: Record<string, readonly string[]>,
  transitions: readonly ValidatedTransition[],
  profile: Profile,
): void {
  const axes = PROFILES[profile].axes as readonly string[];
  const states = new Map<string, State>();
  const build = (index: number, current: State): void => {
    if (index === axes.length) {
      states.set(stateKey(current, axes), { ...current });
      return;
    }
    const axis = axes[index];
    for (const value of initial[axis])
      build(index + 1, { ...current, [axis]: value });
  };
  build(0, {});
  const reachedTransitions = new Set<ValidatedTransition>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of transitions) {
      for (const state of [...states.values()]) {
        if (!matches(state, transition.when)) continue;
        reachedTransitions.add(transition);
        const next = { ...state, ...transition.changes };
        const key = stateKey(next, axes);
        if (!states.has(key)) {
          states.set(key, next);
          changed = true;
        }
      }
    }
  }
  for (const transition of transitions)
    if (!reachedTransitions.has(transition))
      fail(
        transition.path,
        'has an unreachable precondition from the declared initial state',
      );
}

function validateIdentity(
  value: unknown,
  path: string,
  profile: Profile,
): void {
  const identity = obj(value, path);
  const kind = str(identity, 'kind', path);
  if (kind !== PROFILES[profile].identity)
    fail(
      `${path}.kind`,
      `must be ${PROFILES[profile].identity} for profile ${profile}`,
    );
  if (kind === 'created-actor') {
    only(identity, path, ['kind', 'provenance']);
    if (identity.provenance !== 'created-by-this-spell')
      fail(`${path}.provenance`, 'must be created-by-this-spell');
  } else if (kind === 'persistent-linked') {
    only(identity, path, ['kind', 'maximumLinked']);
    if (integer(identity, 'maximumLinked', path) !== 1)
      fail(`${path}.maximumLinked`, 'must be 1');
  } else only(identity, path, ['kind']);
}

function validateScaling(value: unknown, path: string, profile: Profile): void {
  for (const [index, entry] of array(value, path).entries()) {
    const itemPath = `${path}[${index}]`;
    const scaling = obj(entry, itemPath);
    const kind = str(scaling, 'kind', itemPath);
    if (kind === 'per-slot-cardinality') {
      only(scaling, itemPath, [
        'kind',
        'baseSlotLevel',
        'additional',
        'appliesTo',
      ]);
      integer(scaling, 'baseSlotLevel', itemPath);
      integer(scaling, 'additional', itemPath);
      const applies = stringArray(scaling.appliesTo, `${itemPath}.appliesTo`);
      if (profile === 'control-window-undead')
        exactSet(
          applies,
          ['creation', 'control-reassertion'],
          `${itemPath}.appliesTo`,
        );
      else exactSet(applies, ['creation'], `${itemPath}.appliesTo`);
    } else if (kind === 'slot-multipliers') {
      only(scaling, itemPath, ['kind', 'multipliers', 'appliesTo']);
      if (scaling.appliesTo !== 'creation-menu-counts')
        fail(`${itemPath}.appliesTo`, 'must be creation-menu-counts');
      const multipliers = obj(scaling.multipliers, `${itemPath}.multipliers`);
      for (const key of Object.keys(multipliers)) {
        if (!/^\d+$/.test(key))
          fail(`${itemPath}.multipliers`, 'keys must be slot levels');
        integer(multipliers, key, `${itemPath}.multipliers`);
      }
    } else if (kind === 'challenge-cap-at-slot') {
      only(scaling, itemPath, [
        'kind',
        'slotLevel',
        'maximumChallenge',
        'appliesTo',
      ]);
      integer(scaling, 'slotLevel', itemPath);
      if (
        !CHALLENGES.has(str(scaling, 'maximumChallenge', itemPath)) ||
        scaling.appliesTo !== 'creation-candidate'
      )
        fail(itemPath, 'has invalid challenge cap scaling');
    } else if (kind === 'challenge-cap-per-slot') {
      only(scaling, itemPath, [
        'kind',
        'baseSlotLevel',
        'increase',
        'appliesTo',
      ]);
      integer(scaling, 'baseSlotLevel', itemPath);
      integer(scaling, 'increase', itemPath);
      if (scaling.appliesTo !== 'creation-candidate')
        fail(`${itemPath}.appliesTo`, 'must be creation-candidate');
    } else if (kind === 'slot-option-menu') {
      only(scaling, itemPath, ['kind', 'appliesTo', 'selection', 'options']);
      if (profile !== 'control-window-undead')
        fail(
          itemPath,
          'slot-option-menu is licensed only for control-window-undead',
        );
      exactSet(
        stringArray(scaling.appliesTo, `${itemPath}.appliesTo`),
        ['creation', 'control-reassertion'],
        `${itemPath}.appliesTo`,
      );
      if (scaling.selection !== 'choose-one')
        fail(`${itemPath}.selection`, 'must be choose-one');
      const levels = new Set<number>();
      for (const [optionIndex, optionEntry] of array(
        scaling.options,
        `${itemPath}.options`,
      ).entries()) {
        const optionPath = `${itemPath}.options[${optionIndex}]`;
        const option = obj(optionEntry, optionPath);
        only(option, optionPath, ['slotLevel', 'choices']);
        const level = integer(option, 'slotLevel', optionPath);
        if (levels.has(level))
          fail(`${optionPath}.slotLevel`, 'must be unique');
        levels.add(level);
        for (const [choiceIndex, choiceEntry] of array(
          option.choices,
          `${optionPath}.choices`,
        ).entries()) {
          const choicePath = `${optionPath}.choices[${choiceIndex}]`;
          const choice = obj(choiceEntry, choicePath);
          only(choice, choicePath, [
            'creatureRefs',
            'cardinality',
            'composition',
          ]);
          const creatureRefs = stringArray(
            choice.creatureRefs,
            `${choicePath}.creatureRefs`,
          );
          if (
            creatureRefs.length === 0 ||
            new Set(creatureRefs).size !== creatureRefs.length
          )
            fail(`${choicePath}.creatureRefs`, 'must be non-empty and unique');
          for (const ref of creatureRefs)
            if (!ref.startsWith('creature:'))
              fail(
                `${choicePath}.creatureRefs`,
                'must contain only creature:* references',
              );
          const card = validateCardinality(
            choice.cardinality,
            `${choicePath}.cardinality`,
          );
          if (card.mode !== 'maximum')
            fail(`${choicePath}.cardinality.mode`, 'must be maximum');
          if (creatureRefs.length > 1) {
            const composition = obj(
              choice.composition,
              `${choicePath}.composition`,
            );
            only(composition, `${choicePath}.composition`, [
              'kind',
              'ambiguityId',
            ]);
            if (
              composition.kind !== 'source-ambiguity' ||
              typeof composition.ambiguityId !== 'string' ||
              !composition.ambiguityId.startsWith('ambiguity:')
            )
              fail(
                `${choicePath}.composition`,
                'multi-reference composition must cite a source ambiguity',
              );
          } else if (choice.composition !== undefined)
            fail(
              `${choicePath}.composition`,
              'is not licensed for a single eligible creature reference',
            );
        }
      }
    } else fail(`${itemPath}.kind`, `has unknown scaling kind ${kind}`);
  }
}

function validateModifications(
  value: unknown,
  path: string,
  profile: Profile,
): void {
  const licensed: Readonly<Record<Profile, readonly string[]>> = {
    'control-window-undead': [],
    'animated-object': [],
    'ordinary-summon': [],
    'exceptional-concentration-summon': [],
    'persistent-familiar': ['cannot-attack'],
    'persistent-steed': ['ability-floor'],
    'target-transformation': [],
    'phantom-steed': ['speed-override'],
    simulacrum: [
      'hit-point-maximum',
      'no-equipment',
      'no-advancement-or-slot-recovery',
    ],
  };
  for (const [index, entry] of array(value, path).entries()) {
    const itemPath = `${path}[${index}]`;
    const modification = obj(entry, itemPath);
    const kind = str(modification, 'kind', itemPath);
    if (!licensed[profile].includes(kind))
      fail(`${itemPath}.kind`, `${kind} is not licensed by profile ${profile}`);
    if (kind === 'ability-floor') {
      only(modification, itemPath, [
        'kind',
        'ability',
        'minimum',
        'grantsLanguages',
        'languageEligibility',
      ]);
      if (
        modification.ability !== 'intelligence' ||
        modification.languageEligibility !== 'spoken-by-caster'
      )
        fail(itemPath, 'has invalid ability-floor relationship');
      integer(modification, 'minimum', itemPath);
      integer(modification, 'grantsLanguages', itemPath);
    } else if (kind === 'hit-point-maximum') {
      only(modification, itemPath, ['kind', 'value']);
      if (modification.value !== 'half-of-original')
        fail(`${itemPath}.value`, 'must be half-of-original');
    } else if (kind === 'speed-override') {
      only(modification, itemPath, ['kind', 'mode', 'feet']);
      if (modification.mode !== 'walk')
        fail(`${itemPath}.mode`, 'must be walk');
      if (integer(modification, 'feet', itemPath) !== 100)
        fail(`${itemPath}.feet`, 'must be 100');
    } else only(modification, itemPath, ['kind']);
  }
}

function validateProtocols(
  value: unknown,
  path: string,
  profile: Profile,
): void {
  const licensed: Readonly<Record<Profile, readonly string[]>> = {
    'control-window-undead': [],
    'animated-object': [],
    'ordinary-summon': [],
    'exceptional-concentration-summon': [],
    'persistent-familiar': [
      'telepathy',
      'familiar-sense-sharing',
      'familiar-touch-spell-delivery',
    ],
    'persistent-steed': ['telepathy', 'mounted-self-spell-sharing'],
    'target-transformation': [],
    'phantom-steed': [
      'created-equipment-tether',
      'designated-rider',
      'overland-travel',
      'fade-dismount-window',
    ],
    simulacrum: ['simulacrum-repair'],
  };
  const seen = new Set<string>();
  for (const [index, entry] of array(value, path).entries()) {
    const itemPath = `${path}[${index}]`;
    const protocol = obj(entry, itemPath);
    const kind = str(protocol, 'kind', itemPath);
    if (!licensed[profile].includes(kind))
      fail(`${itemPath}.kind`, `${kind} is not licensed by profile ${profile}`);
    if (seen.has(kind)) fail(`${itemPath}.kind`, 'must be unique');
    seen.add(kind);
    switch (kind) {
      case 'telepathy':
        only(protocol, itemPath, ['kind', 'rangeFeet']);
        integer(protocol, 'rangeFeet', itemPath);
        break;
      case 'familiar-sense-sharing':
        only(protocol, itemPath, [
          'kind',
          'cost',
          'requiresWithinFeet',
          'duration',
          'senses',
          'casterOwnSenses',
        ]);
        integer(protocol, 'requiresWithinFeet', itemPath);
        if (
          protocol.cost !== 'action' ||
          protocol.duration !== 'until-start-of-next-turn' ||
          protocol.senses !== 'familiar-including-special-senses'
        )
          fail(itemPath, 'has invalid sense-sharing procedure');
        exactSet(
          stringArray(protocol.casterOwnSenses, `${itemPath}.casterOwnSenses`),
          ['deaf', 'blind'],
          `${itemPath}.casterOwnSenses`,
        );
        break;
      case 'familiar-touch-spell-delivery':
        only(protocol, itemPath, [
          'kind',
          'spellRange',
          'origin',
          'requiresWithinFeet',
          'familiarCost',
          'attackModifier',
          'timing',
        ]);
        integer(protocol, 'requiresWithinFeet', itemPath);
        if (
          protocol.spellRange !== 'touch' ||
          protocol.origin !== 'familiar' ||
          protocol.familiarCost !== 'reaction' ||
          protocol.attackModifier !== 'caster' ||
          protocol.timing !== 'when-caster-casts'
        )
          fail(itemPath, 'has invalid touch-spell delivery procedure');
        break;
      case 'mounted-self-spell-sharing':
        only(protocol, itemPath, [
          'kind',
          'requiresMounted',
          'spellTargets',
          'alsoTargets',
        ]);
        if (
          protocol.requiresMounted !== true ||
          protocol.spellTargets !== 'caster-only' ||
          protocol.alsoTargets !== 'steed'
        )
          fail(itemPath, 'has invalid mounted spell-sharing relationship');
        break;
      case 'designated-rider':
        only(protocol, itemPath, ['kind', 'eligible']);
        if (protocol.eligible !== 'caster-or-chosen-creature')
          fail(`${itemPath}.eligible`, 'is invalid');
        break;
      case 'created-equipment-tether':
        only(protocol, itemPath, [
          'kind',
          'equipment',
          'maximumDistanceFeet',
          'outcome',
        ]);
        exactSet(
          stringArray(protocol.equipment, `${itemPath}.equipment`),
          ['saddle', 'bit', 'bridle'],
          `${itemPath}.equipment`,
        );
        integer(protocol, 'maximumDistanceFeet', itemPath);
        if (protocol.outcome !== 'vanishes')
          fail(`${itemPath}.outcome`, 'must be vanishes');
        break;
      case 'overland-travel':
        only(protocol, itemPath, [
          'kind',
          'normalMilesPerHour',
          'fastMilesPerHour',
        ]);
        integer(protocol, 'normalMilesPerHour', itemPath);
        integer(protocol, 'fastMilesPerHour', itemPath);
        break;
      case 'fade-dismount-window':
        only(protocol, itemPath, ['kind', 'durationMinutes', 'eligible']);
        if (protocol.durationMinutes !== 1 || protocol.eligible !== 'rider')
          fail(itemPath, 'must give the rider a one-minute dismount window');
        break;
      case 'simulacrum-repair':
        only(protocol, itemPath, [
          'kind',
          'requires',
          'costGpPerHitPoint',
          'result',
        ]);
        exactSet(
          stringArray(protocol.requires, `${itemPath}.requires`),
          ['alchemical-laboratory', 'rare-herbs-and-minerals'],
          `${itemPath}.requires`,
        );
        integer(protocol, 'costGpPerHitPoint', itemPath);
        if (protocol.result !== 'regain-hit-points')
          fail(`${itemPath}.result`, 'must be regain-hit-points');
        break;
    }
  }
  exactSet([...seen], licensed[profile], path);
}

function validateOverlay(value: unknown, path: string, profile: Profile): void {
  if (profile !== 'animated-object')
    fail(path, 'is licensed only for animated-object');
  const overlay = obj(value, path);
  only(overlay, path, [
    'creatureType',
    'tableRef',
    'abilityScores',
    'movement',
    'senses',
    'attack',
  ]);
  if (
    overlay.creatureType !== 'construct' ||
    !str(overlay, 'tableRef', path).startsWith('table:')
  )
    fail(path, 'requires construct type and a table:* reference');
  const abilities = obj(overlay.abilityScores, `${path}.abilityScores`);
  only(abilities, `${path}.abilityScores`, [
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ]);
  if (
    abilities.constitution !== 10 ||
    abilities.intelligence !== 3 ||
    abilities.wisdom !== 3 ||
    abilities.charisma !== 1
  )
    fail(`${path}.abilityScores`, 'must match the fixed source overlay');
  const movement = array(overlay.movement, `${path}.movement`).map(
    (entry, index) => obj(entry, `${path}.movement[${index}]`),
  );
  if (movement.length !== 3)
    fail(`${path}.movement`, 'must carry all three movement branches');
  only(movement[0], `${path}.movement[0]`, ['when', 'walkFeet']);
  only(movement[1], `${path}.movement[1]`, ['when', 'flyFeet', 'hover']);
  only(movement[2], `${path}.movement[2]`, [
    'when',
    'allSpeedsFeet',
    'overridesOtherMovement',
  ]);
  if (
    movement[0].when !== 'has-locomoting-appendages' ||
    movement[0].walkFeet !== 30 ||
    movement[1].when !== 'lacks-locomoting-appendages' ||
    movement[1].flyFeet !== 30 ||
    movement[1].hover !== true ||
    movement[2].when !== 'securely-attached' ||
    movement[2].allSpeedsFeet !== 0 ||
    movement[2].overridesOtherMovement !== true
  )
    fail(`${path}.movement`, 'does not match the fixed source branches');
  const senses = obj(overlay.senses, `${path}.senses`);
  only(senses, `${path}.senses`, ['blindsightFeet', 'blindBeyond']);
  if (senses.blindsightFeet !== 30 || senses.blindBeyond !== true)
    fail(`${path}.senses`, 'must be blindsight 30 and blind beyond');
  const attack = obj(overlay.attack, `${path}.attack`);
  only(attack, `${path}.attack`, [
    'count',
    'kind',
    'reachFeet',
    'attackBonus',
    'damage',
    'defaultDamageType',
    'contextualDamageTypes',
    'contextualClassification',
  ]);
  if (
    attack.count !== 1 ||
    attack.kind !== 'melee' ||
    attack.reachFeet !== 5 ||
    attack.attackBonus !== 'size-table' ||
    attack.damage !== 'size-table' ||
    attack.defaultDamageType !== 'bludgeoning' ||
    attack.contextualClassification !== 'model-adjudicated'
  )
    fail(`${path}.attack`, 'does not match the source attack procedure');
  exactSet(
    stringArray(
      attack.contextualDamageTypes,
      `${path}.attack.contextualDamageTypes`,
    ),
    ['slashing', 'piercing'],
    `${path}.attack.contextualDamageTypes`,
  );
}

function validateStatBlockBasis(
  value: unknown,
  path: string,
  profile: Profile,
): void {
  if (profile !== 'simulacrum') fail(path, 'is licensed only for simulacrum');
  const basis = obj(value, path);
  only(basis, path, ['kind', 'copied', 'interaction']);
  if (
    basis.kind !== 'copy-target' ||
    basis.copied !== 'all-statistics' ||
    basis.interaction !== 'normal-creature'
  )
    fail(
      path,
      'must copy all target statistics with normal-creature interaction',
    );
}

function validateProfileInvariants(
  effect: Obj,
  path: string,
  profile: Profile,
  creationKind: string,
  transitions: readonly ValidatedTransition[],
): void {
  const triggers = transitions.map((transition) => transition.trigger);
  const initial = obj(effect.initialState, `${path}.initialState`);
  const expectedInitial: Readonly<Record<Profile, State>> = {
    'control-window-undead': { control: 'controlled' },
    'animated-object': { effect: 'active', form: 'manifested' },
    'ordinary-summon': { effect: 'active', presence: 'present' },
    'exceptional-concentration-summon': {
      effect: 'active',
      presence: 'present',
      control: 'controlled',
      attitude: 'friendly',
    },
    'persistent-familiar': { presence: 'present', link: 'active' },
    'persistent-steed': { presence: 'present', link: 'active' },
    'target-transformation': { effect: 'active', form: 'manifested' },
    'phantom-steed': { effect: 'active', presence: 'present' },
    simulacrum: { effect: 'active', integrity: 'intact' },
  };
  for (const [axis, expected] of Object.entries(expectedInitial[profile])) {
    if (initial[axis] !== expected)
      fail(
        `${path}.initialState.${axis}`,
        `must be ${expected} for profile ${profile}`,
      );
  }

  const control = effect.control as Obj | undefined;
  if (profile === 'phantom-steed') {
    if (control !== undefined)
      fail(`${path}.control`, 'is not licensed by phantom-steed');
  } else if (control === undefined) {
    fail(`${path}.control`, `is required by profile ${profile}`);
  } else {
    const expectedRelationship: Readonly<
      Record<Exclude<Profile, 'phantom-steed'>, string>
    > = {
      'control-window-undead': 'controlled-obedient',
      'animated-object': 'controlled-obedient',
      'ordinary-summon': 'friendly-commanded',
      'exceptional-concentration-summon': 'friendly-commanded',
      'persistent-familiar': 'independent-always-obeys',
      'persistent-steed': 'bonded-mount',
      'target-transformation': 'obeys-verbal-commands',
      simulacrum: 'friendly-to-caster-and-designated-obeys-spoken',
    };
    if (
      control.relationship !==
      expectedRelationship[profile as Exclude<Profile, 'phantom-steed'>]
    )
      fail(
        `${path}.control.relationship`,
        `is incompatible with profile ${profile}`,
      );
    const allowedInitiative: Readonly<
      Partial<Record<Exclude<Profile, 'phantom-steed'>, readonly string[]>>
    > = {
      'control-window-undead': ['own-turn'],
      'animated-object': ['own-turn'],
      'ordinary-summon': ['own-turn', 'grouped-own-turns'],
      'exceptional-concentration-summon': ['own-turn'],
      'persistent-familiar': ['own-turn'],
      'target-transformation': ['caster-turn'],
      simulacrum: ['caster-turn'],
    };
    const licensedInitiative =
      allowedInitiative[profile as Exclude<Profile, 'phantom-steed'>] ?? [];
    if (
      control.initiative !== undefined &&
      !licensedInitiative.includes(String(control.initiative))
    )
      fail(
        `${path}.control.initiative`,
        `is incompatible with profile ${profile}`,
      );
    const commandRequired = [
      'control-window-undead',
      'animated-object',
      'ordinary-summon',
      'exceptional-concentration-summon',
      'target-transformation',
      'simulacrum',
    ].includes(profile);
    if ((control.command !== undefined) !== commandRequired)
      fail(
        `${path}.control.command`,
        commandRequired
          ? `is required by profile ${profile}`
          : `is not licensed by profile ${profile}`,
      );
    const initiativeRequired = !['persistent-steed'].includes(profile);
    if ((control.initiative !== undefined) !== initiativeRequired)
      fail(
        `${path}.control.initiative`,
        initiativeRequired
          ? `is required by profile ${profile}`
          : `is not licensed by profile ${profile}`,
      );
  }

  const placement = effect.placement as Obj | undefined;
  if (profile === 'simulacrum') {
    if (placement !== undefined)
      fail(`${path}.placement`, 'is not licensed by simulacrum');
  } else if (placement === undefined) {
    fail(`${path}.placement`, `is required by profile ${profile}`);
  } else {
    const requiredKind = [
      'control-window-undead',
      'animated-object',
      'target-transformation',
    ].includes(profile)
      ? 'target-location'
      : profile === 'exceptional-concentration-summon' &&
          creationKind === 'candidate'
        ? 'relative-to-selected-source'
        : 'within-spell-range';
    if (placement.kind !== requiredKind)
      fail(
        `${path}.placement.kind`,
        `must be ${requiredKind} for profile ${profile}`,
      );
    if (
      ['ordinary-summon'].includes(profile) ||
      (profile === 'exceptional-concentration-summon' &&
        creationKind === 'candidate-menu')
    ) {
      if (placement.unoccupied !== true || placement.visible !== true)
        fail(
          `${path}.placement`,
          'must require visible and unoccupied placement',
        );
    }
    if (profile === 'phantom-steed' && placement.onGround !== true)
      fail(`${path}.placement.onGround`, 'must be true');
    if (
      ['persistent-familiar', 'persistent-steed', 'phantom-steed'].includes(
        profile,
      ) &&
      placement.unoccupied !== true
    )
      fail(`${path}.placement.unoccupied`, 'must be true');
  }

  const expectedModificationKinds: Readonly<
    Partial<Record<Profile, readonly string[]>>
  > = {
    'persistent-familiar': ['cannot-attack'],
    'persistent-steed': ['ability-floor'],
    'phantom-steed': ['speed-override'],
    simulacrum: [
      'hit-point-maximum',
      'no-equipment',
      'no-advancement-or-slot-recovery',
    ],
  };
  const expectedModifications = expectedModificationKinds[profile] ?? [];
  const actualModifications = Array.isArray(effect.modifications)
    ? (effect.modifications as Obj[]).map((entry) => String(entry.kind))
    : [];
  exactSet(
    actualModifications,
    expectedModifications,
    `${path}.modifications kinds`,
  );
  if (profile === 'control-window-undead') {
    if ((effect.control as Obj | undefined)?.window === undefined)
      fail(`${path}.control.window`, 'is required');
    exactSet(
      triggers,
      ['control-window-expired', 'cast-to-reassert-control'],
      `${path}.transitions triggers`,
    );
  }
  if (profile === 'ordinary-summon')
    exactSet(
      triggers,
      ['spell-ended', 'zero-hit-points'],
      `${path}.transitions triggers`,
    );
  if (profile === 'exceptional-concentration-summon') {
    exactSet(
      triggers,
      [
        'spell-ended',
        'zero-hit-points',
        'concentration-broken',
        'absolute-time-reached',
      ],
      `${path}.transitions triggers`,
    );
    const precedence = obj(effect.causePrecedence, `${path}.causePrecedence`);
    only(precedence, `${path}.causePrecedence`, ['higher', 'lower']);
    if (
      precedence.higher !== 'concentration-broken' ||
      precedence.lower !== 'spell-ended'
    )
      fail(
        `${path}.causePrecedence`,
        'must give concentration-broken precedence over spell-ended',
      );
    const spellEnd = transitions.find(
      (transition) => transition.trigger === 'spell-ended',
    );
    const rawSpellEnd = (effect.transitions as Obj[]).find(
      (transition) => transition.trigger === 'spell-ended',
    );
    const rawConcentrationBreak = (effect.transitions as Obj[]).find(
      (transition) => transition.trigger === 'concentration-broken',
    );
    if (
      spellEnd === undefined ||
      !Array.isArray(rawSpellEnd?.exceptCauses) ||
      !rawSpellEnd.exceptCauses.includes('concentration-broken')
    )
      fail(
        `${path}.transitions`,
        'exceptional spell-end removal must exclude concentration-broken',
      );
    if (
      !Array.isArray(rawConcentrationBreak?.restrictions) ||
      !rawConcentrationBreak.restrictions.includes('caster-cannot-dismiss')
    )
      fail(
        `${path}.transitions`,
        'exceptional concentration-break transition must prohibit caster dismissal',
      );
  } else if (effect.causePrecedence !== undefined)
    fail(`${path}.causePrecedence`, `is not licensed by profile ${profile}`);
  if (profile === 'persistent-familiar') {
    exactMultiset(
      triggers,
      [
        'zero-hit-points',
        'action-temporary-dismissal',
        'action-recall',
        'action-permanent-dismissal',
        'action-permanent-dismissal',
        'cast-again',
        'cast-again',
        'cast-again',
      ],
      `${path}.transitions triggers`,
    );
    const absentPermanentDismissal = transitions.find(
      (transition) =>
        transition.trigger === 'action-permanent-dismissal' &&
        transition.when.presence?.length === 1 &&
        transition.when.presence[0] === 'absent',
    );
    if (
      absentPermanentDismissal?.ambiguityId !==
      'ambiguity:find-familiar-permanent-dismissal-after-zero-hp'
    )
      fail(
        `${path}.transitions`,
        'zero-HP-absence permanent dismissal must be gated by its source ambiguity',
      );
    if (effect.typeTreatment === undefined)
      fail(`${path}.typeTreatment`, 'is required');
  }
  if (profile === 'persistent-steed') {
    exactSet(
      triggers,
      ['zero-hit-points', 'action-dismissal', 'action-release', 'cast-again'],
      `${path}.transitions triggers`,
    );
    if (effect.typeTreatment === undefined)
      fail(`${path}.typeTreatment`, 'is required');
  }
  if (profile === 'target-transformation')
    exactSet(
      triggers,
      ['spell-ended', 'zero-hit-points', 'action-dismissal'],
      `${path}.transitions triggers`,
    );
  if (profile === 'phantom-steed')
    exactSet(
      triggers,
      ['spell-ended', 'action-dismissal', 'damage-taken', 'fade-completed'],
      `${path}.transitions triggers`,
    );
  if (profile === 'simulacrum')
    exactSet(
      triggers,
      ['zero-hit-points', 'cast-again', 'dispelled'],
      `${path}.transitions triggers`,
    );
  if (profile === 'animated-object')
    exactSet(
      triggers,
      ['spell-ended', 'zero-hit-points'],
      `${path}.transitions triggers`,
    );
  if (profile !== 'animated-object' && effect.statBlockOverlay !== undefined)
    fail(`${path}.statBlockOverlay`, `is not licensed by profile ${profile}`);
  if (profile === 'animated-object' && effect.statBlockOverlay === undefined)
    fail(`${path}.statBlockOverlay`, 'is required');
  if (profile === 'simulacrum' && effect.statBlockBasis === undefined)
    fail(`${path}.statBlockBasis`, 'is required');
  if (
    profile === 'ordinary-summon' &&
    effect.typeTreatment !== undefined &&
    creationKind !== 'candidate-menu'
  )
    fail(
      `${path}.typeTreatment`,
      'ordinary type addition requires a candidate menu',
    );
  if (
    profile === 'exceptional-concentration-summon' &&
    (effect.typeTreatment !== undefined) !== (creationKind === 'candidate-menu')
  )
    fail(
      `${path}.typeTreatment`,
      creationKind === 'candidate-menu'
        ? 'is required for the beast-form alternative'
        : 'is not licensed for the elemental candidate',
    );
}

export function validateS1SummoningEffect(effect: Obj, path: string): void {
  only(effect, path, [
    'kind',
    'profile',
    'creation',
    'typeTreatment',
    'placement',
    'control',
    'identity',
    'initialState',
    'transitions',
    'causePrecedence',
    'scaling',
    'modifications',
    'protocols',
    'statBlockOverlay',
    'statBlockBasis',
    'hooks',
    'contextualRulings',
  ]);
  const profile = str(effect, 'profile', path) as Profile;
  if (!(profile in PROFILES))
    fail(`${path}.profile`, 'is not a recognized S1 profile');
  const creation = obj(effect.creation, `${path}.creation`);
  const creationKind = validateCreation(creation, `${path}.creation`, profile);
  if (effect.typeTreatment !== undefined)
    validateTypeTreatment(
      effect.typeTreatment,
      `${path}.typeTreatment`,
      profile,
      creation,
    );
  if (effect.placement !== undefined)
    validatePlacement(effect.placement, `${path}.placement`);
  if (effect.control !== undefined)
    validateControl(effect.control, `${path}.control`, profile);
  validateIdentity(effect.identity, `${path}.identity`, profile);
  const initial = validateStateSelector(
    effect.initialState,
    `${path}.initialState`,
    profile,
    true,
  );
  const transitions = validateTransitions(
    effect.transitions,
    `${path}.transitions`,
    profile,
  );
  validateReachability(initial, transitions, profile);
  if (effect.scaling !== undefined)
    validateScaling(effect.scaling, `${path}.scaling`, profile);
  if (effect.modifications !== undefined)
    validateModifications(
      effect.modifications,
      `${path}.modifications`,
      profile,
    );
  if (effect.protocols !== undefined)
    validateProtocols(effect.protocols, `${path}.protocols`, profile);
  else if (
    [
      'persistent-familiar',
      'persistent-steed',
      'phantom-steed',
      'simulacrum',
    ].includes(profile)
  )
    fail(`${path}.protocols`, `is required by profile ${profile}`);
  if (effect.statBlockOverlay !== undefined)
    validateOverlay(
      effect.statBlockOverlay,
      `${path}.statBlockOverlay`,
      profile,
    );
  if (effect.statBlockBasis !== undefined)
    validateStatBlockBasis(
      effect.statBlockBasis,
      `${path}.statBlockBasis`,
      profile,
    );
  const hooks = stringArray(effect.hooks, `${path}.hooks`);
  exactSet(hooks, PROFILES[profile].hooks, `${path}.hooks`);
  const licensedContextualRulings =
    profile === 'persistent-steed'
      ? ['gm-may-allow-other-steed-forms']
      : profile === 'exceptional-concentration-summon'
        ? ['hostile-actions-model-adjudicated']
        : profile === 'target-transformation'
          ? ['gm-may-map-analogous-targets', 'gm-resolves-actions-and-movement']
          : profile === 'phantom-steed'
            ? ['caster-chooses-appearance']
            : [];
  if (effect.contextualRulings !== undefined) {
    const rulings = stringArray(
      effect.contextualRulings,
      `${path}.contextualRulings`,
    );
    exactSet(rulings, licensedContextualRulings, `${path}.contextualRulings`);
  } else if (licensedContextualRulings.length > 0)
    fail(`${path}.contextualRulings`, `is required by profile ${profile}`);
  validateProfileInvariants(effect, path, profile, creationKind, transitions);
}

export function summoningHasTransitionTrigger(
  effect: Obj,
  trigger: string,
): boolean {
  return (
    Array.isArray(effect.transitions) &&
    effect.transitions.some(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as Obj).trigger === trigger,
    )
  );
}
