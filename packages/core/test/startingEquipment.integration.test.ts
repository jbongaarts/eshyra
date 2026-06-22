import { describe, expect, it } from 'vitest';
import type {
  ModelClient,
  ModelCompleteInput,
  ModelCompleteResult,
} from '../src/internal.js';
import {
  createDefaultToolRegistry,
  ModelTurnAuditor,
  openScene,
  runTurn,
} from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';

class StructuredScriptedModel implements ModelClient {
  private index = 0;

  constructor(private readonly results: readonly ModelCompleteResult[]) {}

  complete(): Promise<ModelCompleteResult> {
    const result = this.results[this.index] ?? { text: '' };
    this.index += 1;
    return Promise.resolve(result);
  }
}

class StartingKitEvidenceAuditModel implements ModelClient {
  readonly seen: ModelCompleteInput[] = [];

  complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const evidence = String(input.messages[0]?.content ?? '');
    const requiredEvidence = [
      '\\"name\\":\\"crossbow bolts\\"',
      '\\"name\\":\\"dungeoneer\'s pack\\"',
      '\\"id\\":\\"crossbow-bolts\\"',
      '\\"quantity\\":20',
      '\\"id\\":\\"chain-mail\\"',
      '\\"id\\":\\"longsword\\"',
      '\\"id\\":\\"shield\\"',
      '\\"id\\":\\"light-crossbow\\"',
      '\\"id\\":\\"dungeoneers-pack\\"',
    ];
    const supported = requiredEvidence.every((fragment) =>
      evidence.includes(fragment),
    );
    return Promise.resolve({
      text: JSON.stringify(
        supported
          ? { verdict: 'accept', missingRequiredCalls: [] }
          : {
              verdict: 'reject',
              missingRequiredCalls: [
                { tool: 'lookup_rules', target: 'starting equipment' },
                { tool: 'give_item', target: 'quantity-bearing fighter kit' },
              ],
              reason: 'starting-kit evidence is incomplete',
              repairInstruction:
                'Resolve the real SRD records and include explicit quantities.',
            },
      ),
    });
  }
}

const nativeCall = (id: string, name: string, args: unknown) => ({
  id,
  name,
  args,
});

describe('fighter starting equipment flow', () => {
  it('resolves real SRD aliases, passes quantity audit, and commits the full kit', async () => {
    const db = freshDbWithSession();
    db.prepare(
      `UPDATE character
       SET name = 'Bob', class_name = 'Fighter', level = 1
       WHERE id = 'pc-1'`,
    ).run();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-0',
      title: 'Character creation',
      at: '2026-05-20T09:00:00.000Z',
    });

    const model = new StructuredScriptedModel([
      {
        text: '',
        toolCalls: [
          nativeCall('lookup-fighter', 'lookup_rules', {
            kind: 'class',
            name: 'Fighter',
          }),
          ...[
            'chain mail',
            'longsword',
            'shield',
            'light crossbow',
            'crossbow bolts',
            "dungeoneer's pack",
          ].map((name, index) =>
            nativeCall(`lookup-equipment-${index}`, 'lookup_rules', {
              kind: 'equipment',
              name,
            }),
          ),
        ],
        stopReason: 'tool_use',
      },
      {
        text: '',
        toolCalls: [
          nativeCall('give-chain-mail', 'give_item', {
            id: 'chain-mail',
            name: 'Chain mail',
            quantity: 1,
            character: 'Bob',
          }),
          nativeCall('give-longsword', 'give_item', {
            id: 'longsword',
            name: 'Longsword',
            quantity: 1,
            character: 'Bob',
          }),
          nativeCall('give-shield', 'give_item', {
            id: 'shield',
            name: 'Shield',
            quantity: 1,
            character: 'Bob',
          }),
          nativeCall('give-light-crossbow', 'give_item', {
            id: 'light-crossbow',
            name: 'Light crossbow',
            quantity: 1,
            character: 'Bob',
          }),
          nativeCall('give-crossbow-bolts', 'give_item', {
            id: 'crossbow-bolts',
            name: 'Crossbow bolts',
            quantity: 20,
            character: 'Bob',
          }),
          nativeCall('give-dungeoneers-pack', 'give_item', {
            id: 'dungeoneers-pack',
            name: 'Dungeoneer’s Pack',
            quantity: 1,
            character: 'Bob',
          }),
        ],
        stopReason: 'tool_use',
      },
      { text: 'Bob is equipped and ready to adventure.' },
    ]);
    const auditModel = new StartingKitEvidenceAuditModel();
    const auditor = new ModelTurnAuditor(auditModel, 'starting-kit-audit');

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry(), auditor },
      {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        turnId: 'turn-starting-kit',
        playerInput:
          'Bob has an empty inventory. Give him a sensible 1st-level fighter starting kit.',
        seed: 42,
        at: '2026-05-20T10:00:00.000Z',
        maxToolRounds: 4,
      },
    );

    expect(result.ok).toBe(true);
    const lookups = result.toolCalls.filter(
      (call) => call.tool === 'lookup_rules',
    );
    expect(lookups).toHaveLength(7);
    for (const lookup of lookups) {
      expect(lookup.result, JSON.stringify(lookup.args)).toMatchObject({
        ok: true,
      });
    }
    expect(auditModel.seen).toHaveLength(1);

    const inventory = db
      .prepare(
        `SELECT id, name, quantity
         FROM inventory
         WHERE character_id = 'pc-1'
         ORDER BY id`,
      )
      .all();
    expect(inventory).toEqual([
      { id: 'chain-mail', name: 'Chain mail', quantity: 1 },
      { id: 'crossbow-bolts', name: 'Crossbow bolts', quantity: 20 },
      {
        id: 'dungeoneers-pack',
        name: 'Dungeoneer’s Pack',
        quantity: 1,
      },
      { id: 'light-crossbow', name: 'Light crossbow', quantity: 1 },
      { id: 'longsword', name: 'Longsword', quantity: 1 },
      { id: 'shield', name: 'Shield', quantity: 1 },
    ]);
    db.close();
  });
});
