import { describe, expect, it } from 'vitest';
import {
  createDefaultToolRegistry,
  ModelClientError,
  ModelRateLimitError,
  runTurn,
} from '../src/index.js';
import type { ModelClient, ModelCompleteResult } from '../src/internal.js';
import { listSceneLog, openScene } from '../src/internal.js';
import { freshDbWithSession } from './support/db.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';

class RateLimitModel implements ModelClient {
  constructor(private readonly retryAfterSeconds?: number) {}
  complete(): Promise<ModelCompleteResult> {
    return Promise.reject(
      new ModelRateLimitError(
        'Anthropic API rate limit: 429 rate_limit_error',
        this.retryAfterSeconds,
      ),
    );
  }
}

class GenericFailingModel implements ModelClient {
  complete(): Promise<ModelCompleteResult> {
    return Promise.reject(new Error('model unavailable'));
  }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    turnId: 'turn-1',
    playerInput: 'I look around.',
    seed: 42,
    at: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('ModelRateLimitError', () => {
  it('is instanceof ModelClientError and instanceof Error', () => {
    const err = new ModelRateLimitError('rate limit hit');
    expect(err).toBeInstanceOf(ModelRateLimitError);
    expect(err).toBeInstanceOf(ModelClientError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ModelRateLimitError');
    expect(err.message).toBe('rate limit hit');
  });

  it('carries retryAfterSeconds when provided', () => {
    const err = new ModelRateLimitError('too many requests', 30);
    expect(err.retryAfterSeconds).toBe(30);
  });

  it('retryAfterSeconds is undefined when not provided', () => {
    const err = new ModelRateLimitError('too many requests');
    expect(err.retryAfterSeconds).toBeUndefined();
  });
});

describe('runTurn rate-limit result', () => {
  it('sets isRateLimit=true when model throws ModelRateLimitError', async () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-0',
      title: 'The Tavern',
      at: '2026-05-20T09:00:00.000Z',
    });

    const result = await runTurn(
      {
        db,
        model: new RateLimitModel(),
        registry: createDefaultToolRegistry(),
      },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    expect(result.isRateLimit).toBe(true);
    db.close();
  });

  it('rolls back the turn savepoint on rate-limit failure', async () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-0',
      title: 'The Tavern',
      at: '2026-05-20T09:00:00.000Z',
    });

    await runTurn(
      {
        db,
        model: new RateLimitModel(),
        registry: createDefaultToolRegistry(),
      },
      baseInput(),
    );

    // Nothing should be written to the scene log.
    expect(
      listSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-0',
      }),
    ).toEqual([]);
    db.close();
  });

  it('includes retryAfterSeconds when the rate-limit error carries one', async () => {
    const db = freshDbWithSession();
    const result = await runTurn(
      {
        db,
        model: new RateLimitModel(60),
        registry: createDefaultToolRegistry(),
      },
      baseInput(),
    );

    expect(result.isRateLimit).toBe(true);
    expect(result.retryAfterSeconds).toBe(60);
    db.close();
  });

  it('omits retryAfterSeconds when none is available', async () => {
    const db = freshDbWithSession();
    const result = await runTurn(
      {
        db,
        model: new RateLimitModel(),
        registry: createDefaultToolRegistry(),
      },
      baseInput(),
    );

    expect(result.isRateLimit).toBe(true);
    expect(result.retryAfterSeconds).toBeUndefined();
    db.close();
  });

  it('sets isRateLimit=false for generic model failures', async () => {
    const db = freshDbWithSession();
    const result = await runTurn(
      {
        db,
        model: new GenericFailingModel(),
        registry: createDefaultToolRegistry(),
      },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    expect(result.isRateLimit).toBe(false);
    db.close();
  });

  it('sets isRateLimit=true when model throws ModelRateLimitError with session-limit text', async () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-0',
      title: 'The Tavern',
      at: '2026-05-20T09:00:00.000Z',
    });

    const sessionLimitModel: ModelClient = {
      complete: () =>
        Promise.reject(
          new ModelRateLimitError(
            "You've hit your session limit · resets 2:30am (America/Chicago)",
          ),
        ),
    };

    const result = await runTurn(
      {
        db,
        model: sessionLimitModel,
        registry: createDefaultToolRegistry(),
      },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    expect(result.isRateLimit).toBe(true);
    db.close();
  });

  it('sets isRateLimit=false on a successful turn', async () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-0',
      title: 'The Tavern',
      at: '2026-05-20T09:00:00.000Z',
    });
    const successModel: ModelClient = {
      complete: () =>
        Promise.resolve({
          text: 'You look around the tavern and see nothing unusual.',
        }),
    };

    const result = await runTurn(
      { db, model: successModel, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.isRateLimit).toBe(false);
    db.close();
  });
});
