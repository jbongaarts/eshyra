import { describe, expect, it } from 'vitest';
import {
  createSeededRng,
  effectiveAdvantageState,
  ResolutionError,
  resolveContest,
  resolveD20,
  resolveDamage,
} from '../src/internal.js';
import {
  validateModifiers,
  validateProficiency,
} from '../src/orchestrator/resolution.js';

/**
 * F9 deterministic resolution primitives (eshyra-2n1t.11): modifier
 * composition with provenance, proficiency apply-once, adv/dis cancellation,
 * vs-DC/AC with nat-1/20 attack overrides, contests (tie = status quo), and
 * damage composition (crit doubling, never-negative, roll-once multi-target,
 * resistance/vulnerability/immunity ordering).
 */

const PROF = (bonus: number, multiplier: string) =>
  validateProficiency({ bonus, multiplier }, 'test');

describe('advantage/disadvantage cancellation', () => {
  it('cancels pairwise and never stacks', () => {
    expect(effectiveAdvantageState(false, false)).toBe('none');
    expect(effectiveAdvantageState(true, false)).toBe('advantage');
    expect(effectiveAdvantageState(false, true)).toBe('disadvantage');
    expect(effectiveAdvantageState(true, true)).toBe('none');
  });

  it('rolls 2d20 and keeps the higher die under advantage', () => {
    const res = resolveD20(
      { kind: 'ability_check', advantage: true },
      createSeededRng(11),
    );
    expect(res.dice).toBe('2d20kh1');
    expect(res.rolls).toHaveLength(2);
    expect(res.natural).toBe(Math.max(...res.rolls));
    expect(res.advantageState).toBe('advantage');
  });

  it('preserves the canonical kept/dropped selection, including tied dice', () => {
    const adv = resolveD20(
      { kind: 'ability_check', advantage: true },
      createSeededRng(11),
    );
    expect([...adv.kept, ...adv.dropped].sort()).toEqual([...adv.rolls].sort());
    expect(adv.keptIndices).toHaveLength(1);
    expect(adv.rolls[adv.keptIndices[0]]).toBe(adv.natural);

    // Tied advantage dice: values alone cannot identify the selection, so
    // the indices must — dice.ts keeps the earlier-rolled die on a tie.
    let seed = 0;
    let tied = resolveD20(
      { kind: 'attack', advantage: true },
      createSeededRng(seed),
    );
    while (tied.rolls[0] !== tied.rolls[1]) {
      seed += 1;
      tied = resolveD20(
        { kind: 'attack', advantage: true },
        createSeededRng(seed),
      );
    }
    expect(tied.keptIndices).toEqual([0]);
    expect(tied.droppedIndices).toEqual([1]);
    expect(tied.kept).toEqual([tied.rolls[0]]);
    expect(
      resolveD20({ kind: 'attack', advantage: true }, createSeededRng(seed)),
    ).toEqual(tied);
  });

  it('rolls a single straight d20 when both flags are declared', () => {
    const res = resolveD20(
      { kind: 'saving_throw', advantage: true, disadvantage: true },
      createSeededRng(11),
    );
    expect(res.dice).toBe('1d20');
    expect(res.rolls).toHaveLength(1);
    expect(res.advantageState).toBe('none');
    expect(res.declaredAdvantage).toBe(true);
    expect(res.declaredDisadvantage).toBe(true);
  });
});

describe('modifier composition and provenance', () => {
  it('sums declared modifiers and preserves identity/order', () => {
    const modifiers = validateModifiers(
      [
        { label: 'DEX modifier', value: 3, source: 'character:kira' },
        { label: 'half cover', value: 2, source: 'cover:half' },
        { label: 'bane', value: -2, source: 'spell:bane' },
      ],
      'test',
    );
    const res = resolveD20(
      { kind: 'ability_check', modifiers },
      createSeededRng(2),
    );
    expect(res.modifiers).toEqual(modifiers);
    expect(res.modifierTotal).toBe(3);
    expect(res.total).toBe(res.natural + 3);
  });

  it('applies proficiency at most once, with SRD multiplier semantics', () => {
    expect(PROF(3, 'normal')?.applied).toBe(3);
    expect(PROF(3, 'double')?.applied).toBe(6);
    // Halving rounds down (SRD division rule).
    expect(PROF(3, 'half')?.applied).toBe(1);
    expect(PROF(5, 'half')?.applied).toBe(2);
    // Not proficient: contributes 0 even when a feature doubles it (0 × n = 0).
    expect(PROF(4, 'none')?.applied).toBe(0);
  });

  it('rejects malformed modifiers fail-closed', () => {
    expect(() => validateModifiers([{ label: '', value: 1 }], 't')).toThrow(
      ResolutionError,
    );
    expect(() => validateModifiers([{ label: 'x', value: 1.5 }], 't')).toThrow(
      ResolutionError,
    );
    expect(() => validateModifiers([{ label: 'x', value: 101 }], 't')).toThrow(
      ResolutionError,
    );
    expect(() =>
      validateModifiers(
        Array.from({ length: 21 }, (_, i) => ({ label: `m${i}`, value: 1 })),
        't',
      ),
    ).toThrow(ResolutionError);
    expect(() =>
      validateModifiers([{ label: 'x', value: 1, source: '' }], 't'),
    ).toThrow(ResolutionError);
  });

  it('rejects malformed proficiency fail-closed', () => {
    expect(() =>
      validateProficiency({ bonus: -1, multiplier: 'normal' }, 't'),
    ).toThrow(ResolutionError);
    expect(() =>
      validateProficiency({ bonus: 2, multiplier: 'triple' }, 't'),
    ).toThrow(ResolutionError);
    expect(() =>
      validateProficiency({ bonus: 2.5, multiplier: 'half' }, 't'),
    ).toThrow(ResolutionError);
  });
});

describe('vs-DC/AC resolution and nat 1/20', () => {
  function attackWithNatural(target: number) {
    // Search seeds until the kept natural die equals the target value.
    for (let seed = 0; seed < 10000; seed += 1) {
      const res = resolveD20(
        { kind: 'attack', vs: 15, modifiers: [{ label: 'STR', value: 2 }] },
        createSeededRng(seed),
      );
      if (res.natural === target) {
        return { res, seed };
      }
    }
    throw new Error(`no seed found for natural ${target}`);
  }

  it('natural 20 hits regardless of AC and marks critical', () => {
    const { seed } = attackWithNatural(20);
    const res = resolveD20(
      { kind: 'attack', vs: 99, modifiers: [{ label: 'STR', value: 2 }] },
      createSeededRng(seed),
    );
    expect(res.natural).toBe(20);
    expect(res.outcome).toBe('hit');
    expect(res.critical).toBe(true);
    expect(res.fumble).toBe(false);
  });

  it('natural 1 misses regardless of modifiers', () => {
    const { seed } = attackWithNatural(1);
    const res = resolveD20(
      {
        kind: 'attack',
        vs: 2,
        modifiers: [{ label: 'huge bonus', value: 50 }],
      },
      createSeededRng(seed),
    );
    expect(res.natural).toBe(1);
    expect(res.total).toBe(51);
    expect(res.outcome).toBe('miss');
    expect(res.fumble).toBe(true);
  });

  it('checks and saves have no natural auto success/failure', () => {
    const { seed: natTwentySeed } = attackWithNatural(20);
    const impossible = resolveD20(
      { kind: 'ability_check', vs: 99 },
      createSeededRng(natTwentySeed),
    );
    expect(impossible.natural).toBe(20);
    expect(impossible.outcome).toBe('failure');
    expect(impossible.critical).toBeUndefined();

    const { seed: natOneSeed } = attackWithNatural(1);
    const trivial = resolveD20(
      { kind: 'saving_throw', vs: 2, modifiers: [{ label: 'CON', value: 5 }] },
      createSeededRng(natOneSeed),
    );
    expect(trivial.natural).toBe(1);
    expect(trivial.outcome).toBe('success');
  });

  it('meets-it-beats-it: total equal to the DC succeeds', () => {
    for (let seed = 0; seed < 10000; seed += 1) {
      const res = resolveD20(
        { kind: 'ability_check', vs: 10 },
        createSeededRng(seed),
      );
      if (res.natural === 10) {
        expect(res.total).toBe(10);
        expect(res.outcome).toBe('success');
        return;
      }
    }
    throw new Error('no natural 10 seed found');
  });

  it('omits the outcome when vs is omitted (DC ruled later)', () => {
    const res = resolveD20({ kind: 'ability_check' }, createSeededRng(6));
    expect(res.outcome).toBeUndefined();
    expect(res.vs).toBeUndefined();
  });
});

describe('contests', () => {
  it('rolls side a first, then side b, deterministically', () => {
    const rng = createSeededRng(77);
    const first = rng.nextInt(20) + 1;
    const second = rng.nextInt(20) + 1;
    const contest = resolveContest(
      { label: 'Brog' },
      { label: 'bandit' },
      createSeededRng(77),
    );
    expect(contest.a.rolls).toEqual([first]);
    expect(contest.b.rolls).toEqual([second]);
  });

  it('higher total wins; the winner is named', () => {
    const contest = resolveContest(
      { label: 'Brog', modifiers: [{ label: 'Athletics', value: 50 }] },
      { label: 'bandit' },
      createSeededRng(1),
    );
    expect(contest.outcome).toBe('a');
    expect(contest.winner).toBe('Brog');
  });

  it('tie means the situation stays as it was (no winner)', () => {
    for (let seed = 0; seed < 20000; seed += 1) {
      const contest = resolveContest(
        { label: 'a' },
        { label: 'b' },
        createSeededRng(seed),
      );
      if (contest.a.total === contest.b.total) {
        expect(contest.outcome).toBe('tie');
        expect(contest.winner).toBeUndefined();
        return;
      }
    }
    throw new Error('no tie seed found');
  });

  it('supports per-side advantage and proficiency', () => {
    const contest = resolveContest(
      {
        label: 'hidden rogue',
        advantage: true,
        proficiency: PROF(3, 'double'),
      },
      { label: 'guard', disadvantage: true },
      createSeededRng(9),
    );
    expect(contest.a.dice).toBe('2d20kh1');
    expect(contest.a.proficiency?.applied).toBe(6);
    expect(contest.b.dice).toBe('2d20kl1');
  });
});

describe('damage composition', () => {
  it('doubles dice count (not modifiers) on a critical hit', () => {
    const normal = resolveDamage(
      {
        packets: [
          {
            dice: '1d8+2',
            type: 'slashing',
            modifiers: [{ label: 'STR', value: 3 }],
          },
        ],
      },
      createSeededRng(4),
    );
    expect(normal.packets[0].dice).toBe('1d8+2');
    expect(normal.packets[0].rolls).toHaveLength(1);

    const crit = resolveDamage(
      {
        packets: [
          {
            dice: '1d8+2',
            type: 'slashing',
            modifiers: [{ label: 'STR', value: 3 }],
          },
        ],
        critical: true,
      },
      createSeededRng(4),
    );
    expect(crit.packets[0].dice).toBe('2d8+2');
    expect(crit.packets[0].declaredDice).toBe('1d8+2');
    expect(crit.packets[0].rolls).toHaveLength(2);
    // Flat +2 notation modifier and the +3 declared modifier apply once.
    expect(crit.packets[0].contribution).toBe(crit.packets[0].natural + 2 + 3);
  });

  it('applies never-negative per damage type, never bleeding across types', () => {
    // 1d4 - 10 is negative for every die face, so the clamp always engages.
    const res = resolveDamage(
      {
        packets: [
          {
            dice: '1d4',
            type: 'bludgeoning',
            modifiers: [{ label: 'penalty', value: -10 }],
          },
          { dice: '1d4', type: 'fire' },
        ],
      },
      createSeededRng(0),
    );
    // The packet keeps its raw (negative) contribution for the audit trail;
    // the min-0 clamp lives on the per-type aggregate.
    expect(res.packets[0].contribution).toBeLessThan(0);
    expect(res.byType).toEqual([
      { type: 'bludgeoning', subtotal: 0 },
      { type: 'fire', subtotal: res.packets[1].contribution },
    ]);
    // The negative bludgeoning aggregate never eats the fire damage.
    expect(res.total).toBe(res.packets[1].contribution);
  });

  it('lets a penalty offset other same-type damage in the same instance', () => {
    // Weapon packet at 1d4 - 10 (negative) plus same-type sneak dice at
    // 1d4 + 12: one damage instance, one type, so the totals aggregate
    // before the never-negative clamp — the penalty is not swallowed by a
    // per-packet floor.
    const res = resolveDamage(
      {
        packets: [
          {
            dice: '1d4',
            type: 'piercing',
            label: 'weapon',
            modifiers: [{ label: 'penalty', value: -10 }],
          },
          { dice: '1d4+12', type: 'piercing', label: 'sneak attack' },
        ],
      },
      createSeededRng(0),
    );
    const expected = res.packets[0].natural - 10 + res.packets[1].natural + 12;
    expect(res.byType).toEqual([{ type: 'piercing', subtotal: expected }]);
    expect(res.total).toBe(expected);
  });

  it('applies immunity, then resistance (floor half), then vulnerability, after modifiers', () => {
    const res = resolveDamage(
      {
        packets: [
          {
            dice: '2d6+3',
            type: 'fire',
            modifiers: [{ label: 'aura', value: -2 }],
          },
        ],
        targets: [
          { label: 'immune', immunities: ['fire'] },
          { label: 'resistant', resistances: ['fire'] },
          { label: 'vulnerable', vulnerabilities: ['fire'] },
          {
            label: 'both',
            resistances: ['fire'],
            vulnerabilities: ['fire'],
          },
          { label: 'plain' },
        ],
      },
      createSeededRng(15),
    );
    const subtotal = res.byType[0].subtotal;
    const byLabel = new Map(res.targets?.map((t) => [t.label, t.total]));
    expect(byLabel.get('immune')).toBe(0);
    expect(byLabel.get('resistant')).toBe(Math.floor(subtotal / 2));
    expect(byLabel.get('vulnerable')).toBe(subtotal * 2);
    // SRD ordering: resistance then vulnerability.
    expect(byLabel.get('both')).toBe(Math.floor(subtotal / 2) * 2);
    expect(byLabel.get('plain')).toBe(subtotal);
  });

  it('rolls once and applies the identical dice to every target', () => {
    const res = resolveDamage(
      {
        packets: [{ dice: '8d6', type: 'fire' }],
        targets: [
          { label: 'goblin 1' },
          { label: 'goblin 2', resistances: ['fire'] },
        ],
      },
      createSeededRng(30),
    );
    expect(res.packets[0].rolls).toHaveLength(8);
    const plain = res.targets?.[0].total ?? 0;
    const resisted = res.targets?.[1].total ?? 0;
    expect(plain).toBe(res.byType[0].subtotal);
    expect(resisted).toBe(Math.floor(plain / 2));
  });

  it('only halves/doubles aggregates of the matching type', () => {
    const res = resolveDamage(
      {
        packets: [
          { dice: '1d8+3', type: 'piercing' },
          { dice: '2d6', type: 'poison' },
        ],
        targets: [{ label: 'wight', resistances: ['poison'] }],
      },
      createSeededRng(8),
    );
    const [piercing, poison] = res.byType;
    expect(res.targets?.[0].typeDamage).toEqual([
      { type: 'piercing', subtotal: piercing.subtotal },
      { type: 'poison', subtotal: Math.floor(poison.subtotal / 2) },
    ]);
  });

  it('rejects keep/drop notation in damage packets (fail closed)', () => {
    expect(() =>
      resolveDamage(
        { packets: [{ dice: '4d6dl1', type: 'fire' }] },
        createSeededRng(1),
      ),
    ).toThrow(ResolutionError);
  });

  it('rejects duplicate resistance declarations instead of stacking', () => {
    expect(() =>
      resolveDamage(
        {
          packets: [{ dice: '1d6', type: 'fire' }],
          targets: [
            {
              label: 'x',
              // Multiple instances count once (SRD) — a duplicate declaration
              // is a malformed call, not a stacking request.
              resistances: ['fire', 'fire'],
            },
          ],
        },
        createSeededRng(1),
      ),
    ).toThrow(ResolutionError);
  });

  it('rejects empty and oversized packet lists', () => {
    expect(() => resolveDamage({ packets: [] }, createSeededRng(1))).toThrow(
      ResolutionError,
    );
    expect(() =>
      resolveDamage(
        {
          packets: Array.from({ length: 11 }, () => ({
            dice: '1d4',
            type: 'fire' as const,
          })),
        },
        createSeededRng(1),
      ),
    ).toThrow(ResolutionError);
  });

  it('replays byte-identically under a fixed seed', () => {
    const input = {
      packets: [
        {
          dice: '1d8+1',
          type: 'slashing' as const,
          modifiers: [{ label: 'STR', value: 3 }],
        },
        { dice: '2d6', type: 'radiant' as const, label: 'smite' },
      ],
      critical: true,
      targets: [{ label: 'skeleton', vulnerabilities: ['radiant' as const] }],
    };
    const first = resolveDamage(input, createSeededRng(123));
    const second = resolveDamage(input, createSeededRng(123));
    expect(second).toEqual(first);
  });
});
describe('damage partitioning is mechanically irrelevant (metamorphic)', () => {
  it('splitting one damage roll into packets never changes any total', () => {
    // Same dice count/faces in the same RNG draw order, so both calls see
    // identical dice: [1d6, 1d6+3] fire ≡ [2d6+3] fire.
    const targets = [
      { label: 'plain' },
      { label: 'resistant', resistances: ['fire' as const] },
      { label: 'vulnerable', vulnerabilities: ['fire' as const] },
    ];
    for (let seed = 0; seed < 25; seed += 1) {
      const split = resolveDamage(
        {
          packets: [
            { dice: '1d6', type: 'fire' },
            { dice: '1d6+3', type: 'fire' },
          ],
          targets,
        },
        createSeededRng(seed),
      );
      const combined = resolveDamage(
        { packets: [{ dice: '2d6+3', type: 'fire' }], targets },
        createSeededRng(seed),
      );
      expect(split.packets.flatMap((packet) => packet.rolls)).toEqual(
        combined.packets.flatMap((packet) => packet.rolls),
      );
      expect(split.byType).toEqual(combined.byType);
      expect(split.total).toBe(combined.total);
      expect(split.targets).toEqual(combined.targets);
    }
  });

  it('moving a declared modifier between same-type packets changes nothing', () => {
    const modifiers = [{ label: 'STR', value: 3 }];
    const onWeapon = resolveDamage(
      {
        packets: [
          { dice: '1d6', type: 'piercing', modifiers },
          { dice: '2d6', type: 'piercing' },
        ],
      },
      createSeededRng(77),
    );
    const onSneak = resolveDamage(
      {
        packets: [
          { dice: '1d6', type: 'piercing' },
          { dice: '2d6', type: 'piercing', modifiers },
        ],
      },
      createSeededRng(77),
    );
    expect(onWeapon.byType).toEqual(onSneak.byType);
    expect(onWeapon.total).toBe(onSneak.total);
  });

  it('resistance rounding applies once per type, not once per packet', () => {
    // Find a seed where both 1d2 packets roll 1: the aggregate is 2 fire, so
    // a resistant target takes floor(2/2) = 1 — per-packet rounding would
    // have produced floor(1/2) + floor(1/2) = 0.
    for (let seed = 0; seed < 1000; seed += 1) {
      const res = resolveDamage(
        {
          packets: [
            { dice: '1d2', type: 'fire' },
            { dice: '1d2', type: 'fire' },
          ],
          targets: [{ label: 'resistant', resistances: ['fire'] }],
        },
        createSeededRng(seed),
      );
      if (res.packets[0].natural === 1 && res.packets[1].natural === 1) {
        expect(res.byType).toEqual([{ type: 'fire', subtotal: 2 }]);
        expect(res.targets?.[0].total).toBe(1);
        return;
      }
    }
    throw new Error('no [1, 1] seed found');
  });
});
