import { RulesPackError } from './types.js';

type Obj = Record<string, unknown>;

export interface RulesAmbiguity {
  readonly id: string;
  readonly question: string;
  readonly source: readonly {
    readonly locator: string;
    readonly clauseId: string;
  }[];
  readonly affects: readonly string[];
  readonly interpretations: readonly {
    readonly id: string;
    readonly summary: string;
  }[];
  readonly canonicalResolution: null;
  readonly runtimeDisposition: {
    readonly status: 'engine-pending';
    readonly owner: 'campaign-ruling';
  };
}

function requireOnlyKeys(
  obj: Obj,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      throw new RulesPackError(
        `${path} has unsupported key ${JSON.stringify(key)}`,
      );
    }
  }
}

function objectArray(
  parent: Obj,
  key: string,
  path: string,
): Obj[] | undefined {
  const value = parent[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an array when present`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new RulesPackError(`${path}.${key}[${index}] must be an object`);
    }
    return item as Obj;
  });
}

function requiredString(parent: Obj, key: string, path: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new RulesPackError(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function requiredStringArray(
  parent: Obj,
  key: string,
  path: string,
): readonly string[] {
  const value = parent[key];
  if (!Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an array`);
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new RulesPackError(
        `${path}.${key}[${index}] must be a non-empty string`,
      );
    }
  });
  return value as readonly string[];
}

function requiredObject(parent: Obj, key: string, path: string): Obj {
  const value = parent[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be a non-null object`);
  }
  return value as Obj;
}

export function optRulesAmbiguities(
  mechanics: Obj,
  path: string,
): ReadonlySet<string> {
  const entries = objectArray(mechanics, 'ambiguities', path);
  if (entries === undefined) return new Set();
  if (entries.length === 0) {
    throw new RulesPackError(`${path}.ambiguities must not be empty`);
  }
  const ids = new Set<string>();
  entries.forEach((ambiguity, index) => {
    const ambiguityPath = `${path}.ambiguities[${index}]`;
    requireOnlyKeys(
      ambiguity,
      [
        'id',
        'question',
        'source',
        'affects',
        'interpretations',
        'canonicalResolution',
        'runtimeDisposition',
      ],
      ambiguityPath,
    );
    const id = requiredString(ambiguity, 'id', ambiguityPath);
    if (!/^ambiguity:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new RulesPackError(
        `${ambiguityPath}.id must be a stable ambiguity:<kebab-case> ID`,
      );
    }
    if (ids.has(id)) {
      throw new RulesPackError(`${ambiguityPath}.id must be unique`);
    }
    ids.add(id);
    requiredString(ambiguity, 'question', ambiguityPath);
    const sources = objectArray(ambiguity, 'source', ambiguityPath);
    if (sources === undefined || sources.length === 0) {
      throw new RulesPackError(`${ambiguityPath}.source must be non-empty`);
    }
    const sourceKeys = new Set<string>();
    sources.forEach((source, sourceIndex) => {
      const sourcePath = `${ambiguityPath}.source[${sourceIndex}]`;
      requireOnlyKeys(source, ['locator', 'clauseId'], sourcePath);
      const locator = requiredString(source, 'locator', sourcePath);
      const clauseId = requiredString(source, 'clauseId', sourcePath);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clauseId)) {
        throw new RulesPackError(
          `${sourcePath}.clauseId must be a stable kebab-case clause ID`,
        );
      }
      const sourceKey = `${locator}:${clauseId}`;
      if (sourceKeys.has(sourceKey)) {
        throw new RulesPackError(`${sourcePath} duplicates a source binding`);
      }
      sourceKeys.add(sourceKey);
    });
    const affects = requiredStringArray(ambiguity, 'affects', ambiguityPath);
    if (affects.length === 0 || new Set(affects).size !== affects.length) {
      throw new RulesPackError(
        `${ambiguityPath}.affects must be non-empty and unique`,
      );
    }
    const interpretations = objectArray(
      ambiguity,
      'interpretations',
      ambiguityPath,
    );
    if (interpretations === undefined || interpretations.length < 2) {
      throw new RulesPackError(
        `${ambiguityPath}.interpretations must contain at least two entries`,
      );
    }
    const interpretationIds = new Set<string>();
    interpretations.forEach((interpretation, interpretationIndex) => {
      const interpretationPath = `${ambiguityPath}.interpretations[${interpretationIndex}]`;
      requireOnlyKeys(interpretation, ['id', 'summary'], interpretationPath);
      const interpretationId = requiredString(
        interpretation,
        'id',
        interpretationPath,
      );
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(interpretationId)) {
        throw new RulesPackError(
          `${interpretationPath}.id must be a stable kebab-case ID`,
        );
      }
      if (interpretationIds.has(interpretationId)) {
        throw new RulesPackError(`${interpretationPath}.id must be unique`);
      }
      interpretationIds.add(interpretationId);
      requiredString(interpretation, 'summary', interpretationPath);
    });
    if (ambiguity.canonicalResolution !== null) {
      throw new RulesPackError(
        `${ambiguityPath}.canonicalResolution must be null`,
      );
    }
    const disposition = requiredObject(
      ambiguity,
      'runtimeDisposition',
      ambiguityPath,
    );
    requireOnlyKeys(
      disposition,
      ['status', 'owner'],
      `${ambiguityPath}.runtimeDisposition`,
    );
    if (
      disposition.status !== 'engine-pending' ||
      disposition.owner !== 'campaign-ruling'
    ) {
      throw new RulesPackError(
        `${ambiguityPath}.runtimeDisposition must declare engine-pending campaign-ruling ownership`,
      );
    }
  });
  return ids;
}

/** Validate every ambiguity reference anywhere in a mechanics subtree. */
export function validateAmbiguityReferences(
  mechanics: Obj,
  ambiguityIds: ReadonlySet<string>,
  path: string,
): void {
  const referenced = new Set<string>();
  const visit = (value: unknown, valuePath: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, `${valuePath}[${index}]`);
      });
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const object = value as Obj;
    if (typeof object.ambiguityId === 'string') {
      if (!ambiguityIds.has(object.ambiguityId)) {
        throw new RulesPackError(
          `${valuePath}.ambiguityId references unknown mechanics ambiguity ${JSON.stringify(object.ambiguityId)}`,
        );
      }
      referenced.add(object.ambiguityId);
    }
    for (const [key, entry] of Object.entries(object)) {
      visit(entry, `${valuePath}.${key}`);
    }
  };
  visit(mechanics, path);
  for (const ambiguityId of ambiguityIds) {
    if (!referenced.has(ambiguityId)) {
      throw new RulesPackError(
        `${path}.ambiguities declares ${JSON.stringify(ambiguityId)} without an affected mechanic reference`,
      );
    }
  }
}
