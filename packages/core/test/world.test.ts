import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModulePack, PackLicense } from '../src/internal.js';
import {
  assertShippablePack,
  classifyVisibility,
  EMBERFALL_HOLLOW,
  evaluatePackPolicy,
  forkModuleIntoCampaign,
  initSchema,
  loadModuleFromDir,
  mutateState,
  openDatabase,
  queryCampaignOverlayLore,
  recordCampaignOverlayLore,
  toPlayerSafeView,
  validateModulePack,
  WorldModuleError,
  worldOverlayKey,
  worldQuery,
} from '../src/internal.js';

const tmpDirs: string[] = [];
const worldQuerySource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/world/worldQuery.ts'),
  'utf8',
);

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lw-world-'));
  tmpDirs.push(dir);
  return dir;
}

function clone(): ModulePack {
  return JSON.parse(JSON.stringify(EMBERFALL_HOLLOW)) as ModulePack;
}

describe('module schema validation', () => {
  it('accepts the original sample pack and enforces referential integrity', () => {
    const pack = validateModulePack(clone());
    expect(pack.meta.packId).toBe('eshyra:emberfall-hollow');
    expect(pack.locations.map((l) => l.id)).toContain('emberfall-square');
    expect(pack.encounters[0].creatures[0].rulesRef).toBe('creature:goblin');
    expect(pack.meta.rulesRequirements.baseSystemId).toBe('dnd5e-srd');
  });

  it('rejects a module pack missing meta.rulesRequirements', () => {
    const bad = clone();
    (bad.meta as { rulesRequirements?: unknown }).rulesRequirements = undefined;
    expect(() => validateModulePack(bad)).toThrow(WorldModuleError);
    expect(() => validateModulePack(bad)).toThrow(/rulesRequirements/);
  });

  it('rejects rulesRequirements missing baseSystemId', () => {
    const bad = clone();
    const reqs = bad.meta.rulesRequirements as { baseSystemId?: string };
    reqs.baseSystemId = undefined;
    expect(() => validateModulePack(bad)).toThrow(WorldModuleError);
    expect(() => validateModulePack(bad)).toThrow(/baseSystemId/);
  });

  it('rejects an encounter creature missing rulesRef', () => {
    const bad = clone();
    const creature = bad.encounters[0].creatures[0] as { rulesRef?: string };
    creature.rulesRef = undefined;
    expect(() => validateModulePack(bad)).toThrow(WorldModuleError);
    expect(() => validateModulePack(bad)).toThrow(/rulesRef/);
  });

  it('rejects a missing required field', () => {
    const bad = clone() as Record<string, unknown> & {
      meta: { title?: string };
    };
    bad.meta.title = undefined;
    expect(() => validateModulePack(bad)).toThrow(WorldModuleError);
  });

  it('rejects an unknown license class', () => {
    const bad = clone();
    (bad.meta.license as { licenseClass: string }).licenseClass = 'fair-use';
    expect(() => validateModulePack(bad)).toThrow(/licenseClass/);
  });

  it('rejects duplicate ids within a kind', () => {
    const bad = clone();
    (bad.locations as unknown[]).push(
      JSON.parse(JSON.stringify(bad.locations[0])),
    );
    expect(() => validateModulePack(bad)).toThrow(/duplicate id/);
  });

  it('rejects a starting location that does not resolve', () => {
    const bad = clone();
    (bad.meta as { startingLocationId: string }).startingLocationId = 'nowhere';
    expect(() => validateModulePack(bad)).toThrow(/startingLocationId/);
  });

  it('rejects an exit pointing at an unknown location', () => {
    const bad = clone();
    (
      bad.locations[0].exits as Array<{ toLocationId: string }>
    )[0].toLocationId = 'void';
    expect(() => validateModulePack(bad)).toThrow(/unknown location/);
  });

  it('rejects an encounter whose locationId does not resolve', () => {
    const bad = clone();
    (bad.encounters[0] as { locationId: string }).locationId = 'nowhere';
    expect(() => validateModulePack(bad)).toThrow(
      /encounters\[.*\] locationId/,
    );
  });

  it('rejects an npc whose locationId does not resolve', () => {
    const bad = clone();
    (bad.npcs[0] as { locationId: string }).locationId = 'nowhere';
    expect(() => validateModulePack(bad)).toThrow(/npcs\[.*\] locationId/);
  });

  it('rejects a location encounterIds reference that does not resolve', () => {
    const bad = clone();
    (bad.locations[0].encounterIds as string[]).push('ghost-encounter');
    expect(() => validateModulePack(bad)).toThrow(/unknown encounter/);
  });

  it('rejects a location npcIds reference that does not resolve', () => {
    const bad = clone();
    (bad.locations[0].npcIds as string[]).push('ghost-npc');
    expect(() => validateModulePack(bad)).toThrow(/unknown npc/);
  });

  it('rejects an entity id containing a colon', () => {
    const bad = clone();
    const extra = JSON.parse(JSON.stringify(bad.npcs[0])) as { id: string };
    extra.id = 'evil:npc';
    (bad.npcs as unknown[]).push(extra);
    expect(() => validateModulePack(bad)).toThrow(/must not contain/);
  });
});

describe('module pack loading', () => {
  it('loads an authored pack from a directory and leaves the file pristine', () => {
    const dir = tempDir();
    const file = join(dir, 'module.json');
    const original = JSON.stringify(EMBERFALL_HOLLOW, null, 2);
    writeFileSync(file, original, 'utf8');

    const pack = loadModuleFromDir(dir);
    const db = openDatabase(':memory:');
    initSchema(db);
    forkModuleIntoCampaign(db, pack);
    db.close();

    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('reports a parse error as WorldModuleError', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'module.json'), '{ not json', 'utf8');
    expect(() => loadModuleFromDir(dir)).toThrow(WorldModuleError);
  });
});

describe('pack license policy', () => {
  it('treats the original CC-BY sample as shippable', () => {
    const policy = evaluatePackPolicy(EMBERFALL_HOLLOW.meta.license);
    expect(policy.shippable).toBe(true);
    expect(policy.hostedAllowed).toBe(true);
    expect(() =>
      assertShippablePack(EMBERFALL_HOLLOW.meta.license),
    ).not.toThrow();
  });

  it('never ships a user-private pack', () => {
    const lic: PackLicense = {
      ...EMBERFALL_HOLLOW.meta.license,
      licenseClass: 'user-private',
    };
    const policy = evaluatePackPolicy(lic);
    expect(policy.shippable).toBe(false);
    expect(policy.reasons.join(' ')).toContain('user-private');
    expect(() => assertShippablePack(lic)).toThrow(WorldModuleError);
  });

  it('blocks trademarked setting material without a publisher license', () => {
    const lic: PackLicense = {
      ...EMBERFALL_HOLLOW.meta.license,
      licenseClass: 'original',
      containsTrademarkedSettingMaterial: true,
    };
    expect(evaluatePackPolicy(lic).shippable).toBe(false);

    const licensed: PackLicense = {
      ...lic,
      licenseClass: 'publisher-licensed',
    };
    expect(evaluatePackPolicy(licensed).shippable).toBe(true);
  });
});

describe('campaign fork + worldQuery', () => {
  function freshCampaign() {
    const db = openDatabase(':memory:');
    initSchema(db);
    forkModuleIntoCampaign(db, validateModulePack(clone()));
    return db;
  }

  it('forks the template into queryable rows', () => {
    const db = freshCampaign();
    const meta = worldQuery(db, { type: 'meta' });
    expect(meta).toMatchObject({
      ok: true,
      resolved: { packId: 'eshyra:emberfall-hollow' },
    });
    const npc = worldQuery(db, { type: 'npc', id: 'warden-sela' });
    expect(npc).toMatchObject({
      ok: true,
      resolved: { name: 'Warden Sela', disposition: 'wary but grateful' },
      overlays: [],
    });
    db.close();
  });

  it('re-forking is idempotent', () => {
    const db = freshCampaign();
    forkModuleIntoCampaign(db, validateModulePack(clone()));
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM module_location')
      .get() as { n: number };
    expect(rows.n).toBe(EMBERFALL_HOLLOW.locations.length);
    db.close();
  });

  it('an overlay fact overrides the template on later queries', () => {
    const db = freshCampaign();

    mutateState(db, {
      target: 'overlay_facts',
      field: worldOverlayKey('npc', 'warden-sela', 'disposition'),
      op: 'set',
      value: 'dead',
      provenance: 'combat:turn-9',
      sessionId: 'session-2',
      at: '2026-05-19T05:00:00.000Z',
    });

    const npc = worldQuery(db, { type: 'npc', id: 'warden-sela' });
    expect(npc.ok).toBe(true);
    if (npc.ok) {
      expect(npc.resolved.disposition).toBe('dead');
      expect(npc.template.disposition).toBe('wary but grateful');
      expect(npc.overlays).toEqual([
        {
          field: 'disposition',
          value: 'dead',
          provenance: 'combat:turn-9',
          sessionId: 'session-2',
          updatedAt: '2026-05-19T05:00:00.000Z',
        },
      ]);
    }
    db.close();
  });

  it('matches overlay keys exactly when ids contain LIKE wildcards', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const insertNpc = db.prepare(
      `INSERT INTO module_npc(id, name, location_id, data_json)
       VALUES (?, ?, ?, ?)`,
    );
    // Three ids that collide if '_' and '%' are treated as LIKE wildcards
    // rather than literals.
    insertNpc.run(
      'gob_lin',
      'Underscore',
      'loc-1',
      JSON.stringify({ mood: 'calm' }),
    );
    insertNpc.run(
      'gobXlin',
      'Decoy',
      'loc-1',
      JSON.stringify({ mood: 'calm' }),
    );
    insertNpc.run(
      'gob%lin',
      'Percent',
      'loc-1',
      JSON.stringify({ mood: 'calm' }),
    );

    const writeOverlay = (id: string, value: string) =>
      mutateState(db, {
        target: 'overlay_facts',
        field: worldOverlayKey('npc', id, 'mood'),
        op: 'set',
        value,
        provenance: 'test',
        sessionId: 'session-1',
        at: '2026-05-20T00:00:00.000Z',
      });

    writeOverlay('gobXlin', 'enraged');
    writeOverlay('gob_lin', 'wary');

    // '_' must match literally, not as a single-char wildcard: the underscore
    // id sees only its own overlay, never the decoy's.
    const underscore = worldQuery(db, { type: 'npc', id: 'gob_lin' });
    expect(underscore.ok).toBe(true);
    if (underscore.ok) {
      expect(underscore.resolved.mood).toBe('wary');
      expect(underscore.overlays.map((o) => o.value)).toEqual(['wary']);
    }

    // '%' must match literally, not as a multi-char wildcard: the percent id
    // has no overlay and must not absorb every other id's overlays.
    const percent = worldQuery(db, { type: 'npc', id: 'gob%lin' });
    expect(percent.ok).toBe(true);
    if (percent.ok) {
      expect(percent.resolved.mood).toBe('calm');
      expect(percent.overlays).toEqual([]);
    }
    db.close();
  });

  it('does not imply multi-row latest-wins overlay ordering', () => {
    expect(worldQuerySource).not.toContain('ORDER BY updated_at');
    expect(worldQuerySource).not.toContain('latest-wins');
  });

  it('returns not_found for unknown targets and missing ids', () => {
    const db = freshCampaign();
    expect(worldQuery(db, { type: 'npc', id: 'ghost' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    expect(worldQuery(db, { type: 'location' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    db.close();
  });

  it('returns campaign overlay lore alongside module canon by location', () => {
    const db = freshCampaign();
    recordCampaignOverlayLore(db, {
      id: 'hearthmere-old-renn-cart',
      kind: 'quest_hook',
      subjectText: 'Old Renn',
      locationId: 'emberfall-square',
      fact: 'Old Renn is missing along with his charcoal cart.',
      truthStatus: 'reported',
      source: 'dm_improvised',
      scope: 'campaign',
      visibility: 'player_visible',
      introducedAtTurnId: 'turn-1',
      introducedAtSessionId: 'session-1',
      tags: ['missing-cart', 'hearthmere'],
      provenance: 'model:turn-1',
      at: '2026-05-20T10:00:00.000Z',
    });

    const result = worldQuery(db, {
      type: 'location',
      id: 'emberfall-square',
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.type === 'location') {
      expect(result.evidence.map((entry) => entry.tier)).toContain(
        'module_canon',
      );
      expect(result.overlayLore).toEqual([
        expect.objectContaining({
          id: 'hearthmere-old-renn-cart',
          tier: 'rumor_belief',
          truthStatus: 'reported',
        }),
      ]);
    }
    db.close();
  });

  it('queries overlay lore by subject, tags, and specific id', () => {
    const db = freshCampaign();
    recordCampaignOverlayLore(db, {
      id: 'north-gate-axe-cuts',
      kind: 'clue',
      subjectText: 'north gate',
      fact: 'Fresh axe-cuts scar the north palisade.',
      truthStatus: 'observed',
      source: 'dm_improvised',
      scope: 'campaign',
      visibility: 'player_visible',
      introducedAtTurnId: 'turn-1',
      introducedAtSessionId: 'session-1',
      tags: ['north-gate', 'evidence'],
      provenance: 'model:turn-1',
      at: '2026-05-20T10:00:00.000Z',
    });

    expect(
      queryCampaignOverlayLore(db, {
        subject: 'north gate',
        tags: ['evidence'],
      }).map((record) => record.id),
    ).toEqual(['north-gate-axe-cuts']);

    expect(
      worldQuery(db, {
        type: 'overlay_lore',
        id: 'north-gate-axe-cuts',
      }),
    ).toMatchObject({
      ok: true,
      type: 'overlay_lore',
      records: [
        {
          id: 'north-gate-axe-cuts',
          tier: 'campaign_overlay_lore',
          truthStatus: 'observed',
        },
      ],
    });
    db.close();
  });

  it('discovers module and overlay records without exact ids', () => {
    const db = freshCampaign();
    recordCampaignOverlayLore(db, {
      id: 'old-renn-mule',
      kind: 'clue',
      subjectText: 'Old Renn mule',
      fact: "Old Renn's mule returned alone.",
      truthStatus: 'observed',
      source: 'dm_improvised',
      scope: 'campaign',
      visibility: 'player_visible',
      introducedAtTurnId: 'turn-1',
      introducedAtSessionId: 'session-1',
      tags: ['old-renn', 'mule'],
      provenance: 'model:turn-1',
      at: '2026-05-20T10:00:00.000Z',
    });

    const result = worldQuery(db, { type: 'search', query: 'Old Renn mule' });

    expect(result.ok).toBe(true);
    if (result.ok && result.type === 'search') {
      expect(result.results).toContainEqual(
        expect.objectContaining({
          tier: 'campaign_overlay_lore',
          type: 'overlay_lore',
          id: 'old-renn-mule',
        }),
      );
    }
    db.close();
  });

  it('does not make decorative color queryable unless promoted', () => {
    const db = freshCampaign();
    recordCampaignOverlayLore(db, {
      id: 'old-renn-mule',
      kind: 'clue',
      subjectText: 'Old Renn mule',
      fact: "Old Renn's mule returned alone.",
      truthStatus: 'observed',
      source: 'dm_improvised',
      scope: 'campaign',
      visibility: 'player_visible',
      introducedAtTurnId: 'turn-1',
      introducedAtSessionId: 'session-1',
      tags: ['old-renn', 'mule'],
      provenance: 'model:turn-1',
      at: '2026-05-20T10:00:00.000Z',
    });

    const result = worldQuery(db, { type: 'search', query: 'chipped cup' });

    expect(result.ok).toBe(true);
    if (result.ok && result.type === 'search') {
      expect(result.results).toEqual([]);
    }
    db.close();
  });
});

describe('world overlay key safety', () => {
  it('rejects a colon in an overlay id or field', () => {
    // Without this guard, ('a:b','c') and ('a','b:c') would build the same key.
    expect(() => worldOverlayKey('npc', 'a:b', 'mood')).toThrow(
      WorldModuleError,
    );
    expect(() => worldOverlayKey('location', 'crypt', 'door:open')).toThrow(
      WorldModuleError,
    );
  });

  it('builds a normal overlay key unchanged', () => {
    expect(worldOverlayKey('npc', 'warden-sela', 'disposition')).toBe(
      'world:npc:warden-sela:disposition',
    );
  });
});

describe('world entity visibility', () => {
  function freshCampaign() {
    const db = openDatabase(':memory:');
    initSchema(db);
    forkModuleIntoCampaign(db, validateModulePack(clone()));
    return db;
  }

  describe('classifyVisibility', () => {
    it('marks npc as mixed with secret as DM-only', () => {
      const result = classifyVisibility('npc', {
        id: 'x',
        name: 'Test',
        secret: 'hidden',
      });
      expect(result.visibility).toBe('mixed');
      expect(result.dmOnlyFields).toEqual(['secret']);
    });

    it('marks dm-scope lore as entirely DM-only', () => {
      const result = classifyVisibility('lore', {
        id: 'x',
        title: 'Secret Lore',
        text: 'hidden text',
        scope: 'dm',
      });
      expect(result.visibility).toBe('dm');
      expect(result.dmOnlyFields).toEqual([]);
    });

    it('marks public-scope lore as public', () => {
      const result = classifyVisibility('lore', {
        id: 'x',
        title: 'Known Lore',
        text: 'common knowledge',
        scope: 'public',
      });
      expect(result.visibility).toBe('public');
    });

    it('marks location, encounter, and meta as public', () => {
      expect(classifyVisibility('location', { id: 'x' }).visibility).toBe(
        'public',
      );
      expect(classifyVisibility('encounter', { id: 'x' }).visibility).toBe(
        'public',
      );
      expect(classifyVisibility('meta', { packId: 'x' }).visibility).toBe(
        'public',
      );
    });
  });

  describe('worldQuery visibility annotations', () => {
    it('annotates an NPC query with mixed visibility', () => {
      const db = freshCampaign();
      const result = worldQuery(db, { type: 'npc', id: 'warden-sela' });
      expect(result).toMatchObject({
        ok: true,
        visibility: 'mixed',
        dmOnlyFields: ['secret'],
      });
      db.close();
    });

    it('annotates dm-scope lore as DM-only', () => {
      const db = freshCampaign();
      const result = worldQuery(db, { type: 'lore', id: 'the-hollow-truth' });
      expect(result).toMatchObject({
        ok: true,
        visibility: 'dm',
        dmOnlyFields: [],
      });
      db.close();
    });

    it('annotates public-scope lore as public', () => {
      const db = freshCampaign();
      const result = worldQuery(db, {
        type: 'lore',
        id: 'why-emberfall-burned',
      });
      expect(result).toMatchObject({
        ok: true,
        visibility: 'public',
        dmOnlyFields: [],
      });
      db.close();
    });

    it('annotates a location as public', () => {
      const db = freshCampaign();
      const result = worldQuery(db, {
        type: 'location',
        id: 'emberfall-square',
      });
      expect(result).toMatchObject({
        ok: true,
        visibility: 'public',
        dmOnlyFields: [],
      });
      db.close();
    });
  });

  describe('toPlayerSafeView', () => {
    it('strips the secret field from an NPC result', () => {
      const db = freshCampaign();
      const result = worldQuery(db, { type: 'npc', id: 'warden-sela' });
      if (!result.ok) throw new Error('expected ok');
      const safe = toPlayerSafeView(result);
      if (safe === undefined) throw new Error('expected defined');
      expect(safe.name).toBe('Warden Sela');
      expect(safe.disposition).toBe('wary but grateful');
      expect(safe.secret).toBeUndefined();
      db.close();
    });

    it('returns undefined for a DM-only lore entity', () => {
      const db = freshCampaign();
      const result = worldQuery(db, { type: 'lore', id: 'the-hollow-truth' });
      if (!result.ok) throw new Error('expected ok');
      expect(toPlayerSafeView(result)).toBeUndefined();
      db.close();
    });

    it('returns the full resolved record for a public entity', () => {
      const db = freshCampaign();
      const result = worldQuery(db, {
        type: 'location',
        id: 'emberfall-square',
      });
      if (!result.ok) throw new Error('expected ok');
      const safe = toPlayerSafeView(result);
      expect(safe).toEqual(result.resolved);
      db.close();
    });

    it('respects overlays when projecting player-safe NPC data', () => {
      const db = freshCampaign();
      mutateState(db, {
        target: 'overlay_facts',
        field: worldOverlayKey('npc', 'warden-sela', 'disposition'),
        op: 'set',
        value: 'friendly',
        provenance: 'test',
        sessionId: 'session-1',
        at: '2026-05-26T00:00:00.000Z',
      });
      const result = worldQuery(db, { type: 'npc', id: 'warden-sela' });
      if (!result.ok) throw new Error('expected ok');
      const safe = toPlayerSafeView(result);
      if (safe === undefined) throw new Error('expected defined');
      expect(safe.disposition).toBe('friendly');
      expect(safe.secret).toBeUndefined();
      db.close();
    });
  });
});
