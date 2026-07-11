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
    expect(() =>
      validateModifiers([{ label: 'x', value: 1.5 }], 't'),
    ).toThrow(ResolutionError);
    expect(() =>
      validateModifiers([{ label: 'x', value: 101 }], 't'),
    ).toThrow(ResolutionError);
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
    expect(() => validateProficiency({ bonus: -1, multiplier: 'normal' }, 't'))
      .toThrow(ResolutionError);
    expect(() => validateProficiency({ bonus: 2, multiplier: 'triple' }, 't'))
      .toThrow(ResolutionError);
    expect(() => validateProficiency({ bonus: 2.5, multiplier: 'half' }, 't'))
      .toThrow(ResolutionError);
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
    expect(crit.packets[0].subtotal).toBe(
      crit.packets[0].natural + 2 + 3,
    );
  });

  it('clamps each packet at 0 (never negative), independently', () => {
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
    expect(res.packets[0].subtotal).toBe(0);
    // The penalized packet never eats the other packet's damage.
    expect(res.total).toBe(res.packets[1].subtotal);
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
    const subtotal = res.packets[0].subtotal;
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
    expect(plain).toBe(res.packets[0].subtotal);
    expect(resisted).toBe(Math.floor(plain / 2));
  });

  it('only halves/doubles packets of the matching type', () => {
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
    const [piercing, poison] = res.packets;
    expect(res.targets?.[0].packetDamage).toEqual([
      piercing.subtotal,
      Math.floor(poison.subtotal / 2),
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
