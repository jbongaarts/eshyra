import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Ownership analyzer for the discovery ↔ `eshyra-jhpt` boundary
 * (`eshyra-o9bd.19.13`, W11).
 *
 * Design section 8.4 forbids discovery from owning a campaign-rule or ruling
 * schema, store, cache of record, recording tool, active-rule resolver, or
 * supersession/revocation lifecycle. An earlier revision of this check scanned
 * one directory level for a list of symbol spellings, which is why it reported
 * green on the very PR that introduced a local ruling schema: the prohibited
 * shape simply used none of the banned words. A checker that recognizes
 * spellings tests the spellings, not the invariant.
 *
 * This analyzer is a pure function over module text so the checker's own
 * rejection behavior is provable: `discoveryOwnershipBoundary.test.ts` feeds it
 * a synthetic module for each prohibited class — including a replay of the
 * exact shape the previous checker missed — and asserts each is reported,
 * before running it over the real tree and asserting none.
 */

export interface OwnershipModule {
  readonly path: string;
  readonly text: string;
}

export interface OwnershipViolation {
  readonly path: string;
  readonly kind:
    | 'unreviewed-dependency'
    | 'dynamic-module-load'
    | 'local-rule-schema'
    | 'module-scope-mutable-binding'
    | 'module-scope-mutable-container';
  readonly detail: string;
}

/**
 * Every module outside the discovery tree that discovery is reviewed to
 * depend on. The list is the point: an indirect helper — say a
 * `../state/rulingCache.js` — cannot be reached without adding a line here,
 * which makes the dependency a deliberate, reviewable act rather than
 * something that slips in behind a check that only looked at `/campaign/`.
 *
 * `../campaign/campaignRules.js` is the shared read vocabulary and the ONLY
 * campaign module on the list. Writers, resolvers, the position allocator and
 * the context assembler all stay on jhpt's side of the seam.
 */
export const REVIEWED_FOREIGN_DEPENDENCIES: readonly string[] = [
  '../adventure/types.js',
  '../campaign/campaignRules.js',
  // W9 (`eshyra-o9bd.19.11`) additions. None is a campaign-rule owner:
  // `turnTrace` is the accepted-turn trace authority design section 12.2 names
  // as the attachment point for shadow evidence; `lookup`, `bundledSrdPack`
  // and the two `toolSchema` modules are what the capture-time B1, B3 and B4
  // blocker probes observe. `campaignRuleStore` is deliberately still ABSENT —
  // the runtime hands discovery a bound read seam rather than letting it build
  // one.
  '../memory/turnTrace.js',
  '../model/toolSchema.js',
  '../model/toolSchemaValidation.js',
  '../persistence/db.js',
  '../rules/bundledSrdPack.js',
  '../rules/conditionRelations.js',
  // `eshyra-o9bd.19.12.11` (W10 F1-rr repair): the packet builder reads the
  // pack-emitted field-provenance classification (`fieldProvenance.ts`,
  // owned by `eshyra-o9bd.19.1.3.1`) instead of guessing a source/projection
  // boundary from container names. It is a plain read of a classification
  // table, not a rule/ruling owner — same review basis as the other `rules/`
  // entries already on this list.
  '../rules/fieldProvenance.js',
  '../rules/lookup.js',
  '../rules/stack.js',
  '../rules/types.js',
  '../state/campaignRecordLookup.js',
  '../state/itemExecutionReadiness.js',
  '../state/itemState.js',
];

/**
 * Field names that constitute a campaign rule or ruling as jhpt models it.
 *
 * Naming a rule is not owning one: a trace that records
 * `{ ruleIdentity, governingRecordKey }` is reporting what happened, and both
 * `RuleJoinTrace` and the M5 measurement legitimately do so. What discovery may
 * not do is DECLARE a shape that carries the interpretation decision or the
 * lifecycle — that shape belongs to the owner.
 */
const RULING_DECISION_FIELD = 'selectedInterpretationId';
const RULE_LIFECYCLE_FIELDS: readonly string[] = [
  'ruleKind',
  'ambiguityId',
  'governingRecordKeys',
  'effectivePosition',
  'supersededBy',
  'revokedPosition',
];

const MUTABLE_CONTAINERS: readonly string[] = [
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
];

/** Recursively collect every TypeScript module under `dir`. */
export function readDiscoverySources(dir: string): OwnershipModule[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return readDiscoverySources(path);
    return entry.isFile() && path.endsWith('.ts')
      ? [{ path, text: readFileSync(path, 'utf8') }]
      : [];
  });
}

/**
 * Every module specifier this source reaches, and every dynamic load.
 *
 * An import declaration is not the only way to name a module. A TypeScript
 * import type — `import('../state/x.js').T` — reaches one from inside a type
 * annotation and appears in no import declaration; discovery uses that form
 * today, and an earlier revision of this analyzer walked only the statement
 * list and never saw it. A runtime `import()` or `require()` would not appear
 * in a static list at all, so those are reported rather than resolved.
 */
function moduleReferences(source: ts.SourceFile): {
  readonly specifiers: string[];
  readonly dynamicLoads: string[];
} {
  const specifiers: string[] = [];
  const dynamicLoads: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      specifiers.push(node.argument.literal.text);
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        dynamicLoads.push('import()');
      else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require'
      )
        dynamicLoads.push('require()');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, dynamicLoads };
}

/** Member names a declaration introduces, ignoring types it merely references. */
function declaredMemberNames(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (child: ts.Node): void => {
    if (
      (ts.isPropertySignature(child) || ts.isPropertyDeclaration(child)) &&
      child.name !== undefined &&
      ts.isIdentifier(child.name)
    )
      names.push(child.name.text);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return names;
}

/**
 * Whether a module-scope initializer builds a mutable container.
 *
 * Function bodies are not descended into: a `new Map()` inside a stage function
 * is per-call working state that dies with the call, which is precisely what a
 * store is not.
 */
function buildsMutableContainer(node: ts.Node): string | undefined {
  let found: string | undefined;
  const visit = (child: ts.Node): void => {
    if (found !== undefined || ts.isFunctionLike(child)) return;
    if (
      ts.isNewExpression(child) &&
      ts.isIdentifier(child.expression) &&
      MUTABLE_CONTAINERS.includes(child.expression.text)
    ) {
      found = child.expression.text;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** Report every ownership violation in the given discovery modules. */
export function findOwnershipViolations(
  modules: readonly OwnershipModule[],
): OwnershipViolation[] {
  const violations: OwnershipViolation[] = [];
  for (const { path, text } of modules) {
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );

    const references = moduleReferences(source);
    for (const form of references.dynamicLoads)
      violations.push({ path, kind: 'dynamic-module-load', detail: form });
    for (const specifier of references.specifiers) {
      if (specifier.startsWith('./')) continue;
      if (REVIEWED_FOREIGN_DEPENDENCIES.includes(specifier)) continue;
      violations.push({
        path,
        kind: 'unreviewed-dependency',
        detail: specifier,
      });
    }

    for (const statement of source.statements) {
      if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)
      ) {
        const members = declaredMemberNames(statement);
        const lifecycle = RULE_LIFECYCLE_FIELDS.filter((field) =>
          members.includes(field),
        );
        if (members.includes(RULING_DECISION_FIELD) || lifecycle.length >= 2)
          violations.push({
            path,
            kind: 'local-rule-schema',
            detail: `${statement.name?.text ?? '(anonymous)'} declares ${[
              ...(members.includes(RULING_DECISION_FIELD)
                ? [RULING_DECISION_FIELD]
                : []),
              ...lifecycle,
            ].join(', ')}`,
          });
      }

      if (!ts.isVariableStatement(statement)) continue;
      const isConst =
        (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (!isConst) {
        violations.push({
          path,
          kind: 'module-scope-mutable-binding',
          detail: statement.declarationList.declarations
            .map((declaration) => declaration.name.getText(source))
            .join(', '),
        });
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        const container =
          declaration.initializer === undefined
            ? undefined
            : buildsMutableContainer(declaration.initializer);
        if (container !== undefined)
          violations.push({
            path,
            kind: 'module-scope-mutable-container',
            detail: `${declaration.name.getText(source)} = new ${container}()`,
          });
      }
    }
  }
  return violations;
}
